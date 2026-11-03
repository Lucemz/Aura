import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Sliders,
  LogIn,
  LogOut,
  Check,
  KeyRound,
  RefreshCw,
  Palette,
} from 'lucide-react';
import { AudioPreset, UserProfile } from '../../types';
import { AISearchIcon } from '../AISearch/AISearchIcon';

export type PlayerThemeMode = 'dynamic' | 'violet' | 'emerald' | 'cyan' | 'rose' | 'youtube';

interface SettingsPopoverProps {
  ytmProfile: UserProfile;
  audioPreset: AudioPreset;
  autoSkipAds: boolean;
  themeMode: PlayerThemeMode;
  onSelectThemeMode: (mode: PlayerThemeMode) => void;
  onOpenGoogleLogin: () => void;
  onLogout: () => void;
  onOpenImporter: () => void;
  onSelectPreset: (preset: AudioPreset) => void;
  onToggleAutoSkipAds: () => void;
}

const PRESET_OPTIONS: { id: AudioPreset; label: string }[] = [
  { id: 'flat', label: 'Original (Plano)' },
  { id: 'bass', label: 'Bass Boost' },
  { id: 'vocal', label: 'Claridad Vocal' },
  { id: 'warm', label: 'Estudio Cálido' },
];

const THEME_OPTIONS: { id: PlayerThemeMode; label: string; dot: string }[] = [
  { id: 'dynamic', label: 'Dinámico (Canción)', dot: 'bg-gradient-to-tr from-cyan-400 via-violet-500 to-rose-500' },
  { id: 'violet', label: 'Aura Violeta', dot: 'bg-[#8b5cf6]' },
  { id: 'emerald', label: 'Esmeralda', dot: 'bg-[#10b981]' },
  { id: 'cyan', label: 'Cian', dot: 'bg-[#06b6d4]' },
  { id: 'rose', label: 'Coral', dot: 'bg-[#f43f5e]' },
  { id: 'youtube', label: 'Rojo YT', dot: 'bg-[#ff0000]' },
];

export const SettingsPopover: React.FC<SettingsPopoverProps> = ({
  ytmProfile,
  audioPreset,
  autoSkipAds,
  themeMode,
  onSelectThemeMode,
  onOpenGoogleLogin,
  onLogout,
  onOpenImporter,
  onSelectPreset,
  onToggleAutoSkipAds,
}) => {
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (window.auraAPI?.getAiApiKey) {
      window.auraAPI.getAiApiKey().then((key) => {
        if (key) {
          setApiKeyInput(key);
          setHasSavedKey(true);
        }
      });
    }
  }, []);

  const handleSaveApiKey = async () => {
    if (!window.auraAPI?.setAiApiKey) return;
    const trimmed = apiKeyInput.trim();
    await window.auraAPI.setAiApiKey(trimmed);
    setHasSavedKey(Boolean(trimmed));
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  return (
    <div className="absolute right-0 top-9 w-80 bg-[#181818]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-4 z-50 space-y-3.5">
      {/* Account & Spotify Importer Section */}
      <div className="pb-3 border-b border-white/10 space-y-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          Cuenta y Biblioteca
        </p>
        {ytmProfile.loggedIn ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              {ytmProfile.avatar ? (
                <img src={ytmProfile.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-xs font-bold">
                  {ytmProfile.name?.[0] || 'U'}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">{ytmProfile.name}</p>
                <p className="text-[11px] text-emerald-400 truncate">
                  {ytmProfile.email || 'Sesión activa'}
                </p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-neutral-400 hover:text-red-400 transition cursor-pointer"
              title="Cerrar sesión"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenGoogleLogin}
            className="w-full py-2 px-3 rounded-xl bg-white text-black hover:bg-neutral-200 font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer transition"
          >
            <LogIn className="w-4 h-4" />
            <span>Iniciar sesión en Google / YT Music</span>
          </button>
        )}

        <button
          onClick={onOpenImporter}
          className="w-full py-2 px-3 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Importar canciones desde Spotify</span>
        </button>
      </div>

      {/* Player Theme / Accent Color */}
      <div className="pb-3 border-b border-white/10">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
          <Palette className="w-3.5 h-3.5 text-violet-400" />
          <span>Color del Reproductor</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {THEME_OPTIONS.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectThemeMode(item.id)}
              className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center justify-between border cursor-pointer transition ${
                themeMode === item.id
                  ? 'bg-white/15 border-white/30 text-white'
                  : 'bg-white/5 border-white/5 text-neutral-400 hover:text-white'
              }`}
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${item.dot}`} />
                <span className="truncate">{item.label}</span>
              </div>
              {themeMode === item.id && <Check className="w-3 h-3 text-white flex-shrink-0" />}
            </button>
          ))}
        </div>
      </div>

      {/* Gemini AI Configuration */}
      <div className="pb-3 border-b border-white/10 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            <AISearchIcon className="w-3.5 h-3.5 text-violet-400" />
            <span>Motor IA (Gemini)</span>
          </div>
          <span className="text-[10px] text-neutral-400 font-medium">
            {hasSavedKey ? 'API Key activa' : 'Por defecto (Sin Key)'}
          </span>
        </div>
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <KeyRound className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2" />
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder="Gemini API Key (Opcional)..."
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-white placeholder-neutral-500 outline-none focus:border-white/30"
            />
          </div>
          <button
            onClick={handleSaveApiKey}
            className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white text-[11px] font-semibold cursor-pointer"
          >
            {savedNotice ? 'Listo' : 'Guardar'}
          </button>
        </div>
      </div>

      {/* Audio Equalizer Preset */}
      <div className="pb-3 border-b border-white/10">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
          <Sliders className="w-3.5 h-3.5 text-violet-400" />
          <span>Ecualizador en Tiempo Real</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESET_OPTIONS.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectPreset(item.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-between border cursor-pointer transition ${
                audioPreset === item.id
                  ? 'bg-white/15 border-white/30 text-white'
                  : 'bg-white/5 border-white/5 text-neutral-400 hover:text-white'
              }`}
            >
              <span>{item.label}</span>
              {audioPreset === item.id && <Check className="w-3 h-3 text-white" />}
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
            onClick={onToggleAutoSkipAds}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${
              autoSkipAds ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-neutral-400'
            }`}
          >
            {autoSkipAds ? 'Activo' : 'Pausado'}
          </button>
        </div>

        <div className="p-2 rounded-xl bg-white/5 border border-white/5 text-[11px] text-neutral-400 flex items-center justify-between">
          <span>Atajos físicos de Mac</span>
          <span className="font-mono text-white">F7 ⏮ · F8 ⏯ · F9 ⏭</span>
        </div>
      </div>
    </div>
  );
};
