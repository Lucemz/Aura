import React, { createContext, useContext, useState, useMemo } from 'react';

export type Locale = 'en' | 'es';
export type LocalePreference = 'system' | 'en' | 'es';

export function detectSystemLocale(): Locale {
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
    for (const l of langs) {
      const lower = l.toLowerCase();
      if (lower.startsWith('es')) return 'es';
      if (lower.startsWith('en')) return 'en';
    }
  } catch {}
  return 'en';
}

const translations = {
  en: {
    topBar: {
      back: 'Back',
      forward: 'Forward',
      reload: 'Reload YouTube Music',
      home: 'Home',
      likedSongs: 'Liked Songs',
      likedSongsTooltip: 'Go to Liked Music in YouTube Music',
      signIn: 'Sign In',
      signInTooltip: 'Sign in to your Google / YouTube Music account',
      aiSearchTooltip: 'Smart search by mood, activity, or vibe',
      miniPlayerExpand: 'Expand window',
      miniPlayerCollapse: 'Floating Mini-Player mode',
      settings: 'Settings',
    },
    settings: {
      accountAndLibrary: 'Account & Library',
      connectedAccount: 'Connected Account',
      activeSession: 'Active session',
      signOut: 'Sign out',
      signInGoogle: 'Sign in to Google / YT Music',
      importMusic: 'Import from Spotify / Apple Music',
      playerColor: 'Player Accent Color',
      themeDynamic: 'Dynamic (Artwork)',
      themeViolet: 'Aura Violet',
      themeEmerald: 'Emerald',
      themeCyan: 'Cyan',
      themeRose: 'Coral',
      themeYoutube: 'YT Red',
      aiEngine: 'AI Engine & Quota',
      aiKeyActive: 'API Key Active',
      aiDefaultNoKey: 'Free Keyless',
      aiKeyPlaceholder: 'API Key (Gemini AIza... / OpenAI sk-... / Groq gsk_...)',
      aiModelLabel: 'Model',
      aiQuotaLabel: 'Daily Quota Left',
      aiTokensTodayLabel: 'Tokens Today',
      aiTokens7dLabel: '7-Day Total',
      save: 'Save',
      saved: 'Saved',
      equalizer: 'Real-Time Equalizer',
      presetFlat: 'Original (Flat)',
      presetBass: 'Bass Boost',
      presetVocal: 'Vocal Clarity',
      presetWarm: 'Warm Studio',
      adBlocker: 'Ad & Interruption Blocker',
      active: 'Active',
      paused: 'Paused',
      macShortcuts: 'Mac Media Keys',
      language: 'Language',
      langSystem: 'System',
    },
    aiSearch: {
      placeholder: 'Tune into your frequency, atmosphere, or moment...',
      searchTooltip: 'Search',
      clearTooltip: 'Clear',
      loading: 'Tuning tracks on YouTube Music...',
      likeTooltip: 'Add to Liked Songs',
      errorEmpty: 'No tracks found for that vibe.',
      errorUnavailable: 'Search is currently unavailable.',
    },
    importer: {
      modalTitle: 'Import from Spotify or Apple Music to YouTube Music',
      modalSubtitle:
        'Transfer your favorite tracks and playlists from Spotify or your Mac Music app directly into YouTube Music',
      loginWarning:
        'To save Likes and Playlists into your YouTube Music account, please sign in first.',
      loginButton: 'Sign in to YT Music',
      tabSpotify: 'Spotify (OAuth)',
      tabApple: 'Apple Music (Mac Music App)',
      tabUrl: 'Paste Playlist Link',
      likedSongsCount: 'Liked Songs',
      librarySongsCount: 'Library Songs',
      of: 'of',
      playlistsCount: 'Playlists',
      refresh: 'Refresh',
      switchAccount: 'Switch account',
      selectAll: 'Select all',
      selected: 'selected',
      sendToLikes: 'Send to my YouTube Music Likes',
      createAsPlaylist: 'Create as Playlist on YT Music',
      createPlaylistBtn: 'Create Playlist on YTM',
      sendToLikesShort: 'Send to Likes',
      spotifyAuthTitle: 'Authorize access to your Spotify library',
      spotifyAuthDesc:
        'Clicking below will open the official Spotify (OAuth 2.0) authorization page in your browser to read your Liked Songs and Playlists.',
      spotifyAuthBtn: 'Authorize Spotify permissions',
      spotifyLoading: 'Loading your Spotify library...',
      appleAuthTitle: 'Read library from your Mac Music app',
      appleAuthDesc:
        'Connect directly to the native Music (Apple Music) app on your Mac to import your Favorite Songs, library, and Playlists with zero external tokens.',
      appleAuthBtn: 'Connect to Mac Music app',
      appleLoading: 'Reading your Apple Music library...',
      urlPlaceholder: 'Paste a public Spotify Playlist link (https://open.spotify.com/playlist/...)...',
      urlExtractBtn: 'Extract Tracks',
      urlReading: 'Reading...',
      urlPlaylistNameLabel: 'Name on YT Music:',
      urlEmptyHint:
        'Paste any public Spotify Playlist link above to preview its tracks and transfer them to your YouTube Music account.',
      transferringTitle: 'Syncing with your YouTube Music account...',
      transferDoneTitle: 'Transfer complete!',
      transferSyncedSuffix: 'tracks synced to your YouTube Music account',
      statusQueued: 'Queued',
      statusSyncing: 'Syncing...',
      statusLiked: 'Liked on YTM',
      statusInPlaylist: 'In Playlist',
      statusFailed: 'Failed',
      importMore: '← Import more music',
      viewLikesNow: 'View my Liked Songs on YouTube Music',
      viewPlaylistNow: 'View created Playlist on YouTube Music',
    },
  },
  es: {
    topBar: {
      back: 'Atrás',
      forward: 'Adelante',
      reload: 'Recargar YouTube Music',
      home: 'Inicio',
      likedSongs: 'Mis Me Gusta',
      likedSongsTooltip: 'Ir a Música que me gusta dentro de YouTube Music',
      signIn: 'Iniciar Sesión',
      signInTooltip: 'Iniciar sesión en tu cuenta de Google / YouTube Music',
      aiSearchTooltip: 'Búsqueda inteligente por momento o atmósfera',
      miniPlayerExpand: 'Expandir ventana',
      miniPlayerCollapse: 'Modo Mini-Player Flotante',
      settings: 'Configuraciones',
    },
    settings: {
      accountAndLibrary: 'Cuenta y Biblioteca',
      connectedAccount: 'Cuenta Conectada',
      activeSession: 'Sesión activa',
      signOut: 'Cerrar sesión',
      signInGoogle: 'Iniciar sesión en Google / YT Music',
      importMusic: 'Importar de Spotify / Apple Music',
      playerColor: 'Color del Reproductor',
      themeDynamic: 'Dinámico (Canción)',
      themeViolet: 'Aura Violeta',
      themeEmerald: 'Esmeralda',
      themeCyan: 'Cian',
      themeRose: 'Coral',
      themeYoutube: 'Rojo YT',
      aiEngine: 'Motor IA y Cuota',
      aiKeyActive: 'Con API Key',
      aiDefaultNoKey: 'Gratis Sin Key',
      aiKeyPlaceholder: 'API Key (Gemini AIza... / OpenAI sk-... / Groq gsk_...)',
      aiModelLabel: 'Modelo',
      aiQuotaLabel: 'Cuota disponible hoy',
      aiTokensTodayLabel: 'Tokens hoy',
      aiTokens7dLabel: 'Últimos 7 días',
      save: 'Guardar',
      saved: 'Listo',
      equalizer: 'Ecualizador en Tiempo Real',
      presetFlat: 'Original (Plano)',
      presetBass: 'Bass Boost',
      presetVocal: 'Claridad Vocal',
      presetWarm: 'Estudio Cálido',
      adBlocker: 'Bloqueador de anuncios y cortes',
      active: 'Activo',
      paused: 'Pausado',
      macShortcuts: 'Atajos físicos de Mac',
      language: 'Idioma',
      langSystem: 'Sistema',
    },
    aiSearch: {
      placeholder: 'Sintoniza tu frecuencia, atmósfera o momento...',
      searchTooltip: 'Buscar',
      clearTooltip: 'Limpiar',
      loading: 'Sintonizando pistas en YouTube Music...',
      likeTooltip: 'Agregar a Mis Me gusta',
      errorEmpty: 'No se encontraron pistas para esa frecuencia.',
      errorUnavailable: 'Búsqueda no disponible en este momento.',
    },
    importer: {
      modalTitle: 'Importar de Spotify o Apple Music a YouTube Music',
      modalSubtitle:
        'Transfiere tus canciones favoritas y Playlists desde Spotify o desde la app nativa Música de tu Mac hacia YouTube Music',
      loginWarning:
        'Para que los Likes y Playlists se guarden en tu cuenta real de YouTube Music, inicia sesión primero.',
      loginButton: 'Iniciar sesión en YT Music',
      tabSpotify: 'Spotify (OAuth)',
      tabApple: 'Apple Music (App Música Mac)',
      tabUrl: 'Pegar Link de Playlist',
      likedSongsCount: 'Canciones que te gustan',
      librarySongsCount: 'Canciones de tu Biblioteca',
      of: 'de',
      playlistsCount: 'Playlists',
      refresh: 'Actualizar',
      switchAccount: 'Cambiar cuenta',
      selectAll: 'Seleccionar todas',
      selected: 'seleccionadas',
      sendToLikes: 'Enviar a mis “Me gusta” de YouTube Music',
      createAsPlaylist: 'Crear como Playlist en YT Music',
      createPlaylistBtn: 'Crear Playlist en YTM',
      sendToLikesShort: 'Enviar a mis Likes',
      spotifyAuthTitle: 'Autorizar acceso a tu biblioteca de Spotify',
      spotifyAuthDesc:
        'Al hacer clic abajo se abrirá la pantalla oficial de permisos de Spotify (OAuth 2.0) en tu navegador para leer tus Canciones que te gustan y Playlists.',
      spotifyAuthBtn: 'Autorizar permisos en Spotify',
      spotifyLoading: 'Cargando tu biblioteca de Spotify...',
      appleAuthTitle: 'Leer biblioteca desde la app Música de tu Mac',
      appleAuthDesc:
        'Conecta directamente con la app nativa Música (Apple Music) instalada en tu Mac para importar tus Canciones Favoritas, biblioteca y Playlists sin tokens externos.',
      appleAuthBtn: 'Conectar con la app Música de mi Mac',
      appleLoading: 'Leyendo tu biblioteca de Apple Music...',
      urlPlaceholder: 'Pega el enlace de una Playlist de Spotify (https://open.spotify.com/playlist/...)...',
      urlExtractBtn: 'Extraer Canciones',
      urlReading: 'Leyendo...',
      urlPlaylistNameLabel: 'Nombre en YT Music:',
      urlEmptyHint:
        'Pega cualquier link de Playlist de Spotify arriba para ver sus canciones y transferirlas a tu cuenta de YouTube Music.',
      transferringTitle: 'Sincronizando con tu cuenta real de YouTube Music...',
      transferDoneTitle: '¡Transferencia completada!',
      transferSyncedSuffix: 'canciones sincronizadas en tu cuenta de YouTube Music',
      statusQueued: 'En cola',
      statusSyncing: 'Sincronizando...',
      statusLiked: 'Like en YT Music',
      statusInPlaylist: 'En Playlist',
      statusFailed: 'Falló',
      importMore: '← Importar más música',
      viewLikesNow: 'Ver mis “Me gusta” en YouTube Music ahora',
      viewPlaylistNow: 'Ver Playlist creada en YouTube Music ahora',
    },
  },
};

export type Translations = typeof translations.en;

interface I18nContextValue {
  locale: Locale;
  preference: LocalePreference;
  setPreference: (pref: LocalePreference) => void;
  t: Translations;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  preference: 'system',
  setPreference: () => {},
  t: translations.en,
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [preference, setPreferenceState] = useState<LocalePreference>(() => {
    try {
      const saved = localStorage.getItem('__aura_locale_pref') as LocalePreference | null;
      if (saved === 'en' || saved === 'es' || saved === 'system') return saved;
    } catch {}
    return 'system';
  });

  const setPreference = (pref: LocalePreference) => {
    setPreferenceState(pref);
    try {
      localStorage.setItem('__aura_locale_pref', pref);
    } catch {}
  };

  const locale: Locale = useMemo(() => {
    if (preference === 'en' || preference === 'es') return preference;
    return detectSystemLocale();
  }, [preference]);

  const value = useMemo(
    () => ({
      locale,
      preference,
      setPreference,
      t: translations[locale] || translations.en,
    }),
    [locale, preference]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => useContext(I18nContext);
