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
  Globe,
  Cpu,
} from 'lucide-react';
import { AudioPreset, UserProfile, AIModelId, AIStatusInfo } from '../../types';
import { AISearchIcon } from '../AISearch/AISearchIcon';
import { useI18n, LocalePreference } from '../../i18n';

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

const AI_MODEL_OPTIONS: { id: AIModelId; label: string; hint: string }[] = [
  { id: 'free-default', label: 'GPT-OSS 20B (Free Keyless)', hint: '100 req/day' },
  { id: 'gemini-2.5-flash', label: 'Google Gemini 2.5 Flash', hint: '500 req/day' },
  { id: 'gemini-2.5-pro', label: 'Google Gemini 2.5 Pro', hint: '100 req/day' },
  { id: 'gpt-4o-mini', label: 'OpenAI GPT-4o mini', hint: '500 req/day' },
  { id: 'llama-3.3-70b', label: 'Groq Llama 3.3 70B', hint: '1,000 req/day' },
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
  const { t, preference, setPreference } = useI18n();
  const [selectedModel, setSelectedModel] = useState<AIModelId>('free-default');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [aiStatus, setAiStatus] = useState<AIStatusInfo | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  const presetOptions: { id: AudioPreset; label: string }[] = [
    { id: 'flat', label: t.settings.presetFlat },
    { id: 'bass', label: t.settings.presetBass },
    { id: 'vocal', label: t.settings.presetVocal },
    { id: 'warm', label: t.settings.presetWarm },
  ];

  const themeOptions: { id: PlayerThemeMode; label: string; dot: string }[] = [
    {
      id: 'dynamic',
      label: t.settings.themeDynamic,
      dot: 'bg-gradient-to-tr from-cyan-400 via-violet-500 to-rose-500',
    },
    { id: 'violet', label: t.settings.themeViolet, dot: 'bg-[#8b5cf6]' },
    { id: 'emerald', label: t.settings.themeEmerald, dot: 'bg-[#10b981]' },
    { id: 'cyan', label: t.settings.themeCyan, dot: 'bg-[#06b6d4]' },
    { id: 'rose', label: t.settings.themeRose, dot: 'bg-[#f43f5e]' },
    { id: 'youtube', label: t.settings.themeYoutube, dot: 'bg-[#ff0000]' },
  ];

  const langOptions: { id: LocalePreference; label: string }[] = [
    { id: 'system', label: t.settings.langSystem },
    { id: 'en', label: 'EN' },
    { id: 'es', label: 'ES' },
  ];

  useEffect(() => {
    if (window.auraAPI?.getAiStatus) {
      window.auraAPI.getAiStatus().then((st) => {
        if (st) {
          setAiStatus(st);
          setSelectedModel(st.selectedModel || 'free-default');
          setApiKeyInput(st.apiKey || '');
        }
      });
    } else if (window.auraAPI?.getAiApiKey) {
      window.auraAPI.getAiApiKey().then((key) => {
        if (key) setApiKeyInput(key);
      });
    }
  }, []);

  const persistAiSettings = async (nextModel: AIModelId, nextKey: string) => {
    const trimmed = nextKey.trim();
    if (window.auraAPI?.saveAiConfig) {
      const updated = await window.auraAPI.saveAiConfig(nextModel, trimmed);
      if (updated) {
        setAiStatus(updated);
        setSelectedModel(updated.selectedModel);
      }
    } else if (window.auraAPI?.setAiApiKey) {
      await window.auraAPI.setAiApiKey(trimmed);
    }
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1600);
  };

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextModel = e.target.value as AIModelId;
    setSelectedModel(nextModel);
    await persistAiSettings(nextModel, apiKeyInput);
  };

  const handleSaveApiKey = async () => {
    const trimmed = apiKeyInput.trim();
    let targetModel = selectedModel;
    if (!trimmed) {
      targetModel = 'free-default';
    } else if (trimmed.startsWith('AIza') && !targetModel.startsWith('gemini-')) {
      targetModel = 'gemini-2.5-flash';
    } else if (trimmed.startsWith('gsk_')) {
      targetModel = 'llama-3.3-70b';
    } else if (trimmed.startsWith('sk-')) {
      targetModel = 'gpt-4o-mini';
    }
    setSelectedModel(targetModel);
    await persistAiSettings(targetModel, trimmed);
  };

  const dailyLimit = aiStatus?.dailyQuotaLimit || 100;
  const remainingQuota = aiStatus?.remainingQuota ?? dailyLimit;
  const quotaPercent = Math.min(100, Math.max(0, Math.round((remainingQuota / dailyLimit) * 100)));

  return (
    <div className="absolute right-0 top-9 w-[340px] bg-[#181818]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-4 z-50 space-y-3.5 max-h-[86vh] overflow-y-auto">
      {/* Account & Library Section */}
      <div className="pb-3 border-b border-white/10 space-y-2.5">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
          {t.settings.accountAndLibrary}
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
                <p className="text-xs font-bold text-white truncate">
                  {t.settings.connectedAccount}
                </p>
                <p className="text-[11px] text-emerald-400 truncate">
                  {ytmProfile.email || t.settings.activeSession}
                </p>
              </div>
            </div>
            <button
              onClick={onLogout}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-neutral-400 hover:text-red-400 transition cursor-pointer"
              title={t.settings.signOut}
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
            <span>{t.settings.signInGoogle}</span>
          </button>
        )}

        <button
          onClick={onOpenImporter}
          className="w-full py-2 px-3 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>{t.settings.importMusic}</span>
        </button>
      </div>

      {/* Player Theme / Accent Color */}
      <div className="pb-3 border-b border-white/10">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
          <Palette className="w-3.5 h-3.5 text-violet-400" />
          <span>{t.settings.playerColor}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {themeOptions.map((item) => (
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

      {/* Multi-Model AI Engine & Quota Telemetry (Max 7-day rolling storage) */}
      <div className="pb-3 border-b border-white/10 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            <AISearchIcon className="w-3.5 h-3.5 text-violet-400" />
            <span>{t.settings.aiEngine}</span>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
              aiStatus?.usingApiKey
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
            }`}
          >
            {aiStatus?.usingApiKey ? t.settings.aiKeyActive : t.settings.aiDefaultNoKey}
          </span>
        </div>

        {/* Model Selector */}
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
          <Cpu className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
          <select
            value={selectedModel}
            onChange={handleModelChange}
            className="flex-1 bg-transparent text-[11px] font-medium text-white outline-none cursor-pointer"
          >
            {AI_MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id} className="bg-[#181818] text-white">
                {m.label} ({m.hint})
              </option>
            ))}
          </select>
        </div>

        {/* API Key Input */}
        <div className="flex gap-1.5">
          <div className="relative flex-1">
            <KeyRound className="w-3.5 h-3.5 text-neutral-500 absolute left-2.5 top-2" />
            <input
              type="password"
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              placeholder={t.settings.aiKeyPlaceholder}
              className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-2 py-1.5 text-[11px] text-white placeholder-neutral-500 outline-none focus:border-white/30"
            />
          </div>
          <button
            onClick={handleSaveApiKey}
            className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white text-[11px] font-semibold cursor-pointer"
          >
            {savedNotice ? t.settings.saved : t.settings.save}
          </button>
        </div>

        {/* Live Quota & Token Telemetry Box */}
        <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-neutral-400">{t.settings.aiQuotaLabel}</span>
            <span className="font-mono font-semibold text-white">
              {remainingQuota} / {dailyLimit} req ({quotaPercent}%)
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-all"
              style={{ width: `${quotaPercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-neutral-400 pt-0.5">
            <span>
              {t.settings.aiTokensTodayLabel}:{' '}
              <strong className="text-neutral-200 font-mono">
                {(aiStatus?.tokensToday || 0).toLocaleString()} tk
              </strong>
            </span>
            <span>
              {t.settings.aiTokens7dLabel}:{' '}
              <strong className="text-neutral-200 font-mono">
                {(aiStatus?.tokensLast7Days || 0).toLocaleString()} tk
              </strong>
            </span>
          </div>
        </div>
      </div>

      {/* Audio Equalizer Preset */}
      <div className="pb-3 border-b border-white/10">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-2">
          <Sliders className="w-3.5 h-3.5 text-violet-400" />
          <span>{t.settings.equalizer}</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {presetOptions.map((item) => (
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

      {/* AdBlocker, Language & Shortcuts Info */}
      <div className="space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-neutral-300">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{t.settings.adBlocker}</span>
          </div>
          <button
            onClick={onToggleAutoSkipAds}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold cursor-pointer ${
              autoSkipAds ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/10 text-neutral-400'
            }`}
          >
            {autoSkipAds ? t.settings.active : t.settings.paused}
          </button>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-neutral-300">
            <Globe className="w-4 h-4 text-violet-400" />
            <span>{t.settings.language}</span>
          </div>
          <div className="flex items-center gap-1">
            {langOptions.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setPreference(opt.id)}
                className={`px-2 py-0.5 rounded text-[10px] font-semibold cursor-pointer transition ${
                  preference === opt.id
                    ? 'bg-white/20 text-white'
                    : 'bg-white/5 text-neutral-400 hover:text-white'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-2 rounded-xl bg-white/5 border border-white/5 text-[11px] text-neutral-400 flex items-center justify-between">
          <span>{t.settings.macShortcuts}</span>
          <span className="font-mono text-white">F7 ⏮ · F8 ⏯ · F9 ⏭</span>
        </div>
      </div>
    </div>
  );
};
