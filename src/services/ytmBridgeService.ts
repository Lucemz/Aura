import { AudioPreset } from '../types';

const EQ_GAINS: Record<AudioPreset, { bass: number; mid: number; treble: number }> = {
  flat: { bass: 0, mid: 0, treble: 0 },
  bass: { bass: 7, mid: -1, treble: 2 },
  vocal: { bass: -2, mid: 5, treble: 3 },
  warm: { bass: 4, mid: 2, treble: -2 },
};

/**
 * Evaluates JavaScript inside the live YouTube Music view (Safari WKWebView or Electron fallback)
 */
export async function evalInYouTubeMusic(code: string, fallbackWebview?: any): Promise<any> {
  if (window.auraAPI?.webviewEvalJS) {
    return await window.auraAPI.webviewEvalJS(code);
  }
  if (fallbackWebview) {
    return await fallbackWebview.executeJavaScript(code);
  }
  return null;
}

/**
 * Applies a real-time 3-band Web Audio API equalizer preset inside YouTube Music
 */
export async function applyEqualizerPresetInYTM(
  preset: AudioPreset,
  fallbackWebview?: any
): Promise<void> {
  const gains = EQ_GAINS[preset];
  await evalInYouTubeMusic(
    `
    (function() {
      try {
        const video = document.querySelector('video');
        if (!video) return;

        if (!window.__auraAudioCtx) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          const ctx = new AudioCtx();
          const source = ctx.createMediaElementSource(video);

          const bass = ctx.createBiquadFilter();
          bass.type = 'lowshelf';
          bass.frequency.value = 120;

          const mid = ctx.createBiquadFilter();
          mid.type = 'peaking';
          mid.frequency.value = 1200;

          const treble = ctx.createBiquadFilter();
          treble.type = 'highshelf';
          treble.frequency.value = 8000;

          source.connect(bass);
          bass.connect(mid);
          mid.connect(treble);
          treble.connect(ctx.destination);

          window.__auraAudioCtx = ctx;
          window.__auraFilters = { bass, mid, treble };
        }

        if (window.__auraFilters) {
          window.__auraFilters.bass.gain.value = ${gains.bass};
          window.__auraFilters.mid.gain.value = ${gains.mid};
          window.__auraFilters.treble.gain.value = ${gains.treble};
        }
      } catch (e) {
        console.warn('EQ init error:', e);
      }
    })();
    `,
    fallbackWebview
  ).catch(() => {});
}

/**
 * Sends a real `youtubei/v1/like/like` mutation inside the live YouTube Music session
 */
export async function likeTrackInYouTubeMusic(
  videoId: string,
  fallbackWebview?: any
): Promise<boolean> {
  try {
    const authHeader = await window.auraAPI?.getSapisidAuthHeader();
    if (!authHeader) return false;

    const ok = await evalInYouTubeMusic(
      `
      (async function() {
        try {
          const ytcfg = window.ytcfg;
          const context = ytcfg ? ytcfg.get('INNERTUBE_CONTEXT') : {
            client: { clientName: 'WEB_REMIX', clientVersion: '1.20241020.01.00', hl: 'es-419', gl: 'PE' }
          };
          const apiKey = ytcfg ? ytcfg.get('INNERTUBE_API_KEY') : '';
          const headers = {
            'Content-Type': 'application/json',
            'X-Origin': 'https://music.youtube.com',
            'X-Goog-AuthUser': ytcfg ? String(ytcfg.get('SESSION_INDEX') || 0) : '0',
            'Authorization': ${JSON.stringify(authHeader)}
          };
          if (ytcfg && ytcfg.get('DELEGATED_SESSION_ID')) {
            headers['X-Goog-PageId'] = ytcfg.get('DELEGATED_SESSION_ID');
          }
          if (ytcfg && ytcfg.get('VISITOR_DATA')) {
            headers['X-Goog-Visitor-Id'] = ytcfg.get('VISITOR_DATA');
          }
          const url = 'https://music.youtube.com/youtubei/v1/like/like?alt=json' + (apiKey ? '&key=' + apiKey : '');
          const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({
              context,
              target: { videoId: ${JSON.stringify(videoId)} }
            })
          });
          return res.ok;
        } catch (e) {
          return false;
        }
      })()
      `,
      fallbackWebview
    );
    return Boolean(ok);
  } catch {
    return false;
  }
}

/**
 * Creates a real playlist (`youtubei/v1/playlist/create`) inside the live YouTube Music session
 */
export async function createPlaylistInYouTubeMusic(
  title: string,
  description: string,
  videoIds: string[],
  fallbackWebview?: any
): Promise<string | null> {
  try {
    const authHeader = await window.auraAPI?.getSapisidAuthHeader();
    if (!authHeader) return null;

    const playlistId = await evalInYouTubeMusic(
      `
      (async function() {
        try {
          const ytcfg = window.ytcfg;
          const context = ytcfg ? ytcfg.get('INNERTUBE_CONTEXT') : {
            client: { clientName: 'WEB_REMIX', clientVersion: '1.20241020.01.00', hl: 'es-419', gl: 'PE' }
          };
          const apiKey = ytcfg ? ytcfg.get('INNERTUBE_API_KEY') : '';
          const headers = {
            'Content-Type': 'application/json',
            'X-Origin': 'https://music.youtube.com',
            'X-Goog-AuthUser': ytcfg ? String(ytcfg.get('SESSION_INDEX') || 0) : '0',
            'Authorization': ${JSON.stringify(authHeader)}
          };
          if (ytcfg && ytcfg.get('DELEGATED_SESSION_ID')) {
            headers['X-Goog-PageId'] = ytcfg.get('DELEGATED_SESSION_ID');
          }
          if (ytcfg && ytcfg.get('VISITOR_DATA')) {
            headers['X-Goog-Visitor-Id'] = ytcfg.get('VISITOR_DATA');
          }
          const url = 'https://music.youtube.com/youtubei/v1/playlist/create?alt=json' + (apiKey ? '&key=' + apiKey : '');
          const res = await fetch(url, {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({
              context,
              title: ${JSON.stringify(title)},
              description: ${JSON.stringify(description)},
              privacyStatus: 'PRIVATE',
              videoIds: ${JSON.stringify(videoIds)}
            })
          });
          if (!res.ok) return null;
          const data = await res.json();
          return data.playlistId || null;
        } catch (e) {
          return null;
        }
      })()
      `,
      fallbackWebview
    );
    return playlistId || null;
  } catch {
    return null;
  }
}
