import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AudioPreset, UserProfile } from './types';
import {
  evalInYouTubeMusic,
  applyEqualizerPresetInYTM,
  likeTrackInYouTubeMusic,
  createPlaylistInYouTubeMusic,
} from './services/ytmBridgeService';
import { TopNavigationBar } from './components/TopBar/TopNavigationBar';
import { PlayerThemeMode } from './components/TopBar/SettingsPopover';
import { MusicImporterModal } from './components/Importer/MusicImporterModal';
import { AISearchModal } from './components/AISearch/AISearchModal';

export const App: React.FC = () => {
  const webviewRef = useRef<any>(null);

  const [ytmProfile, setYtmProfile] = useState<UserProfile>({ loggedIn: false });
  const [isImporterOpen, setIsImporterOpen] = useState(false);
  const [isAISearchOpen, setIsAISearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMiniPlayer, setIsMiniPlayer] = useState(false);
  const [audioPreset, setAudioPreset] = useState<AudioPreset>('flat');
  const [autoSkipAds, setAutoSkipAds] = useState<boolean>(() => {
    try {
      return localStorage.getItem('__aura_auto_skip_ads') !== 'false';
    } catch {
      return true;
    }
  });
  const [themeMode, setThemeMode] = useState<PlayerThemeMode>(
    () => (localStorage.getItem('__aura_ui_theme_mode') as PlayerThemeMode) || 'dynamic'
  );

  const isSafari = Boolean(window.auraAPI?.isSafariEngine);

  // Notify native macOS WKWebView host when a modal/popover is open so overlay expands/shrinks
  useEffect(() => {
    window.auraAPI?.setOverlayExpanded?.(isImporterOpen || isSettingsOpen || isAISearchOpen);
  }, [isImporterOpen, isSettingsOpen, isAISearchOpen]);

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
        if (!window.auraAPI?.isSafariEngine && webviewRef.current) {
          try {
            webviewRef.current.loadURL('https://music.youtube.com/');
          } catch {
            try {
              webviewRef.current.reload();
            } catch {}
          }
        }
      });
    }
  }, [checkAuthStatus]);

  // Sync autoSkipAds across separate WebKit origins (aura://app -> music.youtube.com)
  useEffect(() => {
    const syncAutoSkip = () => {
      evalInYouTubeMusic(
        `window.__auraSetAutoSkipAds && window.__auraSetAutoSkipAds(${JSON.stringify(autoSkipAds)})`,
        webviewRef.current
      ).catch(() => {});
    };
    syncAutoSkip();
    const timer = setTimeout(syncAutoSkip, 2500);
    return () => clearTimeout(timer);
  }, [autoSkipAds]);

  const handleSelectPreset = (preset: AudioPreset) => {
    setAudioPreset(preset);
    applyEqualizerPresetInYTM(preset, webviewRef.current);
  };

  const handleToggleAutoSkipAds = () => {
    const next = !autoSkipAds;
    setAutoSkipAds(next);
    try {
      localStorage.setItem('__aura_auto_skip_ads', next ? 'true' : 'false');
    } catch {}
    evalInYouTubeMusic(
      `window.__auraSetAutoSkipAds && window.__auraSetAutoSkipAds(${JSON.stringify(next)})`,
      webviewRef.current
    ).catch(() => {});
  };

  const handleSelectThemeMode = (mode: PlayerThemeMode) => {
    setThemeMode(mode);
    try {
      localStorage.setItem('__aura_ui_theme_mode', mode);
    } catch {}
    evalInYouTubeMusic(
      `window.__auraSetThemeMode && window.__auraSetThemeMode(${JSON.stringify(mode)})`,
      webviewRef.current
    ).catch(() => {});
  };

  const handleLikeTrack = useCallback(async (videoId: string): Promise<boolean> => {
    return await likeTrackInYouTubeMusic(videoId, webviewRef.current);
  }, []);

  const handlePlayTrack = useCallback((videoId: string) => {
    if (window.auraAPI?.playYouTubeMusicVideo) {
      window.auraAPI.playYouTubeMusicVideo(videoId);
      return;
    }
    navigateIframe(`https://music.youtube.com/watch?v=${videoId}`);
  }, []);

  const handleCreatePlaylist = useCallback(
    async (title: string, description: string, videoIds: string[]): Promise<string | null> => {
      return await createPlaylistInYouTubeMusic(title, description, videoIds, webviewRef.current);
    },
    []
  );

  const navigateIframe = (url: string) => {
    if (window.auraAPI?.webviewLoadURL) {
      window.auraAPI.webviewLoadURL(url);
      return;
    }
    if (!webviewRef.current) return;
    try {
      webviewRef.current.loadURL(url);
    } catch {
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
      if (window.auraAPI?.webviewReload) {
        window.auraAPI.webviewReload();
      } else {
        try {
          webviewRef.current?.reload();
        } catch {}
      }
    }
  };

  const handleLogout = async () => {
    if (window.auraAPI?.logout) {
      await window.auraAPI.logout();
      setYtmProfile({ loggedIn: false });
      if (window.auraAPI?.webviewReload) {
        window.auraAPI.webviewReload();
      } else {
        try {
          webviewRef.current?.reload();
        } catch {}
      }
    }
  };

  return (
    <div
      className={`w-screen h-screen flex flex-col text-white overflow-hidden select-none ${
        isSafari ? 'bg-transparent' : 'bg-[#030303]'
      }`}
    >
      <TopNavigationBar
        ytmProfile={ytmProfile}
        isMiniPlayer={isMiniPlayer}
        isSettingsOpen={isSettingsOpen}
        audioPreset={audioPreset}
        autoSkipAds={autoSkipAds}
        themeMode={themeMode}
        onSelectThemeMode={handleSelectThemeMode}
        onGoBack={() =>
          window.auraAPI?.webviewGoBack
            ? window.auraAPI.webviewGoBack()
            : webviewRef.current?.goBack()
        }
        onGoForward={() =>
          window.auraAPI?.webviewGoForward
            ? window.auraAPI.webviewGoForward()
            : webviewRef.current?.goForward()
        }
        onReload={() =>
          window.auraAPI?.webviewReload
            ? window.auraAPI.webviewReload()
            : webviewRef.current?.reload()
        }
        onNavigate={navigateIframe}
        onOpenGoogleLogin={handleOpenGoogleLogin}
        onLogout={handleLogout}
        onOpenAISearch={() => {
          setIsSettingsOpen(false);
          setIsAISearchOpen(true);
        }}
        onOpenImporter={() => {
          setIsSettingsOpen(false);
          setIsImporterOpen(true);
        }}
        onToggleMini={handleToggleMini}
        onToggleSettings={() => setIsSettingsOpen(!isSettingsOpen)}
        onSelectPreset={handleSelectPreset}
        onToggleAutoSkipAds={handleToggleAutoSkipAds}
      />

      {isSafari ? (
        <main
          onClick={() => {
            if (isSettingsOpen) setIsSettingsOpen(false);
          }}
          className="flex-1 w-full h-full relative bg-transparent"
        />
      ) : (
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
      )}

      <AISearchModal
        isOpen={isAISearchOpen}
        onClose={() => setIsAISearchOpen(false)}
        onPlayTrack={handlePlayTrack}
        onLikeTrack={handleLikeTrack}
      />

      <MusicImporterModal
        isOpen={isImporterOpen}
        onClose={() => setIsImporterOpen(false)}
        ytmLoggedIn={ytmProfile.loggedIn}
        onOpenGoogleLogin={handleOpenGoogleLogin}
        onNavigateIframe={navigateIframe}
        onLikeTrackInWebview={handleLikeTrack}
        onCreatePlaylistInWebview={handleCreatePlaylist}
      />
    </div>
  );
};
