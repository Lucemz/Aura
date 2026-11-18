import Cocoa
import Foundation
import Network

private final class OnceFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false

    func trySet() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if flag { return false }
        flag = true
        return true
    }
}

actor SpotifyService {
    static let shared = SpotifyService()
    private var accessToken: String?
    private var refreshToken: String?
    private var activeListener: NWListener?
    private var activeFinish: (@Sendable ([String: Any]) -> Void)?
    private var activeTimeoutTask: Task<Void, Never>?
    private var oauthGeneration: Int = 0

    func getValidToken() async -> String? {
        let fileURL = AppConfig.spotifyTokenFileURL
        if let data = try? Data(contentsOf: fileURL),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            let token = json["accessToken"] as? String
            let refresh = json["refreshToken"] as? String
            let expiresAt = json["expiresAt"] as? Double ?? 0
            self.accessToken = token
            self.refreshToken = refresh

            let nowMs = Date().timeIntervalSince1970 * 1000
            if let token = token, nowMs < (expiresAt - 60000) {
                return token
            }
            if let refresh = refresh, let refreshed = await refreshSpotifyToken(refresh) {
                return refreshed
            }
        }
        return accessToken
    }

    private func saveTokenData(accessToken: String, refreshToken: String?, expiresIn: Double) {
        self.accessToken = accessToken
        if let r = refreshToken { self.refreshToken = r }
        let payload: [String: Any] = [
            "accessToken": accessToken,
            "refreshToken": self.refreshToken ?? "",
            "expiresAt": (Date().timeIntervalSince1970 + expiresIn) * 1000,
        ]
        if let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted]) {
            AppConfig.writeSecureData(data, to: AppConfig.spotifyTokenFileURL)
        }
    }

    private func refreshSpotifyToken(_ refresh: String) async -> String? {
        guard let url = URL(string: "https://accounts.spotify.com/api/token") else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        req.setValue(AppConfig.safariUserAgent, forHTTPHeaderField: "User-Agent")

        var comps = URLComponents()
        comps.queryItems = [
            URLQueryItem(name: "client_id", value: AppConfig.Spotify.clientId),
            URLQueryItem(name: "grant_type", value: "refresh_token"),
            URLQueryItem(name: "refresh_token", value: refresh),
        ]
        req.httpBody = comps.percentEncodedQuery?.data(using: .utf8)

        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let newToken = json["access_token"] as? String else {
            return nil
        }
        let newRefresh = (json["refresh_token"] as? String) ?? refresh
        let expiresIn = (json["expires_in"] as? Double) ?? 3600
        saveTokenData(accessToken: newToken, refreshToken: newRefresh, expiresIn: expiresIn)
        return newToken
    }

    func queryPathfinder(
        token: String,
        operationName: String,
        sha256Hash: String,
        variables: [String: Any],
        retried: Bool = false
    ) async -> [String: Any]? {
        guard let url = URL(string: "https://api-partner.spotify.com/pathfinder/v1/query") else {
            return nil
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(AppConfig.safariUserAgent, forHTTPHeaderField: "User-Agent")

        let bodyObj: [String: Any] = [
            "variables": variables,
            "operationName": operationName,
            "extensions": [
                "persistedQuery": [
                    "version": 1,
                    "sha256Hash": sha256Hash,
                ]
            ],
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: bodyObj)

        guard let (data, response) = try? await URLSession.shared.data(for: req) else {
            return nil
        }
        if let http = response as? HTTPURLResponse, http.statusCode == 401, !retried {
            if let refresh = self.refreshToken,
               let newToken = await refreshSpotifyToken(refresh) {
                return await queryPathfinder(
                    token: newToken,
                    operationName: operationName,
                    sha256Hash: sha256Hash,
                    variables: variables,
                    retried: true
                )
            }
            return nil
        }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return json
    }

    func fetchUserLibrary(token: String? = nil) async -> [String: Any] {
        guard let activeToken = token != nil ? token : await getValidToken() else {
            return ["ok": false, "likedSongs": [], "playlists": [], "albums": []]
        }

        async let profTask = queryPathfinder(
            token: activeToken,
            operationName: "profileAttributes",
            sha256Hash: AppConfig.Spotify.GraphQLHashes.profileAttributes,
            variables: [:]
        )
        async let firstTracksTask = queryPathfinder(
            token: activeToken,
            operationName: "fetchLibraryTracks",
            sha256Hash: AppConfig.Spotify.GraphQLHashes.fetchLibraryTracks,
            variables: ["offset": 0, "limit": 100]
        )

        let (profRes, firstTracksPage) = await (profTask, firstTracksTask)

        let profData = ((profRes?["data"] as? [String: Any])?["me"] as? [String: Any])?["profile"] as? [String: Any]
        let name = (profData?["name"] as? String) ?? (AppConfig.isSpanishSystem ? "Usuario Spotify" : "Spotify User")
        let username =
            (profData?["username"] as? String)
            ?? ((profData?["uri"] as? String)?.components(separatedBy: ":").last ?? "")
        let avatarSources = (profData?["avatar"] as? [String: Any])?["sources"] as? [[String: Any]]
        let avatarUrl = avatarSources?.first?["url"] as? String ?? ""

        let tracksContainer =
            (((firstTracksPage?["data"] as? [String: Any])?["me"] as? [String: Any])?["library"] as? [String: Any])?[
                "tracks"
            ] as? [String: Any]
        let firstItems = (tracksContainer?["items"] as? [[String: Any]]) ?? []
        let totalLiked = (tracksContainer?["totalCount"] as? Int) ?? firstItems.count

        var allTrackItems = firstItems
        if totalLiked > 100 {
            let offsets = Array(stride(from: 100, to: totalLiked, by: 100))
            let extraItems = await fetchPagedItems(offsets: offsets) { [self] off in
                guard let page = await self.queryPathfinder(
                    token: activeToken,
                    operationName: "fetchLibraryTracks",
                    sha256Hash: AppConfig.Spotify.GraphQLHashes.fetchLibraryTracks,
                    variables: ["offset": off, "limit": 100]
                ) else {
                    return []
                }
                let tc =
                    (((page["data"] as? [String: Any])?["me"] as? [String: Any])?["library"] as? [String: Any])?[
                        "tracks"
                    ] as? [String: Any]
                return (tc?["items"] as? [[String: Any]]) ?? []
            }
            allTrackItems.append(contentsOf: extraItems)
        }

        var likedSongs: [[String: Any]] = []
        for (idx, item) in allTrackItems.enumerated() {
            guard let trackObj = item["track"] as? [String: Any],
                  let tData = trackObj["data"] as? [String: Any],
                  let trackTitle = tData["name"] as? String else { continue }
            let artistItems = (tData["artists"] as? [String: Any])?["items"] as? [[String: Any]] ?? []
            let artists = artistItems.compactMap { ($0["profile"] as? [String: Any])?["name"] as? String }.joined(
                separator: ", "
            )
            let albumObj = tData["albumOfTrack"] as? [String: Any]
            let albumName = (albumObj?["name"] as? String) ?? ""
            let coverSources = (albumObj?["coverArt"] as? [String: Any])?["sources"] as? [[String: Any]]
            let coverUrl = (coverSources?.first?["url"] as? String) ?? ""
            let uri = (trackObj["_uri"] as? String) ?? "sp-liked-\(idx)"

            likedSongs.append([
                "id": uri,
                "title": trackTitle,
                "artist": artists.isEmpty ? (AppConfig.isSpanishSystem ? "Artista" : "Artist") : artists,
                "album": albumName,
                "thumbnail": coverUrl,
            ])
        }

        // Fetch User Playlists via spclient rootlist
        var playlists: [[String: Any]] = []
        if !username.isEmpty,
           let encodedUser = username.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
           let rootUrl = URL(
               string:
                   "https://spclient.wg.spotify.com/playlist/v2/user/\(encodedUser)/rootlist?decorate=revision,length,attributes,timestamp,owner"
           ) {
            var req = URLRequest(url: rootUrl)
            req.setValue("Bearer \(activeToken)", forHTTPHeaderField: "Authorization")
            req.setValue("application/json", forHTTPHeaderField: "Accept")
            req.setValue(AppConfig.safariUserAgent, forHTTPHeaderField: "User-Agent")

            if let (data, _) = try? await URLSession.shared.data(for: req),
               let rootJson = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let contents = rootJson["contents"] as? [String: Any] {
                let rawItems = (contents["items"] as? [[String: Any]]) ?? []
                let metaItems = (contents["metaItems"] as? [[String: Any]]) ?? []

                var userCreated: [[String: Any]] = []
                var others: [[String: Any]] = []

                for i in 0..<rawItems.count {
                    guard let uri = rawItems[i]["uri"] as? String,
                          uri.hasPrefix("spotify:playlist:") else { continue }
                    let plId = uri.components(separatedBy: ":").last ?? ""
                    let meta = i < metaItems.count ? metaItems[i] : [:]
                    let attrs = (meta["attributes"] as? [String: Any]) ?? [:]
                    guard let title = attrs["name"] as? String, !title.isEmpty else { continue }

                    let picSizes = (attrs["pictureSize"] as? [[String: Any]]) ?? []
                    let thumbUrl =
                        (picSizes.first(where: { ($0["targetName"] as? String) == "default" })?["url"] as? String)
                        ?? (picSizes.first?["url"] as? String)
                        ?? ""
                    let isMine = (meta["ownerUsername"] as? String) == username
                    let trackCount = (meta["length"] as? Int) ?? 0

                    let plObj: [String: Any] = [
                        "id": plId,
                        "provider": "spotify",
                        "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
                        "description": AppConfig.isSpanishSystem
                            ? (isMine ? "Creada por ti" : "Playlist guardada")
                            : (isMine ? "Created by you" : "Saved playlist"),
                        "isOwner": isMine,
                        "trackCount": trackCount,
                        "thumbnail": thumbUrl,
                    ]
                    if isMine {
                        userCreated.append(plObj)
                    } else {
                        others.append(plObj)
                    }
                }
                playlists.append(contentsOf: userCreated)
                playlists.append(contentsOf: others)
            }
        }

        return [
            "ok": !likedSongs.isEmpty || !playlists.isEmpty,
            "profile": [
                "name": name,
                "avatar": avatarUrl,
            ],
            "totalLiked": likedSongs.count,
            "likedSongs": likedSongs,
            "playlists": playlists,
            "albums": [],
        ]
    }

    func fetchPlaylistTracks(playlistId: String) async -> [[String: Any]] {
        return await fetchPlaylistWithMetadata(playlistId: playlistId).tracks
    }

    private func fetchPlaylistWithMetadata(playlistId: String) async -> (
        title: String?,
        thumbnail: String?,
        tracks: [[String: Any]]
    ) {
        guard let activeToken = await getValidToken() else { return (nil, nil, []) }
        let uri = playlistId.hasPrefix("spotify:playlist:") ? playlistId : "spotify:playlist:\(playlistId)"
        let firstRes = await queryPathfinder(
            token: activeToken,
            operationName: "fetchPlaylist",
            sha256Hash: AppConfig.Spotify.GraphQLHashes.fetchPlaylist,
            variables: [
                "uri": uri,
                "offset": 0,
                "limit": 100,
                "enableWatchFeedEntrypoint": false,
            ]
        )
        let playlistV2 = (firstRes?["data"] as? [String: Any])?["playlistV2"] as? [String: Any]
        let plTitle = ((playlistV2?["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines))
            .flatMap { $0.isEmpty ? nil : $0 }
        let plThumb = ((((playlistV2?["images"] as? [String: Any])?["items"] as? [[String: Any]])?
            .first?["sources"] as? [[String: Any]])?.first?["url"] as? String)
            .flatMap { $0.isEmpty ? nil : $0 }
        let content = playlistV2?["content"] as? [String: Any]
        let totalCount = (content?["totalCount"] as? Int) ?? 0
        var allItems = (content?["items"] as? [[String: Any]]) ?? []

        if totalCount > 100 {
            let offsets = Array(stride(from: 100, to: totalCount, by: 100))
            let extraItems = await fetchPagedItems(offsets: offsets) { [self] off in
                guard let p = await self.queryPathfinder(
                    token: activeToken,
                    operationName: "fetchPlaylist",
                    sha256Hash: AppConfig.Spotify.GraphQLHashes.fetchPlaylist,
                    variables: [
                        "uri": uri,
                        "offset": off,
                        "limit": 100,
                        "enableWatchFeedEntrypoint": false,
                    ]
                ) else {
                    return []
                }
                let c =
                    ((p["data"] as? [String: Any])?["playlistV2"] as? [String: Any])?["content"] as? [String: Any]
                return (c?["items"] as? [[String: Any]]) ?? []
            }
            allItems.append(contentsOf: extraItems)
        }

        var tracks: [[String: Any]] = []
        for it in allItems {
            guard let itemV2 = it["itemV2"] as? [String: Any],
                  let tData = itemV2["data"] as? [String: Any],
                  let title = tData["name"] as? String else { continue }
            let artistItems = (tData["artists"] as? [String: Any])?["items"] as? [[String: Any]] ?? []
            let artists = artistItems.compactMap { ($0["profile"] as? [String: Any])?["name"] as? String }.joined(
                separator: ", "
            )
            let albumObj = tData["albumOfTrack"] as? [String: Any]
            let albumName = (albumObj?["name"] as? String) ?? ""
            let coverSources = (albumObj?["coverArt"] as? [String: Any])?["sources"] as? [[String: Any]]
            let coverUrl = (coverSources?.first?["url"] as? String) ?? ""

            tracks.append([
                "title": title,
                "artist": artists.isEmpty ? (AppConfig.isSpanishSystem ? "Artista" : "Artist") : artists,
                "album": albumName,
                "thumbnail": coverUrl,
            ])
        }
        return (plTitle, plThumb, tracks)
    }

    private func fetchPagedItems(
        offsets: [Int],
        maxConcurrent: Int = 6,
        fetchPage: @escaping @Sendable (Int) async -> [[String: Any]]
    ) async -> [[String: Any]] {
        guard !offsets.isEmpty else { return [] }
        var paged: [(Int, [[String: Any]])] = []
        await withTaskGroup(of: (Int, [[String: Any]]).self) { group in
            var nextIndex = 0
            let initial = min(maxConcurrent, offsets.count)
            for _ in 0..<initial {
                let off = offsets[nextIndex]
                nextIndex += 1
                group.addTask {
                    (off, await fetchPage(off))
                }
            }
            while let result = await group.next() {
                paged.append(result)
                if nextIndex < offsets.count {
                    let off = offsets[nextIndex]
                    nextIndex += 1
                    group.addTask {
                        (off, await fetchPage(off))
                    }
                }
            }
        }
        paged.sort { $0.0 < $1.0 }
        var merged: [[String: Any]] = []
        for (_, items) in paged {
            merged.append(contentsOf: items)
        }
        return merged
    }

    func parsePublicSpotifyUrl(_ rawUrl: String) async -> [String: Any] {
        let trimmed = rawUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let regex = try? NSRegularExpression(pattern: "(playlist|album|track)/([a-zA-Z0-9]+)"),
              let match = regex.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..., in: trimmed)),
              let typeRange = Range(match.range(at: 1), in: trimmed),
              let idRange = Range(match.range(at: 2), in: trimmed) else {
            return [
                "ok": false,
                "error": AppConfig.isSpanishSystem
                    ? "Ingresa un enlace válido de Spotify (playlist, álbum o canción)."
                    : "Enter a valid Spotify link (playlist, album, or track).",
            ]
        }

        let type = String(trimmed[typeRange])
        let id = String(trimmed[idRange])

        if type == "playlist" {
            let meta = await fetchPlaylistWithMetadata(playlistId: id)
            if !meta.tracks.isEmpty {
                return [
                    "ok": true,
                    "provider": "spotify",
                    "title": meta.title ?? "Spotify Playlist",
                    "thumbnail": meta.thumbnail ?? (meta.tracks.first?["thumbnail"] as? String) ?? "",
                    "tracks": meta.tracks,
                ]
            }
        }

        guard let embedUrl = URL(string: "https://open.spotify.com/embed/\(type)/\(id)") else {
            return [
                "ok": false,
                "error": AppConfig.isSpanishSystem
                    ? "Enlace de Spotify inválido."
                    : "Invalid Spotify link.",
            ]
        }

        var req = URLRequest(url: embedUrl)
        req.timeoutInterval = 15
        req.setValue(AppConfig.safariUserAgent, forHTTPHeaderField: "User-Agent")

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let html = String(data: data, encoding: .utf8),
              let scriptRegex = try? NSRegularExpression(
                  pattern: "<script id=\"__NEXT_DATA__\" type=\"application/json\">([\\s\\S]*?)</script>"
              ),
              let scriptMatch = scriptRegex.firstMatch(in: html, range: NSRange(html.startIndex..., in: html)),
              let jsonRange = Range(scriptMatch.range(at: 1), in: html),
              let jsonData = String(html[jsonRange]).data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let props = root["props"] as? [String: Any],
              let pageProps = props["pageProps"] as? [String: Any],
              let state = pageProps["state"] as? [String: Any],
              let dataObj = state["data"] as? [String: Any],
              let entity = dataObj["entity"] as? [String: Any] else {
            return [
                "ok": false,
                "error": AppConfig.isSpanishSystem
                    ? "No se pudo leer ese enlace público de Spotify."
                    : "Could not load that public Spotify link.",
            ]
        }

        let title = (entity["name"] as? String) ?? (entity["title"] as? String) ?? "Spotify Playlist"
        let coverSources = (entity["coverArt"] as? [String: Any])?["sources"] as? [[String: Any]]
        let thumb = (coverSources?.first?["url"] as? String) ?? ""

        var tracks: [[String: Any]] = []
        if let trackList = entity["trackList"] as? [[String: Any]] {
            for item in trackList {
                guard let trackTitle = item["title"] as? String, !trackTitle.isEmpty else { continue }
                let artist = (item["subtitle"] as? String) ?? (AppConfig.isSpanishSystem ? "Artista" : "Artist")
                tracks.append([
                    "title": trackTitle,
                    "artist": artist,
                    "album": title,
                    "thumbnail": thumb,
                ])
            }
        }

        if tracks.isEmpty, type == "track",
           let singleTitle = (entity["name"] as? String) ?? (entity["title"] as? String),
           !singleTitle.isEmpty {
            let artistNames = ((entity["artists"] as? [[String: Any]]) ?? [])
                .compactMap { $0["name"] as? String }
                .joined(separator: ", ")
            let artist = artistNames.isEmpty
                ? ((entity["subtitle"] as? String) ?? (AppConfig.isSpanishSystem ? "Artista" : "Artist"))
                : artistNames
            tracks.append([
                "title": singleTitle,
                "artist": artist,
                "album": "",
                "thumbnail": thumb,
            ])
        }

        guard !tracks.isEmpty else {
            return [
                "ok": false,
                "error": AppConfig.isSpanishSystem
                    ? "No se encontraron canciones en ese enlace de Spotify."
                    : "No tracks found in that Spotify link.",
            ]
        }

        return [
            "ok": true,
            "provider": "spotify",
            "title": title,
            "thumbnail": thumb,
            "tracks": tracks,
        ]
    }

    private func clearActiveOAuthIfMatching(_ listener: NWListener) {
        if activeListener === listener {
            activeListener = nil
            activeFinish = nil
            activeTimeoutTask?.cancel()
            activeTimeoutTask = nil
        }
    }

    func connectOAuth(forceReauth: Bool) async -> [String: Any] {
        if !forceReauth {
            let cached = await fetchUserLibrary()
            if (cached["ok"] as? Bool) == true {
                return cached
            }
        }

        oauthGeneration += 1
        let currentGeneration = oauthGeneration

        activeTimeoutTask?.cancel()
        activeTimeoutTask = nil
        if let prevFinish = activeFinish {
            activeFinish = nil
            prevFinish([
                "ok": false,
                "error": AppConfig.isSpanishSystem
                    ? "Inicio de sesión anterior cancelado."
                    : "Previous OAuth session cancelled.",
            ])
        }
        if let prevListener = activeListener {
            activeListener = nil
            prevListener.cancel()
            try? await Task.sleep(nanoseconds: 150_000_000)
        }

        guard oauthGeneration == currentGeneration else {
            return [
                "ok": false,
                "error": AppConfig.isSpanishSystem
                    ? "Inicio de sesión anterior cancelado."
                    : "Previous OAuth session cancelled.",
            ]
        }

        let pkce = CryptoUtils.generatePKCEPair()
        let expectedState = UUID().uuidString.replacingOccurrences(of: "-", with: "")

        let tcpParams = NWParameters.tcp
        tcpParams.allowLocalEndpointReuse = true
        guard let port = NWEndpoint.Port(rawValue: AppConfig.Spotify.callbackPort),
              let listener = try? NWListener(using: tcpParams, on: port) else {
            return [
                "ok": false,
                "error": AppConfig.isSpanishSystem
                    ? "No se pudo abrir el puerto local 8898 para Spotify OAuth."
                    : "Could not open local port 8898 for Spotify OAuth.",
            ]
        }

        self.activeListener = listener

        return await withCheckedContinuation { continuation in
            let once = OnceFlag()
            let finish: @Sendable ([String: Any]) -> Void = { res in
                if once.trySet() {
                    Task {
                        await self.clearActiveOAuthIfMatching(listener)
                    }
                    continuation.resume(returning: res)
                }
            }

            let timeoutTask = Task {
                try? await Task.sleep(nanoseconds: 120_000_000_000)
                guard !Task.isCancelled else { return }
                listener.cancel()
                finish([
                    "ok": false,
                    "error": AppConfig.isSpanishSystem
                        ? "Tiempo de espera agotado para Spotify OAuth."
                        : "Spotify OAuth timed out.",
                ])
            }

            self.activeFinish = finish
            self.activeTimeoutTask = timeoutTask

            listener.stateUpdateHandler = { state in
                if case .failed = state {
                    listener.cancel()
                    finish([
                        "ok": false,
                        "error": AppConfig.isSpanishSystem
                            ? "No se pudo escuchar en el puerto local 8898 para Spotify OAuth."
                            : "Failed to listen on local port 8898 for Spotify OAuth.",
                    ])
                }
            }

            listener.newConnectionHandler = { conn in
                conn.start(queue: .global())
                conn.receive(minimumIncompleteLength: 1, maximumLength: 8192) { data, _, _, _ in
                    guard let data = data, let reqStr = String(data: data, encoding: .utf8) else {
                        conn.cancel()
                        return
                    }
                    let firstLine = reqStr.components(separatedBy: "\r\n").first ?? ""
                    let parts = firstLine.components(separatedBy: " ")
                    guard parts.count >= 2 else {
                        conn.cancel()
                        return
                    }
                    let pathAndQuery = parts[1]
                    if !pathAndQuery.hasPrefix("/login") {
                        let notFound = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n"
                        conn.send(
                            content: notFound.data(using: .utf8),
                            completion: .contentProcessed { _ in conn.cancel() }
                        )
                        return
                    }

                    let urlComps = URLComponents(string: "http://127.0.0.1:8898\(pathAndQuery)")
                    let code = urlComps?.queryItems?.first(where: { $0.name == "code" })?.value
                    let returnedState = urlComps?.queryItems?.first(where: { $0.name == "state" })?.value

                    guard returnedState == expectedState else {
                        timeoutTask.cancel()
                        let forbidden = "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"
                        conn.send(
                            content: forbidden.data(using: .utf8),
                            completion: .contentProcessed { _ in
                                conn.cancel()
                                listener.cancel()
                            }
                        )
                        finish([
                            "ok": false,
                            "error": AppConfig.isSpanishSystem
                                ? "Error de seguridad (state inválido) en Spotify OAuth."
                                : "Spotify OAuth state mismatch (CSRF check failed).",
                        ])
                        return
                    }

                    timeoutTask.cancel()

                    let html = """
                    <html><body style="background:#121212;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
                    <div style="text-align:center;padding:36px;background:#181818;border-radius:20px;border:1px solid #1DB954;">
                    <h2 style="color:#1DB954;margin:0 0 8px 0;">✓ ¡Permisos de Spotify concedidos!</h2>
                    <p style="color:#aaa;font-size:14px;margin:0;">Ya puedes volver a Aura Music. Esta pestaña se cerrará sola.</p>
                    <script>setTimeout(() => window.close(), 1000);</script>
                    </div></body></html>
                    """
                    let httpResp =
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(html.utf8.count)\r\n\r\n\(html)"
                    conn.send(
                        content: httpResp.data(using: .utf8),
                        completion: .contentProcessed { _ in
                            conn.cancel()
                            listener.cancel()
                        }
                    )

                    guard let code = code else {
                        finish([
                            "ok": false,
                            "error": AppConfig.isSpanishSystem
                                ? "Autorización cancelada."
                                : "Authorization cancelled.",
                        ])
                        return
                    }

                    Task {
                        guard let tokenUrl = URL(string: "https://accounts.spotify.com/api/token") else {
                            finish(["ok": false, "error": "Invalid URL."])
                            return
                        }
                        var req = URLRequest(url: tokenUrl)
                        req.httpMethod = "POST"
                        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                        req.setValue(AppConfig.safariUserAgent, forHTTPHeaderField: "User-Agent")

                        var form = URLComponents()
                        form.queryItems = [
                            URLQueryItem(name: "client_id", value: AppConfig.Spotify.clientId),
                            URLQueryItem(name: "grant_type", value: "authorization_code"),
                            URLQueryItem(name: "code", value: code),
                            URLQueryItem(name: "redirect_uri", value: AppConfig.Spotify.redirectURI),
                            URLQueryItem(name: "code_verifier", value: pkce.verifier),
                        ]
                        req.httpBody = form.percentEncodedQuery?.data(using: .utf8)

                        if let (tData, _) = try? await URLSession.shared.data(for: req),
                           let json = try? JSONSerialization.jsonObject(with: tData) as? [String: Any],
                           let token = json["access_token"] as? String {
                            let refresh = json["refresh_token"] as? String
                            let expiresIn = (json["expires_in"] as? Double) ?? 3600
                            await self.saveTokenData(accessToken: token, refreshToken: refresh, expiresIn: expiresIn)
                            let lib = await self.fetchUserLibrary(token: token)
                            finish(lib)
                        } else {
                            finish([
                                "ok": false,
                                "error": AppConfig.isSpanishSystem
                                    ? "No se pudo canjear el código OAuth con Spotify."
                                    : "Could not exchange OAuth code with Spotify.",
                            ])
                        }
                    }
                }
            }

            listener.start(queue: .global())

            var authComps = URLComponents(string: "https://accounts.spotify.com/authorize")!
            authComps.queryItems = [
                URLQueryItem(name: "client_id", value: AppConfig.Spotify.clientId),
                URLQueryItem(name: "response_type", value: "code"),
                URLQueryItem(name: "redirect_uri", value: AppConfig.Spotify.redirectURI),
                URLQueryItem(name: "code_challenge_method", value: "S256"),
                URLQueryItem(name: "code_challenge", value: pkce.challenge),
                URLQueryItem(name: "scope", value: AppConfig.Spotify.scopes),
                URLQueryItem(name: "state", value: expectedState),
            ]
            if let url = authComps.url {
                DispatchQueue.main.async {
                    NSWorkspace.shared.open(url)
                }
            }
        }
    }
}
