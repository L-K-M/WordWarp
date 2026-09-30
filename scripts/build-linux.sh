#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
SKIP_WEB=0
FLATPAK=0
for arg in "$@"; do
  case "$arg" in
    --skip-web) SKIP_WEB=1 ;;
    --flatpak) FLATPAK=1 ;;
    *)
      echo "Usage: scripts/build-linux.sh [--skip-web] [--flatpak]" >&2
      exit 2
      ;;
  esac
done
[[ $SKIP_WEB -eq 1 ]] || npm run build:native
python3 native/linux/build_deb.py
[[ $FLATPAK -eq 0 ]] || bash scripts/build-flatpak.sh --skip-web
