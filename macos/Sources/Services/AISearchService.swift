import Foundation
import WebKit

@MainActor
final class AISearchService {
    static let shared = AISearchService()

    struct ModelSpec {
        let id: String
        let displayName: String
        let provider: String
        let requiresKey: Bool
        let dailyLimit: Int
        let rpmLimit: Int
    }

    static let availableModels: [String: ModelSpec] = [
        "free-default": ModelSpec(
            id: "free-default",
            displayName: "GPT-OSS 20B (Free)",
            provider: "pollinations",
            requiresKey: false,
            dailyLimit: 100,
            rpmLimit: 15
        ),
        "gemini-2.5-flash": ModelSpec(
            id: "gemini-2.5-flash",
            displayName: "Gemini 2.5 Flash",
            provider: "gemini",
            requiresKey: true,
            dailyLimit: 500,
            rpmLimit: 15
        ),
        "gemini-2.5-pro": ModelSpec(
            id: "gemini-2.5-pro",
            displayName: "Gemini 2.5 Pro",
            provider: "gemini",
            requiresKey: true,
            dailyLimit: 100,
            rpmLimit: 5
        ),
        "gpt-4o-mini": ModelSpec(
            id: "gpt-4o-mini",
            displayName: "OpenAI GPT-4o mini",
            provider: "openai",
            requiresKey: true,
            dailyLimit: 500,
            rpmLimit: 60
        ),
        "llama-3.3-70b": ModelSpec(
            id: "llama-3.3-70b",
            displayName: "Groq Llama 3.3 70B",
            provider: "groq",
            requiresKey: true,
            dailyLimit: 1000,
            rpmLimit: 30
        ),
    ]

    private var systemInstruction: String {
        let lang = AppConfig.isSpanishSystem ? "Spanish" : "English"
        return """
        Return ONLY a valid JSON array of 8 real songs matching the user's mood, activity, or genre request. Write 'reason' in the same language as the user's prompt (default \(lang), max 10 words). No markdown:
        [{"title":"Song Title","artist":"Artist Name","reason":"Short reason"}]
        """
    }

    private func todayKey() -> String {
        let fmt = DateFormatter()
        fmt.calendar = Calendar(identifier: .gregorian)
        fmt.dateFormat = "yyyy-MM-dd"
        return fmt.string(from: Date())
    }

    // MARK: - Settings & 7-Day Pruned Telemetry Persistence

    private func loadRawSettings() -> [String: Any] {
        guard let data = try? Data(contentsOf: AppConfig.settingsFileURL),
              var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return [:]
        }
        json = pruneOldTelemetry(in: json)
        return json
    }

    private func saveRawSettings(_ settings: [String: Any]) {
        let pruned = pruneOldTelemetry(in: settings)
        if let outData = try? JSONSerialization.data(withJSONObject: pruned, options: [.prettyPrinted]) {
            try? outData.write(to: AppConfig.settingsFileURL, options: .atomic)
        }
    }

    /// Keeps only the most recent 7 days of telemetry in `dailyUsage`
    private func pruneOldTelemetry(in settings: [String: Any]) -> [String: Any] {
        var copy = settings
        guard let daily = copy["dailyUsage"] as? [String: [String: Any]] else {
            return copy
        }
        let sortedDates = daily.keys.sorted(by: >)
        if sortedDates.count > 7 {
            var trimmed: [String: [String: Any]] = [:]
            for dateKey in sortedDates.prefix(7) {
                if let val = daily[dateKey] {
                    trimmed[dateKey] = val
                }
            }
            copy["dailyUsage"] = trimmed
        }
        return copy
    }

    func getGeminiApiKey() -> String {
        let json = loadRawSettings()
        let key = (json["apiKey"] as? String) ?? (json["geminiApiKey"] as? String) ?? ""
        return key.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func setGeminiApiKey(_ key: String) -> Bool {
        let trimmed = key.trimmingCharacters(in: .whitespacesAndNewlines)
        var current = loadRawSettings()
        current["apiKey"] = trimmed
        current["geminiApiKey"] = trimmed

        // Auto-select matching model family when user pastes or clears an API key
        if trimmed.isEmpty {
            current["selectedModel"] = "free-default"
        } else if trimmed.hasPrefix("AIza") {
            let curModel = (current["selectedModel"] as? String) ?? "free-default"
            if !curModel.hasPrefix("gemini-") {
                current["selectedModel"] = "gemini-2.5-flash"
            }
        } else if trimmed.hasPrefix("gsk_") {
            current["selectedModel"] = "llama-3.3-70b"
        } else if trimmed.hasPrefix("sk-") {
            current["selectedModel"] = "gpt-4o-mini"
        }

        saveRawSettings(current)
        return true
    }

    func saveAiConfig(model: String, apiKey: String) -> [String: Any] {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        var current = loadRawSettings()
        current["apiKey"] = trimmedKey
        current["geminiApiKey"] = trimmedKey

        let validModel = Self.availableModels[model] != nil ? model : "free-default"
        current["selectedModel"] = validModel
        saveRawSettings(current)
        return getAiStatus()
    }

    func getAiStatus() -> [String: Any] {
        let settings = loadRawSettings()
        let apiKey = ((settings["apiKey"] as? String) ?? (settings["geminiApiKey"] as? String) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var selectedModel = (settings["selectedModel"] as? String) ?? (apiKey.isEmpty ? "free-default" : "gemini-2.5-flash")
        if Self.availableModels[selectedModel] == nil {
            selectedModel = "free-default"
        }

        let spec = Self.availableModels[selectedModel] ?? Self.availableModels["free-default"]!
        let effectiveModelId = (spec.requiresKey && apiKey.isEmpty) ? "free-default" : spec.id
        let effectiveSpec = Self.availableModels[effectiveModelId]!

        let today = todayKey()
        let daily = (settings["dailyUsage"] as? [String: [String: Any]]) ?? [:]
        let todayEntry = daily[today] ?? [:]
        let byModel = (todayEntry["byModel"] as? [String: [String: Any]]) ?? [:]
        let modelUsage = byModel[effectiveModelId] ?? [:]

        let requestsToday = (modelUsage["requests"] as? Int) ?? 0
        let tokensToday = (modelUsage["tokens"] as? Int) ?? 0
        let lastTokens = (todayEntry["lastTokens"] as? Int) ?? 0

        var tokens7Days = 0
        var requests7Days = 0
        for (_, dayInfo) in daily {
            tokens7Days += (dayInfo["tokens"] as? Int) ?? 0
            requests7Days += (dayInfo["requests"] as? Int) ?? 0
        }

        let remainingQuota = max(0, effectiveSpec.dailyLimit - requestsToday)

        return [
            "selectedModel": selectedModel,
            "activeModel": effectiveSpec.id,
            "activeModelName": effectiveSpec.displayName,
            "provider": effectiveSpec.provider,
            "hasApiKey": !apiKey.isEmpty,
            "apiKey": apiKey,
            "usingApiKey": effectiveSpec.requiresKey && !apiKey.isEmpty,
            "requestsToday": requestsToday,
            "dailyQuotaLimit": effectiveSpec.dailyLimit,
            "remainingQuota": remainingQuota,
            "rpmLimit": effectiveSpec.rpmLimit,
            "tokensToday": tokensToday,
            "lastTokens": lastTokens,
            "tokensLast7Days": tokens7Days,
            "requestsLast7Days": requests7Days,
            "trackedDaysCount": daily.keys.count,
        ]
    }

    private func recordTelemetry(modelId: String, tokensUsed: Int) {
        var settings = loadRawSettings()
        let today = todayKey()
        var daily = (settings["dailyUsage"] as? [String: [String: Any]]) ?? [:]
        var todayEntry = daily[today] ?? [:]

        let totalReq = ((todayEntry["requests"] as? Int) ?? 0) + 1
        let totalTok = ((todayEntry["tokens"] as? Int) ?? 0) + tokensUsed
        todayEntry["requests"] = totalReq
        todayEntry["tokens"] = totalTok
        todayEntry["lastTokens"] = tokensUsed

        var byModel = (todayEntry["byModel"] as? [String: [String: Any]]) ?? [:]
        var modelEntry = byModel[modelId] ?? [:]
        modelEntry["requests"] = ((modelEntry["requests"] as? Int) ?? 0) + 1
        modelEntry["tokens"] = ((modelEntry["tokens"] as? Int) ?? 0) + tokensUsed
        byModel[modelId] = modelEntry
        todayEntry["byModel"] = byModel

        daily[today] = todayEntry
        settings["dailyUsage"] = daily
        saveRawSettings(settings)
    }

    // MARK: - Semantic AI Song Recommendation (Strict AI Only — No YT Search Fallback)

    func recommendSongs(prompt: String, in webView: WKWebView) async -> [String: Any] {
        let cleanPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanPrompt.isEmpty else {
            return ["ok": false, "error": "Empty prompt.", "songs": []]
        }

        let status = getAiStatus()
        let activeModelId = (status["activeModel"] as? String) ?? "free-default"
        let apiKey = (status["apiKey"] as? String) ?? ""

        let result: (songs: [[String: String]]?, tokens: Int, error: String?)
        switch activeModelId {
        case "gemini-2.5-flash", "gemini-2.5-pro":
            result = await fetchFromGeminiOfficial(prompt: cleanPrompt, model: activeModelId, apiKey: apiKey)
        case "gpt-4o-mini":
            result = await fetchFromOpenAICompatible(
                endpoint: "https://api.openai.com/v1/chat/completions",
                model: "gpt-4o-mini",
                apiKey: apiKey,
                prompt: cleanPrompt
            )
        case "llama-3.3-70b":
            result = await fetchFromOpenAICompatible(
                endpoint: "https://api.groq.com/openai/v1/chat/completions",
                model: "llama-3.3-70b-versatile",
                apiKey: apiKey,
                prompt: cleanPrompt
            )
        default:
            result = await fetchFromDefaultKeylessAI(prompt: cleanPrompt)
        }

        guard let rawSuggestions = result.songs, !rawSuggestions.isEmpty else {
            return [
                "ok": false,
                "error": result.error ?? (AppConfig.isSpanishSystem
                    ? "El modelo de IA no pudo responder en este momento. Verifica tu cuota o intenta de nuevo."
                    : "The AI model could not respond right now. Check your quota or try again."),
                "songs": [],
            ]
        }

        let estimatedTokens = result.tokens > 0
            ? result.tokens
            : max(120, (cleanPrompt.count / 3) + (rawSuggestions.count * 28))
        recordTelemetry(modelId: activeModelId, tokensUsed: estimatedTokens)

        // Resolve each AI-recommended song on YouTube Music to attach its videoId & artwork
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
            "provider": activeModelId,
            "tokensUsed": estimatedTokens,
            "songs": resolvedSongs,
            "status": getAiStatus(),
        ]
    }

    // MARK: - Provider 1: Official Google Gemini (2.5 Flash / 2.5 Pro)

    private func fetchFromGeminiOfficial(
        prompt: String,
        model: String,
        apiKey: String
    ) async -> (songs: [[String: String]]?, tokens: Int, error: String?) {
        guard !apiKey.isEmpty else {
            return (nil, 0, AppConfig.isSpanishSystem ? "Configura tu API Key de Gemini primero." : "Configure your Gemini API Key first.")
        }
        guard let encodedKey = apiKey.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(model):generateContent?key=\(encodedKey)") else {
            return (nil, 0, "Invalid Gemini URL.")
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 22
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
                "maxOutputTokens": 1024,
                "responseMimeType": "application/json",
            ],
        ]

        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse else {
            return (nil, 0, AppConfig.isSpanishSystem ? "Sin conexión con Google Gemini." : "Connection to Google Gemini failed.")
        }

        let root = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        if !(200...299).contains(http.statusCode) {
            let apiErr = ((root["error"] as? [String: Any])?["message"] as? String) ?? "HTTP \(http.statusCode)"
            return (nil, 0, "Gemini: \(apiErr)")
        }

        let usageMeta = (root["usageMetadata"] as? [String: Any]) ?? [:]
        let totalTokens = (usageMeta["totalTokenCount"] as? Int) ?? 0

        guard let candidates = root["candidates"] as? [[String: Any]],
              let content = candidates.first?["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]],
              let text = parts.first?["text"] as? String,
              let songs = parseSongArrayJSON(from: text) else {
            return (nil, totalTokens, AppConfig.isSpanishSystem ? "Respuesta inválida de Gemini." : "Invalid response from Gemini.")
        }

        return (songs, totalTokens, nil)
    }

    // MARK: - Provider 2: OpenAI / Groq Compatible Endpoint

    private func fetchFromOpenAICompatible(
        endpoint: String,
        model: String,
        apiKey: String,
        prompt: String
    ) async -> (songs: [[String: String]]?, tokens: Int, error: String?) {
        guard !apiKey.isEmpty else {
            return (nil, 0, AppConfig.isSpanishSystem ? "Falta colocar la API Key para este modelo." : "API Key required for this model.")
        }
        guard let url = URL(string: endpoint) else {
            return (nil, 0, "Invalid endpoint URL.")
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 22
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let payload: [String: Any] = [
            "model": model,
            "messages": [
                ["role": "system", "content": systemInstruction],
                ["role": "user", "content": prompt],
            ],
            "temperature": 0.7,
            "max_tokens": 1024,
        ]

        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse else {
            return (nil, 0, AppConfig.isSpanishSystem ? "Error de red con el proveedor de IA." : "Network error contacting AI provider.")
        }

        let root = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        if !(200...299).contains(http.statusCode) {
            let apiErr = ((root["error"] as? [String: Any])?["message"] as? String) ?? "HTTP \(http.statusCode)"
            return (nil, 0, apiErr)
        }

        let usage = (root["usage"] as? [String: Any]) ?? [:]
        let totalTokens = (usage["total_tokens"] as? Int) ?? 0

        guard let choices = root["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let content = message["content"] as? String,
              let songs = parseSongArrayJSON(from: content) else {
            return (nil, totalTokens, AppConfig.isSpanishSystem ? "Formato inválido del modelo." : "Invalid model output format.")
        }

        return (songs, totalTokens, nil)
    }

    // MARK: - Provider 3: Default Keyless AI Endpoint (GPT-OSS 20B with low reasoning effort)

    private func fetchFromDefaultKeylessAI(
        prompt: String
    ) async -> (songs: [[String: String]]?, tokens: Int, error: String?) {
        guard let url = URL(string: "https://text.pollinations.ai/openai") else {
            return (nil, 0, "Invalid URL")
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 22
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: Any] = [
            "model": "openai-fast",
            "reasoning_effort": "low",
            "max_tokens": 2048,
            "messages": [
                ["role": "system", "content": systemInstruction],
                ["role": "user", "content": prompt],
            ],
            "temperature": 0.7,
        ]

        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse else {
            return (nil, 0, AppConfig.isSpanishSystem ? "El servidor gratuito de IA no respondió." : "Free AI server did not respond.")
        }

        let root = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        if !(200...299).contains(http.statusCode) {
            let apiErr = ((root["error"] as? [String: Any])?["message"] as? String) ?? "HTTP \(http.statusCode)"
            return (nil, 0, apiErr)
        }

        let usage = (root["usage"] as? [String: Any]) ?? [:]
        let totalTokens = (usage["total_tokens"] as? Int) ?? 0

        guard let choices = root["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let content = message["content"] as? String,
              let songs = parseSongArrayJSON(from: content) else {
            return (nil, totalTokens, AppConfig.isSpanishSystem ? "No se pudo interpretar la respuesta de la IA." : "Could not parse AI response.")
        }

        return (songs, totalTokens, nil)
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
