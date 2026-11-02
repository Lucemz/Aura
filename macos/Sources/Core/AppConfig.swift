import Foundation

enum AppConfig {
    static let safariUserAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15"

    static let youtubeMusicHomeURL = URL(string: "https://music.youtube.com")!
    static let localUIEntryURL = URL(string: "aura://app/index.html")!

    enum Spotify {
        static let clientId = "65b708073fc0480ea92a077233ca87bd"
        static let callbackPort: UInt16 = 8898
        static let redirectURI = "http://127.0.0.1:8898/login"
        static let scopes = [
            "user-library-read",
            "playlist-read-private",
            "playlist-read-collaborative",
            "user-read-private",
            "user-read-email",
            "streaming",
        ].joined(separator: " ")

        enum GraphQLHashes {
            static let profileAttributes = "53bcb064f6cd18c23f752bc324a791194d20df612d8e1239c735144ab0399ced"
            static let fetchLibraryTracks = "087278b20b743578a6262c2b0b4bcd20d879c503cc359a2285baf083ef944240"
            static let fetchPlaylist = "bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77"
        }
    }

    static var appSupportDirectory: URL {
        let fm = FileManager.default
        let base = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let auraDir = base.appendingPathComponent("Aura", isDirectory: true)
        if !fm.fileExists(atPath: auraDir.path) {
            try? fm.createDirectory(at: auraDir, withIntermediateDirectories: true)
        }
        return auraDir
    }

    static var spotifyTokenFileURL: URL {
        appSupportDirectory.appendingPathComponent("spotify-oauth-token.json")
    }

    static var googleCookiesCacheFileURL: URL {
        appSupportDirectory.appendingPathComponent("google-cookies.json")
    }

    static var chromeAuthProfileDirectory: URL {
        appSupportDirectory.appendingPathComponent("chrome-auth-profile", isDirectory: true)
    }
}
