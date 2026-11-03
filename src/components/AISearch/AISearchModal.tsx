import React, { useState } from 'react';
import { Sparkles, X, Play, Loader2, Heart, Check, AlertCircle } from 'lucide-react';
import { AISongRecommendation } from '../../types';

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
  const [prompt, setPrompt] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [songs, setSongs] = useState<AISongRecommendation[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  if (!isOpen) return null;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isLoading) return;

    setIsLoading(true);
    setError(null);

    try {
      if (window.auraAPI?.aiRecommendSongs) {
        const res = await window.auraAPI.aiRecommendSongs(trimmed);
        if (res.ok && res.songs && res.songs.length > 0) {
          setSongs(res.songs);
        } else {
          setError(res.error || 'No se encontraron canciones para esa descripción.');
        }
      } else {
        setError('El motor de IA no está disponible en este entorno.');
      }
    } catch {
      setError('Ocurrió un error al consultar las recomendaciones.');
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlay = (song: AISongRecommendation) => {
    setActiveVideoId(song.videoId);
    onPlayTrack(song.videoId);
  };

  const handleLike = async (e: React.MouseEvent, videoId: string) => {
    e.stopPropagation();
    if (likedIds.has(videoId)) return;
    const ok = await onLikeTrack(videoId);
    if (ok) {
      setLikedIds((prev) => new Set(prev).add(videoId));
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/75 flex items-start justify-center pt-16 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#121212] border border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Aura AI · Curador Musical</h2>
              <p className="text-[11px] text-neutral-400">
                Describe qué estás haciendo o cómo te sientes y haz clic en una canción para reproducirla
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Input Form (No suggested chips) */}
        <form onSubmit={handleSearch} className="p-4 border-b border-white/10 flex gap-2">
          <input
            type="text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ej: Estoy programando y quiero música motivadora..."
            autoFocus
            className="flex-1 bg-[#1b1b1b] border border-white/10 focus:border-emerald-500/60 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-neutral-500 outline-none"
          />
          <button
            type="submit"
            disabled={isLoading || !prompt.trim()}
            className="px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-black font-bold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Buscando...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Recomendar</span>
              </>
            )}
          </button>
        </form>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!isLoading && songs.length === 0 && !error && (
            <div className="py-10 text-center text-neutral-500 text-xs">
              Escribe tu actividad o estado de ánimo arriba para recibir canciones listas para reproducir.
            </div>
          )}

          {isLoading && (
            <div className="py-10 flex flex-col items-center justify-center gap-2 text-neutral-400 text-xs">
              <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
              <span>Analizando tu contexto y preparando las canciones en YouTube Music...</span>
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
                  className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer ${
                    isPlaying
                      ? 'bg-emerald-500/15 border-emerald-500/40'
                      : 'bg-[#181818] border-white/5 hover:border-white/15 hover:bg-[#202020]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="relative w-11 h-11 rounded-lg overflow-hidden bg-neutral-800 flex-shrink-0">
                      <img
                        src={song.thumbnail}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <Play className="w-4 h-4 text-white fill-white" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-bold text-white truncate">{song.title}</p>
                        <span className="text-[11px] text-emerald-400 font-medium truncate">
                          · {song.artist}
                        </span>
                      </div>
                      {song.reason && (
                        <p className="text-[11px] text-neutral-400 truncate mt-0.5">{song.reason}</p>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleLike(e, song.videoId)}
                    title="Agregar a Mis Me gusta"
                    className={`p-2 rounded-lg border cursor-pointer flex-shrink-0 ${
                      isLiked
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                        : 'bg-white/5 border-white/10 text-neutral-400 hover:text-white'
                    }`}
                  >
                    {isLiked ? <Check className="w-3.5 h-3.5" /> : <Heart className="w-3.5 h-3.5" />}
                  </button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
};
