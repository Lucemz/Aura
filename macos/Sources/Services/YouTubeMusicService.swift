import Foundation
import WebKit

@MainActor
final class YouTubeMusicService {
    static let shared = YouTubeMusicService()

    /// Evaluates JavaScript (including async Promises) inside the live YouTube Music Safari `WKWebView`
    func evaluateInWebView(_ webView: WKWebView, js: String) async -> Any? {
        await withCheckedContinuation { continuation in
            let body = "return await (\(js));"
            webView.callAsyncJavaScript(body, arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let val):
                    continuation.resume(returning: val)
                case .failure:
                    webView.evaluateJavaScript(js) { res, _ in
                        continuation.resume(returning: res)
                    }
                }
            }
        }
    }

    /// Searches YouTube Music's InnerTube API inside the live `WKWebView` to find the matching `videoId`
    func searchTrack(in webView: WKWebView, title: String, artist: String) async -> [String: Any]? {
        let query = "\(artist) \(title)".trimmingCharacters(in: .whitespacesAndNewlines)
        guard let queryData = try? JSONSerialization.data(withJSONObject: [query]),
              let queryJSON = String(data: queryData, encoding: .utf8) else {
            return nil
        }

        let searchJS = """
        (async function() {
          try {
            const q = (\(queryJSON))[0];
            const ytcfg = window.ytcfg;
            const context = ytcfg ? ytcfg.get('INNERTUBE_CONTEXT') : {
              client: { clientName: 'WEB_REMIX', clientVersion: '1.20241020.01.00', hl: 'es-419', gl: 'PE' }
            };
            const apiKey = ytcfg ? ytcfg.get('INNERTUBE_API_KEY') : '';
            const url = 'https://music.youtube.com/youtubei/v1/search?alt=json' + (apiKey ? '&key=' + apiKey : '');
            const res = await fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                context,
                query: q,
                params: 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D'
              })
            });
            const text = await res.text();
            const match = text.match(/"videoId"\\s*:\\s*"([a-zA-Z0-9_-]{11})"/);
            if (match && match[1]) {
              return JSON.stringify({
                videoId: match[1],
                title: q,
                artist: '',
                thumbnail: 'https://i.ytimg.com/vi/' + match[1] + '/hqdefault.jpg'
              });
            }
            return null;
          } catch (e) {
            return null;
          }
        })()
        """

        if let jsonStr = await evaluateInWebView(webView, js: searchJS) as? String,
           let data = jsonStr.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return parsed
        }
        return nil
    }

    /// Plays a YouTube Music track immediately by `videoId` inside the SPA without full page reload
    func playVideo(in webView: WKWebView, videoId: String) async -> Bool {
        let safeId = videoId.replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "'", with: "")
        let playJS = """
        (function() {
          try {
            const vid = "\(safeId)";
            const app = document.querySelector('ytmusic-app');
            if (app && typeof app.navigate === 'function') {
              app.navigate({ watchEndpoint: { videoId: vid } });
              return true;
            }
            const a = document.createElement('a');
            a.className = 'yt-simple-endpoint';
            a.href = 'watch?v=' + vid;
            a.data = { watchEndpoint: { videoId: vid } };
            document.body.appendChild(a);
            a.click();
            a.remove();
            return true;
          } catch (e) {
            window.location.href = 'https://music.youtube.com/watch?v=\(safeId)';
            return true;
          }
        })()
        """
        _ = await evaluateInWebView(webView, js: playJS)
        return true
    }
}
