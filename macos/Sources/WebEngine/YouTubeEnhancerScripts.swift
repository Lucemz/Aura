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

      // Background Eco-Mode CSS + Zero-Overhead Static Aura Branding & Dynamic Accent Variable
      try {
        const auraLogoSvg = encodeURIComponent(`
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
            <defs>
              <linearGradient id="ring" x1="8" y1="12" x2="56" y2="54" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#06b6d4"/>
                <stop offset="50%" stop-color="#8b5cf6"/>
                <stop offset="100%" stop-color="#f43f5e"/>
              </linearGradient>
            </defs>
            <circle cx="32" cy="34" r="22" stroke="url(#ring)" stroke-width="2.4" opacity="0.92"/>
            <rect x="17" y="28" width="3.2" height="12" rx="1.6" fill="#06b6d4"/>
            <rect x="22" y="23" width="3.2" height="22" rx="1.6" fill="#38bdf8"/>
            <rect x="27" y="18" width="3.2" height="32" rx="1.6" fill="#6366f1"/>
            <rect x="32" y="14" width="3.4" height="40" rx="1.7" fill="#a855f7"/>
            <rect x="37" y="19" width="3.2" height="30" rx="1.6" fill="#c084fc"/>
            <rect x="42" y="24" width="3.2" height="20" rx="1.6" fill="#f43f5e"/>
            <rect x="47" y="29" width="3.2" height="10" rx="1.6" fill="#fb7185"/>
            <path d="M32 3 L33.8 9.2 L40 11 L33.8 12.8 L32 19 L30.2 12.8 L24 11 L30.2 9.2 Z" fill="#ffffff"/>
          </svg>
        `.trim());

        const style = document.createElement('style');
        style.textContent = `
          :root {
            --aura-accent: #8b5cf6;
            --aura-accent-soft: rgba(139, 92, 246, 0.16);
          }

          html.__aura-eco-bg *,
          html.__aura-eco-bg *::before,
          html.__aura-eco-bg *::after {
            animation-play-state: paused !important;
            transition: none !important;
          }

          /* Hide original YouTube Music SVG inside ytmusic-logo and show Aura vector emblem */
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
            width: 30px;
            height: 30px;
            background-image: url("data:image/svg+xml;utf8,${auraLogoSvg}");
            background-size: contain;
            background-repeat: no-repeat;
            background-position: center;
            flex-shrink: 0;
          }

          ytmusic-nav-bar ytmusic-logo a.yt-simple-endpoint::after {
            content: 'Aura';
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'YouTube Sans', Roboto, sans-serif;
            font-size: 21px;
            font-weight: 700;
            letter-spacing: -0.4px;
            color: #ffffff;
          }

          /* Player & Active Theme Color driven by --aura-accent (0% GPU/CPU cost) */
          #progress-bar.ytmusic-player-bar,
          #volume-slider.ytmusic-player-bar,
          #expand-volume-slider.ytmusic-player-bar {
            --paper-slider-active-color: var(--aura-accent) !important;
            --paper-slider-knob-color: var(--aura-accent) !important;
            --paper-slider-knob-start-color: var(--aura-accent) !important;
            --paper-slider-knob-start-border-color: var(--aura-accent) !important;
          }

          ytmusic-player-bar {
            border-top: 1px solid var(--aura-accent-soft) !important;
          }

          ytmusic-guide-entry-renderer[active] tp-yt-paper-item {
            background-color: var(--aura-accent-soft) !important;
          }

          ytmusic-guide-entry-renderer[active] .title.ytmusic-guide-entry-renderer,
          ytmusic-guide-entry-renderer[active] yt-icon.guide-icon {
            color: var(--aura-accent) !important;
          }
        `;
        document.head.appendChild(style);
      } catch (e) {}

      // Lightweight Theme Controller (Fixed Color or Dynamic per-song Artwork sampling)
      window.__auraThemeMode = localStorage.getItem('__aura_theme_mode') || 'dynamic';
      window.__auraLastThumb = '';

      window.__auraApplyHexColor = function(hex, softRgba) {
        document.documentElement.style.setProperty('--aura-accent', hex);
        document.documentElement.style.setProperty('--aura-accent-soft', softRgba);
      };

      window.__auraSampleCurrentArtwork = function() {
        if (window.__auraThemeMode !== 'dynamic') return;
        const img = document.querySelector('ytmusic-player-bar img.image');
        if (!img || !img.src || img.src === window.__auraLastThumb) return;
        window.__auraLastThumb = img.src;

        const probe = new Image();
        probe.crossOrigin = 'Anonymous';
        probe.onload = function() {
          try {
            const c = document.createElement('canvas');
            c.width = 8;
            c.height = 8;
            const ctx = c.getContext('2d');
            if (!ctx) return;
            ctx.drawImage(probe, 0, 0, 8, 8);
            const data = ctx.getImageData(0, 0, 8, 8).data;
            let bestR = 139, bestG = 92, bestB = 246, maxSat = -1;
            for (let i = 0; i < data.length; i += 4) {
              const r = data[i], g = data[i + 1], b = data[i + 2];
              const max = Math.max(r, g, b), min = Math.min(r, g, b);
              const lum = (max + min) / 2;
              if (lum < 45 || lum > 235) continue;
              const sat = max - min;
              if (sat > maxSat) {
                maxSat = sat;
                bestR = r; bestG = g; bestB = b;
              }
            }
            // Boost brightness slightly so it always looks vibrant on dark UI
            const boost = (v) => Math.min(255, Math.max(70, Math.round(v * 1.15)));
            const r = boost(bestR), g = boost(bestG), b = boost(bestB);
            window.__auraApplyHexColor(
              `rgb(${r}, ${g}, ${b})`,
              `rgba(${r}, ${g}, ${b}, 0.18)`
            );
          } catch (e) {}
        };
        probe.src = img.src;
      };

      window.__auraSetThemeMode = function(mode) {
        window.__auraThemeMode = mode;
        try { localStorage.setItem('__aura_theme_mode', mode); } catch (e) {}
        const presets = {
          violet: ['#8b5cf6', 'rgba(139, 92, 246, 0.18)'],
          emerald: ['#10b981', 'rgba(16, 185, 129, 0.18)'],
          cyan: ['#06b6d4', 'rgba(6, 182, 212, 0.18)'],
          rose: ['#f43f5e', 'rgba(244, 63, 94, 0.18)'],
          youtube: ['#ff0000', 'rgba(255, 0, 0, 0.18)'],
        };
        if (presets[mode]) {
          window.__auraApplyHexColor(presets[mode][0], presets[mode][1]);
        } else {
          window.__auraLastThumb = '';
          window.__auraSampleCurrentArtwork();
        }
      };

      // Initialize saved theme mode
      setTimeout(() => window.__auraSetThemeMode(window.__auraThemeMode), 600);

      // Low-overhead Ad-Skipper & 'Still Listening?' auto-dismiss
      setInterval(() => {
        try {
          const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
          if (skipBtn) skipBtn.click();

          const adOverlayClose = document.querySelector('.ytp-ad-overlay-close-button');
          if (adOverlayClose) adOverlayClose.click();

          const confirmDialog = document.querySelector('ytmusic-you-there-renderer button');
          if (confirmDialog) confirmDialog.click();

          if (window.__auraThemeMode === 'dynamic' && window.__auraSampleCurrentArtwork) {
            window.__auraSampleCurrentArtwork();
          }
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
