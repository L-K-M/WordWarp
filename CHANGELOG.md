# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-09-29

### Added

- Web editor: warped-text studio with envelope warps, editable effects,
  material/texture preset library, animation, seeded deterministic rendering,
  share URLs, and alpha-correct PNG/APNG/GIF export.
- PWA: offline service worker, manifest, configurable `VITE_BASE_PATH`
  (root for Docker, `/WordWarp/` for Pages, `./` for release archives).
- Native editors sharing the web semantic controls: macOS `.app`
  (`scripts/build-macos.sh`), Android debug APK
  (`scripts/build-android.sh`), and Ubuntu GTK4/WebKitGTK6 `.deb` +
  `.flatpak` packages (`scripts/build-linux.sh`, `scripts/build-flatpak.sh`).
- Docker Compose deployment (`compose.yaml`, `nginx.conf`, `Dockerfile`)
  with `./update.sh` for deployment hosts.
- CI: quality gate, browser/PWA matrix, native macOS/Android/Linux build
  and self-test jobs, and container verification; `release.yml` re-runs CI
  and publishes the portable archive, checksum, GHCR image, and GitHub
  Release for `v*` tags.
- `scripts/release.sh` over the shared lkm-release engine; README version
  marker kept in step.

[0.1.0]: https://github.com/L-K-M/WordWarp/releases/tag/v0.1.0
