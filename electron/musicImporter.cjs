const https = require('https');
const { BrowserWindow, session } = require('electron');
const {
  loginSpotifyViaExternalBrowser,
  loginAppleMusicViaExternalBrowser,
} = require('./browserAuth.cjs');

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Cached tokens in memory for active session
let spotifyBearerToken = null;
let appleBearerToken = null;
let appleMediaUserToken = null;

/**
 * Simple HTTPS GET helper returning parsed JSON or raw text
 */
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          'User-Agent': CHROME_UA,
          Accept: 'application/json, text/plain, */*',
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).toString();
          return resolve(httpsGet(redirectUrl, headers));
        }

        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(body), raw: body });
          } catch (e) {
            resolve({ statusCode: res.statusCode, data: null, raw: body });
          }
        });
      }
    );
    req.on('error', reject);
  });
}

// ============================================================================
// 1. SPOTIFY ACCOUNT CONNECTION & LIBRARY READER
// ============================================================================

/**
 * Opens Spotify Web Login Popup, captures the Web Player Bearer token automatically,
 * and returns the user's Liked Songs, Playlists, and Saved Albums.
 */
async function connectSpotifyAccount(parentWindow) {
  try {
    const extToken = await loginSpotifyViaExternalBrowser();
    if (extToken) {
      spotifyBearerToken = extToken;
      const library = await fetchSpotifyUserLibrary(spotifyBearerToken);
      return { ok: true, ...library };
    }
  } catch (e) {
    console.warn('[Spotify Importer] External browser fallback:', e.message);
  }

  return new Promise((resolve) => {
    const sess = session.fromPartition('persist:spotify_import');
    let resolved = false;

    const finish = async (token) => {
      if (resolved) return;
      resolved = true;
      if (token) spotifyBearerToken = token;
      try {
        if (!win.isDestroyed()) win.close();
      } catch (e) {}

      if (spotifyBearerToken) {
        const library = await fetchSpotifyUserLibrary(spotifyBearerToken);
        resolve({ ok: true, ...library });
      } else {
        resolve({ ok: false, error: 'No se detectó sesión activa de Spotify.' });
      }
    };

    // Intercept outgoing requests to api.spotify.com to capture the official web player Bearer token
    sess.webRequest.onBeforeSendHeaders(
      { urls: ['*://api.spotify.com/*', '*://api-partner.spotify.com/*'] },
      (details, callback) => {
        const auth =
          details.requestHeaders['Authorization'] || details.requestHeaders['authorization'];
        if (auth && auth.startsWith('Bearer ') && auth.length > 30) {
          const token = auth.replace('Bearer ', '').trim();
          if (!spotifyBearerToken || spotifyBearerToken !== token) {
            console.log('[Spotify Importer] Captured live Bearer token from Spotify Web Player!');
            spotifyBearerToken = token;
            if (!resolved) {
              setTimeout(() => finish(token), 600);
            }
          }
        }
        callback({ requestHeaders: details.requestHeaders });
      }
    );

    const win = new BrowserWindow({
      width: 540,
      height: 700,
      center: true,
      parent: parentWindow || undefined,
      title: 'Conectar con Spotify — Inicia sesión para importar tu música',
      backgroundColor: '#121212',
      webPreferences: {
        partition: 'persist:spotify_import',
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.webContents.setUserAgent(CHROME_UA);
    win.loadURL('https://accounts.spotify.com/es/login?continue=https%3A%2F%2Fopen.spotify.com%2F');

    // Also try extracting token directly from open.spotify.com when loaded
    win.webContents.on('did-finish-load', async () => {
      const url = win.webContents.getURL();
      if (url.startsWith('https://open.spotify.com')) {
        try {
          const tokenData = await win.webContents.executeJavaScript(`
            fetch('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', { credentials: 'include' })
              .then(r => r.json())
              .catch(() => null)
          `);
          if (tokenData && tokenData.accessToken) {
            console.log('[Spotify Importer] Extracted accessToken via get_access_token!');
            finish(tokenData.accessToken);
          }
        } catch (e) {}
      }
    });

    win.on('closed', () => {
      if (!resolved) {
        resolved = true;
        if (spotifyBearerToken) {
          fetchSpotifyUserLibrary(spotifyBearerToken).then((lib) =>
            resolve({ ok: true, ...lib })
          );
        } else {
          resolve({ ok: false, error: 'Ventana cerrada antes de completar el acceso.' });
        }
      }
    });
  });
}

/**
 * Fetches User Profile, Liked Songs, Playlists, and Albums from Spotify Web API
 */
async function fetchSpotifyUserLibrary(token = spotifyBearerToken) {
  if (!token) return { profile: null, likedSongs: [], playlists: [], albums: [] };
  const headers = { Authorization: `Bearer ${token}` };

  try {
    const [meRes, tracksRes, playlistsRes, albumsRes] = await Promise.all([
      httpsGet('https://api.spotify.com/v1/me', headers).catch(() => ({ data: null })),
      httpsGet('https://api.spotify.com/v1/me/tracks?limit=50', headers).catch(() => ({ data: null })),
      httpsGet('https://api.spotify.com/v1/me/playlists?limit=50', headers).catch(() => ({ data: null })),
      httpsGet('https://api.spotify.com/v1/me/albums?limit=50', headers).catch(() => ({ data: null })),
    ]);

    const profile = meRes.data
      ? {
          name: meRes.data.display_name || meRes.data.id || 'Usuario Spotify',
          avatar: meRes.data.images?.[0]?.url || '',
        }
      : { name: 'Cuenta Spotify Conectada', avatar: '' };

    // Parse Liked Songs (fetch up to 200 liked songs if user has more pages)
    let likedItems = tracksRes.data?.items || [];
    const totalLiked = tracksRes.data?.total || likedItems.length;
    if (tracksRes.data?.next && likedItems.length < 200) {
      const page2 = await httpsGet('https://api.spotify.com/v1/me/tracks?limit=50&offset=50', headers).catch(() => null);
      if (page2?.data?.items) likedItems = [...likedItems, ...page2.data.items];
      if (page2?.data?.next) {
        const page3 = await httpsGet('https://api.spotify.com/v1/me/tracks?limit=50&offset=100', headers).catch(() => null);
        if (page3?.data?.items) likedItems = [...likedItems, ...page3.data.items];
      }
    }

    const likedSongs = likedItems
      .map((item) => {
        const t = item.track;
        if (!t || !t.name) return null;
        return {
          id: `sp-track-${t.id || Math.random()}`,
          title: t.name,
          artist: (t.artists || []).map((a) => a.name).join(', ') || 'Artista',
          album: t.album?.name || '',
          thumbnail: t.album?.images?.[0]?.url || '',
        };
      })
      .filter(Boolean);

    const playlists = (playlistsRes.data?.items || [])
      .map((pl) => {
        if (!pl || !pl.id) return null;
        return {
          id: pl.id,
          provider: 'spotify',
          title: pl.name || 'Playlist',
          description: pl.description || '',
          trackCount: pl.tracks?.total || 0,
          thumbnail: pl.images?.[0]?.url || '',
        };
      })
      .filter(Boolean);

    const albums = (albumsRes.data?.items || [])
      .map((alItem) => {
        const al = alItem.album;
        if (!al || !al.id) return null;
        return {
          id: al.id,
          provider: 'spotify',
          title: al.name,
          artist: (al.artists || []).map((a) => a.name).join(', '),
          trackCount: al.total_tracks || al.tracks?.items?.length || 0,
          thumbnail: al.images?.[0]?.url || '',
          tracks: (al.tracks?.items || []).map((t) => ({
            title: t.name,
            artist: (t.artists || []).map((a) => a.name).join(', '),
            thumbnail: al.images?.[0]?.url || '',
          })),
        };
      })
      .filter(Boolean);

    return {
      profile,
      totalLiked,
      likedSongs,
      playlists,
      albums,
    };
  } catch (err) {
    console.error('[Spotify Importer] Error reading library:', err);
    return { profile: null, likedSongs: [], playlists: [], albums: [] };
  }
}

/**
 * Fetches all tracks inside a specific Spotify Playlist
 */
async function getSpotifyPlaylistTracks(playlistId) {
  if (spotifyBearerToken) {
    try {
      const headers = { Authorization: `Bearer ${spotifyBearerToken}` };
      const res = await httpsGet(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100`,
        headers
      );
      if (res.data?.items) {
        return res.data.items
          .map((it) => {
            const t = it.track;
            if (!t || !t.name) return null;
            return {
              title: t.name,
              artist: (t.artists || []).map((a) => a.name).join(', ') || 'Artista',
              album: t.album?.name || '',
              thumbnail: t.album?.images?.[0]?.url || '',
            };
          })
          .filter(Boolean);
      }
    } catch (e) {}
  }

  // Fallback to public embed scraper
  const parsed = await parseExternalMusicUrl(`https://open.spotify.com/playlist/${playlistId}`);
  return parsed.tracks || [];
}

// ============================================================================
// 2. APPLE MUSIC ACCOUNT CONNECTION & LIBRARY READER
// ============================================================================

/**
 * Opens Apple Music Web Login Popup, captures Developer Authorization & Media-User-Token,
 * and returns the user's Library Songs, Playlists, and Albums.
 */
async function connectAppleMusicAccount(parentWindow) {
  try {
    const extTokens = await loginAppleMusicViaExternalBrowser();
    if (extTokens && extTokens.developerToken && extTokens.musicUserToken) {
      appleBearerToken = extTokens.developerToken;
      appleMediaUserToken = extTokens.musicUserToken;
      const library = await fetchAppleMusicLibrary();
      return { ok: true, ...library };
    }
  } catch (e) {
    console.warn('[Apple Importer] External browser fallback:', e.message);
  }

  return new Promise((resolve) => {
    const sess = session.fromPartition('persist:apple_import');
    let resolved = false;

    const finish = async () => {
      if (resolved) return;
      resolved = true;
      try {
        if (!win.isDestroyed()) win.close();
      } catch (e) {}

      if (appleBearerToken && appleMediaUserToken) {
        const library = await fetchAppleMusicLibrary();
        resolve({ ok: true, ...library });
      } else {
        resolve({
          ok: false,
          error: 'Inicia sesión en tu cuenta de Apple Music dentro de la ventana para sincronizar.',
        });
      }
    };

    sess.webRequest.onBeforeSendHeaders(
      { urls: ['*://amp-api.music.apple.com/*'] },
      (details, callback) => {
        const auth =
          details.requestHeaders['Authorization'] || details.requestHeaders['authorization'];
        const mut =
          details.requestHeaders['Media-User-Token'] ||
          details.requestHeaders['media-user-token'] ||
          details.requestHeaders[' Media-User-Token'];

        if (auth && auth.startsWith('Bearer ')) {
          appleBearerToken = auth.replace('Bearer ', '').trim();
        }
        if (mut && mut.length > 20) {
          appleMediaUserToken = mut.trim();
        }

        if (appleBearerToken && appleMediaUserToken && !resolved) {
          console.log('[Apple Music Importer] Captured live Apple Music session tokens!');
          setTimeout(() => finish(), 800);
        }

        callback({ requestHeaders: details.requestHeaders });
      }
    );

    const win = new BrowserWindow({
      width: 580,
      height: 720,
      center: true,
      parent: parentWindow || undefined,
      title: 'Conectar con Apple Music — Inicia sesión arriba a la derecha',
      backgroundColor: '#1f1f1f',
      webPreferences: {
        partition: 'persist:apple_import',
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.webContents.setUserAgent(CHROME_UA);
    win.loadURL('https://music.apple.com/es/home');

    win.on('closed', () => {
      if (!resolved) {
        resolved = true;
        if (appleBearerToken && appleMediaUserToken) {
          fetchAppleMusicLibrary().then((lib) => resolve({ ok: true, ...lib }));
        } else {
          resolve({ ok: false, error: 'Ventana cerrada antes de completar el inicio de sesión.' });
        }
      }
    });
  });
}

async function fetchAppleMusicLibrary() {
  if (!appleBearerToken || !appleMediaUserToken) {
    return { profile: null, likedSongs: [], playlists: [], albums: [] };
  }

  const headers = {
    Authorization: `Bearer ${appleBearerToken}`,
    'Media-User-Token': appleMediaUserToken,
    Origin: 'https://music.apple.com',
    Referer: 'https://music.apple.com/',
  };

  try {
    const [songsRes, playlistsRes, albumsRes] = await Promise.all([
      httpsGet('https://amp-api.music.apple.com/v1/me/library/songs?limit=100', headers).catch(
        () => ({ data: null })
      ),
      httpsGet('https://amp-api.music.apple.com/v1/me/library/playlists?limit=100', headers).catch(
        () => ({ data: null })
      ),
      httpsGet('https://amp-api.music.apple.com/v1/me/library/albums?limit=100', headers).catch(
        () => ({ data: null })
      ),
    ]);

    const likedSongs = (songsRes.data?.data || []).map((item) => {
      const attr = item.attributes || {};
      const thumb = (attr.artwork?.url || '').replace('{w}', '200').replace('{h}', '200');
      return {
        id: item.id,
        title: attr.name || 'Canción',
        artist: attr.artistName || 'Artista',
        album: attr.albumName || '',
        thumbnail: thumb,
      };
    });

    const playlists = (playlistsRes.data?.data || []).map((pl) => {
      const attr = pl.attributes || {};
      const thumb = (attr.artwork?.url || '').replace('{w}', '200').replace('{h}', '200');
      return {
        id: pl.id,
        provider: 'apple',
        title: attr.name || 'Playlist de Apple Music',
        description: attr.description?.standard || '',
        trackCount: attr.trackCount || 0,
        thumbnail: thumb,
      };
    });

    const albums = (albumsRes.data?.data || []).map((al) => {
      const attr = al.attributes || {};
      const thumb = (attr.artwork?.url || '').replace('{w}', '200').replace('{h}', '200');
      return {
        id: al.id,
        provider: 'apple',
        title: attr.name || 'Álbum',
        artist: attr.artistName || 'Artista',
        trackCount: attr.trackCount || 0,
        thumbnail: thumb,
      };
    });

    return {
      profile: { name: 'Cuenta Apple Music Conectada', avatar: '' },
      totalLiked: likedSongs.length,
      likedSongs,
      playlists,
      albums,
    };
  } catch (err) {
    console.error('[Apple Music Importer] Error fetching library:', err);
    return { profile: null, likedSongs: [], playlists: [], albums: [] };
  }
}

async function getApplePlaylistTracks(playlistId) {
  if (!appleBearerToken || !appleMediaUserToken) return [];
  const headers = {
    Authorization: `Bearer ${appleBearerToken}`,
    'Media-User-Token': appleMediaUserToken,
    Origin: 'https://music.apple.com',
    Referer: 'https://music.apple.com/',
  };
  try {
    const res = await httpsGet(
      `https://amp-api.music.apple.com/v1/me/library/playlists/${playlistId}/tracks?limit=100`,
      headers
    );
    return (res.data?.data || []).map((it) => {
      const attr = it.attributes || {};
      const thumb = (attr.artwork?.url || '').replace('{w}', '200').replace('{h}', '200');
      return {
        title: attr.name || 'Canción',
        artist: attr.artistName || 'Artista',
        album: attr.albumName || '',
        thumbnail: thumb,
      };
    });
  } catch (e) {
    return [];
  }
}

// ============================================================================
// 3. DIRECT URL / LINK PARSER (SPOTIFY & APPLE MUSIC PUBLIC LINKS)
// ============================================================================

/**
 * Parses any public Spotify or Apple Music Playlist/Album URL without requiring login
 */
async function parseExternalMusicUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) return { ok: false, error: 'Ingresa un enlace válido.' };

  // A. Spotify URL (open.spotify.com/playlist/... or album/...)
  if (url.includes('spotify.com')) {
    const match = url.match(/(playlist|album|track)\/([a-zA-Z0-9]+)/);
    if (!match) {
      return { ok: false, error: 'No se reconoció el ID de la playlist o álbum de Spotify.' };
    }
    const [, type, id] = match;
    try {
      const embedUrl = `https://open.spotify.com/embed/${type}/${id}`;
      const { raw } = await httpsGet(embedUrl);
      const nextDataMatch = raw.match(
        /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
      );
      if (nextDataMatch) {
        const json = JSON.parse(nextDataMatch[1]);
        const entity = json?.props?.pageProps?.state?.data?.entity;
        if (entity) {
          const title = entity.name || entity.title || 'Lista de Spotify';
          const thumb = entity.coverArt?.sources?.[0]?.url || '';
          const trackList = entity.trackList || [];
          const tracks = trackList.map((t) => ({
            title: t.title || 'Canción',
            artist: t.subtitle || 'Artista',
            thumbnail: thumb,
          }));
          if (tracks.length > 0) {
            return {
              ok: true,
              provider: 'spotify',
              title,
              thumbnail: thumb,
              tracks,
            };
          }
        }
      }
      return { ok: false, error: 'No se pudieron extraer las pistas de este enlace de Spotify.' };
    } catch (err) {
      return { ok: false, error: `Error al leer enlace de Spotify: ${err.message}` };
    }
  }

  // B. Apple Music URL (music.apple.com/.../playlist/... or album/...)
  if (url.includes('music.apple.com')) {
    try {
      const { raw } = await httpsGet(url);
      let title = 'Playlist de Apple Music';
      const titleMatch = raw.match(/<meta property="og:title" content="([^"]+)"/i);
      if (titleMatch) {
        title = titleMatch[1].replace(' en Apple Music', '').replace(' on Apple Music', '').trim();
      }

      const tracks = [];
      // Look for serialized-server-data or schema.org music tracks
      const serverDataMatch = raw.match(
        /<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/
      );
      if (serverDataMatch) {
        const jsonStr = serverDataMatch[1];
        // Match track objects containing title and artistName
        const regex = /"title"\s*:\s*"([^"]+)"[^{}]*?"artistName"\s*:\s*"([^"]+)"/g;
        let m;
        const seen = new Set();
        while ((m = regex.exec(jsonStr)) !== null) {
          const songTitle = m[1];
          const songArtist = m[2];
          const key = `${songArtist}-${songTitle}`.toLowerCase();
          if (!seen.has(key) && songTitle !== title) {
            seen.add(key);
            tracks.push({
              title: songTitle,
              artist: songArtist,
              thumbnail: '',
            });
          }
        }
      }

      if (tracks.length > 0) {
        return {
          ok: true,
          provider: 'apple',
          title,
          thumbnail: '',
          tracks,
        };
      }
      return {
        ok: false,
        error:
          'No se pudieron extraer las canciones del enlace de Apple Music. Prueba conectando tu cuenta.',
      };
    } catch (err) {
      return { ok: false, error: `Error al leer Apple Music: ${err.message}` };
    }
  }

  return {
    ok: false,
    error: 'Enlace no soportado. Usa un link de Spotify (open.spotify.com) o Apple Music.',
  };
}

module.exports = {
  connectSpotifyAccount,
  fetchSpotifyUserLibrary,
  getSpotifyPlaylistTracks,
  connectAppleMusicAccount,
  fetchAppleMusicLibrary,
  getApplePlaylistTracks,
  parseExternalMusicUrl,
};
