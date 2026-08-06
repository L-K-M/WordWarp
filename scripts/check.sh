#!/usr/bin/env bash
# Runs WordWarp's complete local quality gate: locked install, static checks,
# unit tests, production build, and Chromium/WebKit browser tests.
#
# Usage: scripts/check.sh [--install-browsers]
#   --install-browsers  Install Playwright browser binaries before testing.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

INSTALL_BROWSERS=false
case "${1:-}" in
  "") ;;
  --install-browsers) INSTALL_BROWSERS=true ;;
  -h|--help)
    awk 'NR == 1 && /^#!/ {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
    exit 0
    ;;
  *)
    echo "!! unknown option: $1" >&2
    exit 2
    ;;
esac

echo "==> Installing locked dependencies"
npm ci

echo "==> Running static checks, unit tests, and production build"
npm run check

if "$INSTALL_BROWSERS"; then
  echo "==> Installing Playwright browsers"
  ./node_modules/.bin/playwright install chromium webkit
fi

echo "==> Running browser tests"
npm run test:e2e
