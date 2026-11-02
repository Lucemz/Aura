import React from 'react';
import { ShieldCheck, Sliders, LogIn, LogOut, Check } from 'lucide-react';
import { AudioPreset, UserProfile } from '../../types';

interface SettingsPopoverProps {
  ytmProfile: UserProfile;
  audioPreset: AudioPreset;
  autoSkipAds: boolean;
  onOpenGoogleLogin: () => void;
  onLogout: () => void;
  onSelectPreset: (preset: AudioPreset) => void;
  onToggleAutoSkipAds: () => void;
}

const PRESET_OPTIONS: { id: AudioPreset; label: string }[] = [
  { id: 'flat', label: 'Original (Plano)' },
  { id: 'bass', label: 'Bass Boost' },
  { id: 'vocal', label: 'Claridad Vocal' },
  { id: 'warm', label: 'Estudio Cálido' },
];

export const SettingsPopover: React.FC<SettingsPopoverProps> = ({
  ytmProfile,
  audioPreset,
  autoSkipAds,
  onOpenGoogleLogin,
  onLogout,
  onSelectPreset,
  onToggleAutoSkipAds,
}) => {
  return (
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
                <img src={ytmProfile.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center text-xs font-bold">
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
      </div>

      {/* Audio Equalizer Preset */}
      <div className="pb-3 border-b border-white/10">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
          <Sliders className="w-3.5 h-3.5 text-red-500" />
          <span>Ecualizador en Tiempo Real</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESET_OPTIONS.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelectPreset(item.id)}
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
            onClick={onToggleAutoSkipAds}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${
              autoSkipAds ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-neutral-400'
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
  );
};
