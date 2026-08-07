#!/usr/bin/env bash
# Cuts a release: bumps package.json + package-lock.json + README, commits, tags
# "v<version>", and with --push pushes the branch and tag. The tag triggers
# release.yml to re-run all checks, publish the static archive and container,
# and create the GitHub Release.
#
# Usage: scripts/release.sh [X.Y.Z] [--push]
# Shared engine: https://github.com/L-K-M/release-tool (this stub only sets config).
set -euo pipefail

export RELEASE_APP_NAME="WordWarp"
export RELEASE_KIND="npm"
export RELEASE_VERSION_REGEX='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
export RELEASE_CI_NOTE="CI (release.yml) will now verify <tag>, re-run all checks, and publish the WordWarp archive and container."
export RELEASE_INVOKED_AS="scripts/release.sh"

BIN="${LKM_RELEASE_BIN:-lkm-release}"
command -v "$BIN" >/dev/null 2>&1 || {
  echo "error: lkm-release not found - clone https://github.com/L-K-M/release-tool and run ./install.sh" >&2
  exit 1
}

# The shared engine intentionally uses BSD `sed -i ''`. Refuse before it can
# partially bump npm files on a GNU/Linux host.
if [[ "$(uname -s)" != "Darwin" ]]; then
  SAFE=false
  for arg in "$@"; do
    case "$arg" in
      --check|--help|-h|--version) SAFE=true ;;
    esac
  done
  if ! "$SAFE"; then
    echo "error: lkm-release currently requires macOS/BSD sed; no files were changed" >&2
    exit 1
  fi
fi

exec "$BIN" "$@"
