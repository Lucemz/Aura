import Foundation

@MainActor
final class AppleMusicService {
    static let shared = AppleMusicService()

    /// Reads the user's native macOS `Music.app` (`Música`) library and playlists via JXA (`osascript -l JavaScript`)
    func fetchLibrary() async -> [String: Any] {
        let jxaScript = """
        (function() {
          try {
            const music = Application("Music");
            const rawPlaylists = music.userPlaylists();
            const playlists = [];
            let favTracks = [];
            let allTracks = [];
            const seenKeys = new Set();

            function extractTracksFromPlaylist(pl) {
              try {
                const names = pl.tracks.name();
                const artists = pl.tracks.artist();
                const albums = pl.tracks.album();
                const out = [];
                for (let i = 0; i < names.length; i++) {
                  const title = String(names[i] || "").trim();
                  if (!title) continue;
                  const artist = String(artists[i] || "").trim();
                  const album = String(albums[i] || "").trim();
                  out.push({ title, artist, album });
                }
                return out;
              } catch (e) {
                return [];
              }
            }

            for (let i = 0; i < rawPlaylists.length; i++) {
              const p = rawPlaylists[i];
              let id = "";
              let name = "";
              let count = 0;
              try { id = String(p.persistentID()); } catch (e) {}
              try { name = String(p.name()); } catch (e) {}
              try { count = p.tracks.length; } catch (e) {}
              if (!id || !name || count <= 0) continue;

              const isFav = /^(favourite songs|favorite songs|canciones favoritas|favoritas|me gusta)$/i.test(name);
              const isRootMusic = /^(music|música|musica)$/i.test(name);

              playlists.push({
                id: id,
                provider: "apple",
                title: isRootMusic ? (name + " (Biblioteca Completa)") : name,
                description: isFav ? "Favoritas en Apple Music" : (isRootMusic ? "Toda tu biblioteca" : "Playlist de Apple Music"),
                trackCount: count,
                thumbnail: ""
              });

              if (isFav && favTracks.length === 0) {
                favTracks = extractTracksFromPlaylist(p);
              } else if (isRootMusic && allTracks.length === 0) {
                allTracks = extractTracksFromPlaylist(p);
              }
            }

            // Combine Favourite Songs first, then the rest of the library without duplicates
            const combined = [];
            for (const t of favTracks) {
              const key = (t.title + "|" + t.artist).toLowerCase();
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                combined.push(t);
              }
            }
            for (const t of allTracks) {
              const key = (t.title + "|" + t.artist).toLowerCase();
              if (!seenKeys.has(key)) {
                seenKeys.add(key);
                combined.push(t);
              }
            }

            return JSON.stringify({
              ok: true,
              profile: {
                name: "App Música (macOS)",
                avatar: ""
              },
              totalLiked: combined.length,
              likedSongs: combined,
              playlists: playlists,
              albums: []
            });
          } catch (err) {
            return JSON.stringify({
              ok: false,
              error: "No se pudo leer la app Música de tu Mac: " + String(err.message || err),
              likedSongs: [],
              playlists: [],
              albums: []
            });
          }
        })();
        """

        if let output = await runJXA(script: jxaScript),
           let data = output.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return parsed
        }

        return [
            "ok": false,
            "error": "Asegúrate de tener la app Música instalada y darle permiso a Aura cuando macOS lo solicite.",
            "likedSongs": [],
            "playlists": [],
            "albums": [],
        ]
    }

    /// Reads all tracks of a specific playlist in `Music.app` by its `persistentID`
    func fetchPlaylistTracks(playlistId: String) async -> [[String: Any]] {
        let safeId = playlistId.replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "'", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !safeId.isEmpty else { return [] }

        let jxaScript = """
        (function() {
          try {
            const music = Application("Music");
            const pls = music.userPlaylists();
            let target = null;
            for (let i = 0; i < pls.length; i++) {
              if (String(pls[i].persistentID()) === "\(safeId)") {
                target = pls[i];
                break;
              }
            }
            if (!target) return JSON.stringify([]);
            const names = target.tracks.name();
            const artists = target.tracks.artist();
            const albums = target.tracks.album();
            const out = [];
            for (let i = 0; i < names.length; i++) {
              const title = String(names[i] || "").trim();
              if (!title) continue;
              out.push({
                title: title,
                artist: String(artists[i] || "").trim(),
                album: String(albums[i] || "").trim()
              });
            }
            return JSON.stringify(out);
          } catch (e) {
            return JSON.stringify([]);
          }
        })();
        """

        if let output = await runJXA(script: jxaScript),
           let data = output.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            return parsed
        }
        return []
    }

    private func runJXA(script: String) async -> String? {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                let proc = Process()
                proc.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
                proc.arguments = ["-l", "JavaScript", "-e", script]

                let outPipe = Pipe()
                proc.standardOutput = outPipe
                proc.standardError = FileHandle.nullDevice

                do {
                    try proc.run()
                    proc.waitUntilExit()
                    let data = outPipe.fileHandleForReading.readDataToEndOfFile()
                    let str = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                    continuation.resume(returning: str)
                } catch {
                    continuation.resume(returning: nil)
                }
            }
        }
    }
}
