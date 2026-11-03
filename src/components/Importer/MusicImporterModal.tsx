import React, { useState, useEffect } from 'react';
import { X, Music, Link2, AlertCircle, RefreshCw } from 'lucide-react';
import {
  ImportedTrack,
  ImportedPlaylist,
  ProviderLibraryResult,
  TransferLogItem,
} from '../../types';
import { TransferProgressView } from './TransferProgressView';
import { SpotifyLibraryView } from './SpotifyLibraryView';
import { AppleMusicLibraryView } from './AppleMusicLibraryView';
import { SpotifyUrlImporterView } from './SpotifyUrlImporterView';
import { useI18n } from '../../i18n';

interface MusicImporterModalProps {
  isOpen: boolean;
  onClose: () => void;
  ytmLoggedIn: boolean;
  onOpenGoogleLogin: () => void;
  onNavigateIframe: (url: string) => void;
  onLikeTrackInWebview: (videoId: string) => Promise<boolean>;
  onCreatePlaylistInWebview: (
    title: string,
    description: string,
    videoIds: string[]
  ) => Promise<string | null>;
}

export const MusicImporterModal: React.FC<MusicImporterModalProps> = ({
  isOpen,
  onClose,
  ytmLoggedIn,
  onOpenGoogleLogin,
  onNavigateIframe,
  onLikeTrackInWebview,
  onCreatePlaylistInWebview,
}) => {
  const { t } = useI18n();
  const [sourceTab, setSourceTab] = useState<'spotify' | 'apple' | 'url'>('spotify');

  // Spotify & Apple Music Library State
  const [spotifyData, setSpotifyData] = useState<ProviderLibraryResult | null>(null);
  const [appleData, setAppleData] = useState<ProviderLibraryResult | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // URL Parser State
  const [urlInput, setUrlInput] = useState('');
  const [urlParsedData, setUrlParsedData] = useState<{
    title: string;
    tracks: ImportedTrack[];
  } | null>(null);
  const [isParsingUrl, setIsParsingUrl] = useState(false);

  // Selection State
  const [selectedTrackIndices, setSelectedTrackIndices] = useState<Set<number>>(new Set());

  // Transfer Progress State
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferDestination, setTransferDestination] = useState<'likes' | 'playlist'>('likes');
  const [customPlaylistName, setCustomPlaylistName] = useState('');
  const [transferLogs, setTransferLogs] = useState<TransferLogItem[]>([]);
  const [transferDone, setTransferDone] = useState(false);
  const [createdPlaylistId, setCreatedPlaylistId] = useState<string | null>(null);

  // Automatically load cached Spotify library when modal opens
  useEffect(() => {
    if (!isOpen || spotifyData) return;
    let cancelled = false;
    (async () => {
      try {
        setIsConnecting(true);
        const cached = await window.auraAPI?.getCachedSpotify();
        if (!cancelled && cached && cached.ok) {
          setSpotifyData(cached);
          setSelectedTrackIndices(new Set((cached.likedSongs || []).map((_, idx) => idx)));
        }
      } catch {
        // Ignore if not yet connected
      } finally {
        if (!cancelled) setIsConnecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, spotifyData]);

  if (!isOpen) return null;

  const handleConnectSpotify = async (forceReauth = false) => {
    setStatusError(null);
    setIsConnecting(true);
    try {
      const res = await window.auraAPI?.connectSpotify(forceReauth);
      if (res && res.ok) {
        setSpotifyData(res);
        setSelectedTrackIndices(new Set((res.likedSongs || []).map((_, idx) => idx)));
      } else {
        setStatusError(res?.error || 'Could not authorize Spotify access.');
      }
    } catch (err: any) {
      setStatusError(err.message || 'Spotify authorization error.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleConnectAppleMusic = async () => {
    setStatusError(null);
    setIsConnecting(true);
    try {
      const res = await window.auraAPI?.connectAppleMusic();
      if (res && res.ok) {
        setAppleData(res);
        setSelectedTrackIndices(new Set((res.likedSongs || []).map((_, idx) => idx)));
      } else {
        setStatusError(res?.error || 'Could not read Mac Music app.');
      }
    } catch (err: any) {
      setStatusError(err.message || 'Error connecting to Mac Music app.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleParseUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    setStatusError(null);
    setIsParsingUrl(true);
    try {
      const res = await window.auraAPI?.parseExternalMusicUrl(urlInput.trim());
      if (res && res.ok && res.tracks && res.tracks.length > 0) {
        setUrlParsedData({
          title: res.title || 'Spotify Playlist',
          tracks: res.tracks,
        });
        setCustomPlaylistName(res.title || 'Spotify Playlist');
        setSelectedTrackIndices(new Set(res.tracks.map((_, idx) => idx)));
      } else {
        setStatusError(res?.error || 'No tracks found at that link.');
      }
    } catch (err: any) {
      setStatusError(err.message || 'Error parsing URL.');
    } finally {
      setIsParsingUrl(false);
    }
  };

  const toggleTrackSelection = (idx: number) => {
    const next = new Set(selectedTrackIndices);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setSelectedTrackIndices(next);
  };

  const toggleSelectAllTracks = (tracks: ImportedTrack[]) => {
    if (selectedTrackIndices.size === tracks.length) {
      setSelectedTrackIndices(new Set());
    } else {
      setSelectedTrackIndices(new Set(tracks.map((_, i) => i)));
    }
  };

  const startTransfer = async (
    tracksToTransfer: ImportedTrack[],
    destination: 'likes' | 'playlist',
    playlistTitle = 'Imported Playlist'
  ) => {
    if (!tracksToTransfer.length) return;
    setStatusError(null);
    setIsTransferring(true);
    setTransferDone(false);
    setCreatedPlaylistId(null);
    setTransferDestination(destination);

    setTransferLogs(
      tracksToTransfer.map((tr) => ({
        title: tr.title,
        artist: tr.artist,
        status: 'pending',
      }))
    );

    const matchedVideoIds: string[] = [];

    for (let i = 0; i < tracksToTransfer.length; i++) {
      const track = tracksToTransfer[i];

      setTransferLogs((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: 'searching' } : item))
      );

      try {
        const match = await window.auraAPI?.searchYouTubeMusicTrack(track.title, track.artist);
        if (match && match.videoId) {
          matchedVideoIds.push(match.videoId);

          if (destination === 'likes') {
            let likedOk = await onLikeTrackInWebview(match.videoId);
            if (!likedOk && window.auraAPI?.likeSongOnYouTubeMusic) {
              const likeRes = await window.auraAPI.likeSongOnYouTubeMusic(match.videoId);
              likedOk = Boolean(likeRes?.ok);
            }

            setTransferLogs((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? {
                      ...item,
                      status: likedOk ? 'synced' : 'failed',
                      matchedTitle: match.title,
                      videoId: match.videoId,
                      error: likedOk ? undefined : 'Sign in to YouTube Music required',
                    }
                  : item
              )
            );
          } else {
            setTransferLogs((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? {
                      ...item,
                      status: 'synced',
                      matchedTitle: match.title,
                      videoId: match.videoId,
                    }
                  : item
              )
            );
          }
        } else {
          setTransferLogs((prev) =>
            prev.map((item, idx) =>
              idx === i ? { ...item, status: 'failed', error: 'No match found on YTM' } : item
            )
          );
        }
      } catch (e: any) {
        setTransferLogs((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: 'failed', error: e.message } : item
          )
        );
      }
    }

    if (destination === 'playlist' && matchedVideoIds.length > 0) {
      const finalTitle = playlistTitle.trim() || 'Imported Playlist';
      const desc = 'Imported with Aura Music';

      let plId = await onCreatePlaylistInWebview(finalTitle, desc, matchedVideoIds);
      if (!plId && window.auraAPI?.createPlaylistOnYouTubeMusic) {
        const res = await window.auraAPI.createPlaylistOnYouTubeMusic(
          finalTitle,
          desc,
          matchedVideoIds
        );
        if (res.ok && res.playlistId) {
          plId = res.playlistId;
        }
      }
      setCreatedPlaylistId(plId);
    }

    setTransferDone(true);
  };

  const handleTransferSelectedPlaylist = async (
    pl: ImportedPlaylist,
    destination: 'likes' | 'playlist'
  ) => {
    setStatusError(null);
    setIsConnecting(true);
    try {
      const tracks =
        pl.provider === 'apple'
          ? await window.auraAPI?.getApplePlaylistTracks(pl.id)
          : await window.auraAPI?.getSpotifyPlaylistTracks(pl.id);
      setIsConnecting(false);
      if (tracks && tracks.length > 0) {
        await startTransfer(tracks, destination, pl.title);
      } else {
        setStatusError('No tracks found inside this playlist.');
      }
    } catch (err: any) {
      setIsConnecting(false);
      setStatusError(err.message || 'Error fetching playlist tracks.');
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/20 flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-[#181818]/95 border border-white/15 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden text-white"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#181818]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1DB954]/20 border border-[#1DB954]/40 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-[#1DB954]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">{t.importer.modalTitle}</h2>
              <p className="text-xs text-neutral-400">{t.importer.modalSubtitle}</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-lg text-neutral-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warning if not logged into YouTube Music yet */}
        {!ytmLoggedIn && (
          <div className="mx-6 mt-4 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
            <div className="flex items-center gap-2.5 text-xs text-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <span>{t.importer.loginWarning}</span>
            </div>
            <button
              onClick={onOpenGoogleLogin}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs flex-shrink-0 cursor-pointer transition"
            >
              {t.importer.loginButton}
            </button>
          </div>
        )}

        {isTransferring ? (
          <TransferProgressView
            transferLogs={transferLogs}
            transferDone={transferDone}
            transferDestination={transferDestination}
            createdPlaylistId={createdPlaylistId}
            onReset={() => {
              setIsTransferring(false);
              setTransferDone(false);
            }}
            onNavigateIframe={onNavigateIframe}
            onClose={onClose}
          />
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Source Tabs */}
            <div className="flex items-center gap-2 px-6 pt-4 border-b border-white/10 bg-[#151515]">
              <button
                onClick={() => {
                  setSourceTab('spotify');
                  setStatusError(null);
                  if (spotifyData) {
                    setSelectedTrackIndices(
                      new Set((spotifyData.likedSongs || []).map((_, idx) => idx))
                    );
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition cursor-pointer ${
                  sourceTab === 'spotify'
                    ? 'border-[#1DB954] text-[#1DB954] bg-[#1DB954]/10 rounded-t-lg'
                    : 'border-transparent text-neutral-400 hover:text-white'
                }`}
              >
                <Music className="w-4 h-4" />
                <span>{t.importer.tabSpotify}</span>
              </button>

              <button
                onClick={() => {
                  setSourceTab('apple');
                  setStatusError(null);
                  if (appleData) {
                    setSelectedTrackIndices(
                      new Set((appleData.likedSongs || []).map((_, idx) => idx))
                    );
                  } else {
                    handleConnectAppleMusic();
                  }
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition cursor-pointer ${
                  sourceTab === 'apple'
                    ? 'border-[#FA243C] text-[#FA243C] bg-[#FA243C]/10 rounded-t-lg'
                    : 'border-transparent text-neutral-400 hover:text-white'
                }`}
              >
                <Music className="w-4 h-4" />
                <span>{t.importer.tabApple}</span>
              </button>

              <button
                onClick={() => {
                  setSourceTab('url');
                  setStatusError(null);
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition cursor-pointer ${
                  sourceTab === 'url'
                    ? 'border-sky-400 text-sky-400 bg-sky-400/10 rounded-t-lg'
                    : 'border-transparent text-neutral-400 hover:text-white'
                }`}
              >
                <Link2 className="w-4 h-4" />
                <span>{t.importer.tabUrl}</span>
              </button>
            </div>

            {statusError && (
              <div className="mx-6 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span>{statusError}</span>
              </div>
            )}

            {sourceTab === 'spotify' ? (
              <div className="flex-1 flex flex-col overflow-hidden p-6">
                <SpotifyLibraryView
                  spotifyData={spotifyData}
                  isConnecting={isConnecting}
                  selectedTrackIndices={selectedTrackIndices}
                  onConnectSpotify={handleConnectSpotify}
                  onToggleTrackSelection={toggleTrackSelection}
                  onToggleSelectAllTracks={toggleSelectAllTracks}
                  onStartTransfer={startTransfer}
                  onTransferSelectedPlaylist={handleTransferSelectedPlaylist}
                />
              </div>
            ) : sourceTab === 'apple' ? (
              <div className="flex-1 flex flex-col overflow-hidden p-6">
                <AppleMusicLibraryView
                  appleData={appleData}
                  isConnecting={isConnecting}
                  selectedTrackIndices={selectedTrackIndices}
                  onConnectAppleMusic={handleConnectAppleMusic}
                  onToggleTrackSelection={toggleTrackSelection}
                  onToggleSelectAllTracks={toggleSelectAllTracks}
                  onStartTransfer={startTransfer}
                  onTransferSelectedPlaylist={handleTransferSelectedPlaylist}
                />
              </div>
            ) : (
              <SpotifyUrlImporterView
                urlInput={urlInput}
                isParsingUrl={isParsingUrl}
                urlParsedData={urlParsedData}
                customPlaylistName={customPlaylistName}
                selectedTrackIndices={selectedTrackIndices}
                onUrlInputChange={setUrlInput}
                onParseUrl={handleParseUrl}
                onCustomPlaylistNameChange={setCustomPlaylistName}
                onToggleTrackSelection={toggleTrackSelection}
                onStartTransfer={startTransfer}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};
