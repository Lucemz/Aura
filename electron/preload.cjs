const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('auraAPI', {
  // Auth & Profile for YouTube Music
  getUserProfile: () => ipcRenderer.invoke('auth:get-profile'),
  getSapisidAuthHeader: () => ipcRenderer.invoke('auth:get-sapisid-header'),
  openGoogleLogin: () => ipcRenderer.invoke('auth:open-google-login'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  onAuthSuccess: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('auth:success', listener);
    return () => ipcRenderer.removeListener('auth:success', listener);
  },

  // Music Importer (Spotify, Apple Music, External URLs -> Real YouTube Music Account)
  connectSpotify: () => ipcRenderer.invoke('importer:connect-spotify'),
  getSpotifyPlaylistTracks: (playlistId) =>
    ipcRenderer.invoke('importer:get-spotify-playlist-tracks', playlistId),
  connectAppleMusic: () => ipcRenderer.invoke('importer:connect-apple'),
  getApplePlaylistTracks: (playlistId) =>
    ipcRenderer.invoke('importer:get-apple-playlist-tracks', playlistId),
  parseExternalMusicUrl: (url) => ipcRenderer.invoke('importer:parse-url', url),

  // Real YouTube Music Account Write Actions
  searchYouTubeMusicTrack: (title, artist) =>
    ipcRenderer.invoke('importer:search-ytm-track', title, artist),
  likeSongOnYouTubeMusic: (videoId) => ipcRenderer.invoke('importer:like-on-ytm', videoId),
  createPlaylistOnYouTubeMusic: (title, description, videoIds) =>
    ipcRenderer.invoke('importer:create-playlist-on-ytm', title, description, videoIds),
  addVideosToYouTubePlaylist: (playlistId, videoIds) =>
    ipcRenderer.invoke('importer:add-to-playlist-on-ytm', playlistId, videoIds),

  // Window & Media Keys
  toggleMiniPlayer: () => ipcRenderer.invoke('window:toggle-mini'),
  isMiniPlayer: () => ipcRenderer.invoke('window:is-mini'),
  onMediaKey: (action, callback) => {
    const channel = `player:${action}`;
    const listener = () => callback();
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
