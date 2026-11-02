import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Heart,
  RefreshCw,
  Settings,
  Minimize2,
  Maximize2,
  ShieldCheck,
  Sliders,
  LogIn,
  LogOut,
  Check,
} from 'lucide-react';
import { MusicImporterModal } from './components/MusicImporterModal';

type AudioPreset = 'flat' | 'bass' | 'vocal' | 'warm';

export const App: React.FC = () => {
  const webviewRef = useRef<any>(null);

  const [ytmProfile, setYtmProfile] = useState<{
    loggedIn: boolean;
    name?: string;
    email?: string;
    avatar?: string;
  }>({ loggedIn: false });

  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMiniPlayer, setIsMiniPlayer] = useState(false);
  const [audioPreset, setAudioPreset] = useState<AudioPreset>('flat');
  const [autoSkipAds, setAutoSkipAds] = useState(true);

  // Check YouTube Music login status
  const checkAuthStatus = useCallback(async () => {
    if (window.auraAPI?.getUserProfile) {
      const profile = await window.auraAPI.getUserProfile();
      setYtmProfile(profile);
    }
  }, []);

  useEffect(() => {
    checkAuthStatus();
    if (window.auraAPI?.onAuthSuccess) {
      return window.auraAPI.onAuthSuccess(() => {
        checkAuthStatus();
        // Reload YouTube Music iframe to home so the logged-in account appears immediately
        if (webviewRef.current) {
          try {
            webviewRef.current.loadURL('https://music.youtube.com/');
          } catch (e) {
            try {
              webviewRef.current.reload();
            } catch (err2) {}
          }
        }
      });
    }
  }, [checkAuthStatus]);

  // Connect Mac Media Keys (F7, F8, F9) directly to YouTube Music's native player bar inside the iframe
  useEffect(() => {
    if (!window.auraAPI?.onMediaKey) return;

    const unsubPlay = window.auraAPI.onMediaKey('toggle-play', () => {
      if (!webviewRef.current) return;
      webviewRef.current
        .executeJavaScript(`
          (function() {
            const btn = document.querySelector('#play-pause-button');
            if (btn) { btn.click(); return; }
            const video = document.querySelector('video');
            if (video) { video.paused ? video.play() : video.pause(); }
          })();
        `)
        .catch(() => {});
    });

    const unsubNext = window.auraAPI.onMediaKey('next', () => {
      if (!webviewRef.current) return;
      webviewRef.current
        .executeJavaScript(`
          (function() {
            const btn = document.querySelector('.next-button');
            if (btn) btn.click();
          })();
        `)
        .catch(() => {});
    });

    const unsubPrev = window.auraAPI.onMediaKey('previous', () => {
      if (!webviewRef.current) return;
      webviewRef.current
        .executeJavaScript(`
          (function() {
            const btn = document.querySelector('.previous-button');
            if (btn) btn.click();
          })();
        `)
        .catch(() => {});
    });

    return () => {
      unsubPlay();
      unsubNext();
      unsubPrev();
    };
  }, []);

  // Inject Ad-Skipper, "Still Listening?" auto-dismiss, and Web Audio Equalizer into YouTube Music iframe
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;

    const handleDomReady = () => {
      checkAuthStatus();
      wv.executeJavaScript(`
        (function() {
          if (window.__auraEnhancerInstalled) return;
          window.__auraEnhancerInstalled = true;

          // Auto-skip ads & bypass 'Are you still listening?' prompts
          setInterval(() => {
            try {
              const skipBtn = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
              if (skipBtn) skipBtn.click();

              const adOverlayClose = document.querySelector('.ytp-ad-overlay-close-button');
              if (adOverlayClose) adOverlayClose.click();

              // Dismiss 'Still listening?' dialog if it pops up
              const confirmDialog = document.querySelector('ytmusic-you-there-renderer button');
              if (confirmDialog) confirmDialog.click();
            } catch (e) {}
          }, 1000);
        })();
      `).catch(() => {});
    };

    wv.addEventListener('dom-ready', handleDomReady);
    wv.addEventListener('did-navigate', checkAuthStatus);
    wv.addEventListener('did-navigate-in-page', checkAuthStatus);

    return () => {
      try {
        wv.removeEventListener('dom-ready', handleDomReady);
        wv.removeEventListener('did-navigate', checkAuthStatus);
        wv.removeEventListener('did-navigate-in-page', checkAuthStatus);
      } catch (e) {}
    };
  }, [checkAuthStatus]);

  // Apply real-time Web Audio API EQ Preset inside the YouTube Music iframe
  const applyAudioPreset = (preset: AudioPreset) => {
    setAudioPreset(preset);
    if (!webviewRef.current) return;

    const gains = {
      flat: { bass: 0, mid: 0, treble: 0 },
      bass: { bass: 7, mid: -1, treble: 2 },
      vocal: { bass: -2, mid: 5, treble: 3 },
      warm: { bass: 4, mid: 2, treble: -2 },
    }[preset];

    webviewRef.current
      .executeJavaScript(`
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
      `)
      .catch(() => {});
  };

  /**
   * Executes a REAL Like (`youtubei/v1/like/like`) inside the live YouTube Music iframe
   * using the user's active `ytcfg` context and `SAPISIDHASH` authorization header.
   */
  const handleLikeTrackInWebview = useCallback(async (videoId: string): Promise<boolean> => {
    if (!webviewRef.current) return false;
    try {
      const authHeader = await window.auraAPI?.getSapisidAuthHeader();
      if (!authHeader) return false;

      const ok = await webviewRef.current.executeJavaScript(`
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
        })();
      `);
      return Boolean(ok);
    } catch (e) {
      return false;
    }
  }, []);

  /**
   * Creates a REAL Playlist (`youtubei/v1/playlist/create`) inside the live YouTube Music iframe
   * and populates all matched tracks.
   */
  const handleCreatePlaylistInWebview = useCallback(
    async (title: string, description: string, videoIds: string[]): Promise<string | null> => {
      if (!webviewRef.current) return null;
      try {
        const authHeader = await window.auraAPI?.getSapisidAuthHeader();
        if (!authHeader) return null;

        const playlistId = await webviewRef.current.executeJavaScript(`
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
          })();
        `);
        return playlistId || null;
      } catch (e) {
        return null;
      }
    },
    []
  );

  const navigateIframe = (url: string) => {
    if (!webviewRef.current) return;
    try {
      webviewRef.current.loadURL(url);
    } catch (e) {
      webviewRef.current.src = url;
    }
  };

  const handleToggleMini = async () => {
    if (window.auraAPI?.toggleMiniPlayer) {
      const mini = await window.auraAPI.toggleMiniPlayer();
      setIsMiniPlayer(mini);
    }
  };

  const handleOpenGoogleLogin = async () => {
    if (window.auraAPI?.openGoogleLogin) {
      await window.auraAPI.openGoogleLogin();
      await checkAuthStatus();
      if (webviewRef.current) {
        try {
          webviewRef.current.reload();
        } catch (e) {}
      }
    }
  };

  const handleLogout = async () => {
    if (window.auraAPI?.logout) {
      await window.auraAPI.logout();
      setYtmProfile({ loggedIn: false });
      if (webviewRef.current) {
        try {
          webviewRef.current.reload();
        } catch (e) {}
      }
    }
  };

  return (
    <div className="w-screen h-screen flex flex-col bg-[#030303] text-white overflow-hidden select-none">
      {/* Slim Native macOS Top Bar */}
      <header
        className="h-10 bg-[#0a0a0a] border-b border-white/10 flex items-center justify-between pl-20 pr-3 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left Navigation Controls for the YouTube Music Iframe */}
        <div
          className="flex items-center gap-1"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => webviewRef.current?.goBack()}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Atrás"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => webviewRef.current?.goForward()}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Adelante"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => webviewRef.current?.reload()}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title="Recargar YouTube Music"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          <div className="h-4 w-[1px] bg-white/10 mx-1" />

          <button
            onClick={() => navigateIframe('https://music.youtube.com/')}
            className="px-2.5 py-1 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-white/10 flex items-center gap-1.5 transition cursor-pointer"
          >
            <Home className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Inicio</span>
          </button>

          <button
            onClick={() => navigateIframe('https://music.youtube.com/playlist?list=LM')}
            className="px-2.5 py-1 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-white/10 flex items-center gap-1.5 transition cursor-pointer"
            title="Ir a Música que me gusta dentro de YouTube Music"
          >
            <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500" />
            <span className="hidden md:inline">Mis Me Gusta</span>
          </button>
        </div>

        {/* Right Value-Added Controls: Music Importer, EQ, MiniPlayer & Settings */}
        <div
          className="flex items-center gap-2 relative"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Quick External Browser Login Button when not signed in */}
          {!ytmProfile.loggedIn && (
            <button
              onClick={handleOpenGoogleLogin}
              className="px-3 py-1 rounded-lg bg-white text-black hover:bg-neutral-200 text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
              title="Se abrirá tu navegador Google Chrome real para iniciar sesión de forma segura y sincronizar el token automáticamente"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Iniciar Sesión (vía Chrome)</span>
            </button>
          )}

          {/* Primary Value-Add Button: Spotify & Apple Music Importer */}
          <button
            onClick={() => setIsImporterOpen(true)}
            className="px-3 py-1 rounded-lg bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Importar de Spotify / Apple Music</span>
          </button>

          {/* Mini-Player Toggle */}
          <button
            onClick={handleToggleMini}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
            title={isMiniPlayer ? 'Expandir ventana' : 'Modo Mini-Player Flotante'}
          >
            {isMiniPlayer ? (
              <Maximize2 className="w-3.5 h-3.5" />
            ) : (
              <Minimize2 className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Settings & Value-Add Menu Button */}
          <button
            onClick={() => setIsSettingsOpen(!isSettingsOpen)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 border transition cursor-pointer ${
              isSettingsOpen
                ? 'bg-white/15 border-white/30 text-white'
                : 'bg-white/5 border-white/10 text-neutral-300 hover:text-white hover:bg-white/10'
            }`}
          >
            {ytmProfile.loggedIn && ytmProfile.avatar ? (
              <img src={ytmProfile.avatar} alt="" className="w-4 h-4 rounded-full" />
            ) : (
              <Settings className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Configuraciones</span>
          </button>

          {/* Settings & Extras Popover Menu */}
          {isSettingsOpen && (
            <div className="absolute right-0 top-9 w-80 bg-[#161616] border border-white/15 rounded-2xl shadow-2xl p-4 z-50 space-y-4">
              {/* Account Section */}
              <div className="pb-3 border-b border-white/10">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                  Cuenta de YouTube Music
                </p>
                {ytmProfile.loggedIn ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {ytmProfile.avatar ? (
                        <img
                          src={ytmProfile.avatar}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-xs font-bold">
                          {ytmProfile.name?.[0] || 'U'}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{ytmProfile.name}</p>
                        <p className="text-[11px] text-emerald-400 truncate">
                          {ytmProfile.email || 'Sesión activa en el iframe'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleLogout}
                      className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-neutral-400 hover:text-red-400 transition cursor-pointer"
                      title="Cerrar sesión"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setIsSettingsOpen(false);
                      handleOpenGoogleLogin();
                    }}
                    className="w-full py-2 px-3 rounded-xl bg-white text-black hover:bg-neutral-200 font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer transition"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Iniciar sesión en Google / YT Music</span>
                  </button>
                )}
              </div>

              {/* Audio Equalizer Preset */}
              <div className="pb-3 border-b border-white/10">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
                  <Sliders className="w-3.5 h-3.5 text-red-500" />
                  <span>Ecualizador en Tiempo Real</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { id: 'flat', label: 'Original (Plano)' },
                    { id: 'bass', label: 'Bass Boost' },
                    { id: 'vocal', label: 'Claridad Vocal' },
                    { id: 'warm', label: 'Estudio Cálido' },
                  ].map((item) => (
                    <button
                      key={item.id}
                      onClick={() => applyAudioPreset(item.id as AudioPreset)}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between border cursor-pointer transition ${
                        audioPreset === item.id
                          ? 'bg-red-600/20 border-red-500 text-white'
                          : 'bg-white/5 border-white/5 text-neutral-400 hover:text-white'
                      }`}
                    >
                      <span>{item.label}</span>
                      {audioPreset === item.id && <Check className="w-3 h-3 text-red-400" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* AdBlocker & Shortcuts Info */}
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-neutral-300">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Bloqueador de anuncios y cortes</span>
                  </div>
                  <button
                    onClick={() => setAutoSkipAds(!autoSkipAds)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${
                      autoSkipAds
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-white/10 text-neutral-400'
                    }`}
                  >
                    {autoSkipAds ? 'Activo' : 'Pausado'}
                  </button>
                </div>

                <div className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-[11px] text-neutral-400 flex items-center justify-between">
                  <span>Atajos físicos de Mac</span>
                  <span className="font-mono text-white">F7 ⏮ · F8 ⏯ · F9 ⏭</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* 100% Pure, Unmodified YouTube Music Webview / Iframe */}
      <main className="flex-1 w-full h-full relative bg-[#030303] overflow-hidden">
        <webview
          ref={webviewRef}
          src="https://music.youtube.com"
          partition="persist:aura-user-session"
          // @ts-ignore
          allowpopups="true"
          style={{ display: 'inline-flex', width: '100%', height: '100%' }}
          className="absolute inset-0 w-full h-full border-0"
        />
      </main>

      {/* Spotify & Apple Music -> Real YouTube Music Account Importer Modal */}
      <MusicImporterModal
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        ytmLoggedIn={ytmProfile.loggedIn}
        onOpenGoogleLogin={handleOpenGoogleLogin}
        onNavigateIframe={navigateIframe}
        onLikeTrackInWebview={handleLikeTrackInWebview}
        onCreatePlaylistInWebview={handleCreatePlaylistInWebview}
      />
    </div>
  );
};
