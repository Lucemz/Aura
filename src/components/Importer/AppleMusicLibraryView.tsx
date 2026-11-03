import React, { useState } from 'react';
import {
  Heart,
  ListMusic,
  Loader2,
  ArrowRight,
  CheckSquare,
  Square,
  RefreshCw,
  Music2,
} from 'lucide-react';
import { ImportedPlaylist, ImportedTrack, ProviderLibraryResult } from '../../types';
import { useI18n } from '../../i18n';

interface AppleMusicLibraryViewProps {
  appleData: ProviderLibraryResult | null;
  isConnecting: boolean;
  selectedTrackIndices: Set<number>;
  onConnectAppleMusic: () => void;
  onToggleTrackSelection: (idx: number) => void;
  onToggleSelectAllTracks: (tracks: ImportedTrack[]) => void;
  onStartTransfer: (
    tracks: ImportedTrack[],
    destination: 'likes' | 'playlist',
    playlistTitle?: string
  ) => void;
  onTransferSelectedPlaylist: (pl: ImportedPlaylist, destination: 'likes' | 'playlist') => void;
}

export const AppleMusicLibraryView: React.FC<AppleMusicLibraryViewProps> = ({
  appleData,
  isConnecting,
  selectedTrackIndices,
  onConnectAppleMusic,
  onToggleTrackSelection,
  onToggleSelectAllTracks,
  onStartTransfer,
  onTransferSelectedPlaylist,
}) => {
  const { t } = useI18n();
  const [categoryTab, setCategoryTab] = useState<'likes' | 'playlists'>('likes');

  if (!appleData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 border bg-[#FA243C]/15 border-[#FA243C]/40 text-[#FA243C]">
          <Music2 className="w-8 h-8" />
        </div>

        <h3 className="text-lg font-bold text-white mb-2">{t.importer.appleAuthTitle}</h3>
        <p className="text-xs text-neutral-400 max-w-md mb-6 leading-relaxed">
          {t.importer.appleAuthDesc}
        </p>

        <button
          onClick={onConnectAppleMusic}
          disabled={isConnecting}
          className="px-6 py-3 rounded-xl font-bold text-sm bg-[#FA243C] hover:bg-[#ff3b52] text-white flex items-center gap-2.5 shadow-lg cursor-pointer transition disabled:opacity-50"
        >
          {isConnecting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t.importer.appleLoading}</span>
            </>
          ) : (
            <>
              <span>{t.importer.appleAuthBtn}</span>
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
                ? 'bg-[#FA243C] text-white'
                : 'bg-white/5 text-neutral-300 hover:bg-white/10'
            }`}
          >
            <Heart className="w-3.5 h-3.5" />
            <span>
              {t.importer.librarySongsCount} ({appleData.likedSongs.length})
            </span>
          </button>

          <button
            onClick={() => setCategoryTab('playlists')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition ${
              categoryTab === 'playlists'
                ? 'bg-[#FA243C] text-white'
                : 'bg-white/5 text-neutral-300 hover:bg-white/10'
            }`}
          >
            <ListMusic className="w-3.5 h-3.5" />
            <span>
              {t.importer.playlistsCount} ({appleData.playlists.length})
            </span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-[#FA243C] font-medium">✓ Music.app (macOS)</span>
          <button
            onClick={onConnectAppleMusic}
            disabled={isConnecting}
            className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isConnecting ? 'animate-spin' : ''}`} />
            <span>{t.importer.refresh}</span>
          </button>
        </div>
      </div>

      {/* CATEGORY 1: SONGS */}
      {categoryTab === 'likes' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-2 px-1">
            <button
              onClick={() => onToggleSelectAllTracks(appleData.likedSongs)}
              className="text-xs text-neutral-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
            >
              {selectedTrackIndices.size === appleData.likedSongs.length ? (
                <CheckSquare className="w-4 h-4 text-[#FA243C]" />
              ) : (
                <Square className="w-4 h-4 text-neutral-500" />
              )}
              <span>
                {t.importer.selectAll} ({selectedTrackIndices.size} {t.importer.selected})
              </span>
            </button>

            <div className="flex items-center gap-2">
              <button
                disabled={selectedTrackIndices.size === 0}
                onClick={() => {
                  const chosen = appleData.likedSongs.filter((_, i) =>
                    selectedTrackIndices.has(i)
                  );
                  onStartTransfer(chosen, 'likes');
                }}
                className="px-4 py-1.5 rounded-lg bg-[#FA243C] hover:bg-[#ff3b52] disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 shadow cursor-pointer transition"
              >
                <Heart className="w-3.5 h-3.5 fill-current" />
                <span>{t.importer.sendToLikes}</span>
              </button>

              <button
                disabled={selectedTrackIndices.size === 0}
                onClick={() => {
                  const chosen = appleData.likedSongs.filter((_, i) =>
                    selectedTrackIndices.has(i)
                  );
                  onStartTransfer(chosen, 'playlist', 'Apple Music Favorites');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-40 text-white text-xs font-medium cursor-pointer transition"
              >
                {t.importer.createAsPlaylist}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 border border-white/10 rounded-xl p-2 bg-black/30">
            {appleData.likedSongs.map((track, idx) => {
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
                      <CheckSquare className="w-4 h-4 text-[#FA243C] flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-neutral-500 flex-shrink-0" />
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
          {appleData.playlists.map((pl) => (
            <div
              key={pl.id}
              className="flex items-center justify-between p-3 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition"
            >
              <div className="flex items-center gap-3 min-w-0 pr-2">
                <div className="w-12 h-12 rounded-lg bg-[#FA243C]/15 border border-[#FA243C]/30 flex items-center justify-center flex-shrink-0">
                  <ListMusic className="w-6 h-6 text-[#FA243C]" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white truncate">{pl.title}</p>
                  <p className="text-[11px] text-neutral-400 truncate">
                    {pl.description ? `${pl.description} • ` : ''}
                    {pl.trackCount ? `${pl.trackCount}` : 'Playlist'}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 flex-shrink-0">
                <button
                  onClick={() => onTransferSelectedPlaylist(pl, 'playlist')}
                  disabled={isConnecting}
                  className="px-3 py-1 rounded-lg bg-[#FA243C] hover:bg-[#ff3b52] text-white text-[11px] font-semibold cursor-pointer transition"
                >
                  {t.importer.createPlaylistBtn}
                </button>
                <button
                  onClick={() => onTransferSelectedPlaylist(pl, 'likes')}
                  disabled={isConnecting}
                  className="px-3 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-neutral-200 text-[11px] cursor-pointer transition"
                >
                  {t.importer.sendToLikesShort}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
