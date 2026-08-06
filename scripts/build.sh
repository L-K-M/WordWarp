#!/usr/bin/env bash
# Installs the exact locked dependencies, runs the headless quality gate, and
# builds the portable static WordWarp site into dist/.
#
# Usage: scripts/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

case "${1:-}" in
  "") ;;
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

echo "==> Building WordWarp"
npm run check

echo "==> Static site ready in dist/"
