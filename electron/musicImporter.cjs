const https = require('https');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, shell } = require('electron');

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
  'streaming',
].join(' ');

// Persisted Query Hashes for Spotify Pathfinder GraphQL API
const HASH_PROFILE_ATTRIBUTES = '53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced';
const HASH_FETCH_LIBRARY_TRACKS = '087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240';
const HASH_FETCH_PLAYLIST = 'bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77';

let spotifyBearerToken = null;
let spotifyRefreshToken = null;
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

async function getValidSpotifyToken() {
  try {
    const file = getSpotifyTokenCachePath();
    if (!fs.existsSync(file)) return spotifyBearerToken;
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data.accessToken && data.expiresAt && Date.now() < data.expiresAt - 60000) {
      spotifyBearerToken = data.accessToken;
      spotifyRefreshToken = data.refreshToken;
      return data.accessToken;
    }
    // If expired but we have refreshToken, refresh it automatically!
    if (data.refreshToken) {
      const refRes = await httpsPostForm('https://accounts.spotify.com/api/token', {
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: data.refreshToken,
      });
      if (refRes.data && refRes.data.access_token) {
        spotifyBearerToken = refRes.data.access_token;
        spotifyRefreshToken = refRes.data.refresh_token || data.refreshToken;
        saveSpotifyTokensToDisk(refRes.data);
        return spotifyBearerToken;
      }
    }
  } catch (e) {}
  return spotifyBearerToken;
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

/**
 * Queries Spotify's first-party Pathfinder GraphQL API (`api-partner.spotify.com/pathfinder/v1/query`)
 */
function querySpotifyPathfinder(token, operationName, sha256Hash, variables = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      variables,
      operationName,
      extensions: {
        persistedQuery: {
          version: 1,
          sha256Hash,
        },
      },
    });

    const req = https.request(
      'https://api-partner.spotify.com/pathfinder/v1/query',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': CHROME_UA,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(body) });
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
// 1. SPOTIFY OAUTH 2.0 PKCE AUTHORIZATION FLOW + PATHFINDER GRAPHQL READER
// ============================================================================

async function connectSpotifyAccount(parentWindow, forceReauth = false) {
  // 1. First check if we already have a valid token on disk
  if (!forceReauth) {
    const validToken = await getValidSpotifyToken();
    if (validToken) {
      const lib = await fetchSpotifyUserLibrary(validToken);
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

  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

  return new Promise((resolve) => {
    let resolved = false;
    let boundPort = 8898;

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
        const reqUrl = new URL(req.url, `http://127.0.0.1:${boundPort}`);
        if (reqUrl.pathname !== '/login') {
          res.writeHead(404);
          return res.end();
        }

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

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <html>
            <body style="background:#121212;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
              <div style="text-align:center;padding:36px;background:#181818;border-radius:20px;border:1px solid #1DB954;">
                <div style="width:56px;height:56px;border-radius:50%;background:#1DB954;color:#000;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:bold;margin:0 auto 16px;">✓</div>
                <h2 style="margin:0 0 8px 0;">¡Permisos de Spotify concedidos!</h2>
                <p style="color:#aaa;font-size:14px;margin:0;">Tus canciones y playlists ya están cargadas en Aura Music. Puedes cerrar esta pestaña.</p>
                <script>setTimeout(() => window.close(), 1000);</script>
              </div>
            </body>
          </html>
        `);

        const redirectUri = `http://127.0.0.1:${boundPort}/login`;
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
          console.log('[Spotify OAuth] Token obtained! Fetching library via Pathfinder GraphQL...');
          const library = await fetchSpotifyUserLibrary(spotifyBearerToken);
          return finish({ ok: true, ...library });
        } else {
          return finish({
            ok: false,
            error:
              tokenRes.data?.error_description ||
              'No se pudo canjear el código de autorización con Spotify.',
          });
        }
      } catch (err) {
        console.error('[Spotify OAuth] Callback error:', err);
        finish({ ok: false, error: err.message });
      }
    });

    activeOauthServer = server;

    const launchBrowserAuth = () => {
      const addr = server.address();
      if (addr && addr.port) {
        boundPort = addr.port;
      }
      const redirectUri = `http://127.0.0.1:${boundPort}/login`;

      const authUrl = new URL('https://accounts.spotify.com/authorize');
      authUrl.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('code_challenge', codeChallenge);
      authUrl.searchParams.set('scope', SPOTIFY_SCOPES);

      console.log('[Spotify OAuth] Opening authorization consent screen in browser:', authUrl.toString());
      shell.openExternal(authUrl.toString());
    };

    server.listen(8898, '127.0.0.1', launchBrowserAuth);

    server.on('error', () => {
      server.listen(0, '127.0.0.1', launchBrowserAuth);
    });

    setTimeout(() => {
      finish({ ok: false, error: 'Tiempo de espera agotado para autorizar en el navegador.' });
    }, 180000);
  });
}

/**
 * Fetches User Profile, Liked Songs, and Playlists using Spotify's first-party
 * Pathfinder GraphQL API + spclient (0 rate limits, 100% reliable)
 */
async function fetchSpotifyUserLibrary(token) {
  const activeToken = token || (await getValidSpotifyToken());
  if (!activeToken) return { profile: null, likedSongs: [], playlists: [], albums: [] };

  try {
    // 1. Fetch Profile & Liked Songs (first 200 tracks across 2 pages of 100) in parallel
    const [profRes, tracksPage1, tracksPage2] = await Promise.all([
      querySpotifyPathfinder(activeToken, 'profileAttributes', HASH_PROFILE_ATTRIBUTES, {}).catch(
        () => null
      ),
      querySpotifyPathfinder(activeToken, 'fetchLibraryTracks', HASH_FETCH_LIBRARY_TRACKS, {
        offset: 0,
        limit: 100,
      }).catch(() => null),
      querySpotifyPathfinder(activeToken, 'fetchLibraryTracks', HASH_FETCH_LIBRARY_TRACKS, {
        offset: 100,
        limit: 100,
      }).catch(() => null),
    ]);

    const profData = profRes?.data?.data?.me?.profile;
    const username = profData?.username || (profData?.uri ? profData.uri.split(':').pop() : '');
    const profile = {
      name: profData?.name || 'Usuario Spotify',
      avatar: profData?.avatar?.sources?.[0]?.url || '',
    };

    const page1Items = tracksPage1?.data?.data?.me?.library?.tracks?.items || [];
    const page2Items = tracksPage2?.data?.data?.me?.library?.tracks?.items || [];
    const totalLiked =
      tracksPage1?.data?.data?.me?.library?.tracks?.totalCount || page1Items.length;

    const allTrackItems = [...page1Items, ...page2Items];
    const likedSongs = allTrackItems
      .map((item, idx) => {
        const tData = item?.track?.data;
        if (!tData || !tData.name) return null;
        const artists =
          (tData.artists?.items || [])
            .map((a) => a.profile?.name)
            .filter(Boolean)
            .join(', ') || 'Artista';
        const albumName = tData.albumOfTrack?.name || '';
        const coverUrl = tData.albumOfTrack?.coverArt?.sources?.[0]?.url || '';
        return {
          id: item.track._uri || `sp-liked-${idx}`,
          title: tData.name,
          artist: artists,
          album: albumName,
          thumbnail: coverUrl,
        };
      })
      .filter(Boolean);

    // 2. Fetch User's Playlists (both private & public) from spclient rootlist + enrich metadata via Pathfinder
    const playlists = [];
    if (username) {
      const rootlistRes = await httpsGet(
        `https://spclient.wg.spotify.com/playlist/v2/user/${encodeURIComponent(
          username
        )}/rootlist?decorate=revision,length,attributes,timestamp,owner`,
        {
          Authorization: `Bearer ${activeToken}`,
        }
      ).catch(() => null);

      const rawItems = rootlistRes?.data?.contents?.items || [];
      const playlistUris = rawItems
        .map((it) => it.uri)
        .filter((uri) => uri && uri.startsWith('spotify:playlist:'))
        .slice(0, 25);

      const enriched = await Promise.all(
        playlistUris.map(async (uri) => {
          const plId = uri.split(':').pop();
          try {
            const plRes = await querySpotifyPathfinder(
              activeToken,
              'fetchPlaylist',
              HASH_FETCH_PLAYLIST,
              {
                uri,
                offset: 0,
                limit: 1,
                enableWatchFeedEntrypoint: false,
              }
            );
            const plV2 = plRes?.data?.data?.playlistV2;
            if (!plV2 || !plV2.name) return null;
            return {
              id: plId,
              provider: 'spotify',
              title: plV2.name,
              description: plV2.description || '',
              trackCount: plV2.content?.totalCount || 0,
              thumbnail: plV2.images?.items?.[0]?.sources?.[0]?.url || '',
            };
          } catch (e) {
            return null;
          }
        })
      );

      playlists.push(...enriched.filter(Boolean));
    }

    console.log(
      `[Spotify Pathfinder] Loaded ${likedSongs.length} liked songs (of ${totalLiked} total) & ${playlists.length} playlists for ${profile.name}!`
    );

    return {
      profile,
      totalLiked,
      likedSongs,
      playlists,
      albums: [],
    };
  } catch (err) {
    console.error('[Spotify Pathfinder] Error reading library:', err);
    return { profile: null, likedSongs: [], playlists: [], albums: [] };
  }
}

/**
 * Fetches all tracks inside a specific Spotify Playlist via Pathfinder GraphQL `fetchPlaylist`
 */
async function getSpotifyPlaylistTracks(playlistId) {
  const activeToken = await getValidSpotifyToken();
  if (activeToken) {
    try {
      const uri = playlistId.startsWith('spotify:playlist:')
        ? playlistId
        : `spotify:playlist:${playlistId}`;
      const res = await querySpotifyPathfinder(activeToken, 'fetchPlaylist', HASH_FETCH_PLAYLIST, {
        uri,
        offset: 0,
        limit: 100,
        enableWatchFeedEntrypoint: false,
      });

      const items = res?.data?.data?.playlistV2?.content?.items || [];
      const tracks = items
        .map((it) => {
          const tData = it?.itemV2?.data;
          if (!tData || !tData.name) return null;
          const artists =
            (tData.artists?.items || [])
              .map((a) => a.profile?.name)
              .filter(Boolean)
              .join(', ') || 'Artista';
          const albumName = tData.albumOfTrack?.name || '';
          const coverUrl = tData.albumOfTrack?.coverArt?.sources?.[0]?.url || '';
          return {
            title: tData.name,
            artist: artists,
            album: albumName,
            thumbnail: coverUrl,
          };
        })
        .filter(Boolean);

      if (tracks.length > 0) return tracks;
    } catch (e) {
      console.warn('[Spotify Pathfinder] Playlist track fetch fallback:', e.message);
    }
  }

  const parsed = await parseExternalMusicUrl(`https://open.spotify.com/playlist/${playlistId}`);
  return parsed.tracks || [];
}

/**
 * Parses any public Spotify Playlist/Album URL
 */
async function parseExternalMusicUrl(rawUrl) {
  const url = (rawUrl || '').trim();
  if (!url) return { ok: false, error: 'Ingresa un enlace válido.' };

  if (url.includes('spotify.com')) {
    const match = url.match(/(playlist|album|track)\/([a-zA-Z0-9]+)/);
    if (!match) {
      return { ok: false, error: 'No se reconoció el ID de la playlist o álbum de Spotify.' };
    }
    const [, type, id] = match;

    if (type === 'playlist') {
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

  return {
    ok: false,
    error: 'Ingresa un enlace válido de Spotify (open.spotify.com/playlist/...).',
  };
}

module.exports = {
  connectSpotifyAccount,
  fetchSpotifyUserLibrary,
  getSpotifyPlaylistTracks,
  parseExternalMusicUrl,
};
