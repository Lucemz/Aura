import Foundation

enum YouTubeEnhancerScripts {
    /// Injected into `ytmWebView` (`https://music.youtube.com`):
    /// - Preserves 100% default video & audio quality (removes any quality override)
    /// - Skips video/audio ads automatically & dismisses "Are you still listening?" dialogs
    /// - Pauses non-essential CSS animations when window is in background eco-mode
    static let youtubeMusicEnhancerJS = """
    (function() {
      if (window.__auraSafariEnhancer) return;
      window.__auraSafariEnhancer = true;

      // Ensure 100% original default video & audio quality (never override yt-player-quality)
      try {
        localStorage.removeItem('yt-player-quality');
      } catch (e) {}

      // Background Eco-Mode CSS + Zero-Overhead Static Aura Branding & Accent Colors
      try {
        const style = document.createElement('style');
        style.textContent = `
          html.__aura-eco-bg *,
          html.__aura-eco-bg *::before,
          html.__aura-eco-bg *::after {
            animation-play-state: paused !important;
            transition: none !important;
          }

          /* Hide original YouTube Music SVG inside ytmusic-logo and show Aura branding */
          ytmusic-nav-bar ytmusic-logo a.yt-simple-endpoint picture,
          ytmusic-nav-bar ytmusic-logo a.yt-simple-endpoint yt-icon,
          ytmusic-nav-bar ytmusic-logo a.yt-simple-endpoint svg,
          ytmusic-nav-bar ytmusic-logo a.yt-simple-endpoint img:not(.__aura-logo-img) {
            display: none !important;
          }

          ytmusic-nav-bar ytmusic-logo a.yt-simple-endpoint {
            display: inline-flex !important;
            align-items: center !important;
            gap: 8px !important;
            text-decoration: none !important;
          }

          ytmusic-nav-bar ytmusic-logo a.yt-simple-endpoint::before {
            content: '';
            display: inline-block;
            width: 24px;
            height: 24px;
            border-radius: 7px;
            background: linear-gradient(135deg, #10b981 0%, #6366f1 100%);
            box-shadow: inset 0 0 0 1.5px rgba(255,255,255,0.25);
            flex-shrink: 0;
          }

          ytmusic-nav-bar ytmusic-logo a.yt-simple-endpoint::after {
            content: 'Aura';
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
            font-size: 20px;
            font-weight: 800;
            letter-spacing: -0.5px;
            color: #ffffff;
          }

          /* Static Aura Accent Palette (0% GPU/CPU cost: pure flat color variables) */
          #progress-bar.ytmusic-player-bar {
            --paper-slider-active-color: #10b981 !important;
            --paper-slider-knob-color: #10b981 !important;
            --paper-slider-knob-start-color: #10b981 !important;
            --paper-slider-knob-start-border-color: #10b981 !important;
          }

          ytmusic-guide-entry-renderer[active] tp-yt-paper-item {
            background-color: rgba(16, 185, 129, 0.14) !important;
          }

          ytmusic-guide-entry-renderer[active] .title.ytmusic-guide-entry-renderer,
          ytmusic-guide-entry-renderer[active] yt-icon.guide-icon {
            color: #10b981 !important;
          }
        `;
        document.head.appendChild(style);
      } catch (e) {}

      // Low-overhead Ad-Skipper & 'Still Listening?' auto-dismiss
      setInterval(() => {
        try {
          const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
          if (skipBtn) skipBtn.click();

          const adOverlayClose = document.querySelector('.ytp-ad-overlay-close-button');
          if (adOverlayClose) adOverlayClose.click();

          const confirmDialog = document.querySelector('ytmusic-you-there-renderer button');
          if (confirmDialog) confirmDialog.click();
        } catch (e) {}
      }, 2000);
    })();
    """

    /// Injected into `uiWebView` (`aura://app/index.html`) to expose `window.auraAPI`
    static let uiBridgeInjectionJS = """
    (function() {
      const pending = new Map();
      let seq = 1;
      const authListeners = new Set();
      const mediaListeners = { 'toggle-play': new Set(), 'next': new Set(), 'previous': new Set() };

      window.__auraResolve = function(id, result) {
        const p = pending.get(id);
        if (p) {
          pending.delete(id);
          p.resolve(result);
        }
      };

      window.__auraEmitAuthSuccess = function() {
        authListeners.forEach(cb => { try { cb(); } catch (e) {} });
      };

      window.__auraEmitMediaKey = function(action) {
        const set = mediaListeners[action];
        if (set) set.forEach(cb => { try { cb(); } catch (e) {} });
      };

      function callNative(cmd, args = {}) {
        return new Promise((resolve) => {
          const id = seq++;
          pending.set(id, { resolve });
          window.webkit.messageHandlers.auraBridge.postMessage({ id, cmd, args });
        });
      }

      window.auraAPI = {
        isSafariEngine: true,
        setOverlayExpanded: (expanded) => {
          window.webkit.messageHandlers.auraBridge.postMessage({ id: 0, cmd: 'setOverlayExpanded', args: { expanded } });
        },
        webviewGoBack: () => {
          window.webkit.messageHandlers.auraBridge.postMessage({ id: 0, cmd: 'webviewGoBack', args: {} });
        },
        webviewGoForward: () => {
          window.webkit.messageHandlers.auraBridge.postMessage({ id: 0, cmd: 'webviewGoForward', args: {} });
        },
        webviewReload: () => {
          window.webkit.messageHandlers.auraBridge.postMessage({ id: 0, cmd: 'webviewReload', args: {} });
        },
        webviewLoadURL: (url) => {
          window.webkit.messageHandlers.auraBridge.postMessage({ id: 0, cmd: 'webviewLoadURL', args: { url } });
        },
        webviewEvalJS: (code) => callNative('webviewEvalJS', { code }),

        getUserProfile: () => callNative('getUserProfile'),
        getSapisidAuthHeader: () => callNative('getSapisidAuthHeader'),
        openGoogleLogin: () => callNative('openGoogleLogin'),
        logout: () => callNative('logout'),
        onAuthSuccess: (cb) => {
          authListeners.add(cb);
          return () => authListeners.delete(cb);
        },

        connectSpotify: (forceReauth = false) => callNative('connectSpotify', { forceReauth }),
        getCachedSpotify: () => callNative('getCachedSpotify'),
        getSpotifyPlaylistTracks: (playlistId) => callNative('getSpotifyPlaylistTracks', { playlistId }),
        connectAppleMusic: () => Promise.resolve({ ok: false, likedSongs: [], playlists: [], albums: [] }),
        getApplePlaylistTracks: () => Promise.resolve([]),
        parseExternalMusicUrl: (url) => callNative('parseExternalMusicUrl', { url }),

        searchYouTubeMusicTrack: (title, artist) => callNative('searchYouTubeMusicTrack', { title, artist }),
        playYouTubeMusicVideo: (videoId) => callNative('playYouTubeMusicVideo', { videoId }),
        aiRecommendSongs: (prompt) => callNative('aiRecommendSongs', { prompt }),
        getAiApiKey: () => callNative('getAiApiKey'),
        setAiApiKey: (apiKey) => callNative('setAiApiKey', { apiKey }),
        likeSongOnYouTubeMusic: (videoId) => callNative('likeSongOnYouTubeMusic', { videoId }),
        createPlaylistOnYouTubeMusic: (title, description, videoIds = []) =>
          callNative('createPlaylistOnYouTubeMusic', { title, description, videoIds }),
        addVideosToYouTubePlaylist: () => Promise.resolve({ ok: true }),

        toggleMiniPlayer: () => callNative('toggleMiniPlayer'),
        isMiniPlayer: () => callNative('isMiniPlayer'),
        onMediaKey: (action, cb) => {
          if (mediaListeners[action]) mediaListeners[action].add(cb);
          return () => { if (mediaListeners[action]) mediaListeners[action].delete(cb); };
        }
      };

      // Native macOS window dragging when dragging the top bar background
      window.addEventListener('mousedown', (e) => {
        const target = e.target;
        if (!target) return;
        if (target.closest('button, input, a, [role="button"]')) return;
        if (target.closest('header')) {
          window.webkit.messageHandlers.auraBridge.postMessage({ id: 0, cmd: 'startWindowDrag', args: {} });
        }
      });
    })();
    """
}
