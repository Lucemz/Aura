const { app } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const net = require('net');

/**
 * Finds an installed Chromium-based desktop browser on macOS (Google Chrome, Brave, or Edge)
 */
function findSystemChromiumBrowser() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(
      process.env.HOME || '',
      'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    ),
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Finds an available localhost TCP port for Chrome DevTools Protocol
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Simple HTTP GET JSON helper for localhost CDP endpoints
 */
function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
  });
}

/**
 * Minimal zero-dependency RFC6455 WebSocket client to send a single CDP command
 * (e.g. Network.getAllCookies or Runtime.evaluate) and receive the full JSON response.
 */
function callCdpCommand(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');

    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });

    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error('CDP command timeout'));
    }, 6000);

    req.on('upgrade', (res, socket) => {
      const payload = Buffer.from(JSON.stringify({ id: 1, method, params }), 'utf8');
      const mask = crypto.randomBytes(4);
      let header;

      if (payload.length < 126) {
        header = Buffer.alloc(6);
        header[0] = 0x81; // FIN + text frame
        header[1] = 0x80 | payload.length; // Masked + length
        mask.copy(header, 2);
      } else {
        header = Buffer.alloc(8);
        header[0] = 0x81;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(payload.length, 2);
        mask.copy(header, 4);
      }

      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) {
        masked[i] = payload[i] ^ mask[i % 4];
      }

      socket.write(Buffer.concat([header, masked]));

      let recvBuf = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        recvBuf = Buffer.concat([recvBuf, chunk]);
        while (recvBuf.length >= 2) {
          let offset = 2;
          let len = recvBuf[1] & 0x7f;
          if (len === 126) {
            if (recvBuf.length < 4) return;
            len = recvBuf.readUInt16BE(2);
            offset = 4;
          } else if (len === 127) {
            if (recvBuf.length < 10) return;
            len = Number(recvBuf.readBigUInt64BE(2));
            offset = 10;
          }

          if (recvBuf.length < offset + len) return;

          const frameData = recvBuf.slice(offset, offset + len);
          recvBuf = recvBuf.slice(offset + len);

          try {
            const msg = JSON.parse(frameData.toString('utf8'));
            if (msg.id === 1) {
              clearTimeout(timeout);
              socket.destroy();
              return resolve(msg.result);
            }
          } catch (e) {
            // Ignore non-JSON frames
          }
        }
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    req.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    req.end();
  });
}

/**
 * Injects an array of CDP Cookie objects into an Electron Session partition
 */
async function injectCdpCookiesIntoElectronSession(cookies, electronSession) {
  let injectedCount = 0;
  for (const c of cookies) {
    if (!c.name || !c.domain) continue;
    if (
      !c.domain.includes('youtube.com') &&
      !c.domain.includes('google.com') &&
      !c.domain.includes('googleapis.com')
    ) {
      continue;
    }

    const cleanDomain = c.domain.startsWith('.') ? c.domain.slice(1) : c.domain;
    const protocol = c.secure ? 'https://' : 'http://';
    const url = `${protocol}${cleanDomain}${c.path || '/'}`;

    const cookieDetails = {
      url,
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      secure: Boolean(c.secure),
      httpOnly: Boolean(c.httpOnly),
    };

    if (c.expires && c.expires > 0) {
      cookieDetails.expirationDate = c.expires;
    }

    if (c.sameSite) {
      const ss = c.sameSite.toLowerCase();
      if (ss === 'none') cookieDetails.sameSite = 'no_restriction';
      else if (ss === 'lax') cookieDetails.sameSite = 'lax';
      else if (ss === 'strict') cookieDetails.sameSite = 'strict';
    }

    try {
      await electronSession.cookies.set(cookieDetails);
      injectedCount++;
    } catch (e) {
      try {
        delete cookieDetails.domain;
        await electronSession.cookies.set(cookieDetails);
        injectedCount++;
      } catch (err2) {}
    }
  }

  try {
    await electronSession.cookies.flushStore();
  } catch (e) {}

  console.log(`[BrowserAuth] Injected ${injectedCount} real browser cookies into Electron session!`);
  return injectedCount;
}

let activeAuthProcess = null;

/**
 * Launches the system's REAL Google Chrome browser to authenticate with Google / YouTube Music,
 * captures all session tokens & HttpOnly cookies via CDP once logged in, injects them into Electron,
 * and closes the external browser window automatically.
 */
async function loginViaExternalBrowser(electronSession, onAuthSuccessCallback) {
  if (activeAuthProcess) {
    try {
      activeAuthProcess.kill('SIGTERM');
    } catch (e) {}
    activeAuthProcess = null;
  }

  const browserBinary = findSystemChromiumBrowser();
  if (!browserBinary) {
    throw new Error('No se encontró Google Chrome instalado en el sistema.');
  }

  const debugPort = await getFreePort();
  const profileDir = path.join(app.getPath('userData'), 'chrome-auth-profile');
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const loginUrl =
    'https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Des%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F%26feature%3Dsign_in_button&hl=es';

  console.log(`[BrowserAuth] Launching real Chrome on port ${debugPort} for Google Login...`);

  return new Promise((resolve) => {
    let finished = false;
    let pollTimer = null;

    const cleanup = (success) => {
      if (finished) return;
      finished = true;
      if (pollTimer) clearInterval(pollTimer);
      if (activeAuthProcess) {
        try {
          activeAuthProcess.kill('SIGTERM');
        } catch (e) {}
        activeAuthProcess = null;
      }
      resolve(success);
    };

    const proc = spawn(
      browserBinary,
      [
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=560,740',
        `--app=${loginUrl}`,
      ],
      {
        detached: false,
        stdio: 'ignore',
      }
    );

    activeAuthProcess = proc;

    proc.on('exit', () => {
      cleanup(false);
    });

    pollTimer = setInterval(async () => {
      if (finished) return;
      try {
        const targets = await httpGetJson(`http://127.0.0.1:${debugPort}/json`);
        const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!pageTarget) return;

        const currentUrl = pageTarget.url || '';
        const isOnYouTubeMusic = currentUrl.startsWith('https://music.youtube.com');

        if (isOnYouTubeMusic) {
          const result = await callCdpCommand(
            pageTarget.webSocketDebuggerUrl,
            'Network.getAllCookies'
          );
          const cookies = result?.cookies || [];

          const hasSapisid = cookies.some(
            (c) =>
              (c.name === 'SAPISID' || c.name === '__Secure-3PAPISID') &&
              c.domain.includes('youtube.com')
          );
          const hasSid = cookies.some(
            (c) =>
              (c.name === 'SID' || c.name === '__Secure-3PSID') &&
              c.domain.includes('youtube.com')
          );

          if (hasSapisid && hasSid) {
            console.log(
              '[BrowserAuth] Google login verified in external Chrome! Extracting session tokens...'
            );
            await injectCdpCookiesIntoElectronSession(cookies, electronSession);
            if (onAuthSuccessCallback) {
              onAuthSuccessCallback();
            }
            cleanup(true);
          }
        }
      } catch (e) {
        // Chrome still initializing or navigating
      }
    }, 1000);
  });
}

/**
 * Launches REAL Google Chrome to log in to Spotify (so 'Continue with Google/Apple' works without errors)
 * and extracts the live Web Player accessToken over CDP once the user reaches open.spotify.com.
 */
async function loginSpotifyViaExternalBrowser() {
  if (activeAuthProcess) {
    try {
      activeAuthProcess.kill('SIGTERM');
    } catch (e) {}
    activeAuthProcess = null;
  }

  const browserBinary = findSystemChromiumBrowser();
  if (!browserBinary) return null;

  const debugPort = await getFreePort();
  const profileDir = path.join(app.getPath('userData'), 'chrome-auth-profile');
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const loginUrl =
    'https://accounts.spotify.com/es/login?continue=https%3A%2F%2Fopen.spotify.com%2F';

  return new Promise((resolve) => {
    let finished = false;
    let pollTimer = null;

    const cleanup = (token) => {
      if (finished) return;
      finished = true;
      if (pollTimer) clearInterval(pollTimer);
      if (activeAuthProcess) {
        try {
          activeAuthProcess.kill('SIGTERM');
        } catch (e) {}
        activeAuthProcess = null;
      }
      resolve(token);
    };

    const proc = spawn(
      browserBinary,
      [
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=560,740',
        `--app=${loginUrl}`,
      ],
      { detached: false, stdio: 'ignore' }
    );

    activeAuthProcess = proc;
    proc.on('exit', () => cleanup(null));

    pollTimer = setInterval(async () => {
      if (finished) return;
      try {
        const targets = await httpGetJson(`http://127.0.0.1:${debugPort}/json`);
        const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!pageTarget) return;

        const currentUrl = pageTarget.url || '';
        if (currentUrl.startsWith('https://open.spotify.com')) {
          const evalRes = await callCdpCommand(pageTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
            expression: `
              (async () => {
                try {
                  const r = await fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', { credentials: 'include' });
                  const d = await r.json();
                  if (d && d.accessToken && !d.isAnonymous) return d.accessToken;
                } catch (e) {}
                return null;
              })()
            `,
            awaitPromise: true,
            returnByValue: true,
          });

          const token = evalRes?.result?.value;
          if (token && typeof token === 'string' && token.length > 30) {
            console.log('[BrowserAuth] Extracted Spotify accessToken from external Chrome!');
            cleanup(token);
          }
        }
      } catch (e) {}
    }, 1200);
  });
}

/**
 * Launches REAL Google Chrome to log in to Apple Music and extracts developerToken + musicUserToken via CDP
 */
async function loginAppleMusicViaExternalBrowser() {
  if (activeAuthProcess) {
    try {
      activeAuthProcess.kill('SIGTERM');
    } catch (e) {}
    activeAuthProcess = null;
  }

  const browserBinary = findSystemChromiumBrowser();
  if (!browserBinary) return null;

  const debugPort = await getFreePort();
  const profileDir = path.join(app.getPath('userData'), 'chrome-auth-profile');
  if (!fs.existsSync(profileDir)) {
    fs.mkdirSync(profileDir, { recursive: true });
  }

  const loginUrl = 'https://music.apple.com/es/home';

  return new Promise((resolve) => {
    let finished = false;
    let pollTimer = null;

    const cleanup = (tokens) => {
      if (finished) return;
      finished = true;
      if (pollTimer) clearInterval(pollTimer);
      if (activeAuthProcess) {
        try {
          activeAuthProcess.kill('SIGTERM');
        } catch (e) {}
        activeAuthProcess = null;
      }
      resolve(tokens);
    };

    const proc = spawn(
      browserBinary,
      [
        `--user-data-dir=${profileDir}`,
        `--remote-debugging-port=${debugPort}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=620,760',
        `--app=${loginUrl}`,
      ],
      { detached: false, stdio: 'ignore' }
    );

    activeAuthProcess = proc;
    proc.on('exit', () => cleanup(null));

    pollTimer = setInterval(async () => {
      if (finished) return;
      try {
        const targets = await httpGetJson(`http://127.0.0.1:${debugPort}/json`);
        const pageTarget = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        if (!pageTarget) return;

        const currentUrl = pageTarget.url || '';
        if (currentUrl.includes('music.apple.com')) {
          const evalRes = await callCdpCommand(pageTarget.webSocketDebuggerUrl, 'Runtime.evaluate', {
            expression: `
              (() => {
                try {
                  const mk = window.MusicKit && window.MusicKit.getInstance && window.MusicKit.getInstance();
                  if (mk && mk.isAuthorized && mk.musicUserToken && mk.developerToken) {
                    return { developerToken: mk.developerToken, musicUserToken: mk.musicUserToken };
                  }
                } catch (e) {}
                return null;
              })()
            `,
            returnByValue: true,
          });

          const tokens = evalRes?.result?.value;
          if (tokens && tokens.developerToken && tokens.musicUserToken) {
            console.log('[BrowserAuth] Extracted Apple Music tokens from external Chrome!');
            cleanup(tokens);
          }
        }
      } catch (e) {}
    }, 1200);
  });
}

function clearExternalBrowserProfile() {
  try {
    const profileDir = path.join(app.getPath('userData'), 'chrome-auth-profile');
    if (fs.existsSync(profileDir)) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  } catch (e) {}
}

module.exports = {
  loginViaExternalBrowser,
  loginSpotifyViaExternalBrowser,
  loginAppleMusicViaExternalBrowser,
  clearExternalBrowserProfile,
};
