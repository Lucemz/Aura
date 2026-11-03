import Foundation
import WebKit

@MainActor
final class AISearchService {
    static let shared = AISearchService()

    struct DynamicModelInfo {
        let id: String
        let displayName: String
        let provider: String
        let inputTokenLimit: Int
        let outputTokenLimit: Int
        let supportsThinking: Bool

        func toDictionary() -> [String: Any] {
            return [
                "id": id,
                "displayName": displayName,
                "provider": provider,
                "inputTokenLimit": inputTokenLimit,
                "outputTokenLimit": outputTokenLimit,
                "supportsThinking": supportsThinking,
            ]
        }
    }

    struct APICallTelemetry {
        var promptTokens: Int = 0
        var completionTokens: Int = 0
        var reasoningTokens: Int = 0
        var totalTokens: Int = 0
        var latencyMs: Int = 0
        var serviceTier: String = ""
        var modelVersion: String = ""
        var rateLimitRemainingRequests: Int? = nil
        var rateLimitLimitRequests: Int? = nil
        var rateLimitRemainingTokens: Int? = nil
        var rateLimitLimitTokens: Int? = nil
        var rateLimitReset: String = ""
    }

    private var cachedModelsKey: String? = nil
    private var cachedModels: [DynamicModelInfo] = []

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

    // MARK: - Provider Detection from API Key

    func detectProvider(for apiKey: String) -> String {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "pollinations" }
        if trimmed.hasPrefix("AIza") || trimmed.hasPrefix("AQ.") { return "gemini" }
        if trimmed.hasPrefix("gsk_") { return "groq" }
        if trimmed.hasPrefix("sk-or-") { return "openrouter" }
        if trimmed.hasPrefix("sk-ant-") { return "anthropic" }
        if trimmed.hasPrefix("sk-") { return "openai" }
        return "gemini"
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
        cachedModelsKey = nil
        saveRawSettings(current)
        return true
    }

    // MARK: - Dynamic Model Discovery via Official Provider `/models` Endpoints

    func fetchAvailableModels(for apiKey: String, forceRefresh: Bool = false) async -> [DynamicModelInfo] {
        let trimmed = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if !forceRefresh, cachedModelsKey == trimmed, !cachedModels.isEmpty {
            return cachedModels
        }

        let provider = detectProvider(for: trimmed)
        var discovered: [DynamicModelInfo] = []

        switch provider {
        case "gemini":
            discovered = await fetchGeminiModels(apiKey: trimmed)
        case "groq":
            discovered = await fetchOpenAICompatibleModels(
                endpoint: "https://api.groq.com/openai/v1/models",
                apiKey: trimmed,
                provider: "groq"
            )
        case "openrouter":
            discovered = await fetchOpenRouterModels(apiKey: trimmed)
        case "anthropic":
            discovered = await fetchAnthropicModels(apiKey: trimmed)
        case "openai":
            discovered = await fetchOpenAICompatibleModels(
                endpoint: "https://api.openai.com/v1/models",
                apiKey: trimmed,
                provider: "openai"
            )
        default:
            discovered = await fetchPollinationsModels()
        }

        if discovered.isEmpty {
            if provider == "pollinations" {
                discovered = [
                    DynamicModelInfo(
                        id: "openai-fast",
                        displayName: "GPT-OSS 20B (Free Keyless)",
                        provider: "pollinations",
                        inputTokenLimit: 32768,
                        outputTokenLimit: 4096,
                        supportsThinking: true
                    )
                ]
            } else if provider == "gemini" {
                discovered = [
                    DynamicModelInfo(
                        id: "gemini-3.8-flash",
                        displayName: "Gemini 3.8 Flash",
                        provider: "gemini",
                        inputTokenLimit: 1048576,
                        outputTokenLimit: 65536,
                        supportsThinking: true
                    )
                ]
            }
        }

        cachedModelsKey = trimmed
        cachedModels = discovered
        return discovered
    }

    private func fetchGeminiModels(apiKey: String) async -> [DynamicModelInfo] {
        guard let encodedKey = apiKey.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=\(encodedKey)") else {
            return []
        }

        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let models = root["models"] as? [[String: Any]] else {
            return []
        }

        let excludedSubstrings = [
            "gemini-2.5-", // Retired for new users by Google in favor of 3.x
            "tts",
            "image",
            "nano-banana",
            "robotics",
            "computer-use",
            "transcribe",
            "lyria",
            "embedding",
            "aqa",
            "imagen",
            "veo",
            "learnlm",
        ]

        var results: [DynamicModelInfo] = []
        for item in models {
            guard let rawName = item["name"] as? String,
                  let methods = item["supportedGenerationMethods"] as? [String],
                  methods.contains("generateContent") else {
                continue
            }
            let id = rawName.replacingOccurrences(of: "models/", with: "")
            let lowerId = id.lowercased()
            if excludedSubstrings.contains(where: { lowerId.contains($0) }) {
                continue
            }

            let displayName = (item["displayName"] as? String) ?? id
            let inputLimit = (item["inputTokenLimit"] as? Int) ?? 1048576
            let outputLimit = (item["outputTokenLimit"] as? Int) ?? 65536
            let thinking = (item["thinking"] as? Bool) ?? false

            results.append(
                DynamicModelInfo(
                    id: id,
                    displayName: displayName,
                    provider: "gemini",
                    inputTokenLimit: inputLimit,
                    outputTokenLimit: outputLimit,
                    supportsThinking: thinking
                )
            )
        }

        let priorityOrder = [
            "gemini-3.8-flash",
            "gemini-flash-latest",
            "gemini-pro-latest",
            "gemini-3.7-flash",
            "gemini-3.6-flash",
            "gemini-3.5-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.1-pro-preview",
            "gemini-3.1-flash-lite",
            "gemini-3-flash-preview",
            "gemini-4-argon",
            "gemma-4-31b-it",
            "gemma-4-26b-a4b-it",
        ]

        results.sort { a, b in
            let idxA = priorityOrder.firstIndex(of: a.id) ?? 999
            let idxB = priorityOrder.firstIndex(of: b.id) ?? 999
            if idxA != idxB { return idxA < idxB }
            return a.displayName < b.displayName
        }

        return results
    }

    private func fetchOpenAICompatibleModels(endpoint: String, apiKey: String, provider: String) async -> [DynamicModelInfo] {
        guard let url = URL(string: endpoint) else { return [] }
        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = root["data"] as? [[String: Any]] else {
            return []
        }

        let excluded = ["whisper", "tts", "dall-e", "embedding", "moderation", "audio", "realtime", "transcribe", "guard", "vision-preview"]
        var results: [DynamicModelInfo] = []
        for item in list {
            guard let id = item["id"] as? String else { continue }
            let lower = id.lowercased()
            if excluded.contains(where: { lower.contains($0) }) { continue }
            if provider == "openai" {
                let allowedPrefixes = ["gpt-4", "gpt-5", "o1", "o3", "o4", "chatgpt"]
                if !allowedPrefixes.contains(where: { lower.hasPrefix($0) }) { continue }
            }
            let ctx = (item["context_window"] as? Int) ?? 128000
            let maxOut = (item["max_completion_tokens"] as? Int) ?? 16384
            results.append(
                DynamicModelInfo(
                    id: id,
                    displayName: id,
                    provider: provider,
                    inputTokenLimit: ctx,
                    outputTokenLimit: maxOut,
                    supportsThinking: lower.hasPrefix("o1") || lower.hasPrefix("o3") || lower.hasPrefix("o4") || lower.contains("deepseek") || lower.contains("qwen")
                )
            )
        }
        results.sort { $0.id < $1.id }
        return results
    }

    private func fetchOpenRouterModels(apiKey: String) async -> [DynamicModelInfo] {
        guard let url = URL(string: "https://openrouter.ai/api/v1/models") else { return [] }
        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = root["data"] as? [[String: Any]] else {
            return []
        }

        var results: [DynamicModelInfo] = []
        for item in list.prefix(80) {
            guard let id = item["id"] as? String else { continue }
            let name = (item["name"] as? String) ?? id
            let ctx = (item["context_length"] as? Int) ?? 128000
            let topProvider = item["top_provider"] as? [String: Any]
            let maxOut = (topProvider?["max_completion_tokens"] as? Int) ?? 8192
            results.append(
                DynamicModelInfo(
                    id: id,
                    displayName: name,
                    provider: "openrouter",
                    inputTokenLimit: ctx,
                    outputTokenLimit: maxOut,
                    supportsThinking: false
                )
            )
        }
        return results
    }

    private func fetchAnthropicModels(apiKey: String) async -> [DynamicModelInfo] {
        guard let url = URL(string: "https://api.anthropic.com/v1/models") else { return [] }
        var req = URLRequest(url: url)
        req.timeoutInterval = 10
        req.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let list = root["data"] as? [[String: Any]] else {
            return []
        }

        var results: [DynamicModelInfo] = []
        for item in list {
            guard let id = item["id"] as? String else { continue }
            let name = (item["display_name"] as? String) ?? id
            results.append(
                DynamicModelInfo(
                    id: id,
                    displayName: name,
                    provider: "anthropic",
                    inputTokenLimit: 200000,
                    outputTokenLimit: 8192,
                    supportsThinking: id.contains("sonnet") || id.contains("opus")
                )
            )
        }
        return results
    }

    private func fetchPollinationsModels() async -> [DynamicModelInfo] {
        guard let url = URL(string: "https://text.pollinations.ai/models") else { return [] }
        var req = URLRequest(url: url)
        req.timeoutInterval = 8
        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            return []
        }

        var results: [DynamicModelInfo] = []
        for item in list {
            guard let name = item["name"] as? String else { continue }
            let desc = (item["description"] as? String) ?? name
            let reasoning = (item["reasoning"] as? Bool) ?? false
            results.append(
                DynamicModelInfo(
                    id: name,
                    displayName: "\(desc) [\(name)]",
                    provider: "pollinations",
                    inputTokenLimit: 32768,
                    outputTokenLimit: 4096,
                    supportsThinking: reasoning
                )
            )
        }
        return results
    }

    // MARK: - OpenRouter Live Key Credits / Rate Limit Endpoint (`/api/v1/key`)

    private func fetchOpenRouterKeyInfo(apiKey: String) async -> [String: Any]? {
        guard let url = URL(string: "https://openrouter.ai/api/v1/key") else { return nil }
        var req = URLRequest(url: url)
        req.timeoutInterval = 8
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse,
              (200...299).contains(http.statusCode),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let info = root["data"] as? [String: Any] else {
            return nil
        }
        return info
    }

    // MARK: - Configuration & Real Telemetry Status

    func saveAiConfig(model: String, apiKey: String) async -> [String: Any] {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        var current = loadRawSettings()
        let previousKey = ((current["apiKey"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)

        current["apiKey"] = trimmedKey
        current["geminiApiKey"] = trimmedKey

        let keyChanged = previousKey != trimmedKey
        let models = await fetchAvailableModels(for: trimmedKey, forceRefresh: keyChanged)

        var chosenModel = model
        if keyChanged || !models.contains(where: { $0.id == chosenModel }) {
            chosenModel = models.first?.id ?? (trimmedKey.isEmpty ? "openai-fast" : "gemini-3.8-flash")
        }

        current["selectedModel"] = chosenModel
        saveRawSettings(current)
        return await getAiStatus()
    }

    func getAiStatus() async -> [String: Any] {
        var settings = loadRawSettings()
        let apiKey = ((settings["apiKey"] as? String) ?? (settings["geminiApiKey"] as? String) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let provider = detectProvider(for: apiKey)

        let models = await fetchAvailableModels(for: apiKey)
        var selectedModel = (settings["selectedModel"] as? String) ?? ""

        if !models.contains(where: { $0.id == selectedModel }) {
            selectedModel = models.first?.id ?? (apiKey.isEmpty ? "openai-fast" : "gemini-3.8-flash")
            settings["selectedModel"] = selectedModel
            saveRawSettings(settings)
        }

        let activeModelInfo = models.first(where: { $0.id == selectedModel }) ?? DynamicModelInfo(
            id: selectedModel,
            displayName: selectedModel,
            provider: provider,
            inputTokenLimit: 128000,
            outputTokenLimit: 8192,
            supportsThinking: false
        )

        let today = todayKey()
        let daily = (settings["dailyUsage"] as? [String: [String: Any]]) ?? [:]
        let todayEntry = daily[today] ?? [:]
        let byModel = (todayEntry["byModel"] as? [String: [String: Any]]) ?? [:]
        let modelUsage = byModel[activeModelInfo.id] ?? [:]

        let requestsToday = (modelUsage["requests"] as? Int) ?? 0
        let tokensToday = (modelUsage["tokens"] as? Int) ?? 0
        let promptTokensToday = (modelUsage["promptTokens"] as? Int) ?? 0
        let completionTokensToday = (modelUsage["completionTokens"] as? Int) ?? 0
        let reasoningTokensToday = (modelUsage["reasoningTokens"] as? Int) ?? 0

        let lastTelemetry = (settings["lastApiTelemetry"] as? [String: Any]) ?? [:]

        var tokens7Days = 0
        var requests7Days = 0
        for (_, dayInfo) in daily {
            tokens7Days += (dayInfo["tokens"] as? Int) ?? 0
            requests7Days += (dayInfo["requests"] as? Int) ?? 0
        }

        var openRouterCredits: [String: Any] = [:]
        if provider == "openrouter", !apiKey.isEmpty, let info = await fetchOpenRouterKeyInfo(apiKey: apiKey) {
            openRouterCredits = info
        }

        return [
            "selectedModel": activeModelInfo.id,
            "activeModel": activeModelInfo.id,
            "activeModelName": activeModelInfo.displayName,
            "provider": provider,
            "hasApiKey": !apiKey.isEmpty,
            "apiKey": apiKey,
            "usingApiKey": !apiKey.isEmpty,
            "inputTokenLimit": activeModelInfo.inputTokenLimit,
            "outputTokenLimit": activeModelInfo.outputTokenLimit,
            "supportsThinking": activeModelInfo.supportsThinking,
            "availableModels": models.map { $0.toDictionary() },
            "requestsToday": requestsToday,
            "tokensToday": tokensToday,
            "promptTokensToday": promptTokensToday,
            "completionTokensToday": completionTokensToday,
            "reasoningTokensToday": reasoningTokensToday,
            "tokensLast7Days": tokens7Days,
            "requestsLast7Days": requests7Days,
            "trackedDaysCount": daily.keys.count,
            "lastTelemetry": lastTelemetry,
            "openRouterKeyInfo": openRouterCredits,
        ]
    }

    private func recordTelemetry(modelId: String, provider: String, telemetry: APICallTelemetry) {
        var settings = loadRawSettings()
        let today = todayKey()
        var daily = (settings["dailyUsage"] as? [String: [String: Any]]) ?? [:]
        var todayEntry = daily[today] ?? [:]

        todayEntry["requests"] = ((todayEntry["requests"] as? Int) ?? 0) + 1
        todayEntry["tokens"] = ((todayEntry["tokens"] as? Int) ?? 0) + telemetry.totalTokens
        todayEntry["lastTokens"] = telemetry.totalTokens

        var byModel = (todayEntry["byModel"] as? [String: [String: Any]]) ?? [:]
        var modelEntry = byModel[modelId] ?? [:]
        modelEntry["requests"] = ((modelEntry["requests"] as? Int) ?? 0) + 1
        modelEntry["tokens"] = ((modelEntry["tokens"] as? Int) ?? 0) + telemetry.totalTokens
        modelEntry["promptTokens"] = ((modelEntry["promptTokens"] as? Int) ?? 0) + telemetry.promptTokens
        modelEntry["completionTokens"] = ((modelEntry["completionTokens"] as? Int) ?? 0) + telemetry.completionTokens
        modelEntry["reasoningTokens"] = ((modelEntry["reasoningTokens"] as? Int) ?? 0) + telemetry.reasoningTokens
        byModel[modelId] = modelEntry
        todayEntry["byModel"] = byModel

        daily[today] = todayEntry
        settings["dailyUsage"] = daily

        var lastDict: [String: Any] = [
            "modelId": modelId,
            "provider": provider,
            "promptTokens": telemetry.promptTokens,
            "completionTokens": telemetry.completionTokens,
            "reasoningTokens": telemetry.reasoningTokens,
            "totalTokens": telemetry.totalTokens,
            "latencyMs": telemetry.latencyMs,
            "serviceTier": telemetry.serviceTier,
            "modelVersion": telemetry.modelVersion,
            "rateLimitReset": telemetry.rateLimitReset,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
        ]
        if let remReq = telemetry.rateLimitRemainingRequests {
            lastDict["rateLimitRemainingRequests"] = remReq
        }
        if let limReq = telemetry.rateLimitLimitRequests {
            lastDict["rateLimitLimitRequests"] = limReq
        }
        if let remTok = telemetry.rateLimitRemainingTokens {
            lastDict["rateLimitRemainingTokens"] = remTok
        }
        if let limTok = telemetry.rateLimitLimitTokens {
            lastDict["rateLimitLimitTokens"] = limTok
        }

        settings["lastApiTelemetry"] = lastDict
        saveRawSettings(settings)
    }

    // MARK: - Semantic AI Song Recommendation (Strict AI Only — Zero Fallback)

    func recommendSongs(prompt: String, in webView: WKWebView) async -> [String: Any] {
        let cleanPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanPrompt.isEmpty else {
            return ["ok": false, "error": "Empty prompt.", "songs": []]
        }

        let status = await getAiStatus()
        let activeModelId = (status["activeModel"] as? String) ?? "openai-fast"
        let provider = (status["provider"] as? String) ?? "pollinations"
        let apiKey = (status["apiKey"] as? String) ?? ""

        let result: (songs: [[String: String]]?, telemetry: APICallTelemetry, error: String?)
        switch provider {
        case "gemini":
            result = await fetchFromGeminiOfficial(prompt: cleanPrompt, model: activeModelId, apiKey: apiKey)
        case "groq":
            result = await fetchFromOpenAICompatible(
                endpoint: "https://api.groq.com/openai/v1/chat/completions",
                model: activeModelId,
                apiKey: apiKey,
                prompt: cleanPrompt
            )
        case "openrouter":
            result = await fetchFromOpenAICompatible(
                endpoint: "https://openrouter.ai/api/v1/chat/completions",
                model: activeModelId,
                apiKey: apiKey,
                prompt: cleanPrompt
            )
        case "anthropic":
            result = await fetchFromAnthropicOfficial(prompt: cleanPrompt, model: activeModelId, apiKey: apiKey)
        case "openai":
            result = await fetchFromOpenAICompatible(
                endpoint: "https://api.openai.com/v1/chat/completions",
                model: activeModelId,
                apiKey: apiKey,
                prompt: cleanPrompt
            )
        default:
            result = await fetchFromDefaultKeylessAI(prompt: cleanPrompt, model: activeModelId)
        }

        guard let rawSuggestions = result.songs, !rawSuggestions.isEmpty else {
            return [
                "ok": false,
                "error": result.error ?? (AppConfig.isSpanishSystem
                    ? "El modelo de IA no pudo responder en este momento."
                    : "The AI model could not respond right now."),
                "songs": [],
            ]
        }

        recordTelemetry(modelId: activeModelId, provider: provider, telemetry: result.telemetry)

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

        let updatedStatus = await getAiStatus()
        return [
            "ok": true,
            "provider": provider,
            "model": activeModelId,
            "tokensUsed": result.telemetry.totalTokens,
            "songs": resolvedSongs,
            "status": updatedStatus,
        ]
    }

    // MARK: - Provider 1: Official Google Gemini (`v1beta/models/{model}:generateContent`)

    private func fetchFromGeminiOfficial(
        prompt: String,
        model: String,
        apiKey: String
    ) async -> (songs: [[String: String]]?, telemetry: APICallTelemetry, error: String?) {
        var telemetry = APICallTelemetry()
        guard !apiKey.isEmpty else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "Configura tu API Key de Gemini primero." : "Configure your Gemini API Key first.")
        }
        let cleanModel = model.replacingOccurrences(of: "models/", with: "")
        guard let encodedKey = apiKey.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "https://generativelanguage.googleapis.com/v1beta/models/\(cleanModel):generateContent?key=\(encodedKey)") else {
            return (nil, telemetry, "Invalid Gemini URL.")
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 25
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
                "maxOutputTokens": 4096,
                "responseMimeType": "application/json",
            ],
        ]

        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        let startTime = DispatchTime.now()

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "Sin conexión con Google Gemini." : "Connection to Google Gemini failed.")
        }

        let elapsedMs = Int((DispatchTime.now().uptimeNanoseconds - startTime.uptimeNanoseconds) / 1_000_000)
        telemetry.latencyMs = elapsedMs
        telemetry.serviceTier = http.value(forHTTPHeaderField: "x-gemini-service-tier") ?? "standard"

        let root = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        if !(200...299).contains(http.statusCode) {
            let apiErr = ((root["error"] as? [String: Any])?["message"] as? String) ?? "HTTP \(http.statusCode)"
            return (nil, telemetry, "Gemini: \(apiErr)")
        }

        let usageMeta = (root["usageMetadata"] as? [String: Any]) ?? [:]
        telemetry.promptTokens = (usageMeta["promptTokenCount"] as? Int) ?? 0
        telemetry.completionTokens = (usageMeta["candidatesTokenCount"] as? Int) ?? 0
        telemetry.reasoningTokens = (usageMeta["thoughtsTokenCount"] as? Int) ?? 0
        telemetry.totalTokens = (usageMeta["totalTokenCount"] as? Int) ?? (telemetry.promptTokens + telemetry.completionTokens + telemetry.reasoningTokens)
        if let tier = usageMeta["serviceTier"] as? String {
            telemetry.serviceTier = tier
        }
        telemetry.modelVersion = (root["modelVersion"] as? String) ?? cleanModel

        guard let candidates = root["candidates"] as? [[String: Any]],
              let content = candidates.first?["content"] as? [String: Any],
              let parts = content["parts"] as? [[String: Any]] else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "Respuesta vacía de Gemini." : "Empty response from Gemini.")
        }

        let combinedText = parts.compactMap { $0["text"] as? String }.joined(separator: "\n")
        guard let songs = parseSongArrayJSON(from: combinedText) else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "Respuesta inválida de Gemini." : "Invalid response from Gemini.")
        }

        return (songs, telemetry, nil)
    }

    // MARK: - Provider 2: OpenAI / Groq / OpenRouter Compatible Endpoint + `x-ratelimit-*` Headers

    private func fetchFromOpenAICompatible(
        endpoint: String,
        model: String,
        apiKey: String,
        prompt: String
    ) async -> (songs: [[String: String]]?, telemetry: APICallTelemetry, error: String?) {
        var telemetry = APICallTelemetry()
        guard !apiKey.isEmpty else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "Falta colocar la API Key." : "API Key required.")
        }
        guard let url = URL(string: endpoint) else {
            return (nil, telemetry, "Invalid endpoint URL.")
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 25
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")

        let payload: [String: Any] = [
            "model": model,
            "messages": [
                ["role": "system", "content": systemInstruction],
                ["role": "user", "content": prompt],
            ],
            "temperature": 0.7,
            "max_tokens": 2048,
        ]

        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        let startTime = DispatchTime.now()

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "Error de red con el proveedor de IA." : "Network error contacting AI provider.")
        }

        telemetry.latencyMs = Int((DispatchTime.now().uptimeNanoseconds - startTime.uptimeNanoseconds) / 1_000_000)

        // Extract real HTTP `x-ratelimit-*` headers exposed by OpenAI / Groq / OpenRouter
        if let remReqStr = http.value(forHTTPHeaderField: "x-ratelimit-remaining-requests"), let val = Int(remReqStr) {
            telemetry.rateLimitRemainingRequests = val
        }
        if let limReqStr = http.value(forHTTPHeaderField: "x-ratelimit-limit-requests"), let val = Int(limReqStr) {
            telemetry.rateLimitLimitRequests = val
        }
        if let remTokStr = http.value(forHTTPHeaderField: "x-ratelimit-remaining-tokens"), let val = Int(remTokStr) {
            telemetry.rateLimitRemainingTokens = val
        }
        if let limTokStr = http.value(forHTTPHeaderField: "x-ratelimit-limit-tokens"), let val = Int(limTokStr) {
            telemetry.rateLimitLimitTokens = val
        }
        telemetry.rateLimitReset = http.value(forHTTPHeaderField: "x-ratelimit-reset-requests")
            ?? http.value(forHTTPHeaderField: "x-ratelimit-reset-tokens")
            ?? ""

        let root = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        if !(200...299).contains(http.statusCode) {
            let apiErr = ((root["error"] as? [String: Any])?["message"] as? String) ?? "HTTP \(http.statusCode)"
            return (nil, telemetry, apiErr)
        }

        let usage = (root["usage"] as? [String: Any]) ?? [:]
        telemetry.promptTokens = (usage["prompt_tokens"] as? Int) ?? 0
        telemetry.completionTokens = (usage["completion_tokens"] as? Int) ?? 0
        if let details = usage["completion_tokens_details"] as? [String: Any] {
            telemetry.reasoningTokens = (details["reasoning_tokens"] as? Int) ?? 0
        }
        telemetry.totalTokens = (usage["total_tokens"] as? Int) ?? (telemetry.promptTokens + telemetry.completionTokens)
        telemetry.serviceTier = (root["service_tier"] as? String) ?? "api-key"
        telemetry.modelVersion = (root["model"] as? String) ?? model

        guard let choices = root["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let content = message["content"] as? String,
              let songs = parseSongArrayJSON(from: content) else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "Formato inválido del modelo." : "Invalid model output format.")
        }

        return (songs, telemetry, nil)
    }

    // MARK: - Provider 3: Official Anthropic Claude (`/v1/messages` + `anthropic-ratelimit-*` Headers)

    private func fetchFromAnthropicOfficial(
        prompt: String,
        model: String,
        apiKey: String
    ) async -> (songs: [[String: String]]?, telemetry: APICallTelemetry, error: String?) {
        var telemetry = APICallTelemetry()
        guard let url = URL(string: "https://api.anthropic.com/v1/messages") else {
            return (nil, telemetry, "Invalid Anthropic URL.")
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 25
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

        let payload: [String: Any] = [
            "model": model,
            "max_tokens": 1024,
            "system": systemInstruction,
            "messages": [
                ["role": "user", "content": prompt]
            ],
        ]

        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        let startTime = DispatchTime.now()

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "Sin conexión con Anthropic." : "Connection to Anthropic failed.")
        }

        telemetry.latencyMs = Int((DispatchTime.now().uptimeNanoseconds - startTime.uptimeNanoseconds) / 1_000_000)

        if let remReqStr = http.value(forHTTPHeaderField: "anthropic-ratelimit-requests-remaining"), let val = Int(remReqStr) {
            telemetry.rateLimitRemainingRequests = val
        }
        if let limReqStr = http.value(forHTTPHeaderField: "anthropic-ratelimit-requests-limit"), let val = Int(limReqStr) {
            telemetry.rateLimitLimitRequests = val
        }
        if let remTokStr = http.value(forHTTPHeaderField: "anthropic-ratelimit-tokens-remaining"), let val = Int(remTokStr) {
            telemetry.rateLimitRemainingTokens = val
        }
        if let limTokStr = http.value(forHTTPHeaderField: "anthropic-ratelimit-tokens-limit"), let val = Int(limTokStr) {
            telemetry.rateLimitLimitTokens = val
        }
        telemetry.rateLimitReset = http.value(forHTTPHeaderField: "anthropic-ratelimit-requests-reset") ?? ""

        let root = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        if !(200...299).contains(http.statusCode) {
            let apiErr = ((root["error"] as? [String: Any])?["message"] as? String) ?? "HTTP \(http.statusCode)"
            return (nil, telemetry, "Anthropic: \(apiErr)")
        }

        let usage = (root["usage"] as? [String: Any]) ?? [:]
        telemetry.promptTokens = (usage["input_tokens"] as? Int) ?? 0
        telemetry.completionTokens = (usage["output_tokens"] as? Int) ?? 0
        telemetry.totalTokens = telemetry.promptTokens + telemetry.completionTokens
        telemetry.serviceTier = "anthropic-api"
        telemetry.modelVersion = (root["model"] as? String) ?? model

        guard let contentArr = root["content"] as? [[String: Any]],
              let text = contentArr.first?["text"] as? String,
              let songs = parseSongArrayJSON(from: text) else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "Formato inválido de Claude." : "Invalid Claude response format.")
        }

        return (songs, telemetry, nil)
    }

    // MARK: - Provider 4: Default Keyless AI Endpoint (Pollinations + `x-usage-*` Headers)

    private func fetchFromDefaultKeylessAI(
        prompt: String,
        model: String
    ) async -> (songs: [[String: String]]?, telemetry: APICallTelemetry, error: String?) {
        var telemetry = APICallTelemetry()
        guard let url = URL(string: "https://text.pollinations.ai/openai") else {
            return (nil, telemetry, "Invalid URL")
        }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 25
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let targetModel = (model.isEmpty || model == "free-default") ? "openai-fast" : model
        let payload: [String: Any] = [
            "model": targetModel,
            "reasoning_effort": "low",
            "max_tokens": 2048,
            "messages": [
                ["role": "system", "content": systemInstruction],
                ["role": "user", "content": prompt],
            ],
            "temperature": 0.7,
        ]

        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        let startTime = DispatchTime.now()

        guard let (data, response) = try? await URLSession.shared.data(for: req),
              let http = response as? HTTPURLResponse else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "El servidor gratuito de IA no respondió." : "Free AI server did not respond.")
        }

        telemetry.latencyMs = Int((DispatchTime.now().uptimeNanoseconds - startTime.uptimeNanoseconds) / 1_000_000)

        let root = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
        if !(200...299).contains(http.statusCode) {
            let apiErr = ((root["error"] as? [String: Any])?["message"] as? String) ?? "HTTP \(http.statusCode)"
            return (nil, telemetry, apiErr)
        }

        let usage = (root["usage"] as? [String: Any]) ?? [:]
        let headerPrompt = Int(http.value(forHTTPHeaderField: "x-usage-prompt-text-tokens") ?? "") ?? 0
        let headerComp = Int(http.value(forHTTPHeaderField: "x-usage-completion-text-tokens") ?? "") ?? 0
        let headerTotal = Int(http.value(forHTTPHeaderField: "x-usage-total-tokens") ?? "") ?? 0

        telemetry.promptTokens = (usage["prompt_tokens"] as? Int) ?? headerPrompt
        telemetry.completionTokens = (usage["completion_tokens"] as? Int) ?? headerComp
        telemetry.totalTokens = (usage["total_tokens"] as? Int) ?? headerTotal
        telemetry.serviceTier = (root["user_tier"] as? String) ?? "anonymous"
        telemetry.modelVersion = http.value(forHTTPHeaderField: "x-model-used")
            ?? (root["model"] as? String)
            ?? targetModel

        guard let choices = root["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let content = message["content"] as? String,
              let songs = parseSongArrayJSON(from: content) else {
            return (nil, telemetry, AppConfig.isSpanishSystem ? "No se pudo interpretar la respuesta de la IA." : "Could not parse AI response.")
        }

        return (songs, telemetry, nil)
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
