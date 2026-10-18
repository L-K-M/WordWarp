# Android host

A native Kotlin/Jetpack Compose editor for Android 8.0 (API 26) and newer. The
canvas runs locally in an up-to-date Android System WebView (update it through
Google Play before using the app on older Android releases); the APK bundles all rendering
code, fonts, and presets. The app requests no network or broad storage permission.

## Build

From the repository root, using the Node/npm versions pinned there:

```sh
npm ci
npm run build:android
```

The build script requires Java 17 and an Android SDK with platform 36 and build
tools 35.0.0. It discovers the usual macOS SDK location; elsewhere set
`ANDROID_HOME`. The checksum-verified Gradle 8.14.3 wrapper downloads the pinned
AGP 8.13.2, Kotlin 2.2.21 and AndroidX dependencies on its first run.

Output: `artifacts/native/WordWarp-android-debug.apk`. This is a debug-signed
preview for local installation; it has no production signing key. Copy the APK
to an Android device and open it, or with an authorized attached test device:

```sh
adb install -r artifacts/native/WordWarp-android-debug.apk
```

Android Studio can also open this directory after `npm run build:native` from
the repository root. The Gradle asset source points to `../../dist-native`, and
fails early if that bundle is missing. Use `scripts/build-android.sh --skip-web`
when packaging an already verified shared bundle.

Every debug and release build verifies its resolved runtime dependency inventory
and bundles the original third-party license/NOTICE texts. The app's Document
menu includes a read-only Licenses view; the APK also contains these texts under
`assets/licenses/`. These dependencies, Google Material Icons, and the bundled
fonts are excluded from WordWarp's Unlicense. See [licenses/README.md](licenses/README.md)
for provenance, the fail-closed dependency-update procedure, and the separate
Gradle wrapper notices.

## Verification

With an emulator or authorized test device attached:

```sh
cd native/android
./gradlew :app:lintDebug :app:connectedDebugAndroidTest
```

Instrumentation uses the real bundled WebView and native controls. It verifies
live text, numeric and color bindings, presets, layers/stamps/effects/animation,
actual canvas composition, document save/open through Android's system picker,
transparent PNG and multi-frame APNG/GIF bytes, picker cancellation, pending-edit
restoration, origin restrictions, and malformed export rejection. Reports are
under `app/build/reports/androidTests/connected/debug/`.

## Native editing

Phones keep the canvas visible above a focused Edit, Effects, or Motion panel.
Layers and searchable Styles open as native bottom sheets. On tablets, a tool
rail and persistent inspector sit beside the canvas. Controls use Compose text
fields, sliders, switches, searchable choice dialogs, color/alpha pickers, and
editable contour curves. Effects and motion tracks use compact expandable rows,
with an independent enable checkbox and native action menu. Collapsed rows show
only their header. The inspector follows the selected text or stamp layer.

- Add, duplicate, delete, reorder, hide, and lock text and bundled stamp layers.
- Edit text/font/layout, transforms, every supported warp mode, effect stacks,
  paints/gradient stops, global lighting, and canvas settings.
- Add animation tracks, edit duration/seed/parameters, play, pause, and scrub.
- Drag/resize/rotate/skew selections; pan, pinch to zoom, and fit the artboard.
- New, Open, and Save `.wordwarp` documents through Android's Storage Access
  Framework, with save-before-discard confirmation and schema-validated import.
- Export PNG, APNG, or GIF at 1–4×, with frame rate and progress feedback.
  The shared engine reports budget adjustments and rejects unsupported sizes.

The app atomically autosaves snapshots. Native saved state keeps unacknowledged
field edits across Activity recreation; the system picker retains its pending
file across Activity/process recreation. File delivery reports saved, cancelled,
and error outcomes. No server, account, or broad storage permission is needed.

Bundled fonts and supported text/stamp documents match the shared editor's
rendering semantics. Imported external assets and group/image layers are not
supported by the shared native document format. Distribution is currently a
local debug build; Play distribution, production signing, and physical-device
performance testing remain separate work. Android lint checks minimum-API
compatibility; emulator validation uses Android 16 with a current WebView.
