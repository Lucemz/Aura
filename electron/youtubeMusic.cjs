const https = require('https');
const crypto = require('crypto');
const yts = require('yt-search');

const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Helper to build Cookie header string and map from Electron session
 */
async function getCookiesDataFromSession(sess) {
  try {
    if (!sess) return { cookieHeader: '', cookieMap: {} };
    const cookiesYt = await sess.cookies.get({ url: 'https://music.youtube.com' });
    const cookiesGoogle = await sess.cookies.get({ domain: '.youtube.com' });
    const allCookies = [...cookiesGoogle, ...cookiesYt];

    const cookieMap = {};
    for (const c of allCookies) {
      cookieMap[c.name] = c.value;
    }
    const cookieHeader = Object.entries(cookieMap)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');

    return { cookieHeader, cookieMap };
  } catch (e) {
    return { cookieHeader: '', cookieMap: {} };
  }
}

async function getCookieHeaderFromSession(sess) {
  const { cookieHeader } = await getCookiesDataFromSession(sess);
  return cookieHeader;
}

/**
 * Generates SAPISIDHASH Authorization header required by YouTube Music for authenticated write actions
 * (Liking songs, creating playlists, adding tracks to playlists)
 */
function buildSapisidHashHeader(cookieMap) {
  const sapisid =
    cookieMap['SAPISID'] ||
    cookieMap['__Secure-3PAPISID'] ||
    cookieMap['__Secure-1PAPISID'] ||
    '';
  if (!sapisid) return null;

  const origin = 'https://music.youtube.com';
  const timestamp = Math.floor(Date.now() / 1000);
  const input = `${timestamp} ${sapisid} ${origin}`;
  const hash = crypto.createHash('sha1').update(input).digest('hex');
  return `SAPISIDHASH ${timestamp}_${hash} SAPISID1PHASH ${timestamp}_${hash} SAPISID3PHASH ${timestamp}_${hash}`;
}

/**
 * Generic authenticated InnerTube POST request against music.youtube.com
 */
async function callYouTubeMusicApi(sess, endpointPath, payload) {
  const { cookieHeader, cookieMap } = await getCookiesDataFromSession(sess);
  const authHeader = buildSapisidHashHeader(cookieMap);

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: '1.20241020.01.00',
          hl: 'es-419',
          gl: 'PE',
        },
      },
      ...payload,
    });

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': CHROME_UA,
      Origin: 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/',
      'X-Origin': 'https://music.youtube.com',
      'X-Goog-AuthUser': '0',
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(authHeader ? { Authorization: authHeader } : {}),
    };

    const req = https.request(
      `https://music.youtube.com/youtubei/v1/${endpointPath}?alt=json`,
      {
        method: 'POST',
        headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve({ statusCode: res.statusCode, data: parsed });
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
 * Searches YouTube Music specifically for an official Song (ATV/OMV) matching Artist + Title
 */
async function searchYouTubeMusicTrack(sess, title, artist) {
  const query = `${artist} ${title}`.trim();
  try {
    // 1. Try YouTube Music's native search with "Songs" filter (EgWKAQIIAWoKEAMQBBAJEAoQBQ==)
    const { data } = await callYouTubeMusicApi(sess, 'search', {
      query,
      params: 'EgWKAQIIAWoKEAMQBBAJEAoQBQ%3D%3D',
    });

    const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs || [];
    const contents = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];

    for (const sec of contents) {
      const shelf = sec.musicShelfRenderer;
      if (!shelf || !shelf.contents) continue;
      for (const it of shelf.contents) {
        const item = it.musicResponsiveListItemRenderer;
        if (!item) continue;

        const videoId =
          item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer
            ?.playNavigationEndpoint?.watchEndpoint?.videoId ||
          item.playlistItemData?.videoId ||
          item.navigationEndpoint?.watchEndpoint?.videoId;

        const matchedTitle =
          item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text ||
          title;
        const matchedArtist =
          item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
            ?.map((r) => r.text)
            .join('') || artist;
        const thumb =
          item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url || '';

        if (videoId) {
          return {
            videoId,
            title: matchedTitle,
            artist: matchedArtist,
            thumbnail: thumb || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          };
        }
      }
    }
  } catch (e) {
    console.warn('[YTM Search] InnerTube song search fallback:', e.message);
  }

  // 2. Fallback to yt-search if InnerTube didn't return a song
  try {
    const r = await yts(`${query} official audio`);
    if (r && r.videos && r.videos.length > 0) {
      const top = r.videos.find((v) => v.seconds >= 60 && v.seconds <= 600) || r.videos[0];
      return {
        videoId: top.videoId,
        title: top.title,
        artist: top.author?.name || artist,
        thumbnail: top.thumbnail || `https://img.youtube.com/vi/${top.videoId}/hqdefault.jpg`,
      };
    }
  } catch (err) {
    console.error('[YTM Search] yt-search fallback failed:', err.message);
  }

  return null;
}

/**
 * Likes a song directly on the user's REAL YouTube Music account (adds it to 'Música que me gusta' / LM)
 */
async function likeSongOnYouTubeMusic(sess, videoId) {
  try {
    const res = await callYouTubeMusicApi(sess, 'like/like', {
      target: {
        videoId,
      },
    });
    const ok = res.statusCode >= 200 && res.statusCode < 300 && !res.data?.error;
    if (!ok) {
      console.warn('[YTM Like] Failed response:', res.statusCode, JSON.stringify(res.data?.error || {}));
    }
    return { ok, statusCode: res.statusCode, error: res.data?.error?.message };
  } catch (err) {
    console.error('[YTM Like] Error liking videoId:', videoId, err);
    return { ok: false, error: err.message };
  }
}

/**
 * Creates a REAL Playlist in the user's YouTube Music account
 */
async function createPlaylistOnYouTubeMusic(sess, title, description = '', videoIds = []) {
  try {
    const payload = {
      title: title || 'Playlist Importada',
      description: description || 'Importada con Aura Music desde Spotify / Apple Music',
      privacyStatus: 'PRIVATE',
    };
    if (videoIds && videoIds.length > 0) {
      payload.videoIds = videoIds;
    }

    const res = await callYouTubeMusicApi(sess, 'playlist/create', payload);
    const playlistId = res.data?.playlistId;
    if (playlistId) {
      return { ok: true, playlistId };
    }
    return {
      ok: false,
      error: res.data?.error?.message || 'No se pudo crear la playlist en YouTube Music',
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Adds one or more videoIds to an existing YouTube Music Playlist
 */
async function addVideosToYouTubePlaylist(sess, playlistId, videoIds = []) {
  if (!playlistId || !videoIds.length) return { ok: false };
  try {
    const actions = videoIds.map((id) => ({
      action: 'ACTION_ADD_VIDEO',
      addedVideoId: id,
      dedupeOption: 'DEDUPE_OPTION_SKIP',
    }));

    const res = await callYouTubeMusicApi(sess, 'browse/edit_playlist', {
      playlistId,
      actions,
    });
    const ok = res.statusCode >= 200 && res.statusCode < 300 && !res.data?.error;
    return { ok, error: res.data?.error?.message };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Fetches user profile info (name, handle/email, avatar) from YouTube Music session cookies
 */
async function getUserProfile(sess) {
  try {
    const { cookieHeader, cookieMap } = await getCookiesDataFromSession(sess);
    if (!cookieHeader || (!cookieMap['SAPISID'] && !cookieMap['__Secure-3PAPISID'])) {
      return { loggedIn: false };
    }

    const { data } = await callYouTubeMusicApi(sess, 'account/account_menu', {});
    const active =
      data?.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer?.header
        ?.activeAccountHeaderRenderer;
    if (active) {
      const name = active.accountName?.runs?.[0]?.text || 'Usuario';
      const email =
        active.email?.runs?.[0]?.text || active.channelHandle?.runs?.[0]?.text || '';
      const avatar = active.accountPhoto?.thumbnails?.slice(-1)[0]?.url || '';
      return { loggedIn: true, name, email, avatar };
    }
    return { loggedIn: true, name: 'Cuenta Conectada', email: '', avatar: '' };
  } catch (e) {
    return { loggedIn: false };
  }
}

module.exports = {
  getCookieHeaderFromSession,
  getCookiesDataFromSession,
  buildSapisidHashHeader,
  searchYouTubeMusicTrack,
  likeSongOnYouTubeMusic,
  createPlaylistOnYouTubeMusic,
  addVideosToYouTubePlaylist,
  getUserProfile,
};
