#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The macOS build requires macOS and Xcode command-line tools." >&2
  exit 1
fi
if [[ "${1:-}" != "--skip-web" ]]; then
  npm run build:native
fi
for REQUIRED in native.html licenses/index.html licenses/manifest.json fonts/SOURCES.json; do
  if [[ ! -f "dist-native/$REQUIRED" ]]; then
    echo "Missing dist-native/$REQUIRED; run npm run build:native before packaging." >&2
    exit 1
  fi
done
BUILD="$ROOT/native/macos/build"
APP="$BUILD/WordWarp.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$BUILD/ModuleCache"
cp native/macos/Info.plist "$APP/Contents/Info.plist"
VERSION="$(node -p 'JSON.parse(require("fs").readFileSync("package.json", "utf8")).version')"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$APP/Contents/Info.plist"
# Replacing the copied web bundle prevents obsolete hashed assets accumulating across builds.
if [[ -d "$APP/Contents/Resources/Web" ]]; then
  rm -rf "$APP/Contents/Resources/Web"
fi
cp -R dist-native "$APP/Contents/Resources/Web"
ARCH="${WORDWARP_MACOS_ARCH:-$(uname -m)}"
xcrun swiftc -swift-version 5 -O -parse-as-library \
  -target "$ARCH-apple-macosx14.0" -module-cache-path "$BUILD/ModuleCache" \
  -framework SwiftUI -framework AppKit -framework WebKit -framework UniformTypeIdentifiers \
  native/macos/Sources/WordWarpApp.swift native/macos/Sources/StudioModel.swift \
  native/macos/Sources/InspectorFields.swift native/macos/Sources/EditorViews.swift -o "$APP/Contents/MacOS/WordWarp"
xcrun swift -module-cache-path "$BUILD/ModuleCache" native/macos/Sources/GenerateIcon.swift \
  public/wordwarp-icon.svg "$BUILD/WordWarp.iconset"
iconutil -c icns "$BUILD/WordWarp.iconset" -o "$APP/Contents/Resources/WordWarp.icns"
codesign --force --deep --sign - "$APP"
mkdir -p "$ROOT/artifacts/native"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ROOT/artifacts/native/WordWarp-macOS-$ARCH.zip"
printf 'Built %s\n' "$APP"
printf 'Archive %s\n' "$ROOT/artifacts/native/WordWarp-macOS-$ARCH.zip"
