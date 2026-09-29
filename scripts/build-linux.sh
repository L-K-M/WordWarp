#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if [[ "${1:-}" == "--skip-web" ]]; then
  shift
else
  npm run build:native
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: scripts/build-linux.sh [--skip-web]" >&2
  exit 2
fi
python3 native/linux/build_deb.py
