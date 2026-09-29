#!/usr/bin/env bash
set -euo pipefail
# Build artifacts/native/WordWarp-linux.flatpak: the dist-native web bundle
# plus the GTK4/WebKitGTK shell, packaged on the GNOME runtime for a one-file
# install. Usage: scripts/build-flatpak.sh [--skip-web]
#   --skip-web  reuse an existing dist-native/ (set when the bundle was just built)
#
# The bundle names Flathub as its runtime's source, so installing it fetches
# the GNOME runtime from there. Needs flatpak and flatpak-builder; the runtime
# and SDK come from Flathub (user installation) on the first build.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ "${1:-}" == "--skip-web" ]]; then
  shift
else
  npm run build:native
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: scripts/build-flatpak.sh [--skip-web]" >&2
  exit 2
fi

command -v flatpak-builder >/dev/null 2>&1 && command -v flatpak >/dev/null 2>&1 ||
  { echo "flatpak/flatpak-builder not found: install both" >&2; exit 1; }

VERSION="$(node -p 'require("./package.json").version')"
STAGE="artifacts/flatpak/stage"
rm -rf "$STAGE" artifacts/flatpak/build artifacts/flatpak/repo
mkdir -p "$STAGE/bin" "$STAGE/share/wordwarp" \
  "$STAGE/share/applications" \
  "$STAGE/share/icons/hicolor/512x512/apps" \
  "$STAGE/share/mime/packages" "$STAGE/share/doc/wordwarp"

# /app prefix inside the sandbox; the launcher resolves the shell next to it.
printf '%s\n' '#!/bin/sh' 'exec python3 /app/share/wordwarp/wordwarp.py "$@"' \
  > "$STAGE/bin/wordwarp"
chmod 755 "$STAGE/bin/wordwarp"
cp native/linux/wordwarp.py "$STAGE/share/wordwarp/wordwarp.py"
printf '%s\n' "$VERSION" > "$STAGE/share/wordwarp/VERSION"
cp -R dist-native/. "$STAGE/share/wordwarp/web/"
cp native/linux/app.wordwarp.WordWarp.desktop "$STAGE/share/applications/"
cp native/linux/wordwarp.xml "$STAGE/share/mime/packages/"
# flatpak-builder's icon validation needs a raster (the SVG loader may not be
# present on the runner); render the source SVG at 512px.
if command -v rsvg-convert >/dev/null; then
  rsvg-convert -w 512 -h 512 public/wordwarp-icon.svg \
    -o "$STAGE/share/icons/hicolor/512x512/apps/app.wordwarp.WordWarp.png"
elif command -v magick >/dev/null; then
  magick -background none -size 512x512 public/wordwarp-icon.svg \
    "$STAGE/share/icons/hicolor/512x512/apps/app.wordwarp.WordWarp.png"
else
  { echo "need librsvg2-bin (rsvg-convert) or ImageMagick to render the app icon" >&2; exit 1; }
fi
cp native/linux/README.md "$STAGE/share/doc/wordwarp/"

flatpak remote-add --user --if-not-exists flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo
# --disable-rofiles-fuse: containers (CI) have no FUSE, and a copy-only
# build gains nothing from it.
flatpak-builder --user --install-deps-from=flathub --force-clean \
  --disable-rofiles-fuse --state-dir=artifacts/flatpak/state \
  --repo=artifacts/flatpak/repo \
  artifacts/flatpak/build native/linux/app.wordwarp.WordWarp.yml

mkdir -p artifacts/native
flatpak build-bundle artifacts/flatpak/repo \
  "artifacts/native/WordWarp-linux.flatpak" app.wordwarp.WordWarp --runtime-repo=https://flathub.org/repo/flathub.flatpakrepo
printf 'Flatpak: %s/artifacts/native/WordWarp-linux.flatpak\n' "$ROOT"
