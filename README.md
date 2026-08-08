# WordWarp

**Latest release:** v<!-- version -->0.1.0<!-- /version -->

WordWarp is a browser-based studio for warped, metallic, dimensional text with alpha-correct image
export. The product and rendering decisions are documented in [`PLAN.md`](./PLAN.md).

## Features

- 41 envelope warp presets plus path, mesh, and perspective mapping primitives
- Editable fill, stroke, bevel, glow, shadow, extrusion, texture, reflection, and post effects
- 80+ built-in styles and 24 Office-compatible color ramps
- 40+ built-in styles and 24 Office-compatible color ramps
- Transparent PNG, animated APNG, and GIF export
- Deterministic procedural animation with live reduced-motion-aware preview
- IndexedDB autosave, compressed share URLs, direct manipulation, undo/redo, and offline PWA support
- WebGL2 presentation with a Canvas2D fallback and tiled large-image export

## Development

WordWarp uses Node.js 22.23.2 and npm 10.9.8. Version managers can read `.nvmrc`; CI reads the same
file. Install exactly what `package-lock.json` declares:

```bash
npm ci
./node_modules/.bin/playwright install chromium webkit
npm run dev
```

The complete local gate is:

```bash
scripts/check.sh
```

On a new machine, `scripts/check.sh --install-browsers` also downloads the Playwright browsers.
Linux CI uses Playwright's `--with-deps` mode to install required system packages. Individual checks
remain available as `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and
`npm run test:e2e`.

`scripts/build.sh` performs a clean locked install and creates a portable static site under `dist/`.
Serve that directory over HTTPS (or localhost); service workers and installable PWA behavior do not
work from `file://` URLs.

## Deployment

### Docker

Build and run the production PWA with Docker Compose:

```bash
docker compose up --build
```

Open `http://localhost:8080`. Set `WORDWARP_PORT` to use another host port:

```bash
WORDWARP_PORT=3000 docker compose up --build
```

The service binds to `127.0.0.1` by default. Set `WORDWARP_HOST=0.0.0.0` to expose it on the network,
and put it behind HTTPS anywhere other than localhost. Stop it with `docker compose down`.

On a deployment host, update the current branch and rebuild the service in one step:

```bash
./update.sh
./update.sh main # explicitly select a branch
```

The updater refuses tracked local edits, fast-forwards from `origin`, refreshes base images, builds
before replacing the running container, and waits for the Compose health check.

Tagged releases publish the immutable `ghcr.io/l-k-m/wordwarp:<version>` tag for `linux/amd64` and `linux/arm64`.
The first GHCR package may be private until its package visibility is changed.

### GitHub Pages

`pages.yml` builds WordWarp for `/WordWarp/` and deploys only a successfully tested `main` commit.
Deployment is guarded by the repository variable `WORDWARP_PAGES_ENABLED=true`. The repository is
currently private and its GitHub plan does not provide Pages; leave the variable false until the
repository becomes public or the plan supports private Pages, then enable Pages with GitHub Actions
as its source and set the variable to true.

## Releases

On macOS, install the shared [`lkm-release`](https://github.com/L-K-M/release-tool) tool, then run:

```bash
scripts/release.sh 0.2.0 --push
```

The helper updates `package.json`, `package-lock.json`, and this README marker together, commits the
bump, and creates `v0.2.0`. The tag workflow independently verifies the versions and `main` history,
re-runs CI, publishes a portable `.tar.gz` plus SHA-256 checksum, publishes the GHCR image, and
creates the GitHub Release. Do not create release tags by hand.

The shared release engine currently requires BSD `sed`; the WordWarp wrapper refuses release mutation
on GNU/Linux before changing files. `scripts/release.sh --check` remains portable.

Application SemVer is independent from the serialized document version (`DOC_VERSION`) and IndexedDB
schema version. Only bump those storage versions when their schemas change, with migrations and tests.

See [`CICD.md`](./CICD.md) for workflow details and repository settings.

GIF transparency is one-bit and uses ordered dithering. APNG is the recommended animated format for
soft glows and shadows. Native system fonts use the browser raster path; exact outline-backed
`keepUpright` warping requires an imported TTF/OTF font. Large exports that require tiling reject
reflection effects rather than risk clipped or misaligned pixels.
