import Foundation
import CryptoKit

enum CryptoUtils {
    /// Generates lowercase hexadecimal SHA-1 digest used by YouTube Music's SAPISIDHASH header
    static func sha1Hex(_ input: String) -> String {
        let data = Data(input.utf8)
        let digest = Insecure.SHA1.hash(data: data)
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// URL-safe Base64 encoding without padding (RFC 7636 PKCE)
    static func base64URLEncode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Generates PKCE (codeVerifier, codeChallenge) pair for OAuth 2.0 S256 flow
    static func generatePKCEPair() -> (verifier: String, challenge: String) {
        var randomBytes = [UInt8](repeating: 0, count: 32)
        _ = SecRandomCopyBytes(kSecRandomDefault, randomBytes.count, &randomBytes)
        let verifier = base64URLEncode(Data(randomBytes))
        let digest = SHA256.hash(data: Data(verifier.utf8))
        let challenge = base64URLEncode(Data(digest))
        return (verifier, challenge)
    }
}
