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
  fetchSpotifyUserLibrary,
  getSpotifyPlaylistTracks,
  parseExternalMusicUrl,
} = require('./musicImporter.cjs');
const {
  loginViaExternalBrowser,
  clearExternalBrowserProfile,
} = require('./browserAuth.cjs');

// Bypass Chromium's autoplay policy for seamless background/instant playback
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-features', 'HardwareMediaKeyHandling,VaapiVideoDecoder');

// Low-RAM & Low-CPU Optimizations (0% impact on audio bitrate/quality)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256 --optimize-for-size');
app.commandLine.appendSwitch('renderer-process-limit', '2');
app.commandLine.appendSwitch('disk-cache-size', '52428800'); // 50 MB max disk cache
app.commandLine.appendSwitch('media-cache-size', '26214400'); // 25 MB max media buffer
app.commandLine.appendSwitch('disable-spell-checking');
app.commandLine.appendSwitch(
  'disable-features',
  'Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,InterestFeedContentSuggestions, AutofillServerCommunication'
);

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

  // 1. Silent Ad-Blocker & Telemetry-Blocker for YouTube Music (reduces RAM/CPU & GC churn)
  sess.webRequest.onBeforeRequest(
    {
      urls: [
        '*://*.doubleclick.net/*',
        '*://*.googleads.g.doubleclick.net/*',
        '*://*.youtube.com/api/stats/ads*',
        '*://*.youtube.com/api/stats/qoe*',
        '*://*.youtube.com/youtubei/v1/log_event*',
        '*://*.youtube.com/pagead/*',
        '*://*.googlesyndication.com/*',
        '*://play.google.com/log*',
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
      spellcheck: false,
      partition: SESSION_PARTITION,
    },
  });

  mainWindow.webContents.setUserAgent(CHROME_UA);

  // Handle any webview attachment (e.g. YouTube Music iframe/webview)
  mainWindow.webContents.on('did-attach-webview', (_, webviewContents) => {
    webviewContents.setUserAgent(CHROME_UA);

    // Eco GPU Frame-Rate Throttling:
    // When Aura is in the background or minimized, drop UI rendering to 4 FPS (saves ~85% GPU/CPU)
    // while CoreAudio keeps streaming music at 100% original bitrate!
    const setEcoMode = (isBackground) => {
      if (webviewContents.isDestroyed()) return;
      try {
        webviewContents.setFrameRate(isBackground ? 4 : 60);
        webviewContents
          .executeJavaScript(
            `document.documentElement.classList.toggle('__aura-eco-bg', ${Boolean(isBackground)});`
          )
          .catch(() => {});
      } catch (e) {}
    };

    mainWindow.on('blur', () => setEcoMode(true));
    mainWindow.on('minimize', () => setEcoMode(true));
    mainWindow.on('hide', () => setEcoMode(true));
    mainWindow.on('focus', () => setEcoMode(false));
    mainWindow.on('restore', () => setEcoMode(false));
    mainWindow.on('show', () => setEcoMode(false));

    // Intercept top-level navigation to accounts.google.com when user clicks "Acceder" inside YT Music
    webviewContents.on('will-navigate', (event, url) => {
      if (url.includes('accounts.google.com') || url.includes('youtube.com/signin')) {
        event.preventDefault();
        openGoogleLoginWindow();
      }
    });

    // If user clicks "Acceder" / Sign In and it tries to open a popup, route to external Chrome
    webviewContents.setWindowOpenHandler(({ url }) => {
      if (url.includes('accounts.google.com') || url.includes('youtube.com/signin')) {
        openGoogleLoginWindow();
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });

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
 * Launches the user's REAL Google Chrome browser to sign into Google / YouTube Music,
 * captures all session cookies & HttpOnly tokens via CDP, and injects them into Electron's session.
 */
async function openGoogleLoginWindow() {
  const sess = session.fromPartition(SESSION_PARTITION);
  try {
    const ok = await loginViaExternalBrowser(sess, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('auth:success');
      }
    });
    return ok;
  } catch (err) {
    console.error('[Aura Main] External browser login error:', err);
    return false;
  }
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
  clearExternalBrowserProfile();
  if (mainWindow) {
    mainWindow.webContents.send('auth:success');
  }
  return true;
});

// Music Importer IPCs
ipcMain.handle('importer:connect-spotify', async (_, forceReauth = false) => {
  return await connectSpotifyAccount(mainWindow, forceReauth);
});

ipcMain.handle('importer:get-cached-spotify', async () => {
  const lib = await fetchSpotifyUserLibrary();
  if (lib && (lib.likedSongs.length > 0 || lib.playlists.length > 0)) {
    return { ok: true, ...lib };
  }
  return { ok: false, likedSongs: [], playlists: [], albums: [] };
});

ipcMain.handle('importer:get-spotify-playlist-tracks', async (_, playlistId) => {
  return await getSpotifyPlaylistTracks(playlistId);
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
