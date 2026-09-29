# WordWarp for macOS

A native SwiftUI/AppKit editor around WordWarp's shared, interactive drawing engine.
The layers list, style browser, contextual inspectors, color controls, menus, file
panels, animation controls and export settings are native. Only the canvas lives in
a confined `WKWebView`; every resource and font ships in the application bundle.

## Editing workspace

- **Layers / Styles sidebar:** select, add text or catalog stamps, duplicate, delete,
  reorder by dragging or commands, lock and show/hide layers; searchable styles.
- **Tools strip:** Select/transform and Pan modes. The toolbar Insert menu adds
  text and stamps; Styles, Effects and Motion stay in their respective panels.
  Canvas handles support move, resize, rotation and skew.
- **Object inspector:** text and bundled fonts, layout, opacity/blending, precise
  transforms, preset/path/mesh/perspective warps, stamp shape and dimensions.
- **Effects inspector:** add, remove, reorder and configure every implemented effect;
  solid colors, gradients/stops, contours, lighting and procedural parameters use
  native controls. Effects and motion tracks share compact checkbox/disclosure/title/
  action headers; their parameter bodies appear only when expanded.
- **Motion inspector:** add/remove tracks, enabled state, durations, seeds and all
  implemented track parameters. Native play/pause and scrubbing preview the loop.
- **Canvas inspector:** document name, size, export cropping/padding, transparent or
  colored/gradient background and global light. Native zoom menu and fit controls.
- **Files:** New, Open, Save and Save As use `.wordwarp` document JSON. File dialogs,
  modified-window indicator and unsaved-edit prompts follow Mac conventions.
- **Export:** PNG, APNG and GIF at 1×–4×, animation frame rate, native destination panel,
  progress, completion/error/cancel feedback. Export bounds include effects.

The inspector is generated from shared declarative metadata, keeping available
native fields in sync with the renderer. Unsupported schema-only features are not
presented as working controls. The current renderer supports text and stamp layers;
external embedded assets, unbundled fonts, image/group layers and per-character
animation staggering are rejected on import with an explanation.

## Build and run

Requires macOS 14 or later, Xcode command-line tools with a recent Swift compiler,
and the repository's pinned Node/npm versions. No Xcode project or external Swift
packages are required.

```sh
nvm use
npm ci
./scripts/build-macos.sh
open native/macos/build/WordWarp.app
```

The build creates `native/macos/build/WordWarp.app` and
`artifacts/native/WordWarp-macOS-arm64.zip` on Apple Silicon (or `x86_64` on Intel).
Unzip and drag WordWarp.app to Applications to install locally.
`WORDWARP_MACOS_ARCH=x86_64 ./scripts/build-macos.sh` cross-compiles Intel; validate
that architecture separately on an Intel Mac.

The app is locally ad-hoc signed. Public distribution still requires a Developer ID
signature and notarization. No account or signing credentials are needed to build
and run it on the development Mac. `./scripts/build-macos.sh --skip-web` reuses
`dist-native/`; a normal build regenerates the shared canvas first.

**Help → Licenses…** opens the bundled offline notice index in your default
browser. Original WordWarp work uses the Unlicense; bundled JavaScript and fonts
retain their own licenses. The complete scope and notices are inside the app at
`Contents/Resources/Web/licenses/` and `Contents/Resources/Web/fonts/`. Packaging
rejects a shared bundle without its license/font manifests, including when using
`--skip-web`. This does not change the canvas's restricted navigation policy.

## Validate the real app

```sh
native/macos/build/WordWarp.app/Contents/MacOS/WordWarp \
  --self-test /tmp/wordwarp-macos-test.png
```

This launches the actual native app and exercises rapid text acknowledgements,
styles/history, typography and effect fields, layers/stamps/lock/visibility,
animation/playback/scrubbing/zoom, atomic autosave, native document save/open, and
PNG/APNG/GIF delivery. It exits nonzero on failure and prints elapsed time. Test
artifacts are written beside the supplied path; the user's normal autosave is untouched.
Add `--self-test-import /path/to/example.wordwarp` to verify a current-version document
from another platform: import it, compare the complete document, save a lossless
roundtrip copy and export its PNG. The supplied source file is never overwritten.

Also exercise native interactions: edit a field, drag a layer, adjust a color,
undo/redo, open/save a document, export through the native save panel, and cancel it.
Check resizing plus light/dark appearance. A stopped renderer offers “Reopen Canvas.”

Useful shortcuts: Cmd-N / Cmd-O / Cmd-S / Shift-Cmd-S for documents; Cmd-Z and
Shift-Cmd-Z for history; Cmd-J to duplicate; Cmd-[ / Cmd-] to reorder; Shift-Cmd-T
to add text; Cmd-0 to fit; Shift-Cmd-E to export.

## Local data and security

The current document saves atomically to
`~/Library/Application Support/WordWarp/native-document.json`. The shared engine
validates and migrates a recovered or opened document. `.wordwarp` files are plain
schema-versioned JSON; explicit saves request a validated snapshot after preceding
edits, so typing immediately before Cmd-S is included.

The web view uses an ephemeral data store. Only `wordwarp://app/native.html` can
navigate in the privileged view, and the custom scheme only serves files contained
inside the bundled resource directory. No localhost server or service worker runs.

## Mac interaction references

The workspace follows familiar Mac creative-app patterns, with original WordWarp
controls and artwork. Pixelmator's persistent layer stack and task-specific tool
pane informed the left stack/right inspector arrangement. [Apple's interface guide](https://support.apple.com/en-sg/guide/pixelmator-pro/pix96e754af4/mac).

Photoshop's document-centered workspace and contextual panels informed the compact
tools strip and grouping of controls. [Adobe's workspace guide](https://helpx.adobe.com/photoshop/desktop/get-started/learn-the-basics/workspace-overview.html).

Acorn's unified inspector and explicit zoom/fit controls informed inspector tabs and
native navigation. [Acorn tools and inspector](https://flyingmeat.com/acorn/docs/tools_palette.html).

Affinity's layer visibility, locking and effect operations informed row controls,
context menus and stack ordering. [Affinity Layers panel](https://affinity.help/designer2/English.lproj/pages/Panels/layersPanel.html).
