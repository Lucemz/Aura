import React, { useState } from 'react';
import {
  Heart,
  ListMusic,
  Loader2,
  ArrowRight,
  CheckSquare,
  Square,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { ImportedPlaylist, ImportedTrack, ProviderLibraryResult } from '../../types';

interface SpotifyLibraryViewProps {
  spotifyData: ProviderLibraryResult | null;
  isConnecting: boolean;
  selectedTrackIndices: Set<number>;
  onConnectSpotify: (forceReauth: boolean) => void;
  onToggleTrackSelection: (idx: number) => void;
  onToggleSelectAllTracks: (tracks: ImportedTrack[]) => void;
  onStartTransfer: (
    tracks: ImportedTrack[],
    destination: 'likes' | 'playlist',
    playlistTitle?: string
  ) => void;
  onTransferSelectedPlaylist: (pl: ImportedPlaylist, destination: 'likes' | 'playlist') => void;
}

export const SpotifyLibraryView: React.FC<SpotifyLibraryViewProps> = ({
  spotifyData,
  isConnecting,
  selectedTrackIndices,
  onConnectSpotify,
  onToggleTrackSelection,
  onToggleSelectAllTracks,
  onStartTransfer,
  onTransferSelectedPlaylist,
}) => {
  const [categoryTab, setCategoryTab] = useState<'likes' | 'playlists'>('likes');

  if (!spotifyData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 border bg-[#1DB954]/15 border-[#1DB954]/40 text-[#1DB954]">
          <ShieldCheck className="w-8 h-8" />
        </div>

        <h3 className="text-lg font-bold text-white mb-2">
          Autorizar acceso a tu biblioteca de Spotify
        </h3>
        <p className="text-xs text-neutral-400 max-w-md mb-6 leading-relaxed">
          Al hacer clic abajo se abrirá la pantalla oficial de permisos de{' '}
          <strong>Spotify (OAuth 2.0)</strong> en tu navegador. Solo pulsa{' '}
          <strong>&ldquo;Aceptar&rdquo;</strong> para autorizar la lectura de tus{' '}
          <strong>Canciones que te gustan</strong> y <strong>Playlists</strong>.
        </p>

        <button
          onClick={() => onConnectSpotify(false)}
          disabled={isConnecting}
          className="px-6 py-3 rounded-xl font-bold text-sm bg-[#1DB954] hover:bg-[#1ed760] text-black flex items-center gap-2.5 shadow-lg cursor-pointer transition disabled:opacity-50"
        >
          {isConnecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Cargando tu biblioteca de Spotify...</span>
            </>
          ) : (
            <>
              <span>Autorizar permisos en Spotify</span>
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCategoryTab('likes')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition ${
              categoryTab === 'likes'
                ? 'bg-[#1DB954] text-black'
                : 'bg-white/5 text-neutral-300 hover:bg-white/10'
            }`}
          >
            <Heart className="w-3.5 h-3.5" />
            <span>
              Canciones que te gustan ({spotifyData.likedSongs.length}
              {spotifyData.totalLiked && spotifyData.totalLiked > spotifyData.likedSongs.length
                ? ` de ${spotifyData.totalLiked}`
                : ''}
              )
            </span>
          </button>

          <button
            onClick={() => setCategoryTab('playlists')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition ${
              categoryTab === 'playlists'
                ? 'bg-[#1DB954] text-black'
                : 'bg-white/5 text-neutral-300 hover:bg-white/10'
            }`}
          >
            <ListMusic className="w-3.5 h-3.5" />
            <span>Playlists ({spotifyData.playlists.length})</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {spotifyData.profile?.name && (
            <span className="text-xs text-[#1DB954] font-medium">✓ {spotifyData.profile.name}</span>
          )}
          <button
            onClick={() => onConnectSpotify(false)}
            disabled={isConnecting}
            className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isConnecting ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
          <button
            onClick={() => onConnectSpotify(true)}
            disabled={isConnecting}
            className="text-xs text-neutral-500 hover:text-neutral-300 cursor-pointer disabled:opacity-50"
          >
            Cambiar cuenta
          </button>
        </div>
      </div>

      {/* CATEGORY 1: LIKED SONGS */}
      {categoryTab === 'likes' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-2 px-1">
            <button
              onClick={() => onToggleSelectAllTracks(spotifyData.likedSongs)}
              className="text-xs text-neutral-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
            >
              {selectedTrackIndices.size === spotifyData.likedSongs.length ? (
                <CheckSquare className="w-4 h-4 text-emerald-400" />
              ) : (
                <Square className="w-4 h-4 text-neutral-500" />
              )}
              <span>Seleccionar todas ({selectedTrackIndices.size} seleccionadas)</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                disabled={selectedTrackIndices.size === 0}
                onClick={() => {
                  const chosen = spotifyData.likedSongs.filter((_, i) =>
                    selectedTrackIndices.has(i)
                  );
                  onStartTransfer(chosen, 'likes');
                }}
                className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 shadow cursor-pointer transition"
              >
                <Heart className="w-3.5 h-3.5 fill-current" />
                <span>Enviar a mis &ldquo;Me gusta&rdquo; de YouTube Music</span>
              </button>

              <button
                disabled={selectedTrackIndices.size === 0}
                onClick={() => {
                  const chosen = spotifyData.likedSongs.filter((_, i) =>
                    selectedTrackIndices.has(i)
                  );
                  onStartTransfer(chosen, 'playlist', 'Favoritas de Spotify');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-xs font-medium cursor-pointer transition"
              >
                Crear como Playlist en YT Music
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 border border-white/10 rounded-xl p-2 bg-black/30">
            {spotifyData.likedSongs.map((track, idx) => {
              const selected = selectedTrackIndices.has(idx);
              return (
                <div
                  key={idx}
                  onClick={() => onToggleTrackSelection(idx)}
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition ${
                    selected ? 'bg-white/10' : 'hover:bg-white/5 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {selected ? (
                      <CheckSquare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                    )}
                    {track.thumbnail && (
                      <img
                        src={track.thumbnail}
                        alt=""
                        className="w-8 h-8 rounded object-cover flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">{track.title}</p>
                      <p className="text-[11px] text-neutral-400 truncate">{track.artist}</p>
                    </div>
                  </div>
                  {track.album && (
                    <span className="text-[11px] text-neutral-500 truncate max-w-[180px] hidden sm:inline">
                      {track.album}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* CATEGORY 2: PLAYLISTS */}
      {categoryTab === 'playlists' && (
        <div className="flex-1 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 gap-3 p-1">
          {spotifyData.playlists.map((pl) => (
            <div
              key={pl.id}
              className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition"
            >
              <div className="flex items-center gap-3 min-w-0 pr-2">
                {pl.thumbnail ? (
                  <img
                    src={pl.thumbnail}
                    alt={pl.title}
                    className="w-12 h-12 rounded-lg object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                    <ListMusic className="w-6 h-6 text-neutral-400" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{pl.title}</p>
                  <p className="text-[11px] text-neutral-400 truncate">
                    {pl.description ? (
                      <span
                        className={
                          pl.description === 'Creada por ti'
                            ? 'text-[#1DB954] font-medium'
                            : 'text-neutral-400'
                        }
                      >
                        {pl.description} •{' '}
                      </span>
                    ) : null}
                    {pl.trackCount ? `${pl.trackCount} canciones` : 'Playlist'}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <button
                  onClick={() => onTransferSelectedPlaylist(pl, 'playlist')}
                  disabled={isConnecting}
                  className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold cursor-pointer transition"
                >
                  Crear Playlist en YTM
                </button>
                <button
                  onClick={() => onTransferSelectedPlaylist(pl, 'likes')}
                  disabled={isConnecting}
                  className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-neutral-200 text-[11px] cursor-pointer transition"
                >
                  Enviar a mis Likes
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
