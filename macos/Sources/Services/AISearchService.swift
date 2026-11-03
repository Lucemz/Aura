import Foundation
import WebKit

@MainActor
final class AISearchService {
    static let shared = AISearchService()

    private var systemInstruction: String {
        let langNote = AppConfig.isSpanishSystem
            ? "Write the 'reason' field in the same language as the user's prompt (defaulting to Spanish)."
            : "Write the 'reason' field in the same language as the user's prompt (defaulting to English)."
        return """
        You are Aura AI, an expert music curator. The user will describe what they are doing, how they feel, or what atmosphere they want.
        Do NOT perform a literal keyword match. Reason about real songs that best fit that mood, activity, tempo, and energy.
        \(langNote)
        Return ONLY a valid JSON array of 8 recommended songs with no extra text or markdown blocks, matching this exact schema:
        [
          {
            "title": "Exact song title",
            "artist": "Artist name",
            "reason": "Short explanation (max 10 words) of why it fits"
          }
        ]
        """
    }

    // MARK: - Persistent Gemini API Key Management (stored in ~/Library/Application Support/Aura/aura-settings.json)

    func getGeminiApiKey() -> String {
        guard let data = try? Data(contentsOf: AppConfig.settingsFileURL),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let key = json["geminiApiKey"] as? String else {
            return ""
        }
        return key.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func setGeminiApiKey(_ key: String) -> Bool {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        var current: [String: Any] = [:]
        if let data = try? Data(contentsOf: AppConfig.settingsFileURL),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            current = json
        }
        current["geminiApiKey"] = trimmed
        if let outData = try? JSONSerialization.data(withJSONObject: current, options: [.prettyPrinted]) {
            try? outData.write(to: AppConfig.settingsFileURL, options: .atomic)
            return true
        }
        return false
    }

    // MARK: - Semantic AI Song Recommendation + Parallel YouTube Music Resolution

    func recommendSongs(prompt: String, in webView: WKWebView) async -> [String: Any] {
        let cleanPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanPrompt.isEmpty else {
            return ["ok": false, "error": "Escribe qué estás haciendo o qué tipo de música buscas.", "songs": []]
        }

        let apiKey = getGeminiApiKey()
        var rawSuggestions: [[String: String]] = []
        var providerUsed = "gemini-default"

        if !apiKey.isEmpty {
            if let geminiList = await fetchFromGeminiOfficial(prompt: cleanPrompt, apiKey: apiKey), !geminiList.isEmpty {
                rawSuggestions = geminiList
                providerUsed = "gemini-api-key"
            }
        }

        if rawSuggestions.isEmpty {
            if let keylessList = await fetchFromDefaultKeylessAI(prompt: cleanPrompt), !keylessList.isEmpty {
                rawSuggestions = keylessList
            }
        }

        guard !rawSuggestions.isEmpty else {
            return [
                "ok": false,
                "error": "No se pudo obtener recomendaciones en este momento. Intenta de nuevo.",
                "songs": [],
            ]
        }

        // Resolve each AI-recommended song on YouTube Music in parallel to obtain exact videoId & artwork
        var resolvedSongs: [[String: Any]] = []
        for item in rawSuggestions.prefix(8) {
            let title = item["title"] ?? ""
            let artist = item["artist"] ?? ""
            let reason = item["reason"] ?? ""
            guard !title.isEmpty else { continue }

            if let match = await YouTubeMusicService.shared.searchTrack(in: webView, title: title, artist: artist),
               let videoId = match["videoId"] as? String, !videoId.isEmpty {
                let thumbnail = (match["thumbnail"] as? String) ?? "https://i.ytimg.com/vi/\(videoId)/hqdefault.jpg"
                resolvedSongs.append([
                    "videoId": videoId,
                    "title": title,
                    "artist": artist,
                    "reason": reason,
                    "thumbnail": thumbnail,
                ])
            }
        }

        return [
            "ok": true,
            "provider": providerUsed,
            "songs": resolvedSongs,
        ]
    }

    // MARK: - Official Google Gemini 2.5 Flash Free Tier Endpoint

    private func fetchFromGeminiOfficial(prompt: String, apiKey: String) async -> [[String: String]]? {
        guard let encodedKey = apiKey.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=\(encodedKey)") else {
            return nil
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: Any] = [
            "systemInstruction": [
                "parts": [["text": systemInstruction]]
            ],
            "contents": [
                [
                    "role": "user",
                    "parts": [["text": prompt]],
                ]
            ],
            "generationConfig": [
                "temperature": 0.7,
                "responseMimeType": "application/json",
            ],
        ]

        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let candidates = root["candidates"] as? [[String: Any]],
              let content = candidates.first?["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]],
              let text = parts.first?["text"] as? String else {
            return nil
        }

        return parseSongArrayJSON(from: text)
    }

    // MARK: - Default Keyless AI Endpoint (Zero API Key Required)

    private func fetchFromDefaultKeylessAI(prompt: String) async -> [[String: String]]? {
        guard let url = URL(string: "https://text.pollinations.ai/openai") else {
            return nil
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: Any] = [
            "model": "openai",
            "messages": [
                ["role": "system", "content": systemInstruction],
                ["role": "user", "content": prompt],
            ],
            "temperature": 0.7,
        ]

        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = root["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let content = message["content"] as? String else {
            return nil
        }

        return parseSongArrayJSON(from: content)
    }

    // MARK: - JSON Extraction Helper

    private func parseSongArrayJSON(from rawText: String) -> [[String: String]]? {
        var cleaned = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        if let startIdx = cleaned.firstIndex(of: "["),
           let endIdx = cleaned.lastIndex(of: "]"),
           startIdx <= endIdx {
            cleaned = String(cleaned[startIdx...endIdx])
        }

        guard let data = cleaned.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return nil
        }

        var results: [[String: String]] = []
        for obj in arr {
            let title = (obj["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let artist = (obj["artist"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let reason = (obj["reason"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !title.isEmpty && !artist.isEmpty {
                results.append([
                    "title": title,
                    "artist": artist,
                    "reason": reason,
                ])
            }
        }
        return results.isEmpty ? nil : results
    }
}
