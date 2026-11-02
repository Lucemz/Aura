import Foundation

enum YouTubeEnhancerScripts {
    /// Injected at document start so Google Login uses standard Phone Prompt / Password
    /// instead of failing on macOS Bluetooth Passkey inside unsigned WebViews
    static let disableBrokenBluetoothPasskeyJS = """
    (function() {
      try {
        if (location.hostname.includes('accounts.google.com')) {
          Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true });
          if (navigator.credentials) {
            navigator.credentials.get = () => Promise.reject(new Error('WebAuthn disabled'));
            navigator.credentials.create = () => Promise.reject(new Error('WebAuthn disabled'));
          }
        }
      } catch (e) {}
    })();
    """

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

      // Background Eco-Mode CSS (pauses decorative animations when window is hidden/unfocused)
      try {
        const style = document.createElement('style');
        style.textContent = `
          html.__aura-eco-bg *,
          html.__aura-eco-bg *::before,
          html.__aura-eco-bg *::after {
            animation-play-state: paused !important;
            transition: none !important;
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
