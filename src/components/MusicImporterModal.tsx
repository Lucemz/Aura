import React, { useState, useEffect } from 'react';
import {
  X,
  Music,
  Heart,
  ListMusic,
  Link2,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ArrowRight,
  ExternalLink,
  CheckSquare,
  Square,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import {
  ImportedTrack,
  ImportedPlaylist,
  ProviderLibraryResult,
  TransferLogItem,
} from '../types';

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
  const [sourceTab, setSourceTab] = useState<'spotify' | 'url'>('spotify');
  const [categoryTab, setCategoryTab] = useState<'likes' | 'playlists'>('likes');

  // Spotify Library State
  const [spotifyData, setSpotifyData] = useState<ProviderLibraryResult | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // URL Parser State
  const [urlInput, setUrlInput] = useState('');
  const [urlParsedData, setUrlParsedData] = useState<{
    title: string;
    tracks: ImportedTrack[];
  } | null>(null);
  const [isParsingUrl, setIsParsingUrl] = useState(false);

  // Selection State for Liked Songs
  const [selectedTrackIndices, setSelectedTrackIndices] = useState<Set<number>>(new Set());

  // Transfer Progress State
  const [isTransferring, setIsTransferring] = useState(false);
  const [transferDestination, setTransferDestination] = useState<'likes' | 'playlist'>('likes');
  const [customPlaylistName, setCustomPlaylistName] = useState('');
  const [transferLogs, setTransferLogs] = useState<TransferLogItem[]>([]);
  const [transferDone, setTransferDone] = useState(false);
  const [createdPlaylistId, setCreatedPlaylistId] = useState<string | null>(null);

  // Automatically load cached Spotify library when modal opens if user already authorized before
  useEffect(() => {
    if (!isOpen || spotifyData) return;
    let cancelled = false;
    (async () => {
      try {
        setIsConnecting(true);
        const cached = await window.auraAPI?.getCachedSpotify();
        if (!cancelled && cached && cached.ok) {
          setSpotifyData(cached);
          const allIndices = new Set((cached.likedSongs || []).map((_, idx) => idx));
          setSelectedTrackIndices(allIndices);
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
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConnectSpotify = async (forceReauth = false) => {
    setStatusError(null);
    setIsConnecting(true);
    try {
      const res = await window.auraAPI?.connectSpotify(forceReauth);
      if (res && res.ok) {
        setSpotifyData(res);
        const allIndices = new Set((res.likedSongs || []).map((_, idx) => idx));
        setSelectedTrackIndices(allIndices);
      } else {
        setStatusError(res?.error || 'No se pudo autorizar el acceso con Spotify.');
      }
    } catch (err: any) {
      setStatusError(err.message || 'Error al autorizar con Spotify.');
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
          title: res.title || 'Playlist de Spotify',
          tracks: res.tracks,
        });
        setCustomPlaylistName(res.title || 'Playlist de Spotify');
        setSelectedTrackIndices(new Set(res.tracks.map((_, idx) => idx)));
      } else {
        setStatusError(
          res?.error || 'No se encontraron pistas en ese enlace. Verifica que la playlist sea pública.'
        );
      }
    } catch (err: any) {
      setStatusError(err.message || 'Error al analizar el enlace.');
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

  /**
   * Core Transfer Execution:
   * 1. Matches each song on YouTube Music
   * 2. Sends REAL Likes (`like/like`) or Creates a REAL Playlist (`playlist/create`) on the user's YouTube Music account
   */
  const startTransfer = async (
    tracksToTransfer: ImportedTrack[],
    destination: 'likes' | 'playlist',
    playlistTitle = 'Playlist de Spotify'
  ) => {
    if (!tracksToTransfer.length) return;
    setStatusError(null);
    setIsTransferring(true);
    setTransferDone(false);
    setCreatedPlaylistId(null);
    setTransferDestination(destination);

    const initialLogs: TransferLogItem[] = tracksToTransfer.map((t) => ({
      title: t.title,
      artist: t.artist,
      status: 'pending',
    }));
    setTransferLogs(initialLogs);

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
              const ipcRes = await window.auraAPI.likeSongOnYouTubeMusic(match.videoId);
              likedOk = ipcRes.ok;
            }

            setTransferLogs((prev) =>
              prev.map((item, idx) =>
                idx === i
                  ? {
                      ...item,
                      status: likedOk ? 'synced' : 'failed',
                      matchedTitle: `${match.artist} - ${match.title}`,
                      videoId: match.videoId,
                      error: likedOk ? undefined : 'No se pudo marcar Like (verifica tu sesión)',
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
                      matchedTitle: `${match.artist} - ${match.title}`,
                      videoId: match.videoId,
                    }
                  : item
              )
            );
          }
        } else {
          setTransferLogs((prev) =>
            prev.map((item, idx) =>
              idx === i
                ? { ...item, status: 'failed', error: 'No se encontró coincidencia en YT Music' }
                : item
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
      const finalTitle = playlistTitle.trim() || 'Playlist de Spotify';
      const desc = 'Importada desde Spotify con Aura Music';

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
      const tracks = await window.auraAPI?.getSpotifyPlaylistTracks(pl.id);
      setIsConnecting(false);
      if (tracks && tracks.length > 0) {
        await startTransfer(tracks, destination, pl.title);
      } else {
        setStatusError('No se encontraron canciones dentro de esta playlist.');
      }
    } catch (err: any) {
      setIsConnecting(false);
      setStatusError(err.message || 'Error al obtener las canciones de la playlist.');
    }
  };

  const syncedCount = transferLogs.filter((l) => l.status === 'synced').length;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#121212] border border-white/15 rounded-2xl w-full max-w-4xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden text-white">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#181818]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1DB954]/20 border border-[#1DB954]/40 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-[#1DB954]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                Importar de Spotify a YouTube Music
              </h2>
              <p className="text-xs text-neutral-400">
                Autoriza el acceso a tu cuenta de Spotify (OAuth 2.0) para transferir tus &ldquo;Me gusta&rdquo;, Playlists y Álbumes directamente al iframe de YouTube Music
              </p>
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
              <span>
                Para que los <strong>Likes</strong> y <strong>Playlists</strong> se guarden en tu cuenta real de YouTube Music, inicia sesión primero.
              </span>
            </div>
            <button
              onClick={onOpenGoogleLogin}
              className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs flex-shrink-0 cursor-pointer transition"
            >
              Iniciar sesión en YT Music
            </button>
          </div>
        )}

        {/* Active Transfer Progress View */}
        {isTransferring ? (
          <div className="flex-1 flex flex-col p-6 overflow-hidden">
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-white">
                  {transferDone
                    ? `¡Transferencia completada! (${syncedCount} de ${transferLogs.length} canciones sincronizadas en tu cuenta de YouTube Music)`
                    : `Sincronizando con tu cuenta real de YouTube Music... (${syncedCount} / ${transferLogs.length})`}
                </span>
                <span className="text-xs font-mono text-neutral-400">
                  {Math.round((syncedCount / Math.max(transferLogs.length, 1)) * 100)}%
                </span>
              </div>
              <div className="w-full h-2.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#1DB954] to-emerald-400 transition-all duration-300"
                  style={{
                    width: `${Math.round(
                      (transferLogs.filter((l) => l.status !== 'pending' && l.status !== 'searching')
                        .length /
                        Math.max(transferLogs.length, 1)) *
                        100
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* Song by song real-time log */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 border border-white/10 rounded-xl p-3 bg-black/40">
              {transferLogs.map((log, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5 text-xs"
                >
                  <div className="min-w-0 flex-1 pr-3">
                    <p className="font-medium text-white truncate">
                      {log.title}{' '}
                      <span className="text-neutral-400 font-normal">— {log.artist}</span>
                    </p>
                    {log.matchedTitle && (
                      <p className="text-[11px] text-emerald-400 truncate">
                        ✓ Match en YT Music: {log.matchedTitle}
                      </p>
                    )}
                    {log.error && <p className="text-[11px] text-red-400">{log.error}</p>}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {log.status === 'pending' && <span className="text-neutral-500">En cola</span>}
                    {log.status === 'searching' && (
                      <span className="flex items-center gap-1.5 text-amber-400">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Sincronizando...
                      </span>
                    )}
                    {log.status === 'synced' && (
                      <span className="flex items-center gap-1 text-emerald-400 font-medium">
                        <CheckCircle2 className="w-4 h-4" />
                        {transferDestination === 'likes' ? 'Like en YT Music' : 'En Playlist'}
                      </span>
                    )}
                    {log.status === 'failed' && (
                      <span className="flex items-center gap-1 text-red-400">
                        <AlertCircle className="w-4 h-4" />
                        Falló
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer Actions when done */}
            {transferDone && (
              <div className="mt-4 flex items-center justify-between pt-3 border-t border-white/10">
                <button
                  onClick={() => {
                    setIsTransferring(false);
                    setTransferDone(false);
                  }}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-medium text-white cursor-pointer transition"
                >
                  ← Importar más música
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
                      <span>Ver mis &ldquo;Me gusta&rdquo; en YouTube Music ahora</span>
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
                      <span>Ver Playlist creada en YouTube Music ahora</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Main Spotify OAuth & URL Browser */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Tabs */}
            <div className="flex items-center gap-2 px-6 pt-4 border-b border-white/10 bg-[#151515]">
              <button
                onClick={() => {
                  setSourceTab('spotify');
                  setStatusError(null);
                }}
                className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition cursor-pointer ${
                  sourceTab === 'spotify'
                    ? 'border-[#1DB954] text-[#1DB954] bg-[#1DB954]/10 rounded-t-lg'
                    : 'border-transparent text-neutral-400 hover:text-white'
                }`}
              >
                <Music className="w-4 h-4" />
                <span>Autorizar Cuenta de Spotify (OAuth)</span>
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
                <span>Pegar Link de Playlist / Álbum de Spotify</span>
              </button>
            </div>

            {statusError && (
              <div className="mx-6 mt-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <span>{statusError}</span>
              </div>
            )}

            {/* TAB 1: SPOTIFY OAUTH PERMISSION FLOW */}
            {sourceTab === 'spotify' && (
              <div className="flex-1 flex flex-col overflow-hidden p-6">
                {!spotifyData ? (
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
                      <strong>Canciones que te gustan</strong>, <strong>Playlists</strong> y{' '}
                      <strong>Álbumes</strong>.
                    </p>

                    <button
                      onClick={() => handleConnectSpotify(false)}
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
                ) : (
                  /* Connected Spotify Library View */
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
                            {spotifyData.totalLiked &&
                            spotifyData.totalLiked > spotifyData.likedSongs.length
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
                          <span className="text-xs text-[#1DB954] font-medium">
                            ✓ {spotifyData.profile.name}
                          </span>
                        )}
                        <button
                          onClick={() => handleConnectSpotify(false)}
                          disabled={isConnecting}
                          className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isConnecting ? 'animate-spin' : ''}`} />
                          <span>Actualizar</span>
                        </button>
                        <button
                          onClick={() => handleConnectSpotify(true)}
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
                            onClick={() => toggleSelectAllTracks(spotifyData.likedSongs)}
                            className="text-xs text-neutral-300 hover:text-white flex items-center gap-1.5 cursor-pointer"
                          >
                            {selectedTrackIndices.size === spotifyData.likedSongs.length ? (
                              <CheckSquare className="w-4 h-4 text-emerald-400" />
                            ) : (
                              <Square className="w-4 h-4 text-neutral-500" />
                            )}
                            <span>
                              Seleccionar todas ({selectedTrackIndices.size} seleccionadas)
                            </span>
                          </button>

                          <div className="flex items-center gap-2">
                            <button
                              disabled={selectedTrackIndices.size === 0}
                              onClick={() => {
                                const chosen = spotifyData.likedSongs.filter((_, i) =>
                                  selectedTrackIndices.has(i)
                                );
                                startTransfer(chosen, 'likes');
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
                                startTransfer(chosen, 'playlist', 'Favoritas de Spotify');
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
                                onClick={() => toggleTrackSelection(idx)}
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
                                    <p className="text-xs font-medium text-white truncate">
                                      {track.title}
                                    </p>
                                    <p className="text-[11px] text-neutral-400 truncate">
                                      {track.artist}
                                    </p>
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
                                onClick={() => handleTransferSelectedPlaylist(pl, 'playlist')}
                                disabled={isConnecting}
                                className="px-3 py-1 rounded-lg bg-red-600 hover:bg-red-500 text-white text-[11px] font-semibold cursor-pointer transition"
                              >
                                Crear Playlist en YTM
                              </button>
                              <button
                                onClick={() => handleTransferSelectedPlaylist(pl, 'likes')}
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
                )}
              </div>
            )}

            {/* TAB 2: DIRECT URL PASTE */}
            {sourceTab === 'url' && (
              <div className="flex-1 flex flex-col overflow-hidden p-6">
                <form onSubmit={handleParseUrl} className="flex items-center gap-2 mb-4">
                  <input
                    type="text"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="Pega el enlace de una Playlist o Álbum de Spotify (https://open.spotify.com/playlist/...)..."
                    className="flex-1 bg-black/50 border border-white/15 rounded-xl px-4 py-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-[#1DB954]"
                  />
                  <button
                    type="submit"
                    disabled={isParsingUrl || !urlInput.trim()}
                    className="px-5 py-2.5 rounded-xl bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-40 text-black font-bold text-xs flex items-center gap-2 cursor-pointer transition"
                  >
                    {isParsingUrl ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Extrayendo...</span>
                      </>
                    ) : (
                      <span>Cargar Canciones</span>
                    )}
                  </button>
                </form>

                {urlParsedData && (
                  <div className="flex-1 flex flex-col overflow-hidden">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3 bg-white/5 p-3 rounded-xl border border-white/10">
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={customPlaylistName}
                          onChange={(e) => setCustomPlaylistName(e.target.value)}
                          className="bg-black/40 border border-white/15 rounded-lg px-3 py-1 text-xs font-semibold text-white"
                        />
                        <span className="text-xs text-neutral-400">
                          ({selectedTrackIndices.size} de {urlParsedData.tracks.length} temas)
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            const chosen = urlParsedData.tracks.filter((_, i) =>
                              selectedTrackIndices.has(i)
                            );
                            startTransfer(chosen, 'likes');
                          }}
                          className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
                        >
                          <Heart className="w-3.5 h-3.5 fill-current" />
                          <span>Dar &ldquo;Me gusta&rdquo; en YT Music</span>
                        </button>

                        <button
                          onClick={() => {
                            const chosen = urlParsedData.tracks.filter((_, i) =>
                              selectedTrackIndices.has(i)
                            );
                            startTransfer(chosen, 'playlist', customPlaylistName);
                          }}
                          className="px-3.5 py-1.5 rounded-lg bg-white text-black hover:bg-neutral-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
                        >
                          <ListMusic className="w-3.5 h-3.5" />
                          <span>Crear Playlist en YT Music</span>
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-1 border border-white/10 rounded-xl p-2 bg-black/30">
                      {urlParsedData.tracks.map((track, idx) => {
                        const selected = selectedTrackIndices.has(idx);
                        return (
                          <div
                            key={idx}
                            onClick={() => toggleTrackSelection(idx)}
                            className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition ${
                              selected ? 'bg-white/10' : 'hover:bg-white/5 opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              {selected ? (
                                <CheckSquare className="w-4 h-4 text-[#1DB954] flex-shrink-0" />
                              ) : (
                                <Square className="w-4 h-4 text-neutral-500 flex-shrink-0" />
                              )}
                              <div className="min-w-0">
                                <p className="text-xs font-medium text-white truncate">
                                  {track.title}
                                </p>
                                <p className="text-[11px] text-neutral-400 truncate">
                                  {track.artist}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
