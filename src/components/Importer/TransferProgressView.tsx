import React from 'react';
import {
  CheckCircle2,
  Loader2,
  AlertCircle,
  Heart,
  ListMusic,
  ExternalLink,
} from 'lucide-react';
import { TransferLogItem } from '../../types';
import { useI18n } from '../../i18n';

interface TransferProgressViewProps {
  transferLogs: TransferLogItem[];
  transferDone: boolean;
  transferDestination: 'likes' | 'playlist';
  createdPlaylistId: string | null;
  onReset: () => void;
  onNavigateIframe: (url: string) => void;
  onClose: () => void;
}

export const TransferProgressView: React.FC<TransferProgressViewProps> = ({
  transferLogs,
  transferDone,
  transferDestination,
  createdPlaylistId,
  onReset,
  onNavigateIframe,
  onClose,
}) => {
  const { t } = useI18n();
  const syncedCount = transferLogs.filter((l) => l.status === 'synced').length;
  const processedCount = transferLogs.filter(
    (l) => l.status !== 'pending' && l.status !== 'searching'
  ).length;
  const totalCount = Math.max(transferLogs.length, 1);

  return (
    <div className="flex-1 flex flex-col p-6 overflow-hidden">
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-white">
            {transferDone
              ? `${t.importer.transferDoneTitle} (${syncedCount} / ${transferLogs.length} ${t.importer.transferSyncedSuffix})`
              : `${t.importer.transferringTitle} (${syncedCount} / ${transferLogs.length})`}
          </span>
          <span className="text-xs font-mono text-neutral-400">
            {Math.round((syncedCount / totalCount) * 100)}%
          </span>
        </div>
        <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#1DB954] to-emerald-400 transition-all duration-300"
            style={{ width: `${Math.round((processedCount / totalCount) * 100)}%` }}
          />
        </div>
      </div>

      {/* Song-by-song real-time log */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 border border-white/10 rounded-xl p-3 bg-black/40">
        {transferLogs.map((log, index) => (
          <div
            key={index}
            className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5 text-xs"
          >
            <div className="min-w-0 flex-1 pr-3">
              <p className="font-medium text-white truncate">
                {log.title} <span className="text-neutral-400 font-normal">— {log.artist}</span>
              </p>
              {log.matchedTitle && (
                <p className="text-[11px] text-emerald-400 truncate">
                  ✓ YT Music: {log.matchedTitle}
                </p>
              )}
              {log.error && <p className="text-[11px] text-red-400">{log.error}</p>}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {log.status === 'pending' && (
                <span className="text-neutral-500">{t.importer.statusQueued}</span>
              )}
              {log.status === 'searching' && (
                <span className="flex items-center gap-1.5 text-amber-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t.importer.statusSyncing}
                </span>
              )}
              {log.status === 'synced' && (
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  <CheckCircle2 className="w-4 h-4" />
                  {transferDestination === 'likes'
                    ? t.importer.statusLiked
                    : t.importer.statusInPlaylist}
                </span>
              )}
              {log.status === 'failed' && (
                <span className="flex items-center gap-1 text-red-400">
                  <AlertCircle className="w-4 h-4" />
                  {t.importer.statusFailed}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {transferDone && (
        <div className="mt-4 flex items-center justify-between pt-3 border-t border-white/10">
          <button
            onClick={onReset}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-medium text-white cursor-pointer transition"
          >
            {t.importer.importMore}
          </button>

          <div className="flex items-center gap-3">
            {transferDestination === 'likes' ? (
              <button
                onClick={() => {
                  onNavigateIframe('https://music.youtube.com/playlist?list=LM');
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg cursor-pointer transition"
              >
                <Heart className="w-4 h-4 fill-current" />
                <span>{t.importer.viewLikesNow}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            ) : (
              <button
                onClick={() => {
                  const targetUrl = createdPlaylistId
                    ? `https://music.youtube.com/playlist?list=${createdPlaylistId}`
                    : 'https://music.youtube.com/library/playlists';
                  onNavigateIframe(targetUrl);
                  onClose();
                }}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-2 shadow-lg cursor-pointer transition"
              >
                <ListMusic className="w-4 h-4" />
                <span>{t.importer.viewPlaylistNow}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
