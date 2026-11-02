const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');
const { loginAppleMusicViaExternalBrowser } = require('./browserAuth.cjs');

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// Official Spotify Desktop Client ID for OAuth 2.0 PKCE Authorization Flow
const SPOTIFY_CLIENT_ID = '65b708073fc0480ea92a077233ca87bd';
const SPOTIFY_SCOPES = [
  'user-library-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-private',
  'user-read-email',
].join(' ');

let spotifyBearerToken = null;
let spotifyRefreshToken = null;
let appleBearerToken = null;
let appleMediaUserToken = null;
let activeOauthServer = null;

function getSpotifyTokenCachePath() {
  return path.join(app.getPath('userData'), 'spotify-oauth-token.json');
}

function saveSpotifyTokensToDisk(tokenData) {
  try {
    fs.writeFileSync(
      getSpotifyTokenCachePath(),
      JSON.stringify({
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || spotifyRefreshToken,
        expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
      }),
      'utf8'
    );
  } catch (e) {}
}

function loadSpotifyTokensFromDisk() {
  try {
    const file = getSpotifyTokenCachePath();
    if (!fs.existsSync(file)) return null;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.accessToken && data.expiresAt && Date.now() < data.expiresAt - 60000) {
      spotifyBearerToken = data.accessToken;
      spotifyRefreshToken = data.refreshToken;
      return data.accessToken;
    }
  } catch (e) {}
  return null;
}

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

/**
 * Simple HTTPS POST x-www-form-urlencoded helper for OAuth token exchange
 */
function httpsPostForm(url, paramsObj) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams(paramsObj).toString();
    const parsedUrl = new URL(url);
    const req = https.request(
      {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': CHROME_UA,
          Accept: 'application/json',
        },
      },
      (res) => {
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
    req.write(postData);
    req.end();
  });
}

// ============================================================================
// 1. SPOTIFY OAUTH 2.0 PKCE AUTHORIZATION FLOW (OFFICIAL PERMISSION GRANT)
// ============================================================================

/**
 * Starts a local loopback callback server on 127.0.0.1, opens Spotify's official OAuth
 * Permission Consent screen in the user's browser, receives the ?code=... callback,
 * exchanges it via PKCE for an OAuth access_token, and reads the user's library.
 */
async function connectSpotifyAccount(parentWindow, forceReauth = false) {
  // Check if we already have a valid cached OAuth token (unless user clicked Recargar/Reconectar)
  if (!forceReauth) {
    const cached = loadSpotifyTokensFromDisk();
    if (cached) {
      const lib = await fetchSpotifyUserLibrary(cached);
      if (lib.likedSongs.length > 0 || lib.playlists.length > 0) {
        return { ok: true, ...lib };
      }
    }
  }

  if (activeOauthServer) {
    try {
      activeOauthServer.close();
    } catch (e) {}
    activeOauthServer = null;
  }

  // Generate PKCE Code Verifier & S256 Code Challenge
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      if (activeOauthServer) {
        try {
          activeOauthServer.close();
        } catch (e) {}
        activeOauthServer = null;
      }
      if (parentWindow && !parentWindow.isDestroyed()) {
        parentWindow.show();
        parentWindow.focus();
      }
      resolve(result);
    };

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url, `http://${req.headers.host}`);
        if (reqUrl.pathname === '/login') {
          const code = reqUrl.searchParams.get('code');
          const error = reqUrl.searchParams.get('error');

          if (error || !code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(`
              <html>
                <body style="background:#121212;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
                  <div style="text-align:center;padding:32px;background:#181818;border-radius:16px;border:1px solid #333;">
                    <h2 style="color:#ef4444;">Autorización cancelada</h2>
                    <p style="color:#aaa;">No se concedieron permisos en Spotify. Puedes cerrar esta pestaña.</p>
                  </div>
                </body>
              </html>
            `);
            return finish({ ok: false, error: 'Autorización de Spotify cancelada por el usuario.' });
          }

          // Respond immediately with success screen in browser
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`
            <html>
              <body style="background:#121212;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
                <div style="text-align:center;padding:36px;background:#181818;border-radius:20px;border:1px solid #1DB954;">
                  <div style="width:56px;height:56px;border-radius:50%;background:#1DB954;color:#000;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:bold;margin:0 auto 16px;">✓</div>
                  <h2 style="margin:0 0 8px 0;">¡Permisos de Spotify concedidos!</h2>
                  <p style="color:#aaa;font-size:14px;margin:0;">Tus canciones y playlists se están cargando en Aura Music. Ya puedes cerrar esta pestaña.</p>
                  <script>setTimeout(() => window.close(), 1200);</script>
                </div>
              </body>
            </html>
          `);

          const port = server.address().port;
          const redirectUri = `http://127.0.0.1:${port}/login`;

          console.log('[Spotify OAuth] Exchanging authorization code for OAuth token...');
          const tokenRes = await httpsPostForm('https://accounts.spotify.com/api/token', {
            client_id: SPOTIFY_CLIENT_ID,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
          });

          if (tokenRes.data && tokenRes.data.access_token) {
            spotifyBearerToken = tokenRes.data.access_token;
            spotifyRefreshToken = tokenRes.data.refresh_token || null;
            saveSpotifyTokensToDisk(tokenRes.data);
            console.log('[Spotify OAuth] Token obtained! Fetching user library...');
            const library = await fetchSpotifyUserLibrary(spotifyBearerToken);
            return finish({ ok: true, ...library });
          } else {
            console.error('[Spotify OAuth] Token exchange failed:', tokenRes.raw);
            return finish({
              ok: false,
              error:
                tokenRes.data?.error_description ||
                'No se pudo canjear el código de autorización con Spotify.',
            });
          }
        }
      } catch (err) {
        console.error('[Spotify OAuth] Callback error:', err);
        finish({ ok: false, error: err.message });
      }
    });

    activeOauthServer = server;

    // Listen on 127.0.0.1:8898 (or random free port if 8898 is busy)
    server.listen(8898, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}/login`;

      const authUrl = new URL('https://accounts.spotify.com/authorize');
      authUrl.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('scope', SPOTIFY_SCOPES);
      authUrl.searchParams.set('show_dialog', 'true');

      console.log('[Spotify OAuth] Opening authorization consent screen in browser:', authUrl.toString());
      shell.openExternal(authUrl.toString());
    });

    server.on('error', () => {
      // Fallback to any free port on 127.0.0.1
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const redirectUri = `http://127.0.0.1:${port}/login`;

        const authUrl = new URL('https://accounts.spotify.com/authorize');
        authUrl.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('code_challenge_method', 'S256');
        authUrl.searchParams.set('code_challenge', codeChallenge);
        authUrl.searchParams.set('scope', SPOTIFY_SCOPES);
        authUrl.searchParams.set('show_dialog', 'true');

        shell.openExternal(authUrl.toString());
      });
    });

    // Timeout after 3 minutes if user never completes authorization
    setTimeout(() => {
      finish({ ok: false, error: 'Tiempo de espera agotado para autorizar en el navegador.' });
    }, 180000);
  });
}

/**
 * Fetches User Profile, Liked Songs, Playlists, and Albums from Spotify Web API using OAuth Bearer token
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
      : { name: 'Cuenta Spotify Autorizada', avatar: '' };

    // Fetch up to 200 Liked Songs across pages
    let likedItems = tracksRes.data?.items || [];
    const totalLiked = tracksRes.data?.total || likedItems.length;
    if (tracksRes.data?.next && likedItems.length < 200) {
      const page2 = await httpsGet(
        'https://api.spotify.com/v1/me/tracks?limit=50&offset=50',
        headers
      ).catch(() => null);
      if (page2?.data?.items) likedItems = [...likedItems, ...page2.data.items];
      if (page2?.data?.next) {
        const page3 = await httpsGet(
          'https://api.spotify.com/v1/me/tracks?limit=50&offset=100',
          headers
        ).catch(() => null);
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

    console.log(
      `[Spotify OAuth] Loaded ${likedSongs.length} liked songs, ${playlists.length} playlists, ${albums.length} albums!`
    );

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
 * Fetches all tracks inside a specific Spotify Playlist using the OAuth Bearer token
 */
async function getSpotifyPlaylistTracks(playlistId) {
  if (!spotifyBearerToken) {
    loadSpotifyTokensFromDisk();
  }
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

  const parsed = await parseExternalMusicUrl(`https://open.spotify.com/playlist/${playlistId}`);
  return parsed.tracks || [];
}

// ============================================================================
// 2. APPLE MUSIC ACCOUNT CONNECTION & LIBRARY READER
// ============================================================================

async function connectAppleMusicAccount() {
  try {
    const extTokens = await loginAppleMusicViaExternalBrowser();
    if (extTokens && extTokens.developerToken && extTokens.musicUserToken) {
      appleBearerToken = extTokens.developerToken;
      appleMediaUserToken = extTokens.musicUserToken;
      const library = await fetchAppleMusicLibrary();
      return { ok: true, ...library };
    }
    return {
      ok: false,
      error: 'No se completó la autorización en Apple Music.',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
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

async function parseExternalMusicUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) return { ok: false, error: 'Ingresa un enlace válido.' };

  if (url.includes('spotify.com')) {
    const match = url.match(/(playlist|album|track)\/([a-zA-Z0-9]+)/);
    if (!match) {
      return { ok: false, error: 'No se reconoció el ID de la playlist o álbum de Spotify.' };
    }
    const [, type, id] = match;

    // If we have an active Spotify OAuth token and it's a playlist, use the official API!
    if (type === 'playlist' && (spotifyBearerToken || loadSpotifyTokensFromDisk())) {
      const tracks = await getSpotifyPlaylistTracks(id);
      if (tracks && tracks.length > 0) {
        return {
          ok: true,
          provider: 'spotify',
          title: 'Playlist de Spotify',
          thumbnail: tracks[0]?.thumbnail || '',
          tracks,
        };
      }
    }

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

  if (url.includes('music.apple.com')) {
    try {
      const { raw } = await httpsGet(url);
      let title = 'Playlist de Apple Music';
      const titleMatch = raw.match(/<meta property="og:title" content="([^"]+)"/i);
      if (titleMatch) {
        title = titleMatch[1].replace(' en Apple Music', '').replace(' on Apple Music', '').trim();
      }

      const tracks = [];
      const serverDataMatch = raw.match(
        /<script type="application\/json" id="serialized-server-data">([\s\S]*?)<\/script>/
      );
      if (serverDataMatch) {
        const jsonStr = serverDataMatch[1];
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
