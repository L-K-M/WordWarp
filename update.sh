#!/usr/bin/env bash
# Update a WordWarp deployment: fast-forward the selected branch, rebuild the
# production image, and recreate the Docker Compose service.
#
# Usage: ./update.sh [branch]
#
# Syncs the current branch by default. Run this on the deployment host from any
# directory. Requires git with pull access and Docker with the Compose plugin.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

case "${1:-}" in
  -h|--help)
    awk 'NR == 1 && /^#!/ {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
    exit 0
    ;;
esac

if [[ "$#" -gt 1 ]]; then
  echo "!! usage: ./update.sh [branch]" >&2
  exit 2
fi

branch="${1:-$(git symbolic-ref --short -q HEAD || true)}"
if [[ -z "$branch" ]]; then
  echo "!! cannot determine the current branch; pass one explicitly" >&2
  exit 1
fi
if ! git check-ref-format --branch "$branch" >/dev/null 2>&1; then
  echo "!! invalid branch name: $branch" >&2
  exit 2
fi

command -v docker >/dev/null 2>&1 || {
  echo "!! docker is not installed" >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "!! Docker Compose plugin is unavailable" >&2
  exit 1
}

# Building a mixture of local edits and remote source is not a reproducible
# deployment. Untracked files such as host-local notes remain allowed.
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "!! tracked files have local changes; commit or restore them before updating" >&2
  exit 1
fi

echo "==> Fetching '$branch' from origin"
git fetch origin --prune
if ! git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
  echo "!! origin has no branch named '$branch'" >&2
  exit 1
fi

current="$(git symbolic-ref --short -q HEAD || true)"
if [[ "$current" != "$branch" ]]; then
  echo "==> Switching to '$branch'"
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git switch "$branch"
  else
    git switch --track -c "$branch" "origin/$branch"
  fi
fi

echo "==> Fast-forwarding '$branch'"
git merge --ff-only "origin/$branch"

echo "==> Building the production image"
# Build first so the existing container keeps serving if compilation fails.
docker compose build --pull

echo "==> Recreating the service"
docker compose up -d --remove-orphans --wait --wait-timeout 90

echo "==> Pruning dangling images"
docker image prune -f >/dev/null || true

echo "==> Stack status"
docker compose ps
