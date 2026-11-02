const { app, BrowserWindow, ipcMain, globalShortcut, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { startStaticServer } = require('./server.cjs');
const {
  getCookiesDataFromSession,
  buildSapisidHashHeader,
  searchYouTubeMusicTrack,
  likeSongOnYouTubeMusic,
  createPlaylistOnYouTubeMusic,
  addVideosToYouTubePlaylist,
  getUserProfile,
} = require('./youtubeMusic.cjs');
const {
  connectSpotifyAccount,
  getSpotifyPlaylistTracks,
  connectAppleMusicAccount,
  getApplePlaylistTracks,
  parseExternalMusicUrl,
} = require('./musicImporter.cjs');

// Bypass Chromium's autoplay policy for seamless background/instant playback
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling');

let mainWindow = null;
let isMiniPlayer = false;
let previousBounds = null;
let staticServer = null;

const SESSION_PARTITION = 'persist:aura-user-session';
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function createWindow() {
  const sess = session.fromPartition(SESSION_PARTITION);
  sess.setUserAgent(CHROME_UA);

  // 1. Silent Ad-Blocker for YouTube Music network requests
  sess.webRequest.onBeforeRequest(
    {
      urls: [
        '*://*.doubleclick.net/*',
        '*://*.googleads.g.doubleclick.net/*',
        '*://*.youtube.com/api/stats/ads*',
        '*://*.youtube.com/pagead/*',
        '*://*.googlesyndication.com/*',
      ],
    },
    (details, callback) => {
      if (
        details.url.includes('accounts.google.com') ||
        details.url.includes('accounts.youtube.com') ||
        details.url.includes('gstatic.com') ||
        details.url.includes('signin') ||
        details.url.includes('ServiceLogin')
      ) {
        return callback({ cancel: false });
      }
      callback({ cancel: true });
    }
  );

  // 2. Strip X-Frame-Options & CSP frame-ancestors so music.youtube.com works in iframe / webview
  sess.webRequest.onHeadersReceived(
    { urls: ['*://*.youtube.com/*', '*://*.google.com/*'] },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      for (const key of Object.keys(responseHeaders)) {
        const lower = key.toLowerCase();
        if (lower === 'x-frame-options' || lower === 'content-security-policy') {
          delete responseHeaders[key];
        }
      }
      callback({ cancel: false, responseHeaders });
    }
  );

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    backgroundColor: '#030303',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      webviewTag: true,
      backgroundThrottling: false,
      partition: SESSION_PARTITION,
    },
  });

  mainWindow.webContents.setUserAgent(CHROME_UA);

  // Handle any webview attachment (e.g. YouTube Music iframe/webview)
  mainWindow.webContents.on('did-attach-webview', (_, webviewContents) => {
    webviewContents.setUserAgent(CHROME_UA);

    // If user clicks "Acceder" / Sign In inside YouTube Music webview, handle popup cleanly
    webviewContents.setWindowOpenHandler(({ url }) => {
      if (url.includes('accounts.google.com') || url.includes('youtube.com/signin')) {
        openGoogleLoginWindow();
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

    // If webview navigates directly to accounts.google.com, ensure webdriver is hidden
    webviewContents.on('dom-ready', () => {
      webviewContents
        .executeJavaScript(`
          try {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          } catch (e) {}
        `)
        .catch(() => {});
    });
  });

  let distPath = path.join(__dirname, '../dist');
  if (app.isPackaged) {
    const unpackedDist = path.join(process.resourcesPath, 'app.asar.unpacked/dist');
    const resourcesDist = path.join(process.resourcesPath, 'dist');
    if (fs.existsSync(unpackedDist)) {
      distPath = unpackedDist;
    } else if (fs.existsSync(resourcesDist)) {
      distPath = resourcesDist;
    }
  }

  const { port, server } = await startStaticServer(distPath, async () => {
    if (mainWindow) {
      mainWindow.webContents.send('auth:success');
    }
  });
  staticServer = server;
  const localUrl = `http://localhost:${port}`;
  await mainWindow.loadURL(localUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (staticServer) staticServer.close();
  });

  // Register Mac Media Keys & Function Keys F7, F8, F9
  try {
    globalShortcut.register('F7', () => {
      if (mainWindow) mainWindow.webContents.send('player:previous');
    });
    globalShortcut.register('F8', () => {
      if (mainWindow) mainWindow.webContents.send('player:toggle-play');
    });
    globalShortcut.register('F9', () => {
      if (mainWindow) mainWindow.webContents.send('player:next');
    });
    globalShortcut.register('MediaPlayPause', () => {
      if (mainWindow) mainWindow.webContents.send('player:toggle-play');
    });
    globalShortcut.register('MediaNextTrack', () => {
      if (mainWindow) mainWindow.webContents.send('player:next');
    });
    globalShortcut.register('MediaPreviousTrack', () => {
      if (mainWindow) mainWindow.webContents.send('player:previous');
    });
  } catch (err) {
    console.warn('[Aura Main] Could not register media shortcuts:', err);
  }
}

/**
 * Opens official Google / YouTube Music Sign-In Window sharing SESSION_PARTITION
 */
function openGoogleLoginWindow() {
  return new Promise((resolve) => {
    const loginWin = new BrowserWindow({
      width: 520,
      height: 680,
      center: true,
      parent: mainWindow || undefined,
      modal: false,
      title: 'Iniciar sesión en YouTube Music / Google',
      backgroundColor: '#030303',
      webPreferences: {
        partition: SESSION_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    loginWin.webContents.setUserAgent(CHROME_UA);

    const targetUrl =
      'https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Des%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F%26feature%3Dsign_in_button&hl=es';

    loginWin.loadURL(targetUrl);

    loginWin.webContents.on('dom-ready', () => {
      loginWin.webContents
        .executeJavaScript(`
          try {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          } catch (e) {}
        `)
        .catch(() => {});
    });

    const checkLogin = async (url) => {
      if (url.startsWith('https://music.youtube.com')) {
        if (mainWindow) {
          mainWindow.webContents.send('auth:success');
        }
        setTimeout(() => {
          if (!loginWin.isDestroyed()) loginWin.close();
          resolve(true);
        }, 800);
        return;
      }

      const sess = session.fromPartition(SESSION_PARTITION);
      const profile = await getUserProfile(sess);
      if (profile && profile.loggedIn) {
        if (mainWindow) {
          mainWindow.webContents.send('auth:success');
        }
        setTimeout(() => {
          if (!loginWin.isDestroyed()) loginWin.close();
          resolve(true);
        }, 800);
      }
    };

    loginWin.webContents.on('did-navigate', (_, url) => checkLogin(url));
    loginWin.webContents.on('did-redirect-navigation', (_, url) => checkLogin(url));

    loginWin.on('closed', () => {
      resolve(true);
    });
  });
}

// ============================================================================
// IPC HANDLERS
// ============================================================================

ipcMain.handle('auth:get-profile', async () => {
  const sess = session.fromPartition(SESSION_PARTITION);
  return await getUserProfile(sess);
});

ipcMain.handle('auth:get-sapisid-header', async () => {
  const sess = session.fromPartition(SESSION_PARTITION);
  const { cookieMap } = await getCookiesDataFromSession(sess);
  return buildSapisidHashHeader(cookieMap);
});

ipcMain.handle('auth:open-google-login', async () => {
  return await openGoogleLoginWindow();
});

ipcMain.handle('auth:logout', async () => {
  const sess = session.fromPartition(SESSION_PARTITION);
  await sess.clearStorageData();
  if (mainWindow) {
    mainWindow.webContents.send('auth:success');
  }
  return true;
});

// Music Importer IPCs
ipcMain.handle('importer:connect-spotify', async () => {
  return await connectSpotifyAccount(mainWindow);
});

ipcMain.handle('importer:get-spotify-playlist-tracks', async (_, playlistId) => {
  return await getSpotifyPlaylistTracks(playlistId);
});

ipcMain.handle('importer:connect-apple', async () => {
  return await connectAppleMusicAccount(mainWindow);
});

ipcMain.handle('importer:get-apple-playlist-tracks', async (_, playlistId) => {
  return await getApplePlaylistTracks(playlistId);
});

ipcMain.handle('importer:parse-url', async (_, url) => {
  return await parseExternalMusicUrl(url);
});

// Real YouTube Music Account Write IPCs
ipcMain.handle('importer:search-ytm-track', async (_, title, artist) => {
  const sess = session.fromPartition(SESSION_PARTITION);
  return await searchYouTubeMusicTrack(sess, title, artist);
});

ipcMain.handle('importer:like-on-ytm', async (_, videoId) => {
  const sess = session.fromPartition(SESSION_PARTITION);
  return await likeSongOnYouTubeMusic(sess, videoId);
});

ipcMain.handle('importer:create-playlist-on-ytm', async (_, title, description, videoIds) => {
  const sess = session.fromPartition(SESSION_PARTITION);
  return await createPlaylistOnYouTubeMusic(sess, title, description, videoIds);
});

ipcMain.handle('importer:add-to-playlist-on-ytm', async (_, playlistId, videoIds) => {
  const sess = session.fromPartition(SESSION_PARTITION);
  return await addVideosToYouTubePlaylist(sess, playlistId, videoIds);
});

// Window Controls
ipcMain.handle('window:toggle-mini', async () => {
  if (!mainWindow) return false;
  if (!isMiniPlayer) {
    previousBounds = mainWindow.getBounds();
    mainWindow.setAlwaysOnTop(true, 'floating');
    mainWindow.setBounds({
      width: 420,
      height: 580,
      x: previousBounds.x + (previousBounds.width - 420),
      y: previousBounds.y,
    });
    isMiniPlayer = true;
  } else {
    mainWindow.setAlwaysOnTop(false);
    if (previousBounds) {
      mainWindow.setBounds(previousBounds);
    } else {
      mainWindow.setBounds({ width: 1240, height: 820 });
    }
    isMiniPlayer = false;
  }
  return isMiniPlayer;
});

ipcMain.handle('window:is-mini', () => isMiniPlayer);

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (staticServer) staticServer.close();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
