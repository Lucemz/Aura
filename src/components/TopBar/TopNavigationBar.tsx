import React from 'react';
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
  LogIn,
} from 'lucide-react';
import { AudioPreset, UserProfile } from '../../types';
import { SettingsPopover } from './SettingsPopover';

interface TopNavigationBarProps {
  ytmProfile: UserProfile;
  isMiniPlayer: boolean;
  isSettingsOpen: boolean;
  audioPreset: AudioPreset;
  autoSkipAds: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onReload: () => void;
  onNavigate: (url: string) => void;
  onOpenGoogleLogin: () => void;
  onLogout: () => void;
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
  onGoBack,
  onGoForward,
  onReload,
  onNavigate,
  onOpenGoogleLogin,
  onLogout,
  onOpenImporter,
  onToggleMini,
  onToggleSettings,
  onSelectPreset,
  onToggleAutoSkipAds,
}) => {
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
          title="Atrás"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onGoForward}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          title="Adelante"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={onReload}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          title="Recargar YouTube Music"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>

        <div className="h-4 w-[1px] bg-white/10 mx-1" />

        <button
          onClick={() => onNavigate('https://music.youtube.com/')}
          className="px-2.5 py-1 rounded-lg text-xs font-medium text-neutral-300 hover:text-white hover:bg-white/10 flex items-center gap-1.5 transition cursor-pointer"
        >
          <Home className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Inicio</span>
        </button>

        <button
          onClick={() => onNavigate('https://music.youtube.com/playlist?list=LM')}
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
        {!ytmProfile.loggedIn && (
          <button
            onClick={onOpenGoogleLogin}
            className="px-3 py-1 rounded-lg bg-white text-black hover:bg-neutral-200 text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
            title="Iniciar sesión en tu cuenta de Google / YouTube Music"
          >
            <LogIn className="w-3.5 h-3.5" />
            <span>Iniciar Sesión</span>
          </button>
        )}

        <button
          onClick={onOpenImporter}
          className="px-3 py-1 rounded-lg bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Importar desde Spotify</span>
        </button>

        <button
          onClick={onToggleMini}
          className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          title={isMiniPlayer ? 'Expandir ventana' : 'Modo Mini-Player Flotante'}
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
          <span className="hidden sm:inline">Configuraciones</span>
        </button>

        {isSettingsOpen && (
          <SettingsPopover
            ytmProfile={ytmProfile}
            audioPreset={audioPreset}
            autoSkipAds={autoSkipAds}
            onOpenGoogleLogin={() => {
              onToggleSettings();
              onOpenGoogleLogin();
            }}
            onLogout={onLogout}
            onSelectPreset={onSelectPreset}
            onToggleAutoSkipAds={onToggleAutoSkipAds}
          />
        )}
      </div>
    </header>
  );
};
