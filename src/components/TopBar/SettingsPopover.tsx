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
  Activity,
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

function formatTokenCount(n?: number): string {
  if (!n || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
  return n.toLocaleString();
}

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
  const [selectedModel, setSelectedModel] = useState<AIModelId>('openai-fast');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [aiStatus, setAiStatus] = useState<AIStatusInfo | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
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
      setLoadingModels(true);
      window.auraAPI
        .getAiStatus()
        .then((st) => {
          if (st) {
            setAiStatus(st);
            setSelectedModel(st.selectedModel || 'openai-fast');
            setApiKeyInput(st.apiKey || '');
          }
        })
        .finally(() => setLoadingModels(false));
    } else if (window.auraAPI?.getAiApiKey) {
      window.auraAPI.getAiApiKey().then((key) => {
        if (key) setApiKeyInput(key);
      });
    }
  }, []);

  const persistAiSettings = async (nextModel: AIModelId, nextKey: string) => {
    const trimmed = nextKey.trim();
    setLoadingModels(true);
    try {
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
    } finally {
      setLoadingModels(false);
    }
  };

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextModel = e.target.value;
    setSelectedModel(nextModel);
    await persistAiSettings(nextModel, apiKeyInput);
  };

  const handleSaveApiKey = async () => {
    const trimmed = apiKeyInput.trim();
    await persistAiSettings(selectedModel, trimmed);
  };

  const availableModels = aiStatus?.availableModels?.length
    ? aiStatus.availableModels
    : [
        {
          id: selectedModel || 'openai-fast',
          displayName: aiStatus?.activeModelName || 'GPT-OSS 20B (Free Keyless)',
          provider: aiStatus?.provider || 'pollinations',
          inputTokenLimit: aiStatus?.inputTokenLimit || 32768,
          outputTokenLimit: aiStatus?.outputTokenLimit || 4096,
          supportsThinking: true,
        },
      ];

  const lastTel = aiStatus?.lastTelemetry;
  const hasHeaderRateLimit =
    typeof lastTel?.rateLimitRemainingRequests === 'number' &&
    typeof lastTel?.rateLimitLimitRequests === 'number' &&
    lastTel.rateLimitLimitRequests > 0;

  const headerReqPercent = hasHeaderRateLimit
    ? Math.min(
        100,
        Math.max(
          0,
          Math.round(
            ((lastTel!.rateLimitRemainingRequests || 0) / (lastTel!.rateLimitLimitRequests || 1)) *
              100
          )
        )
      )
    : null;

  return (
    <div className="absolute right-0 top-9 w-[355px] bg-[#181818]/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-4 z-50 space-y-3.5 max-h-[86vh] overflow-y-auto">
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

      {/* Dynamic Multi-Model AI Engine & Real API Telemetry */}
      <div className="pb-3 border-b border-white/10 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
            <AISearchIcon className="w-3.5 h-3.5 text-violet-400" />
            <span>{t.settings.aiEngine}</span>
          </div>
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${
              aiStatus?.usingApiKey
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
            }`}
          >
            {aiStatus?.provider || 'pollinations'} ·{' '}
            {aiStatus?.usingApiKey ? t.settings.aiKeyActive : t.settings.aiDefaultNoKey}
          </span>
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
            disabled={loadingModels}
            className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white text-[11px] font-semibold cursor-pointer disabled:opacity-50"
          >
            {loadingModels ? '...' : savedNotice ? t.settings.saved : t.settings.save}
          </button>
        </div>

        {/* Dynamic Model Selector fetched from the key's `/models` endpoint */}
        <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5">
          <Cpu className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
          <select
            value={selectedModel}
            onChange={handleModelChange}
            disabled={loadingModels}
            className="flex-1 bg-transparent text-[11px] font-medium text-white outline-none cursor-pointer truncate"
          >
            {availableModels.map((m) => (
              <option key={m.id} value={m.id} className="bg-[#181818] text-white">
                {m.displayName} ({formatTokenCount(m.inputTokenLimit)} ctx)
              </option>
            ))}
          </select>
        </div>

        {/* Real Provider Telemetry Box (from API `usageMetadata` / `usage`, `/models` & `x-ratelimit-*` headers) */}
        <div className="p-2.5 rounded-xl bg-black/40 border border-white/10 space-y-2 text-[10px]">
          {/* Model Context & Output Hardware Limits from `/models` */}
          <div className="flex items-center justify-between text-neutral-400">
            <span className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-violet-400" />
              {t.settings.aiContextLabel}:
            </span>
            <span className="font-mono text-neutral-200">
              In: {formatTokenCount(aiStatus?.inputTokenLimit)} tk · Out:{' '}
              {formatTokenCount(aiStatus?.outputTokenLimit)} tk
              {lastTel?.serviceTier ? ` · Tier: ${lastTel.serviceTier}` : ''}
            </span>
          </div>

          {/* Live Server Rate-Limit Headers (OpenAI / Groq / Anthropic) */}
          {hasHeaderRateLimit && (
            <div className="space-y-1 pt-1 border-t border-white/5">
              <div className="flex items-center justify-between">
                <span className="text-neutral-400">{t.settings.aiRateLimitLabel}:</span>
                <span className="font-mono text-emerald-400 font-semibold">
                  {lastTel?.rateLimitRemainingRequests?.toLocaleString()} /{' '}
                  {lastTel?.rateLimitLimitRequests?.toLocaleString()} req ({headerReqPercent}%)
                </span>
              </div>
              <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-emerald-400 transition-all"
                  style={{ width: `${headerReqPercent || 0}%` }}
                />
              </div>
              {typeof lastTel?.rateLimitRemainingTokens === 'number' && (
                <div className="flex items-center justify-between text-neutral-400">
                  <span>TPM Bucket:</span>
                  <span className="font-mono text-neutral-200">
                    {lastTel.rateLimitRemainingTokens.toLocaleString()} /{' '}
                    {(lastTel.rateLimitLimitTokens || 0).toLocaleString()} tk
                    {lastTel.rateLimitReset ? ` (reset ${lastTel.rateLimitReset})` : ''}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* OpenRouter Live Key Credits (`/api/v1/key`) */}
          {aiStatus?.openRouterKeyInfo && typeof aiStatus.openRouterKeyInfo.usage === 'number' && (
            <div className="flex items-center justify-between pt-1 border-t border-white/5 text-neutral-400">
              <span>OpenRouter Usage:</span>
              <span className="font-mono text-emerald-400">
                ${aiStatus.openRouterKeyInfo.usage.toFixed(4)} USD
                {aiStatus.openRouterKeyInfo.limit
                  ? ` / $${aiStatus.openRouterKeyInfo.limit} USD`
                  : ''}
              </span>
            </div>
          )}

          {/* Last API Response Real Token & Latency Breakdown */}
          {lastTel && (lastTel.totalTokens || 0) > 0 && (
            <div className="pt-1 border-t border-white/5 space-y-0.5">
              <div className="flex items-center justify-between text-neutral-400">
                <span>{t.settings.aiLastCallLabel}:</span>
                <span className="font-mono text-white">
                  {(lastTel.totalTokens || 0).toLocaleString()} tk · {lastTel.latencyMs || 0} ms
                </span>
              </div>
              <div className="flex items-center justify-between text-[9.5px] text-neutral-400 font-mono">
                <span>Prompt: {(lastTel.promptTokens || 0).toLocaleString()}</span>
                <span>Out: {(lastTel.completionTokens || 0).toLocaleString()}</span>
                {(lastTel.reasoningTokens || 0) > 0 && (
                  <span className="text-violet-300">
                    Think: {(lastTel.reasoningTokens || 0).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Real Accumulated Usage Today & 7-Day Rolling Window */}
          <div className="pt-1 border-t border-white/5 flex items-center justify-between text-neutral-400">
            <span>
              {t.settings.aiTokensTodayLabel}:{' '}
              <strong className="text-neutral-200 font-mono">
                {aiStatus?.requestsToday || 0} req ·{' '}
                {(aiStatus?.tokensToday || 0).toLocaleString()} tk
              </strong>
            </span>
            <span>
              {t.settings.aiTokens7dLabel}:{' '}
              <strong className="text-neutral-200 font-mono">
                {aiStatus?.requestsLast7Days || 0} req ·{' '}
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
