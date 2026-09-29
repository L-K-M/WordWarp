# WordWarp for Ubuntu

A GTK4/libadwaita desktop editor using the same document and bundled canvas engine
as the macOS and Android apps. Requires Ubuntu 24.04 or newer with WebKitGTK 6.0.
The package contains Python and platform-independent assets; native libraries are
installed by apt. No web server, Docker service, account or internet is needed to run.

```sh
npm ci
npm run build:linux
sudo apt install ./artifacts/native/WordWarp-linux-all.deb
wordwarp
```

The package builder uses Python's standard library and works on macOS and Linux.
Use `scripts/build-linux.sh --skip-web` to package an already verified native bundle.
Uninstall using `sudo apt remove wordwarp`; user documents and recovery data remain.

The Document menu's **Licenses…** item opens the bundled offline notice index in
your system browser. The package includes the original-work dedication and its
third-party exclusions at `/usr/share/doc/wordwarp/copyright`; complete dependency
and font notices remain under `/usr/share/wordwarp/web/licenses/` and `fonts/`.
Builds reject native bundles missing these licensing manifests, including when
using `--skip-web`. The canvas's navigation restrictions remain in effect.

The workspace has Layers/Styles on the left and Object/Effects/Motion/Canvas
inspectors on the right. The tool strip contains Select/Pan modes; Insert contains
the commands to add text and stamps. Effect and animation cards share one header:
checkbox, disclosure, title, actions. Collapsed cards have no hidden-body padding.

Supported editing includes typography, transforms, warps, effects, gradients,
contours, stamp layers, animations and canvas settings. Open/Save use native dialogs
and schema-validated `.wordwarp` JSON. Export supports PNG/APNG/GIF at 1–4×. Fonts
are bundled; unsupported image/group/external-asset documents are rejected explicitly.

## Verify the installed app

```sh
python3 native/linux/test_recovery.py
dbus-run-session -- xvfb-run -a wordwarp --self-test /tmp/wordwarp-linux.png
```

The first command runs focused recovery tests from the source checkout without a
display: selected-layer drafts, acknowledgement order, reloads and Discard on close.
The diagnostic opens the actual GTK/WebKit app, edits documents, checks native
controls and compact cards, exercises history and interchange, then exports PNG,
APNG and GIF. It also reloads the canvas during a native edit on a second text layer.
It exits nonzero on failure and does not touch the normal recovery file.
Normal recovery data is stored under `$XDG_STATE_HOME/wordwarp` (default
`~/.local/state/wordwarp`). Closing or replacing an unsaved document prompts first.

CI installs and exercises the `.deb` in Ubuntu. Local Linux testing from macOS can
use `Dockerfile.test` with Xvfb; no ports need to be exposed. Software rendering
options in CI are test-environment settings, not application defaults.
Docker Desktop may block the nested namespaces needed by WebKit's sandbox. For
that container-only test, add `--env WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1`
to `docker run`. The installed app and CI's Ubuntu host tests retain WebKit's
default sandbox settings.
