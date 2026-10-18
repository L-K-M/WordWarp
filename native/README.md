# WordWarp native editors

Native macOS, Android and Ubuntu controls around the shared WordWarp rendering engine.
The app, fonts, and presets are bundled locally: no server, Docker, SSH tunnel, or
internet connection is needed. The web PWA continues to build independently.
See [platform design and capability coverage](DESIGN.md) for the workspace decisions.

Original WordWarp material uses the [Unlicense](../LICENSE), subject to the
[third-party exclusions](../LICENSING.md). Each app includes an offline **Licenses**
command: in Help on Mac and the document menu on Android/Ubuntu. Builds include
full font and JavaScript notices; Android also verifies and includes native runtime
dependency notices. `--skip-web` requires a renderer bundle with its license inventory.

## Editing

- Native typography, transform, warp, paint, effect-stack, animation and canvas controls.
- Multiple text/stamp layers, ordering, visibility, locking, duplication, and undo/redo.
- All built-in preset styles, plus editable animation tracks and play/scrub controls.
- Direct selection/move/resize/rotate/skew, pan, zoom, and touch pinch on the canvas.
- PNG export at 1×–4×, APNG and GIF through the shared renderer and export pipeline.
- Open/Save editable .wordwarp JSON through native file dialogs.
- Recovery of the last document from native app storage, validated before use.
- Bundled fonts on every native platform; presets that refer to a system font use Bungee.

The Mac and Ubuntu workspaces provide Layers/Styles on the left, a compact Select/Pan
tool strip beside the canvas, and Object/Effects/Motion/Canvas inspectors on the right.
Text and stamp insertion use separate Insert commands. Effect and animation cards place
their checkbox, disclosure, title and actions in one header; collapsed cards reserve no
body space. Both desktop apps use native document menus, shortcuts, colors and file dialogs.
Android uses focused editing panels and native bottom navigation on phones and a side
inspector on tablets. The web editor shares the semantic inspector definitions and
compact stack organization, while retaining its full font catalog and gradient editor.
Text layers support up to 5000 UTF-16 units. Export uses the web editor's bounds and
memory checks and reports unsupported sizes rather than clipping. Animation exports
report when the frame budget lowers the requested rate. Files require bundled fonts;
future image/group layers, external asset textures, and per-character animation
staggering remain unsupported by the current engine.

## Toolchain

Use Node and npm pinned in `.nvmrc` and `package.json`:

```sh
nvm install
nvm use
npm ci
```

No npm dependencies were added for native packaging. The native projects use the
platform SDKs and, for Android, the pinned Gradle wrapper and Maven dependencies.

## macOS

Requires macOS, Xcode command-line tools, and the pinned Node/npm toolchain.
The application targets macOS 14 or later. The default build targets the host CPU.

```sh
npm run build:macos
open native/macos/build/WordWarp.app
```

The build creates `native/macos/build/WordWarp.app` and
`artifacts/native/WordWarp-macOS-arm64.zip` (or `-x86_64.zip`). Unzip and copy
WordWarp.app to Applications to install. Set `WORDWARP_MACOS_ARCH=x86_64` for an
Intel build. These are locally ad-hoc-signed preview builds, not Developer ID
signed or notarized distribution releases.

The built app has a diagnostic mode that tests its real WKWebView and native PNG
delivery without changing the normal autosaved document:

```sh
native/macos/build/WordWarp.app/Contents/MacOS/WordWarp --self-test /tmp/wordwarp-macos.png
```

## Android

Requires Android SDK platform 36 and build tools 35.0.0, Java 17, and the pinned
Node/npm toolchain. Set `ANDROID_HOME` if the SDK is outside its standard location.
The app targets Android 8.0 or later with an up-to-date Android System WebView.

```sh
npm run build:android
```

The Gradle wrapper is included. Its first build may download dependencies. The
result is `artifacts/native/WordWarp-android-debug.apk`, a debug-signed APK for
local installation; production signing and store submission are separate release
work. See [Android verification instructions](android/README.md) for device tests.

## Ubuntu

The native Linux app requires Ubuntu 24.04 or compatible GTK4, libadwaita and
WebKitGTK 6.0 libraries. The package contains Python and bundled canvas assets,
so it is architecture independent; apt installs the platform libraries.

```sh
npm run build:linux
sudo apt install ./artifacts/native/WordWarp-linux-all.deb
wordwarp
```

The package builder uses Python's standard library and runs on macOS or Linux.
`scripts/build-linux.sh --skip-web` packages an existing `dist-native/` build.
The installed app uses GTK controls and native file dialogs, with the same desktop
workspace organization as the Mac app. See [Ubuntu build and test details](linux/README.md).

## Verification

```sh
VITE_BASE_PATH=/WordWarp/ bash scripts/check.sh
npm run test:native
```

The first command runs the existing web/PWA gate plus the native bridge tests.
The second runs only the native tests, building the native-only web bundle and
exercising both bridge transports in Chromium and WebKit:
font loading, layers/inspectors/history, canvas and multitouch gestures, migrated
document files, PNG transparency/scale, APNG/GIF frames, deterministic export
snapshots, validation/recovery, and offline bundled assets. Browser tests
supplement actual WKWebView, Android WebView and WebKitGTK tests; they do not replace them.

CI builds both Mac CPU variants, builds/lints the Android debug APK, and installs
and exercises the Ubuntu `.deb` under Xvfb. Mac and Ubuntu self-tests run the actual
packaged editor, including editable files and image exports. Android instrumentation
tests are compiled in CI and run separately on a device/emulator. Package downloads
and SHA-256 checksums are retained as CI artifacts for 14 days. Native host builds
are separate from `scripts/check.sh` because they require their platform toolchains.
Ubuntu also runs `python3 native/linux/test_recovery.py` to check acknowledgement
ordering, reload persistence and Discard behavior without requiring a display.

The existing release workflow gates on these builds but publishes only its existing
web/container deliverables. Native release attachments are described in the
[publication proposal](RELEASE-PROPOSAL.md) and are not enabled. Mac builds are not
notarized; CI Android debug keys may differ between runs, requiring an uninstall
before a later APK can be installed. Save documents before removing an app.

`dist-native/`, native build outputs, Gradle caches, and `artifacts/` are ignored.
The bridge contract is in [shared/BRIDGE.md](shared/BRIDGE.md).
