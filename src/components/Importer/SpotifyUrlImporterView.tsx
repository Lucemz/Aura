import React from 'react';
import { Heart, Loader2, CheckSquare, Square } from 'lucide-react';
import { ImportedTrack } from '../../types';
import { useI18n } from '../../i18n';

interface SpotifyUrlImporterViewProps {
  urlInput: string;
  isParsingUrl: boolean;
  urlParsedData: { title: string; tracks: ImportedTrack[] } | null;
  customPlaylistName: string;
  selectedTrackIndices: Set<number>;
  onUrlInputChange: (val: string) => void;
  onParseUrl: (e: React.FormEvent) => void;
  onCustomPlaylistNameChange: (val: string) => void;
  onToggleTrackSelection: (idx: number) => void;
  onStartTransfer: (
    tracks: ImportedTrack[],
    destination: 'likes' | 'playlist',
    playlistTitle?: string
  ) => void;
}

export const SpotifyUrlImporterView: React.FC<SpotifyUrlImporterViewProps> = ({
  urlInput,
  isParsingUrl,
  urlParsedData,
  customPlaylistName,
  selectedTrackIndices,
  onUrlInputChange,
  onParseUrl,
  onCustomPlaylistNameChange,
  onToggleTrackSelection,
  onStartTransfer,
}) => {
  const { t } = useI18n();

  return (
    <div className="flex-1 flex flex-col overflow-hidden p-6">
      <form onSubmit={onParseUrl} className="flex items-center gap-2 mb-4">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => onUrlInputChange(e.target.value)}
          placeholder={t.importer.urlPlaceholder}
          className="flex-1 bg-black/50 border border-white/15 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#1DB954]"
        />
        <button
          type="submit"
          disabled={isParsingUrl}
          className="px-5 py-2.5 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] text-black text-xs font-bold flex items-center gap-1.5 cursor-pointer transition disabled:opacity-50"
        >
          {isParsingUrl ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t.importer.urlReading}</span>
            </>
          ) : (
            <span>{t.importer.urlExtractBtn}</span>
          )}
        </button>
      </form>

      {urlParsedData ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-400">{t.importer.urlPlaylistNameLabel}</span>
              <input
                type="text"
                value={customPlaylistName}
                onChange={(e) => onCustomPlaylistNameChange(e.target.value)}
                className="bg-black/40 border border-white/15 rounded-lg px-3 py-1 text-xs text-white"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const chosen = urlParsedData.tracks.filter((_, i) =>
                    selectedTrackIndices.has(i)
                  );
                  onStartTransfer(chosen, 'playlist', customPlaylistName);
                }}
                className="px-4 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold cursor-pointer transition"
              >
                {t.importer.createPlaylistBtn} ({selectedTrackIndices.size})
              </button>

              <button
                onClick={() => {
                  const chosen = urlParsedData.tracks.filter((_, i) =>
                    selectedTrackIndices.has(i)
                  );
                  onStartTransfer(chosen, 'likes');
                }}
                className="px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer transition"
              >
                <Heart className="w-3.5 h-3.5 text-red-400 fill-current" />
                <span>{t.importer.sendToLikesShort}</span>
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 border border-white/10 rounded-xl p-2 bg-black/30">
            {urlParsedData.tracks.map((track, idx) => {
              const selected = selectedTrackIndices.has(idx);
              return (
                <div
                  key={idx}
                  onClick={() => onToggleTrackSelection(idx)}
                  className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition ${
                    selected ? 'bg-white/10' : 'hover:bg-white/5 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {selected ? (
                      <CheckSquare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : (
                      <Square className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-white truncate">{track.title}</p>
                      <p className="text-[11px] text-neutral-400 truncate">{track.artist}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-neutral-500 text-xs">
          {t.importer.urlEmptyHint}
        </div>
      )}
    </div>
  );
};
