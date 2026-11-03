export type AudioPreset = 'flat' | 'bass' | 'vocal' | 'warm';

export interface UserProfile {
  loggedIn: boolean;
  name?: string;
  email?: string;
  avatar?: string;
}

export interface ImportedTrack {
  id?: string;
  title: string;
  artist: string;
  album?: string;
  thumbnail?: string;
}

export interface ImportedPlaylist {
  id: string;
  provider: 'spotify' | 'apple';
  title: string;
  description?: string;
  trackCount: number;
  thumbnail?: string;
  tracks?: ImportedTrack[];
}

export interface ImportedAlbum {
  id: string;
  provider: 'spotify' | 'apple';
  title: string;
  artist: string;
  trackCount: number;
  thumbnail?: string;
  tracks?: ImportedTrack[];
}

export interface ProviderLibraryResult {
  ok: boolean;
  error?: string;
  profile?: {
    name: string;
    avatar: string;
  } | null;
  totalLiked?: number;
  likedSongs: ImportedTrack[];
  playlists: ImportedPlaylist[];
  albums: ImportedAlbum[];
}

export interface TransferLogItem {
  title: string;
  artist: string;
  status: 'pending' | 'searching' | 'synced' | 'failed';
  matchedTitle?: string;
  videoId?: string;
  error?: string;
}

export interface AISongRecommendation {
  videoId: string;
  title: string;
  artist: string;
  reason: string;
  thumbnail: string;
}

export interface AISearchResponse {
  ok: boolean;
  provider?: string;
  tokensUsed?: number;
  error?: string;
  songs: AISongRecommendation[];
  status?: AIStatusInfo;
}

export type AIModelId =
  | 'free-default'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  | 'gpt-4o-mini'
  | 'llama-3.3-70b';

export interface AIStatusInfo {
  selectedModel: AIModelId;
  activeModel: AIModelId;
  activeModelName: string;
  provider: string;
  hasApiKey: boolean;
  apiKey: string;
  usingApiKey: boolean;
  requestsToday: number;
  dailyQuotaLimit: number;
  remainingQuota: number;
  rpmLimit: number;
  tokensToday: number;
  lastTokens: number;
  tokensLast7Days: number;
  requestsLast7Days: number;
  trackedDaysCount: number;
}

declare global {
  interface Window {
    auraAPI?: {
      getUserProfile: () => Promise<UserProfile>;
      getSapisidAuthHeader: () => Promise<string | null>;
      openGoogleLogin: () => Promise<boolean>;
      logout: () => Promise<boolean>;
      onAuthSuccess: (callback: () => void) => () => void;

      connectSpotify: (forceReauth?: boolean) => Promise<ProviderLibraryResult>;
      getCachedSpotify: () => Promise<ProviderLibraryResult>;
      getSpotifyPlaylistTracks: (playlistId: string) => Promise<ImportedTrack[]>;
      connectAppleMusic: () => Promise<ProviderLibraryResult>;
      getApplePlaylistTracks: (playlistId: string) => Promise<ImportedTrack[]>;
      parseExternalMusicUrl: (url: string) => Promise<{
        ok: boolean;
        provider?: 'spotify' | 'apple';
        title?: string;
        thumbnail?: string;
        tracks?: ImportedTrack[];
        error?: string;
      }>;

      searchYouTubeMusicTrack: (
        title: string,
        artist: string
      ) => Promise<{
        videoId: string;
        title: string;
        artist: string;
        thumbnail: string;
      } | null>;
      playYouTubeMusicVideo?: (videoId: string) => Promise<boolean>;
      aiRecommendSongs?: (prompt: string) => Promise<AISearchResponse>;
      getAiApiKey?: () => Promise<string>;
      setAiApiKey?: (apiKey: string) => Promise<boolean>;
      getAiStatus?: () => Promise<AIStatusInfo>;
      saveAiConfig?: (model: AIModelId, apiKey: string) => Promise<AIStatusInfo>;
      likeSongOnYouTubeMusic: (videoId: string) => Promise<{ ok: boolean; error?: string }>;
      createPlaylistOnYouTubeMusic: (
        title: string,
        description: string,
        videoIds?: string[]
      ) => Promise<{ ok: boolean; playlistId?: string; error?: string }>;
      addVideosToYouTubePlaylist: (
        playlistId: string,
        videoIds: string[]
      ) => Promise<{ ok: boolean; error?: string }>;

      toggleMiniPlayer: () => Promise<boolean>;
      isMiniPlayer: () => Promise<boolean>;
      onMediaKey: (
        action: 'toggle-play' | 'next' | 'previous',
        callback: () => void
      ) => () => void;

      // Native Safari WKWebView bridge methods
      isSafariEngine?: boolean;
      setOverlayExpanded?: (expanded: boolean) => void;
      webviewGoBack?: () => void;
      webviewGoForward?: () => void;
      webviewReload?: () => void;
      webviewLoadURL?: (url: string) => void;
      webviewEvalJS?: (code: string) => Promise<any>;
    };
  }
}
