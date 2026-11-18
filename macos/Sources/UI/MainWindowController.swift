import Cocoa
import WebKit

final class InstantClickWKWebView: WKWebView {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        return true
    }
}

@MainActor
final class MainWindowController: NSObject, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    var mainWindow: NSWindow!
    var ytmWebView: WKWebView!
    var uiWebView: WKWebView!

    private var isMiniPlayer = false
    private var previousFrame: NSRect?
    private var overlayExpanded = false
    private var isUiLoaded = false

    func setupWindow() {
        let initialFrame = NSRect(x: 0, y: 0, width: 1240, height: 820)
        mainWindow = NSWindow(
            contentRect: initialFrame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        mainWindow.title = "Aura"
        mainWindow.titleVisibility = .hidden
        mainWindow.titlebarAppearsTransparent = true
        mainWindow.isReleasedWhenClosed = false
        mainWindow.backgroundColor = NSColor(calibratedRed: 0.01, green: 0.01, blue: 0.01, alpha: 1.0)
        mainWindow.minSize = NSSize(width: 420, height: 500)
        mainWindow.center()

        guard let contentView = mainWindow.contentView else { return }
        contentView.wantsLayer = true

        // 1. Configure Native Safari WKWebView for YouTube Music (Spatial Audio + WebKit MediaSession)
        let ytmConfig = WKWebViewConfiguration()
        ytmConfig.websiteDataStore = WKWebsiteDataStore.default()
        ytmConfig.mediaTypesRequiringUserActionForPlayback = []
        ytmConfig.allowsAirPlayForMediaPlayback = true

        let ytmScript = WKUserScript(
            source: YouTubeEnhancerScripts.youtubeMusicEnhancerJS,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: true
        )
        ytmConfig.userContentController.addUserScript(ytmScript)

        ytmWebView = InstantClickWKWebView(frame: .zero, configuration: ytmConfig)
        ytmWebView.customUserAgent = AppConfig.safariUserAgent
        ytmWebView.uiDelegate = self
        ytmWebView.navigationDelegate = self
        ytmWebView.allowsBackForwardNavigationGestures = false
        ytmWebView.setValue(false, forKey: "drawsBackground")
        contentView.addSubview(ytmWebView)

        // 2. Configure Top Bar & Importer Modal Overlay WKWebView
        let uiConfig = WKWebViewConfiguration()
        uiConfig.websiteDataStore = WKWebsiteDataStore.default()
        uiConfig.setURLSchemeHandler(AuraSchemeHandler(), forURLScheme: "aura")
        uiConfig.userContentController.add(self, name: "auraBridge")

        let bridgeScript = WKUserScript(
            source: YouTubeEnhancerScripts.uiBridgeInjectionJS,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        uiConfig.userContentController.addUserScript(bridgeScript)

        uiWebView = InstantClickWKWebView(frame: .zero, configuration: uiConfig)
        uiWebView.customUserAgent = AppConfig.safariUserAgent
        uiWebView.navigationDelegate = self
        uiWebView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) {
            uiWebView.underPageBackgroundColor = .clear
        }
        contentView.addSubview(uiWebView)

        layoutWebViews()
        NotificationCenter.default.addObserver(
            forName: NSView.frameDidChangeNotification,
            object: contentView,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.layoutWebViews()
            }
        }
        contentView.postsFrameChangedNotifications = true

        // Load UI and restore cached Google cookies before loading YouTube Music
        uiWebView.load(URLRequest(url: AppConfig.localUIEntryURL))

        Task { @MainActor in
            await GoogleAuthService.shared.restoreCachedCookiesIntoWebKit()
            self.ytmWebView.load(URLRequest(url: AppConfig.youtubeMusicHomeURL))
            if self.isUiLoaded {
                self.emitAuthSuccessToUI()
            }
        }

        mainWindow.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func emitAuthSuccessToUI() {
        guard isUiLoaded else { return }
        uiWebView.evaluateJavaScript(
            "window.__auraEmitAuthSuccess && window.__auraEmitAuthSuccess();",
            completionHandler: nil
        )
    }

    func showWindow() {
        mainWindow?.makeKeyAndOrderFront(nil)
    }

    private func clampFrameToVisibleScreen(_ frame: NSRect) -> NSRect {
        guard let visible = (mainWindow.screen ?? NSScreen.main)?.visibleFrame else {
            return frame
        }
        var r = frame
        r.size.width = min(r.size.width, visible.width)
        r.size.height = min(r.size.height, visible.height)
        r.origin.x = min(max(r.origin.x, visible.minX), visible.maxX - r.width)
        r.origin.y = min(max(r.origin.y, visible.minY), visible.maxY - r.height)
        return r
    }

    private func layoutWebViews() {
        guard let contentView = mainWindow.contentView else { return }
        contentView.wantsLayer = true
        let bounds = contentView.bounds
        let topBarHeight: CGFloat = 40.0

        ytmWebView.frame = NSRect(
            x: 0,
            y: 0,
            width: bounds.width,
            height: max(0, bounds.height - topBarHeight)
        )

        if overlayExpanded {
            uiWebView.frame = bounds
        } else {
            uiWebView.frame = NSRect(
                x: 0,
                y: max(0, bounds.height - topBarHeight),
                width: bounds.width,
                height: topBarHeight
            )
        }
    }

    // MARK: - WKUIDelegate & WKNavigationDelegate
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if webView == ytmWebView,
           navigationAction.targetFrame?.isMainFrame == true,
           let urlStr = navigationAction.request.url?.absoluteString {
            let isExplicitLogin =
                (urlStr.contains("accounts.google.com/v3/signin")
                    || urlStr.contains("accounts.google.com/ServiceLogin"))
                && !urlStr.contains("passive=true")
                && !urlStr.contains("RotateCookies")
            if isExplicitLogin {
                decisionHandler(.cancel)
                Task { @MainActor in
                    let ok = await GoogleAuthService.shared.authenticateViaExternalChrome()
                    if ok {
                        self.ytmWebView.load(URLRequest(url: AppConfig.youtubeMusicHomeURL))
                        self.emitAuthSuccessToUI()
                    }
                }
                return
            }
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let urlStr = navigationAction.request.url?.absoluteString,
           urlStr.contains("accounts.google.com") || urlStr.contains("youtube.com/signin") {
            Task { @MainActor in
                let ok = await GoogleAuthService.shared.authenticateViaExternalChrome()
                if ok {
                    self.ytmWebView.load(URLRequest(url: AppConfig.youtubeMusicHomeURL))
                    self.emitAuthSuccessToUI()
                }
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView == uiWebView {
            isUiLoaded = true
            emitAuthSuccessToUI()
        } else if webView == ytmWebView, isUiLoaded {
            emitAuthSuccessToUI()
        }
    }

    // MARK: - WKScriptMessageHandler (auraBridge)
    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        guard let body = message.body as? [String: Any],
              let cmd = body["cmd"] as? String else { return }
        let reqId = (body["id"] as? Int) ?? 0
        let args = (body["args"] as? [String: Any]) ?? [:]

        switch cmd {
        case "setOverlayExpanded":
            let expanded = (args["expanded"] as? Bool) ?? false
            if overlayExpanded != expanded {
                overlayExpanded = expanded
                layoutWebViews()
                let blurJS = expanded
                    ? "document.body.style.transition = 'filter 0.18s ease'; document.body.style.filter = 'blur(8px) brightness(0.6)';"
                    : "document.body.style.filter = 'none';"
                ytmWebView.evaluateJavaScript(blurJS, completionHandler: nil)
            }
            return
        case "startWindowDrag":
            if let event = NSApp.currentEvent {
                mainWindow.performDrag(with: event)
            }
            return
        case "webviewGoBack":
            ytmWebView.goBack()
            return
        case "webviewGoForward":
            ytmWebView.goForward()
            return
        case "webviewReload":
            ytmWebView.reload()
            return
        case "webviewLoadURL":
            if let urlStr = args["url"] as? String, let url = URL(string: urlStr) {
                ytmWebView.load(URLRequest(url: url))
            }
            return
        default:
            break
        }

        Task { @MainActor in
            var responseObj: Any = NSNull()

            switch cmd {
            case "webviewEvalJS":
                if let code = args["code"] as? String {
                    responseObj = await YouTubeMusicService.shared.evaluateInWebView(ytmWebView, js: code) ?? NSNull()
                }

            case "getUserProfile":
                if await GoogleAuthService.shared.getSapisidFromCookieStore() != nil {
                    let profile = await YouTubeMusicService.shared.fetchAccountProfile(in: ytmWebView)
                    responseObj = [
                        "loggedIn": true,
                        "name": (profile["name"] as? String) ?? "",
                        "email": (profile["email"] as? String) ?? "",
                        "avatar": (profile["avatar"] as? String) ?? "",
                    ]
                } else {
                    responseObj = ["loggedIn": false]
                }

            case "getSapisidAuthHeader":
                if let header = await GoogleAuthService.shared.buildSapisidHashHeader() {
                    responseObj = header
                }

            case "openGoogleLogin":
                let ok = await GoogleAuthService.shared.authenticateViaExternalChrome()
                if ok {
                    ytmWebView.load(URLRequest(url: AppConfig.youtubeMusicHomeURL))
                    emitAuthSuccessToUI()
                }
                responseObj = ok

            case "logout":
                await GoogleAuthService.shared.clearYouTubeSession()
                ytmWebView.reload()
                responseObj = true

            case "connectSpotify":
                let force = (args["forceReauth"] as? Bool) ?? false
                responseObj = await SpotifyService.shared.connectOAuth(forceReauth: force)

            case "getCachedSpotify":
                responseObj = await SpotifyService.shared.fetchUserLibrary()

            case "getSpotifyPlaylistTracks":
                let plId = (args["playlistId"] as? String) ?? ""
                responseObj = await SpotifyService.shared.fetchPlaylistTracks(playlistId: plId)

            case "connectAppleMusic":
                responseObj = await AppleMusicService.shared.fetchLibrary()

            case "getApplePlaylistTracks":
                let plId = (args["playlistId"] as? String) ?? ""
                responseObj = await AppleMusicService.shared.fetchPlaylistTracks(playlistId: plId)

            case "parseExternalMusicUrl":
                let rawUrl = (args["url"] as? String) ?? ""
                responseObj = await SpotifyService.shared.parsePublicSpotifyUrl(rawUrl)

            case "searchYouTubeMusicTrack":
                let title = (args["title"] as? String) ?? ""
                let artist = (args["artist"] as? String) ?? ""
                if let match = await YouTubeMusicService.shared.searchTrack(
                    in: ytmWebView,
                    title: title,
                    artist: artist
                ) {
                    responseObj = match
                }

            case "playYouTubeMusicVideo":
                let videoId = (args["videoId"] as? String) ?? ""
                if !videoId.isEmpty {
                    responseObj = await YouTubeMusicService.shared.playVideo(in: ytmWebView, videoId: videoId)
                } else {
                    responseObj = false
                }

            case "aiRecommendSongs":
                let prompt = (args["prompt"] as? String) ?? ""
                responseObj = await AISearchService.shared.recommendSongs(prompt: prompt, in: ytmWebView)

            case "getAiApiKey":
                responseObj = AISearchService.shared.getGeminiApiKey()

            case "setAiApiKey":
                let key = (args["apiKey"] as? String) ?? ""
                responseObj = AISearchService.shared.setGeminiApiKey(key)

            case "getAiStatus":
                responseObj = await AISearchService.shared.getAiStatus()

            case "saveAiConfig":
                let model = (args["model"] as? String) ?? "openai-fast"
                let key = (args["apiKey"] as? String) ?? ""
                responseObj = await AISearchService.shared.saveAiConfig(model: model, apiKey: key)

            case "toggleMiniPlayer":
                if !isMiniPlayer {
                    previousFrame = mainWindow.frame
                    mainWindow.level = .floating
                    let f = mainWindow.frame
                    mainWindow.setFrame(
                        clampFrameToVisibleScreen(
                            NSRect(x: f.maxX - 420, y: f.minY, width: 420, height: 580)
                        ),
                        display: true,
                        animate: true
                    )
                    isMiniPlayer = true
                } else {
                    mainWindow.level = .normal
                    if let prev = previousFrame {
                        mainWindow.setFrame(clampFrameToVisibleScreen(prev), display: true, animate: true)
                    }
                    isMiniPlayer = false
                }
                responseObj = isMiniPlayer

            case "isMiniPlayer":
                responseObj = isMiniPlayer

            default:
                break
            }

            if reqId > 0 {
                sendBridgeResponse(id: reqId, result: responseObj)
            }
        }
    }

    private func sendBridgeResponse(id: Int, result: Any) {
        let wrapper: [String: Any] = ["val": result]
        guard let data = try? JSONSerialization.data(withJSONObject: wrapper),
              let jsonStr = String(data: data, encoding: .utf8) else {
            uiWebView.evaluateJavaScript("window.__auraResolve(\(id), null);", completionHandler: nil)
            return
        }
        uiWebView.evaluateJavaScript("window.__auraResolve(\(id), (\(jsonStr)).val);", completionHandler: nil)
    }
}
