import React from 'react';
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Heart,
  Settings,
  Minimize2,
  Maximize2,
  LogIn,
} from 'lucide-react';
import { AudioPreset, UserProfile } from '../../types';
import { SettingsPopover, PlayerThemeMode } from './SettingsPopover';
import { AISearchIcon } from '../AISearch/AISearchIcon';
import { useI18n } from '../../i18n';

interface TopNavigationBarProps {
  ytmProfile: UserProfile;
  isMiniPlayer: boolean;
  isSettingsOpen: boolean;
  audioPreset: AudioPreset;
  autoSkipAds: boolean;
  themeMode: PlayerThemeMode;
  onSelectThemeMode: (mode: PlayerThemeMode) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onNavigate: (url: string) => void;
  onOpenGoogleLogin: () => void;
  onLogout: () => void;
  onOpenAISearch: () => void;
  onOpenImporter: () => void;
  onToggleMini: () => void;
  onToggleSettings: () => void;
  onSelectPreset: (preset: AudioPreset) => void;
  onToggleAutoSkipAds: () => void;
}

export const TopNavigationBar: React.FC<TopNavigationBarProps> = ({
  ytmProfile,
  isMiniPlayer,
  isSettingsOpen,
  audioPreset,
  autoSkipAds,
  themeMode,
  onSelectThemeMode,
  onGoBack,
  onGoForward,
  onReload,
  onNavigate,
  onOpenGoogleLogin,
  onLogout,
  onOpenAISearch,
  onOpenImporter,
  onToggleMini,
  onToggleSettings,
  onSelectPreset,
  onToggleAutoSkipAds,
}) => {
  const { t } = useI18n();

  return (
    <header
      className="h-10 bg-[#0a0a0a] border-b border-white/10 flex items-center justify-between pl-20 pr-3 flex-shrink-0 relative z-50"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left Navigation Controls for YouTube Music */}
      <div
        className="flex items-center gap-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={onGoBack}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          title={t.topBar.back}
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onGoForward}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          title={t.topBar.forward}
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={onReload}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          title={t.topBar.reload}
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-[1px] bg-white/10 mx-1" />

        <button
          onClick={() => onNavigate('https://music.youtube.com/')}
          className="px-2.5 py-1 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-white/10 flex items-center gap-1.5 transition cursor-pointer"
        >
          <Home className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{t.topBar.home}</span>
        </button>

        <button
          onClick={() => onNavigate('https://music.youtube.com/playlist?list=LM')}
          className="px-2.5 py-1 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-white/10 flex items-center gap-1.5 transition cursor-pointer"
          title={t.topBar.likedSongsTooltip}
        >
          <Heart className="w-3.5 h-3.5 text-red-500 fill-red-500" />
          <span className="hidden md:inline">{t.topBar.likedSongs}</span>
        </button>
      </div>

      {/* Right Value-Added Controls: AI Search, MiniPlayer & Settings */}
      <div
        className="flex items-center gap-2 relative"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {!ytmProfile.loggedIn && (
          <button
            onClick={onOpenGoogleLogin}
            className="px-3 py-1 rounded-lg bg-white text-black hover:bg-neutral-200 text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
            title={t.topBar.signInTooltip}
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>{t.topBar.signIn}</span>
          </button>
        )}

        <button
          onClick={onOpenAISearch}
          className="px-3 py-1 rounded-lg bg-white/[0.08] hover:bg-white/[0.14] border border-white/15 text-white text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          title={t.topBar.aiSearchTooltip}
        >
          <AISearchIcon className="w-4 h-4 text-violet-400" />
          <span>Aura AI</span>
        </button>

        <button
          onClick={onToggleMini}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          title={isMiniPlayer ? t.topBar.miniPlayerExpand : t.topBar.miniPlayerCollapse}
        >
          {isMiniPlayer ? (
            <Maximize2 className="w-3.5 h-3.5" />
          ) : (
            <Minimize2 className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          onClick={onToggleSettings}
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
          <span className="hidden sm:inline">{t.topBar.settings}</span>
        </button>

        {isSettingsOpen && (
          <SettingsPopover
            ytmProfile={ytmProfile}
            audioPreset={audioPreset}
            autoSkipAds={autoSkipAds}
            themeMode={themeMode}
            onSelectThemeMode={onSelectThemeMode}
            onOpenGoogleLogin={() => {
              onToggleSettings();
              onOpenGoogleLogin();
            }}
            onLogout={onLogout}
            onOpenImporter={() => {
              onToggleSettings();
              onOpenImporter();
            }}
            onSelectPreset={onSelectPreset}
            onToggleAutoSkipAds={onToggleAutoSkipAds}
          />
        )}
      </div>
    </header>
  );
};
