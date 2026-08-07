# WordWarp agent and contributor notes

WordWarp is a client-only React/Vite PWA for building and exporting warped text effects. Read
`PLAN.md` before changing product scope, the document model, rendering, export, or persistence.

## Toolchain and checks

- Node.js 22.23.2 is pinned in `.nvmrc`; npm 10.9.8 is pinned in `package.json`.
- Use `npm ci`, not `npm install`, when verifying a committed lockfile.
- `scripts/check.sh` is the complete local gate: locked install, lint, typecheck, unit tests,
  production build, and Playwright tests in Chromium and WebKit.
- `scripts/build.sh` runs the headless gate and creates the portable static site in `dist/`.
- Browser tests run against Vite's production build, not the development server, so the generated
  service worker and manifest are exercised.

## Architecture invariants

- The app remains static and client-only. Do not add runtime secrets or assume a backend without a
  product decision recorded in `PLAN.md`.
- Every intermediate rendering surface is premultiplied RGBA. Only export readback un-premultiplies.
- The preview and exporter share rendering semantics; do not create a separate simplified exporter.
- Rendering, animation, share URLs, and seeded effects remain deterministic for the same inputs.
- Original and autosaved documents must pass schema validation and migrations before use.
- `DOC_VERSION`, the IndexedDB schema version, and package SemVer are independent. A document or DB
  bump requires a migration and tests; a normal app release changes only package SemVer.
- Large export tiling must account for effect bounds. Reject unsupported combinations rather than
  silently clip output.

## PWA and hosting

- `VITE_BASE_PATH` is the single source for Vite assets, the manifest id/start URL/scope, workers,
  and service-worker scope. Root Docker builds use `/`; Pages and CI browser tests use `/WordWarp/`;
  release archives use `./` for portability.
- PWA changes must pass the production offline test and the configured-base-path test.
- Service workers require HTTPS or localhost. Do not claim PWA support for `file://` archives.
- Do not put secrets in `VITE_*` variables; Vite exposes them to the client bundle.
- Keep `nginx.conf` navigation fallback and no-cache rules for `sw.js`, the manifest, and HTML.

## CI/CD

- `ci.yml` is secret-free and read-only. It checks source, browsers/PWA, and Docker Compose on PRs,
  `main`, manual dispatch, and release workflow calls.
- `pages.yml` deploys only a successful CI revision that is still current `main`, and only when
  `WORDWARP_PAGES_ENABLED=true`.
- `release.yml` accepts `vX.Y.Z` tags whose commit is on `main` and whose version matches both npm
  files. It re-runs CI, then publishes a portable archive, checksum, GHCR image, and GitHub Release.
- `zai-code-review.yml` uses `pull_request_target` only for non-draft same-repository PRs. It must
  never check out or execute PR code; it reads diffs through the pinned action API.
- Every workflow keeps least-privilege permissions, explicit concurrency, job timeouts, and immutable
  third-party action pins.

## Releases

Use `scripts/release.sh X.Y.Z --push`. Never hand-edit only one npm version file and never create a
`v*` tag by hand. The shared release tool requires a clean tree and updates the README version marker.
Its mutating commands currently require macOS/BSD `sed`; the wrapper fails closed on GNU/Linux.

`dist/`, `node_modules/`, Playwright reports, local environment files, and generated secrets are not
source. Never commit them.
