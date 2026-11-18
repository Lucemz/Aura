import Foundation
import WebKit

@MainActor
final class YouTubeMusicService {
    static let shared = YouTubeMusicService()

    /// Evaluates JavaScript (including async Promises) inside the live YouTube Music Safari `WKWebView`
    func evaluateInWebView(_ webView: WKWebView, js: String) async -> Any? {
        await withCheckedContinuation { continuation in
            var expr = js.trimmingCharacters(in: .whitespacesAndNewlines)
            while expr.hasSuffix(";") {
                expr.removeLast()
                expr = expr.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            let body = "return await (\(expr));"
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
        guard let paramsData = try? JSONSerialization.data(withJSONObject: [query, title, artist]),
              let paramsJSON = String(data: paramsData, encoding: .utf8) else {
            return nil
        }

        let searchJS = """
        (async function() {
          try {
            const [q, reqTitle, reqArtist] = (\(paramsJSON));
            const ytcfg = window.ytcfg;
            const context = ytcfg ? ytcfg.get('INNERTUBE_CONTEXT') : {
              client: { clientName: 'WEB_REMIX', clientVersion: '1.20241020.01.00', hl: (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es-419' : 'en', gl: 'US' }
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
            const data = await res.json();
            const sections = data?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
            for (const sec of sections) {
              const items = sec.musicShelfRenderer?.contents || [];
              for (const it of items) {
                const item = it.musicResponsiveListItemRenderer;
                if (!item) continue;
                const videoId =
                  item.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId ||
                  item.playlistItemData?.videoId ||
                  item.navigationEndpoint?.watchEndpoint?.videoId;
                if (videoId) {
                  const matchedTitle = item.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || reqTitle;
                  const matchedArtist = item.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.map(r => r.text).join('') || reqArtist;
                  const thumb = item.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)?.[0]?.url;
                  return JSON.stringify({
                    videoId,
                    title: matchedTitle,
                    artist: matchedArtist,
                    thumbnail: thumb || ('https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg')
                  });
                }
              }
            }
            const raw = JSON.stringify(data);
            const match = raw.match(/"videoId"\\s*:\\s*"([a-zA-Z0-9_-]{11})"/);
            if (match && match[1]) {
              return JSON.stringify({
                videoId: match[1],
                title: reqTitle,
                artist: reqArtist,
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

    /// Plays a YouTube Music track immediately by `videoId` inside the `WKWebView`
    func playVideo(in webView: WKWebView, videoId: String) async -> Bool {
        let trimmed = videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: "^[a-zA-Z0-9_-]{11}$", options: .regularExpression) != nil,
              let idData = try? JSONSerialization.data(withJSONObject: [trimmed]),
              let idJSON = String(data: idData, encoding: .utf8) else {
            return false
        }

        let playJS = """
        (async function() {
          const vid = (\(idJSON))[0];
          try {
            // 1. Try YouTube Music Polymer native navigation command
            const app = document.querySelector('ytmusic-app');
            if (app) {
              if (typeof app.navigate === 'function') {
                app.navigate({ watchEndpoint: { videoId: vid } });
              }
              app.dispatchEvent(new CustomEvent('yt-navigate', {
                bubbles: true,
                composed: true,
                detail: { endpoint: { watchEndpoint: { videoId: vid } } }
              }));
              app.dispatchEvent(new CustomEvent('yt-action', {
                bubbles: true,
                composed: true,
                detail: {
                  actionName: 'yt-navigate',
                  args: [{ watchEndpoint: { videoId: vid } }]
                }
              }));
            }

            // 2. Also try movie_player API if a player instance is already active
            const mp = document.getElementById('movie_player');
            if (mp && typeof mp.loadVideoById === 'function') {
              mp.loadVideoById(vid);
              if (typeof mp.playVideo === 'function') mp.playVideo();
            }

            // Wait briefly and check if the active video matches vid
            await new Promise(r => setTimeout(r, 250));
            const currentVid = mp && typeof mp.getVideoData === 'function'
              ? (mp.getVideoData() && mp.getVideoData().video_id)
              : null;

            if (currentVid === vid) {
              const v = document.querySelector('video');
              if (v && v.paused) v.play().catch(() => {});
              return 'spa-ok';
            }
          } catch (e) {}

          // 3. Guaranteed fallback: navigate directly to the YouTube Music watch URL
          window.location.href = 'https://music.youtube.com/watch?v=' + vid;
          return 'nav-fallback';
        })()
        """
        _ = await evaluateInWebView(webView, js: playJS)
        return true
    }

    /// Fetches the signed-in YouTube Music account profile from `account_menu` inside the `WKWebView`
    @MainActor
    func fetchAccountProfile(in webView: WKWebView) async -> [String: Any] {
        let profileJS = """
        (async function() {
          try {
            const ytcfg = window.ytcfg;
            const context = ytcfg ? ytcfg.get('INNERTUBE_CONTEXT') : null;
            const apiKey = ytcfg ? ytcfg.get('INNERTUBE_API_KEY') : '';
            if (!context) {
              const imgAvatar = document.querySelector('ytmusic-settings-button img')?.src || '';
              return JSON.stringify({ name: '', email: '', avatar: imgAvatar });
            }
            const url = 'https://music.youtube.com/youtubei/v1/account/account_menu?alt=json' + (apiKey ? '&key=' + apiKey : '');
            const res = await fetch(url, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ context })
            });
            const data = await res.json();
            const header = data?.actions?.[0]?.openPopupAction?.popup?.multiPageMenuRenderer?.header?.activeAccountHeaderRenderer;
            const name = header?.accountName?.runs?.[0]?.text || '';
            const email = header?.email?.runs?.[0]?.text || header?.channelHandle?.runs?.[0]?.text || '';
            const avatar = header?.accountPhoto?.thumbnails?.slice(-1)?.[0]?.url || document.querySelector('ytmusic-settings-button img')?.src || '';
            return JSON.stringify({ name, email, avatar });
          } catch (e) {
            const fallbackAvatar = document.querySelector('ytmusic-settings-button img')?.src || '';
            return JSON.stringify({ name: '', email: '', avatar: fallbackAvatar });
          }
        })()
        """

        if let jsonStr = await evaluateInWebView(webView, js: profileJS) as? String,
           let data = jsonStr.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return [
                "name": parsed["name"] as? String ?? "",
                "email": parsed["email"] as? String ?? "",
                "avatar": parsed["avatar"] as? String ?? "",
            ]
        }
        return ["name": "", "email": "", "avatar": ""]
    }
}
