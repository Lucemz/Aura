import Foundation
import WebKit

@MainActor
final class GoogleAuthService {
    static let shared = GoogleAuthService()

    /// Restores cached Google/YouTube cookies (`google-cookies.json`) into Safari's `WKWebsiteDataStore`
    func restoreCachedCookiesIntoWebKit() async {
        let fileURL = AppConfig.googleCookiesCacheFileURL
        guard let data = try? Data(contentsOf: fileURL),
              let rawCookies = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return
        }
        await injectCookiesIntoWebKit(rawCookies)
    }

    func injectCookiesIntoWebKit(_ rawCookies: [[String: Any]]) async {
        let store = WKWebsiteDataStore.default().httpCookieStore
        for c in rawCookies {
            guard let name = c["name"] as? String,
                  let value = c["value"] as? String,
                  let domain = c["domain"] as? String else { continue }
            let path = (c["path"] as? String) ?? "/"
            var props: [HTTPCookiePropertyKey: Any] = [
                .name: name,
                .value: value,
                .domain: domain,
                .path: path,
            ]
            if (c["secure"] as? Bool) == true {
                props[.secure] = "TRUE"
            }
            if (c["httpOnly"] as? Bool) == true {
                props[HTTPCookiePropertyKey("HttpOnly")] = "TRUE"
            }
            if let expires = (c["expires"] as? NSNumber)?.doubleValue, expires > 0 {
                props[.expires] = Date(timeIntervalSince1970: expires)
            }
            if let cookie = HTTPCookie(properties: props) {
                await store.setCookie(cookie)
            }
        }
    }

    func getSapisidFromCookieStore() async -> String? {
        let cookies = await WKWebsiteDataStore.default().httpCookieStore.allCookies()
        for c in cookies where c.domain.contains("youtube.com") {
            if c.name == "SAPISID" || c.name == "__Secure-3PAPISID" {
                return c.value
            }
        }
        return nil
    }

    func buildSapisidHashHeader() async -> String? {
        guard let sapisid = await getSapisidFromCookieStore() else { return nil }
        let ts = Int(Date().timeIntervalSince1970)
        let hash = CryptoUtils.sha1Hex("\(ts) \(sapisid) https://music.youtube.com")
        return "SAPISIDHASH \(ts)_\(hash) SAPISID1PHASH \(ts)_\(hash) SAPISID3PHASH \(ts)_\(hash)"
    }

    func clearYouTubeSession() async {
        try? FileManager.default.removeItem(at: AppConfig.googleCookiesCacheFileURL)
        try? FileManager.default.removeItem(at: AppConfig.chromeAuthProfileDirectory)
        let store = WKWebsiteDataStore.default()
        let records = await store.dataRecords(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes())
        for rec in records where rec.displayName.contains("youtube") || rec.displayName.contains("google") {
            await store.removeData(ofTypes: rec.dataTypes, for: [rec])
        }
    }

    /// Launches real Google Chrome for 100% trusted Google Sign-In, extracts all cookies via CDP,
    /// saves them to `google-cookies.json`, and injects them into Safari's `WKWebsiteDataStore`.
    func authenticateViaExternalChrome() async -> Bool {
        let chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        guard FileManager.default.fileExists(atPath: chromePath) else {
            return false
        }

        let profileDir = AppConfig.chromeAuthProfileDirectory
        try? FileManager.default.createDirectory(at: profileDir, withIntermediateDirectories: true)

        let debugPort = Int.random(in: 19300...19899)
        let loginUrl =
            "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26hl%3Des%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F%26feature%3Dsign_in_button&hl=es"

        let process = Process()
        process.executableURL = URL(fileURLWithPath: chromePath)
        process.arguments = [
            "--user-data-dir=\(profileDir.path)",
            "--remote-debugging-port=\(debugPort)",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-features=WebAuthentication",
            "--window-size=560,740",
            "--app=\(loginUrl)",
        ]

        do {
            try process.run()
        } catch {
            return false
        }

        for _ in 0..<180 {
            if !process.isRunning {
                break
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)

            guard let listUrl = URL(string: "http://127.0.0.1:\(debugPort)/json"),
                  let (data, _) = try? await URLSession.shared.data(from: listUrl),
                  let targets = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                continue
            }

            guard let pageTarget = targets.first(where: {
                ($0["type"] as? String) == "page" && ($0["webSocketDebuggerUrl"] as? String) != nil
            }),
            let currentUrl = pageTarget["url"] as? String,
            currentUrl.hasPrefix("https://music.youtube.com"),
            let wsUrlStr = pageTarget["webSocketDebuggerUrl"] as? String,
            let wsUrl = URL(string: wsUrlStr) else {
                continue
            }

            if let cookies = await fetchCookiesViaCDP(wsUrl: wsUrl) {
                let hasSapisid = cookies.contains {
                    let name = ($0["name"] as? String) ?? ""
                    let domain = ($0["domain"] as? String) ?? ""
                    return (name == "SAPISID" || name == "__Secure-3PAPISID") && domain.contains("youtube.com")
                }
                if hasSapisid {
                    if let savedData = try? JSONSerialization.data(withJSONObject: cookies, options: [.prettyPrinted]) {
                        try? savedData.write(to: AppConfig.googleCookiesCacheFileURL)
                    }
                    await injectCookiesIntoWebKit(cookies)
                    process.terminate()
                    return true
                }
            }
        }

        if process.isRunning {
            process.terminate()
        }
        return false
    }

    private func fetchCookiesViaCDP(wsUrl: URL) async -> [[String: Any]]? {
        let wsTask = URLSession.shared.webSocketTask(with: wsUrl)
        wsTask.resume()
        defer { wsTask.cancel(with: .goingAway, reason: nil) }

        let cmd = #"{"id":1,"method":"Network.getAllCookies","params":{}}"#
        do {
            try await wsTask.send(.string(cmd))
            let message = try await wsTask.receive()
            if case .string(let text) = message,
               let data = text.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let result = json["result"] as? [String: Any],
               let cookies = result["cookies"] as? [[String: Any]] {
                return cookies.filter {
                    let domain = ($0["domain"] as? String) ?? ""
                    return domain.contains("youtube.com") || domain.contains("google.com")
                }
            }
        } catch {
            return nil
        }
        return nil
    }
}
