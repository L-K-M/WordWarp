# Native release publication proposal

This is a proposal for a future workflow change. It does not enable publication,
create a tag, or run a release.

## Current behavior

The read-only CI workflow builds and uploads these downloadable artifacts with
SHA-256 checksums. Downloads are retained for 14 days:

| Target | File | Verification |
| --- | --- | --- |
| Apple silicon | `WordWarp-macOS-arm64.zip` | Architecture, ad-hoc signature, actual WKWebView editor self-test |
| Intel Mac | `WordWarp-macOS-x86_64.zip` | Architecture, ad-hoc signature, actual WKWebView editor self-test |
| Android | `WordWarp-android-debug.apk` | Debug APK signature, Android lint, instrumentation-test compilation |
| Ubuntu 24.04 | `WordWarp-linux-all.deb` | Package installation and actual GTK/WebKit editor self-test |

Native browser tests also run in Chromium and WebKit. Android device tests have
been exercised locally; CI currently compiles those tests without running an
emulator.

The existing tag release workflow calls the full CI workflow, so its gate includes
these builds. Its publication step remains unchanged: it publishes the portable
web archive and container image, without attaching the native downloads to the
GitHub Release.

## Proposed change after authorization

Extend the existing release packaging job, after its successful CI dependency, to:

1. Download the four native artifacts from the same workflow run and attempt using
   `wordwarp-native-*-${{ github.sha }}-${{ github.run_attempt }}`. Do not fetch
   artifacts from another revision or rebuild the applications for publication.
2. Require exactly the expected four files and their four checksum files. Verify
   every checksum before copying any file into the release artifact directory;
   fail the job on missing, additional, or mismatched files.
3. Give the files versioned names that clearly describe their signing status:
   `wordwarp-vX.Y.Z-macos-arm64-ad-hoc.zip`,
   `wordwarp-vX.Y.Z-macos-x86_64-ad-hoc.zip`,
   `wordwarp-vX.Y.Z-android-debug.apk`, and
   `wordwarp-vX.Y.Z-ubuntu-all.deb`. Generate matching checksums for the renamed
   files and include them in the existing verified release artifact upload.
4. Let the existing protected release publication job attach those verified files
   to the GitHub Release along with the web archive. Keep its tag/version/main
   checks, environment protection, concurrency, timeout, and permissions intact.

Use the existing immutable download/upload action pins. CI retains only
`contents: read`; no native signing secrets or additional publication credentials
are introduced. The existing release wrapper remains the only supported way to
prepare and push a release tag.

## Download labels and release notes

The Mac applications are ad-hoc signed and are not notarized. The Android package
uses a CI-generated debug signing key, which is not stable between runners;
installing a later build may require uninstalling the previous build first, so
users must save their documents before doing so. These are development builds,
not App Store or Play Store packages. The Ubuntu package is architecture
independent Python and bundled JavaScript, with native GTK/WebKit dependencies
installed by apt on Ubuntu 24.04 or a compatible distribution.

Production signing, notarization, store submission, and stable Android update
signing would require separate decisions and configuration.

## Authorization boundary

Automatic approval review rejected the proposed release workflow edit because it
would upload newly built native binaries to GitHub Releases, while the authorized
request covered CI builds rather than publication of repository-derived binaries.
That edit was not applied. Explicit authorization to attach native downloads to
future GitHub Releases is needed before implementing this proposal; no immediate
release is implied by that authorization.
