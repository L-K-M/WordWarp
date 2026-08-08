# CI/CD

Every WordWarp workflow follows the same contract: least-privilege permissions, explicit concurrency,
timeouts on every job, immutable third-party action commits, locked npm installs, and no persisted
checkout credentials.

## Workflows

### `ci.yml`

- Triggers for every PR, pushes to `main`, manual dispatch, and `workflow_call` from releases.
- Cancels superseded PR runs only. A `main` or tag result is preserved for diagnosis and release gates.
- `quality` runs `npm ci` and `npm run check`, then uploads the generated `dist/` for seven days.
- `browser` tests the Pages build under `/WordWarp/` in desktop Chromium, mobile Chromium, and mobile
  WebKit, and separately tests the portable `./` release build in Chromium. Reports are always
  uploaded; traces and screenshots are retained on failure.
- `container` builds and starts Compose, verifies SPA fallback, manifest media type, and service-worker
  cache headers, then always tears the service down.
- Every `ci.yml` artifact upload is `continue-on-error`. All three are diagnostic — nothing downloads
  them — so a full or unavailable artifact store must not turn a passing gate red, which makes an
  infrastructure failure indistinguishable from a real one. `release.yml` uploads the archive its
  publish job later downloads, so that one stays strict and is expected to fail the run.
- Permissions are `contents: read`; PR code receives no secrets and cannot publish.

Local equivalent:

```bash
scripts/check.sh --install-browsers
docker compose up --build --detach --wait
docker compose down --volumes
```

Deployment hosts use `./update.sh [branch]` to fast-forward source, rebuild before replacement, wait
for the production health check, prune dangling images, and print final Compose status.

### `pages.yml`

- Runs after a successful `CI` workflow for a `main` push.
- The build job is disabled unless the repository variable `WORDWARP_PAGES_ENABLED` equals `true`.
- A read-only preflight compares the tested SHA to the current `main` head; stale or rerun older CI
  results cannot roll the site back.
- Checks out the exact current SHA proved by CI, builds with `VITE_BASE_PATH=/WordWarp/`, verifies the PWA
  files, uploads the official Pages artifact, and deploys through the `github-pages` environment.
- The repository is currently private on a plan without private Pages. Keep the variable false until
  Pages is eligible, enable Settings -> Pages -> GitHub Actions, then set it true.

### `release.yml`

- A pushed `v*` tag starts the workflow; malformed tags fail the SemVer gate.
- The tag must match `package.json`, both lockfile version locations, and a commit in `main` history.
- The reusable CI workflow re-proves source, browser behavior, and the container at the tagged SHA.
- The static package job builds with relative URLs and uploads `wordwarp-vX.Y.Z.tar.gz` plus a SHA-256
  checksum using a read-only token.
- One `release`-environment-gated publisher receives `contents: write` and `packages: write`, publishes
  the immutable full-version `ghcr.io/l-k-m/wordwarp` image for `linux/amd64` and `linux/arm64`, then
  creates the GitHub Release. Release runs are globally serialized and never cancelled.

On macOS, use `scripts/release.sh X.Y.Z --push`; do not create release tags manually. The shared
engine uses BSD `sed`, so the wrapper refuses mutating release commands on GNU/Linux before changing
files. `scripts/release.sh --check` works on either platform.

### `zai-code-review.yml`

- Triggers on opened, reopened, synchronized, and ready non-draft pull requests.
- Runs automatically for same-repository branches. Forks are deliberately excluded because
  `pull_request_target` exposes `ZAI_API_KEY` and a write-capable PR token.
- The workflow never checks out or executes PR code. The action is pinned to the immutable `v0.0.9`
  commit and reads the diff through the API.
- Lockfiles and generated output are excluded; review input is bounded to 120,000 diff characters.
- If `ZAI_API_KEY` is missing, the workflow records a green explanatory skip.

## Secrets and variables

| Name | Kind | Purpose |
| --- | --- | --- |
| `ZAI_API_KEY` | repository secret | GLM 5.2 review API key |
| `WORDWARP_PAGES_ENABLED` | repository variable | Set to `true` only after Pages is eligible and enabled |

GHCR and GitHub Releases use the built-in `GITHUB_TOKEN`; no deployment token is required. No
`VITE_*` value may contain a secret because Vite embeds it in public JavaScript.

## Dependabot and repository settings

Dependabot checks npm, GitHub Actions, and Docker weekly. Enable the dependency graph, vulnerability
alerts, and security updates in repository settings. When the repository plan permits protection,
require every CI job on `main`; do not require external GLM review.

The first GHCR package normally inherits private visibility. Make it public separately if anonymous
pulls are desired. The `release` and `github-pages` environments may be protected with reviewer rules.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| GLM job is skipped | Draft or fork PR. The old `glm-review` label gate no longer exists. |
| GLM job times out | Z.ai is slow or unavailable; retry after checking service/model access. |
| Pages workflow is skipped | `WORDWARP_PAGES_ENABLED` is not `true`, or a newer `main` commit superseded the tested SHA. |
| Pages configuration fails | Enable GitHub Actions as the Pages source and verify plan/private-repo eligibility. |
| Browser test works at `/` but not Pages | Preserve `VITE_BASE_PATH`; run `VITE_BASE_PATH=/WordWarp/ npm run test:e2e`. |
| Release version gate fails | Re-cut with `scripts/release.sh`; tag, package, lockfile, and main history must agree. |
| Container PWA does not update | Preserve no-cache headers for `/sw.js`, `/manifest.webmanifest`, and HTML. |
