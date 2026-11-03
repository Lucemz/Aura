#!/bin/bash
set -e

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "1. Compiling React Frontend (Vite + TypeScript)..."
npm run build

echo "2. Creating native macOS Safari WKWebView App Bundle..."
APP_BUNDLE="$ROOT_DIR/release/Aura.app"
DMG_PATH="$ROOT_DIR/release/Aura-Safari-arm64.dmg"

rm -rf "$APP_BUNDLE" "$DMG_PATH"
mkdir -p "$APP_BUNDLE/Contents/MacOS"
mkdir -p "$APP_BUNDLE/Contents/Resources"

echo "3. Compiling modular Swift sources (Apple Silicon arm64)..."
swiftc -O \
  macos/Sources/Core/AppConfig.swift \
  macos/Sources/Core/CryptoUtils.swift \
  macos/Sources/WebEngine/AuraSchemeHandler.swift \
  macos/Sources/WebEngine/YouTubeEnhancerScripts.swift \
  macos/Sources/Services/GoogleAuthService.swift \
  macos/Sources/Services/SpotifyService.swift \
  macos/Sources/Services/AppleMusicService.swift \
  macos/Sources/Services/YouTubeMusicService.swift \
  macos/Sources/Services/AISearchService.swift \
  macos/Sources/UI/MainWindowController.swift \
  macos/Sources/App/AppDelegate.swift \
  macos/Sources/App/main.swift \
  -o "$APP_BUNDLE/Contents/MacOS/Aura" \
  -framework Cocoa \
  -framework WebKit \
  -framework CryptoKit \
  -framework Network \
  -framework UniformTypeIdentifiers

echo "4. Copying Info.plist, Icon, and Frontend dist assets..."
cp "$ROOT_DIR/macos/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
if [ -f "$ROOT_DIR/build/icon.icns" ]; then
  cp "$ROOT_DIR/build/icon.icns" "$APP_BUNDLE/Contents/Resources/icon.icns"
fi
cp -R "$ROOT_DIR/dist" "$APP_BUNDLE/Contents/Resources/dist"

echo "5. Signing bundle ad-hoc for macOS Gatekeeper & Spatial Audio..."
codesign --force --deep --sign - "$APP_BUNDLE"

echo "6. Creating macOS DMG Installer ($DMG_PATH)..."
STAGE_DIR="$ROOT_DIR/release/dmg-stage"
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
cp -R "$APP_BUNDLE" "$STAGE_DIR/Aura.app"
ln -s /Applications "$STAGE_DIR/Applications"
hdiutil create -volname "Instalar Aura (Safari Engine)" -srcfolder "$STAGE_DIR" -ov -format UDZO "$DMG_PATH" >/dev/null
rm -rf "$STAGE_DIR"

echo "✓ Build complete:"
ls -lh "$DMG_PATH"
du -sh "$APP_BUNDLE"
