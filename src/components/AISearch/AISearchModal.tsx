import React, { useState, useEffect } from 'react';
import { X, Play, Loader2, Heart, Check, AlertCircle } from 'lucide-react';
import { AISongRecommendation } from '../../types';
import { AISearchIcon } from './AISearchIcon';
import { useI18n } from '../../i18n';

interface AISearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlayTrack: (videoId: string) => void;
  onLikeTrack: (videoId: string) => Promise<boolean>;
}

export const AISearchModal: React.FC<AISearchModalProps> = ({
  isOpen,
  onClose,
  onPlayTrack,
  onLikeTrack,
}) => {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [songs, setSongs] = useState<AISongRecommendation[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isLoading) {
      setLoadingStepIdx(0);
      return;
    }
    const stepsCount = t.aiSearch.loadingSteps?.length || 5;
    const interval = setInterval(() => {
      setLoadingStepIdx((prev) => (prev < stepsCount - 1 ? prev + 1 : prev));
    }, 1650);
    return () => clearInterval(interval);
  }, [isLoading, t.aiSearch.loadingSteps]);

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;

    setIsLoading(true);
    setLoadingStepIdx(0);
    setError(null);

    try {
      if (window.auraAPI?.aiRecommendSongs) {
        const res = await window.auraAPI.aiRecommendSongs(trimmed);
        if (res.ok && res.songs && res.songs.length > 0) {
          setSongs(res.songs);
        } else {
          setError(res.error || t.aiSearch.errorEmpty);
        }
      } else {
        setError(t.aiSearch.errorUnavailable);
      }
    } catch {
      setError(t.aiSearch.errorUnavailable);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlay = (song: AISongRecommendation) => {
    setActiveVideoId(song.videoId);
    onPlayTrack(song.videoId);
    onClose();
  };

  const handleLike = async (e: React.MouseEvent, videoId: string) => {
    e.stopPropagation();
    if (likedIds.has(videoId)) return;
    const ok = await onLikeTrack(videoId);
    if (ok) {
      setLikedIds((prev) => new Set(prev).add(videoId));
    }
  };

  const loadingSteps = t.aiSearch.loadingSteps || [t.aiSearch.loading];
  const currentStepText = loadingSteps[loadingStepIdx] || t.aiSearch.loading;
  const progressPercent = Math.min(94, Math.round(((loadingStepIdx + 1) / loadingSteps.length) * 92));

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/20 flex items-start justify-center pt-14 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[620px] bg-[#212121]/95 border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[78vh]"
      >
        {/* Native YouTube Music Search Bar Header */}
        <form
          onSubmit={handleSearch}
          className="px-4 py-3 border-b border-white/10 flex items-center gap-3 bg-[#212121]"
        >
          <button
            type="submit"
            disabled={isLoading || !prompt.trim()}
            className="text-[#aaa] hover:text-white disabled:opacity-50 transition cursor-pointer flex-shrink-0"
            title={t.aiSearch.searchTooltip}
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            ) : (
              <AISearchIcon className="w-5 h-5" />
            )}
          </button>

          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t.aiSearch.placeholder}
            autoFocus
            className="flex-1 bg-transparent text-[14px] font-normal text-white placeholder-[#888] outline-none"
          />

          {prompt && (
            <button
              type="button"
              onClick={() => setPrompt('')}
              className="p-1 text-[#888] hover:text-white cursor-pointer"
              title={t.aiSearch.clearTooltip}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </form>

        {/* Native YouTube Music Track List */}
        {(isLoading || error || songs.length > 0) && (
          <div className="flex-1 overflow-y-auto divide-y divide-white/[0.06] bg-[#181818]/95">
            {error && (
              <div className="p-4 text-[#ff8983] text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {isLoading && (
              <div className="py-9 px-6 flex flex-col items-center justify-center gap-3">
                <div className="flex items-center gap-2.5 text-white text-[13px] font-medium transition-all duration-300">
                  <Loader2 className="w-4 h-4 animate-spin text-violet-400 flex-shrink-0" />
                  <span key={loadingStepIdx} className="animate-pulse">
                    {currentStepText}
                  </span>
                </div>
                <div className="w-56 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-700 ease-out"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  {loadingSteps.map((_, idx) => (
                    <span
                      key={idx}
                      className={`h-1 rounded-full transition-all duration-300 ${
                        idx === loadingStepIdx
                          ? 'w-4 bg-violet-400'
                          : idx < loadingStepIdx
                          ? 'w-1.5 bg-white/40'
                          : 'w-1.5 bg-white/10'
                      }`}
                    />
                  ))}
                </div>
              </div>
            )}

            {!isLoading &&
              songs.map((song) => {
                const isPlaying = activeVideoId === song.videoId;
                const isLiked = likedIds.has(song.videoId);
                return (
                  <div
                    key={song.videoId}
                    onClick={() => handlePlay(song)}
                    className={`group px-4 py-2.5 flex items-center justify-between gap-3 cursor-pointer transition ${
                      isPlaying ? 'bg-white/[0.12]' : 'hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center gap-3.5 min-w-0 flex-1">
                      <div className="relative w-12 h-12 rounded overflow-hidden bg-[#2a2a2a] flex-shrink-0">
                        <img
                          src={song.thumbnail}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        <div
                          className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${
                            isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                        >
                          <Play className="w-4 h-4 text-white fill-white" />
                        </div>
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-white truncate leading-snug">
                          {song.title}
                        </p>
                        <p className="text-[12px] text-[#aaa] truncate mt-0.5">
                          {song.artist}
                          {song.reason ? ` · ${song.reason}` : ''}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={(e) => handleLike(e, song.videoId)}
                      title={t.aiSearch.likeTooltip}
                      className={`p-2 rounded-full cursor-pointer flex-shrink-0 transition ${
                        isLiked
                          ? 'text-white bg-white/15'
                          : 'text-[#888] hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {isLiked ? <Check className="w-4 h-4" /> : <Heart className="w-4 h-4" />}
                    </button>
                  </div>
                );
              })}
          </div>
        )}
      </div>
    </div>
  );
};
