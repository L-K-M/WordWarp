# WordWarp Product and Engineering Audit

**Audit date:** 2026-08-06

**Audited commit:** `ce9403a` (`main` after `git pull`)

**Audit branch:** `sol/audit-and-roadmap`
**Status:** Review snapshot. `ANALYSIS.md` should contain the unresolved, current backlog after the
implementation pass; this file preserves the complete evidence and original recommendations.

## Executive Summary

WordWarp has an unusually strong product brief, a sensible serializable model, a broad preset
catalogue, deterministic animation evaluation, undo/redo, autosave, share URLs, real PNG/APNG/GIF
encoding, tiled exports, and a coherent visual shell. The checkerboard canvas and immediate styled
default document also communicate the product quickly.

The shipped application is not yet the v1 described by `PLAN.md`, despite the plan calling the
five-PR roadmap complete and the README advertising the corresponding features. The primary
renderer is a CPU Canvas2D prototype. Its "WEBGL2" path only uploads the finished CPU bitmap to a
texture. Text is rasterized by the browser before warping, effects are recomputed on the main thread,
many serialized controls are ignored, and several accepted element/paint/warp types are silently
degraded or omitted. That mismatch is the central technical and product risk: the data model and UI
promise a deep effects studio, while the current editor exposes and renders only a narrow subset.

The highest priorities are:

1. Make persistence, imported/share data, export limits, and unsupported content fail safely.
2. Merge the concurrent renderer-quality and workspace-layout fixes, then establish visual and
   alpha-correctness tests so fidelity stops being anecdotal.
3. Remove main-thread full-graph recomputation from ordinary editing and animation.
4. Make the first minute truthful and delightful with real preset thumbnails, reliable mobile
   controls, an honest effect inspector, and an export studio.
5. Treat outline-native text, a cached GPU/worker render graph, and deterministic bundled fonts as a
   strategic renderer program, not a collection of small patches.

## Audit Method

The review covered `PLAN.md`, README and contributor guidance, every source module, all unit and
browser tests, build/PWA configuration, persistence and share boundaries, rendering and encoding
paths, responsive CSS, and open PRs. The production app was exercised headlessly at 1440x900,
768x900, and 320x568.

The exact pinned Node.js 22.23.2 runtime was used. `scripts/check.sh` produced:

- Lint, typecheck, 18 unit-test files/51 tests, and production build: pass.
- Production main chunk: 471.26 KiB raw, 153.27 KiB gzip.
- Service-worker precache: 14 entries, 627.88 KiB.
- Browser suite: 5 passed, 11 skipped, 2 failed.
- Local PWA failure: the build defaulted to portable `./`, while Playwright expected root `/`.
- PNG journey failure: Gold Bar export did not finish inside the 60-second test timeout while the
  full suite ran with eight workers. The same journey passed in 7.0 seconds with one worker.

A separate isolated headless probe measured roughly 233 ms from a text fill through two animation
frames, 317 ms for applying Gold Bar, and 1.16 seconds for its 2x PNG export. Six long tasks totaled
1.1 seconds; the longest was 478 ms. These are local diagnostic numbers, not stable benchmarks, but
they confirm visible interaction stalls and explain why concurrent browser tests become flaky.

The responsive geometry probe found a more fundamental layout defect:

| Viewport | Document height | Canvas/artboard result |
|---|---:|---|
| 1440x900 | 1969 px | Workspace row 1829 px; artboard begins at y=792; layers at y=1893 |
| 768x900 | 1149 px | Opening Presets collapses canvas to width 0 and puts Inspector in its place |
| 320x568 | 642 px | Canvas panel only 173 px tall at y=231; layers and deletion are below/absent |

Physical mobile devices, assistive technologies, color-profile differences, and reference-image
comparisons were not available. Those remain explicit validation gaps.

## Concurrent Work

These findings were already being addressed in open PRs during the audit and should not be
duplicated:

| PR | Scope | Findings partially or fully covered |
|---|---|---|
| `#6` | Rasterize glyphs at export scale | C-07 |
| `#7` | Render effect paints and antialias strokes | C-08, part of C-06 |
| `#8` | Bevel profiles and extrusion parameters | Part of C-06 |
| `#9` | Remove unused text-shaping code | Documents current reality; does not solve C-05/outline rendering |
| `#24` | Constrain workspace rows to the viewport | UX-01 and part of UX-03/UX-10 |
| `#25` | Auto-dismiss toast notifications | Part of UX-17 |
| `#26` | Skip static animation evaluation and disable static Play | Part of PERF-04/UX-16 |
| `#27`, `#34` | Keyboard editing, duplication, visibility controls | Parts of UX-07/UX-09/UX-15/UX-20 |
| `#28` | Smooth bevel staircasing | Additional verified visual-quality defect |
| `#29` | Scrollable library, legibility, rendered preset previews | UX-01/UX-05/UX-13 |
| `#30` | Real Fit calculation | Part of UX-15 |
| `#31` | Extend warp ranges | Requires model/version review before merge; see C-14 |
| `#32` | Solid effect-color controls | Part of UX-04 |
| `#33` | Eleven presets and Texture category | Adds near-term style breadth |
| `#35` | Favicon, tablet Undo, local PWA test alignment | Part of UX-02 and C-21 |
| `#36` | `k3.md` and initial `ANALYSIS.md` | Documentation base for final consolidation |

The renderer PRs are stacked (`#6` -> `#7` -> `#8` -> `#9`). They improve the CPU renderer but do
not implement the outline/GPU architecture or all ignored model semantics. PR `#8` also removes
`facePaint` and `capBack`, which remain requirements in `PLAN.md:923-927`; that model migration needs
an explicit product/plan decision rather than unconditional merge. PR `#31` admits `bend`/`adj`
values outside the serialized ranges in `PLAN.md:429-435` without a document-version change, so it
also needs compatibility review. PRs `#24` and `#29` overlap on workspace height and should be
coordinated rather than merged independently without reconciliation.

## Confirmed Correctness, Safety, and Data Issues

### C-01 - Critical: fill alpha is incorrectly used as the geometry mask

`src/render/fallback2d/renderer.ts:90-138` paints the fill into the only source surface, then
`src/render/effects/cpu-effects.ts:31-37` derives the SDF from that painted alpha. Geometry must come
from opaque glyph coverage, independent of fill visibility or opacity.

User impact:

- Disabling all fills draws an opaque white fallback instead of a transparent body.
- A translucent fill changes stroke, bevel, shadow, and glow geometry.
- Neon Grid uses a 30% alpha fill (`src/presets/library.ts:210-212`), below the SDF's 128 threshold
  (`src/render/effects/fields.ts:42-55`), so its shape-derived effects can disappear.

Fix direction: rasterize an independent opaque glyph mask, derive fields from it, and composite fill
effects separately. Add pixel tests for disabled, transparent, and translucent fills.

### C-02 - Critical: schema-valid documents can exhaust memory

Several effect sizes/distances are finite and nonnegative but unbounded in
`src/model/schema.ts:80-98,151-205`. A shared document can request a shadow size of 100,000,000,
which reaches `gaussianKernel` and attempts a massive allocation
(`src/render/effects/fields.ts:7-39,126-135`). Canvas dimensions are capped individually but not by
area (`src/model/schema.ts:367-379`), and preview assigns them directly to two canvases.

Fix direction: enforce documented effect maxima, canvas area and element/text limits, animation loop
budgets, and a pre-allocation render budget. Reject unsafe data before creating a canvas, typed array,
kernel, or animation LCM. Runtime allocation guards can land immediately; tightening fields that are
currently valid in document v1 requires a `DOC_VERSION` bump, migration, and fixture tests.

### C-03 - High: normal UI input can persist an invalid document

Clearing the Size field yields `Number('') === 0`; `src/app/App.tsx:600-611` accepts every finite
number, while the schema requires a positive size (`src/model/schema.ts:267-276`). Store mutation,
IndexedDB saving, and share encoding do not validate the outgoing document. Reload then rejects the
autosave and enters recovery.

Fix direction: prevent invalid transient values from committing, clamp/validate at every command
boundary, and parse before persistence/share. Add a clear-input, reload, and share regression test.

### C-04 - High: accepted non-text layers silently disappear

Shape, image, and group elements validate (`src/model/schema.ts:341-365`), but the renderer skips
them (`src/render/fallback2d/renderer.ts:47-57`). Diagnostics are not surfaced by
`src/ui/DocumentCanvas.tsx:55-64`, and export ignores them, so a valid imported document can produce
an incomplete PNG/APNG/GIF without warning.

Fix direction: preserve these layers, surface diagnostics visibly, and block incomplete exports until
they render. Removing or rejecting documented element types is a model/product change requiring a
migration. Silent partial export is not acceptable.

### C-05 - High: font loading and deterministic shaping are disconnected from rendering

The renderer always uses native `measureText`/`fillText` (`src/text/layout.ts`,
`src/render/fallback2d/renderer.ts`). HarfBuzz and font metadata helpers have no callers; no
`FontFace` registration, font-blob store, asset loading, or export-worker font pipeline exists. The
default `Arial Black` is not universal. The same document therefore changes across OS/browser, and
user fonts, variable axes, features, complex shaping, and exact `keepUpright` behavior do not work.

Fix direction: bundle an OFL display-font shelf, make missing/substituted fonts visible, persist font
bytes content-addressably, and build the planned shaping/outline worker path. Until then, narrow the
README guarantees rather than implying outline-backed fonts are already importable.

### C-06 - High: many serialized effect controls and reorder semantics are no-ops

`src/render/effects/cpu-effects.ts` ignores or substitutes substantial model state:

- Stroke join, miter limit, dash, and dash offset.
- Bevel soften, several styles, and per-highlight/per-shadow blend modes on audited `main`.
- Much of extrusion mode, perspective, shading, face paint, steps, and cap behavior on audited
  `main`.
- Texture scale/rotation and asset-backed texture behavior.
- Glow/shadow noise, technique, range, jitter, choke, and several contours/paint semantics.
- Reflection fade/blur semantics.
- Persisted `effect.slot`; rendering hardcodes slots by kind (`cpu-effects.ts:467-471`).
- Arbitrary array reordering across slots; fills are always drawn before the stack.

Fix direction: each visible/serialized parameter must change pixels, or be removed through a model
decision and migration. Group the near-term UI by truthful fixed slots instead of implying arbitrary
graph order. Add per-control pixel-difference tests.

### C-07 - High: high-resolution export enlarges a 1x glyph bitmap

The source text surface is allocated at logical size without export scale, then enlarged by the
destination transform (`src/render/fallback2d/renderer.ts:90-127`). Edges and warped text are scaled,
not rerasterized. Covered by concurrent PR `#6`; verify source-area guards and 1x/2x/4x edge-detail
tests after merge.

### C-08 - High: supported paints render as different paints

Effect paints are flattened to one color by `paintColor`
(`src/render/effects/cpu-effects.ts:445-453`). The main paint implementation also approximates or
omits texture, matcap identity/intensity, ramp variants, diamond gradients, and dithering. Concurrent
PR `#7` improves effect paint routing but does not complete every paint discriminant.

Fix direction: implement each accepted paint parameter or reject it. Golden images should prove
that named materials are visually distinct rather than differently labeled approximations.

### C-09 - Medium: texture and post scales change with export resolution

Scanlines, halftone, aberration, weave, grain, and procedural coordinates operate directly in output
pixels (`src/render/effects/cpu-effects.ts:273-400`). Most ignore `options.scale`, so 2x output does
not match preview semantics.

Fix direction: define parameters in logical document pixels and transform them consistently. Compare
cropped preview, 1x, 2x, and 4x exports.

### C-10 - High: schema-valid animation durations can crash app rendering

Track duration has no upper bound (`src/model/schema.ts:220-243`). `documentAnimationDuration` takes
an LCM and can throw (`src/animation/evaluate.ts:9-23`), while `App` calls it unguarded during every
render (`src/app/App.tsx:164`). The 30-second export check happens too late. The TypeScript model also
advertises `stagger`, while schema and evaluator reject it.

Fix direction: validate common loop duration at import, cap supported duration/complexity, and align
the model, schema, evaluator, UI, and README on staggering. Runtime loop guards can land immediately;
persisted-schema restrictions need a document migration.

### C-11 - Medium: preview time zero differs from exported frame zero

`src/app/App.tsx:368` uses the raw document at `animationTime === 0`, while export always evaluates
frame zero. Typewriter begins full in preview but empty in export; Glitter opacity also differs.

Fix direction: evaluate time zero whenever enabled tracks exist. Keep play state separate from
whether animation semantics are applied.

### C-12 - Medium: locale-dependent case conversion breaks determinism

`src/text/layout.ts:85-90` calls locale-sensitive case transforms without persisting a locale. The
same `i` can uppercase to `I` or `İ` depending on the machine.

Fix direction: use locale-independent case conversion, or serialize an explicit locale. This is an
implementation-now candidate.

### C-13 - Medium: glyph overhang can be clipped before effects and auto-fit

Layout uses `metrics.width` but ignores `actualBoundingBoxLeft/Right`
(`src/text/layout.ts:30-55`). Italics, swashes, `f`, and `j` can lose horizontal ink in the source
surface; later bounds expansion cannot recover already-clipped pixels.

Fix direction: accumulate actual ink bounds for each line and retain an antialias margin.

### C-14 - High: accepted warp data has silent identity, clipping, and ignored semantics

A mesh warp without mesh data validates, then maps as identity. `curveSpacing`, `keepUpright`, and
several path semantics do not affect current output. Warp diagnostics are discarded. Fixed-grid
bitmap triangulation also produces seams/faceting under strong deformation. Rendering can use a
64x64 mesh while bounds always sample only 24x12 (`src/render/fallback2d/warp.ts:18-59`), so sharp
control points can fall outside computed bounds and be clipped. Empty paths and degenerate
perspective data are also schema-valid.

Fix direction: compute conservative/adaptive bounds and reject degenerate runtime mappings before
rendering. Preserve or visibly label unsupported controls; later replace bitmap triangulation with
warped outlines/adaptive geometry. Tightening accepted v1 structures requires a migration that either
repairs or explicitly rejects old data.

### C-15 - High: timestamp conflict detection permits cross-tab lost updates

`src/persistence/database.ts:30-44` bypasses a stale expected revision if incoming and stored
`meta.modified` happen to share the same millisecond. Two tabs can therefore overwrite each other
silently.

Fix direction: compare strictly against an opaque expected revision. At minimum remove the incoming
timestamp bypass; longer term store a UUID/revision separately from display time. This is an
implementation-now candidate.

### C-16 - Medium: recovery's "Start a new document" can return to the same corruption

The fresh document is installed before autosave starts (`src/app/App.tsx:370-385`). Autosave begins
clean and does not replace the corrupt active record unless the user makes another edit. Reloading
immediately can show the same recovery screen.

Fix direction: quarantine/delete the corrupt record and save the fresh document before leaving
recovery mode.

### C-17 - Medium: invisible effects still enlarge or block exports

Rendering skips zero-opacity effects, but reach and reflection tiling checks consider `enabled` only
(`src/render/fallback2d/renderer.ts:159-183`, `src/export/render-png.ts:88-92`). An invisible effect
can add huge margins or block tiled export.

Fix direction: share one "contributes pixels" predicate across render, bounds, tiling, and animation
bounds. This is an implementation-now candidate.

### C-18 - High: tiling still allocates the complete output

The accepted maximum output allocates a contiguous 256 MiB RGBA array before encoder working memory
(`src/export/render-png.ts:43-84`, `src/export/bounds.ts:23-30`). Tiling only reduces individual canvas
dimensions; it does not bound total memory.

Fix direction: apply a conservative runtime memory budget and eventually stream PNG rows/chunks.
Reject safely on low-memory devices rather than terminating the tab.

### C-19 - Medium: duplicate nested IDs are accepted

The schema checks element IDs but not effect or animation IDs (`src/model/schema.ts:397-421`). UI
commands use `find`/`findIndex` and React keys by ID, so duplicate imported IDs edit the wrong item.

Fix direction: validate nested ID uniqueness in the appropriate element scope. This can be combined
with C-14 as one structural-integrity migration, not a schema-only patch.

### C-20 - Medium: lost pointer capture can leave history permanently transactional

`src/ui/DocumentCanvas.tsx:92-127` commits on pointer-up/cancel only. Lost capture or unmount can
leave the document store in a transaction, after which undo/redo refuse to run.

Fix direction: handle `lostpointercapture` and clean up an active drag on unmount. Cache the pointer
rectangle at drag start as part of the same lifecycle fix.

### C-21 - Medium: the local gate builds and tests different default PWA bases

`vite.config.ts:6` intentionally defaults to `./` for the portable archive, while Playwright defaults
to `/`. The complete local gate therefore receives manifest `id: "./"` when its test expects `/`.
Docker and Pages explicitly provide their own root/subpath values, so this is a test orchestration
mismatch rather than evidence that those deployments are broken.

Fix direction: keep the portable default, but make each gate explicit about the base it builds and
tests. PR `#35` sets `/` for local browser tests. Continue to verify root, configured subpath,
offline behavior, and the `./` portable artifact separately.

### C-22 - Medium: PNG worker errors can repeat failed work on the main thread

`src/export/png.ts` catches every worker error/timeout and reruns the full export synchronously. A
domain error or 60-second timeout can therefore become a second UI freeze.

Fix direction: fallback only when worker creation/capability fails before work starts. Propagate
render/size/timeout errors and add progress/cancellation.

### C-23 - High risk: alpha correctness diverges from architecture and lacked end-to-end evidence

Canvas2D `getImageData()` already returns straight-alpha pixels, so the unused unpremultiply helper is
not a missing final export step. The architectural deviation is that CPU effects repeatedly read and
write straight-alpha arrays (`src/render/effects/cpu-effects.ts:31-37,338-409`) and use Canvas blend
and color-space semantics instead of one premultiplied linear graph. Audited `main` browser tests
assert only PNG channel count/dimensions, not fringe colors, zero-alpha RGB, preview/export parity,
or blend formulas. PR `#6` adds initial chromatic-fringe and zero-alpha-RGB coverage.

Fix direction: retain and expand exported-alpha fixtures across colors/blend modes and browsers.
Treat full alpha-correct linear compositing as unverified until those tests and the shared render
graph exist.

### C-24 - Medium: several animation names do not match their promised semantics

`src/animation/evaluate.ts:47-98` implements Bounce as whole-element movement rather than
per-character motion, Gloss Sweep as moving a reflection, Sparkle as pulsing texture opacity, and
Typewriter as erasing during the final 30% instead of holding at the end. These are deterministic,
but the user-facing names and `PLAN.md:1005-1022` promise different effects.

Fix direction: label current tracks honestly or implement the specified semantics after glyph-level
animation exists. Add rendered loop-seam tests, not only model-evaluation tests.

## Performance and Responsiveness

### PERF-01 - Critical: all preview effects run on the main thread; WebGL adds a copy

`DocumentCanvas` coalesces to `requestAnimationFrame`, but `PreviewRenderer` synchronously runs the
entire Canvas2D renderer. The WebGL presenter then uploads the completed frame with `texImage2D`
(`src/render/preview.ts:32-43`, `src/render/gl/presenter.ts:52-63`). There is no graph cache, dirty
pass, reusable styled-element surface, or preview worker.

Impact: measured 233-317 ms edit/preset cycles and a 478 ms long task on the default-size document.

Fix direction: render directly to visible 2D until WebGL performs real passes; cache geometry, warp,
SDF, each effect, and final composite separately; reuse styled surfaces for transform-only moves;
move CPU raster/effect work to a persistent worker; instrument every stage.

### PERF-02 - Critical: effect kernels cause large operation counts and allocation churn

`blurAlpha` is O(pixels x radius) with no tap cap/downsampling. SDF transforms allocate EDT work
arrays per row and column. Extrude/long shadow creates up to 96 full-mask shifts. Effects repeatedly
allocate full RGBA arrays, ImageData, and canvases. Texture hashing occurs inside the pixel loop and
post effects copy full images twice.

Fix direction: first reuse EDT work buffers, hoist invariant hashes, create readback contexts with
`willReadFrequently` initially, pool arrays/canvases, and implement bounded/downsampled blur. Then
move field/effect passes to GPU or worker. EDT buffer reuse is a low-conflict implementation-now
candidate.

### PERF-03 - High: continuous input does unthrottled store work and quadratic patch copying

Each pointer/range event runs Immer, timestamps the document, grows transaction arrays by copying all
previous patches, rerenders React, and resets autosave. A long drag has approximately O(events^2)
patch-copy cost (`src/state/document-store.ts:65-89,181-197`). `getBoundingClientRect` also runs on
every move.

Fix direction: keep transient drag/slider state outside the document and commit once at pointer-up,
or at least coalesce per frame. Compact patches by path, timestamp/autosave on commit, and cache the
drag rectangle.

### PERF-04 - Critical: animation rerenders the whole application at display refresh rate

Every animation RAF sets React state in the 878-line `App`, clones the full document, reevaluates
tracks, and triggers a full render (`src/app/App.tsx:164-189,368`,
`src/animation/evaluate.ts:26-44`). Play is available even with no tracks.

Fix direction: keep the clock outside React and subscribe only the renderer; represent evaluated
properties as a small overlay; invalidate only affected passes; disable Play for static documents;
adapt preview FPS on constrained devices and pause when hidden.

### PERF-05 - Critical: animated export renders on main, retains every frame, and cannot cancel

Bounds and frames are evaluated twice; rendering occurs on the page; every RGBA frame remains in
memory until an encoding-only worker starts (`src/export/animation.ts`). One expensive frame can be
a long task despite yielding between frames.

Fix direction: move evaluation, bounds, rendering, and encoding into an export worker; stream through
a one/two-frame transferable buffer; add `AbortSignal`, progress, and cancel; pause live preview while
exporting on constrained devices.

### PERF-06 - Critical: preview and export dimensions ignore practical device memory

Preview uses logical dimensions directly for target and staging canvases. Imported dimensions can
reach 32767x32767. Export accepts 67,108,864 pixels before effect surfaces/codec memory. There is no
DPR working resolution, actual GPU/canvas probe, context-loss recovery, or low-memory budget.

Fix direction: preview at displayed CSS size times capped DPR; use lower interaction resolution;
probe capabilities; budget aggregate bytes; recover WebGL context loss; test physical iOS/Android.

### PERF-07 - Medium/high: root React subscriptions rerender every panel on every edit

`App` subscribes to the full document and owns presets, inspector, layers, history, export, and
canvas. Canvas bounds then cause another React state update after each render.

Fix direction: split panels into narrowly subscribed components and hold render bounds in refs unless
they materially change. Profile before adding incidental `useMemo`/`useCallback`.

### PERF-08 - High for warped text: fixed-grid bitmap warp has hundreds of draw calls

A preset warp performs 576 clipped full-source `drawImage` calls per element and repeats corner
mapping (`src/render/fallback2d/warp.ts`). Path mapping reflattens/rebuilds length tables per sample;
perspective mapping can recompute coefficients per point.

Fix direction: preprocess path tables/homographies once per revision, share grid vertices, cache the
mapped mesh, and ultimately warp outline geometry or a GPU mesh.

### PERF-09 - Medium: optional codecs are eagerly reachable and broadly precached

Animation/share codecs are static imports from `App`; Workbox precaches every generated JS/WASM/font
asset. Lazy feature chunks may still download at service-worker installation. The measured precache
was 627.88 KiB.

Fix direction: dynamically import animation/share/fallback codecs on first use, keep codecs
worker-only where practical, and enforce initial/precache byte budgets in CI. APNG, GIF, and sharing
are advertised offline capabilities, so precache reduction must not make first-session offline use
fail; retain core feature chunks or add an explicit offline readiness/download model and exercise
offline export/share in browser tests.

### PERF-10 - Medium: save/load/share duplicate full documents synchronously

Autosave reads the existing document, explicitly clones before IndexedDB clones again, and can
synchronously stringify to localStorage. Current-version load clones before Zod builds another
graph. Share uses level-9 synchronous deflate/inflate on the main thread.

Fix direction: store revision metadata separately, remove redundant clones, and move large
serialization/compression to a worker.

### PERF-11 - High regression risk: performance budgets are not enforced

No tests assert keystroke/drag latency, render-stage timings, long tasks, memory, cancellation,
initial bundle bytes, or representative export duration. The full browser suite runs CPU-heavy
journeys in parallel and can fail only under contention, while the isolated test passes.

Fix direction: add stable fixtures and generous p50/p95 thresholds, separate correctness from
benchmark jobs, constrain workers for CPU-heavy E2E tests, and report rather than hide baseline
costs.

## UX, Accessibility, and Visual Findings

### UX-01 - Critical: the artboard is below the fold on desktop

The unconstrained workspace row sizes itself from the tall preset list. On a 1440x900 viewport the
workspace becomes 1829 px tall and centers the artboard near the bottom. Concurrent PR `#24`
addresses this; retain geometry assertions across desktop/mobile.

### UX-02 - High: touch users have no visible undo or delete

History controls are hidden at <=1050 px and Delete is hidden at <=740 px
(`src/styles.css:1030-1041,1181-1183`). Keyboard shortcuts are not substitutes on a phone.

Fix direction: keep compact Undo/Redo in the mobile command bar and Delete in the layer strip or an
overflow action sheet. PR `#35` restores tablet Undo/Redo only; phone history/deletion remains open.

### UX-03 - High: opening Presets at tablet width collapses the canvas

At 768 px, opening the fixed preset overlay removes it from grid flow but leaves auto-placement to
put Canvas in the zero-width first column and Inspector in the flexible column. Live measurement:
canvas width 0, Inspector width 508.

Fix direction: assign explicit grid areas/columns or portal overlays outside the workspace grid.
Recheck after `#24`, which may not fully address this placement case.

### UX-04 - High: the advertised editable effect stack exposes only one scalar

Most cards expose Size/Width/Opacity only (`src/app/App.tsx:301-317,832-869`). Users cannot choose
fill/stroke color, gradient, shadow color/angle/distance, bevel profile/light, material, blend mode,
or advanced controls. The core "take any preset apart" workflow is therefore unavailable.

Fix direction: expandable cards with 4-6 working primary controls and an Advanced disclosure. Every
slider needs a typeable numeric field and one drag must create one undo entry.
PR `#32` adds native color inputs for solid paints/colors, which is useful partial coverage but not
the broader inspector.

### UX-05 - High: preset thumbnails do not preview presets

All 30 cards are the same italic `Ww` over a swatch gradient. Warp, extrusion, bevel, glow, texture,
and animation are invisible, so the primary discovery interface asks users to apply styles blindly.

Fix direction: ship renderer-generated 240x120 thumbnails, then audition current text on hover,
focus, or long press using one debounced low-resolution surface. Mark the current preset and support
favorites/recent styles. PR `#29` adds lazy same-renderer cards; verify its 30-preview CPU/memory cost
and mobile behavior before considering this item complete.

### UX-06 - High: export is immediate, inflexible, and silently lossy

PNG is fixed at 2x; animation FPS/duration/size are hidden; no exact dimensions, padding, full-canvas
choice, estimate, matte, alpha preview, cancellation, clipboard, or save location is offered. GIF
always gets one-bit dithering despite the plan promising explicit matte/APNG choices.

Fix direction: an Export Studio with preflight dimensions, scale/target pixels, bounds/padding,
background preview, format explanation, GIF matte-vs-dither comparison, progress/cancel, Copy PNG,
and `showSaveFilePicker` when available.

### UX-07 - High: direct manipulation stops at moving

There are no scale/rotate/warp/gradient/shadow/extrusion handles; the Warp tool is disabled even
though preset controls exist in Inspector. Numeric transform controls are also absent.

Fix direction: first add numeric transform parity and keyboard nudge; then accessible resize/rotate
handles and one Office-style yellow warp handle. Do not imply disabled tools are functional.
PR `#27` adds keyboard nudge and duplication; pointer handles and numeric parity remain open.

### UX-08 - High: mobile disables native gestures without implementing editor gestures

Canvas uses `touch-action: none`, but only single-pointer element drag exists. Pan state is unused.
There is no pinch zoom, two-finger pan, or movement threshold.

Fix direction: implement multi-pointer pan/pinch, tap-vs-drag thresholds, and accessible alternatives,
or restore native scrolling where editor gestures do not exist.

### UX-09 - High: persistence has no project workflow or editable document name

Everything remains `Untitled warp`; filenames derive from it. Only the active IndexedDB document is
reachable despite an existing modified-time index. Opening a shared copy replaces the current view
without a recent-documents route.

Fix direction: title/autosave state, New/Recent/Duplicate/Rename/Delete, and a reversible shared-copy
transition. Add user styles only after defining a separate DB migration.

### UX-10 - Medium: short mobile viewports cannot show the complete editor

The shell's minimum rows total 642 px, so the project's 320x568 target must scroll. The top bar is
not sticky, and hidden panels still consume problematic grid placement in the audited build.

Fix direction: use `100dvh`, remove the 520 px minimum, design landscape explicitly, and make the
mobile first minute a text/style/export flow with a persistent preview.

### UX-11 - Medium: responsive panels look modal but lack modal behavior

Presets and Inspector can both open, with no backdrop, close button, Escape handling, initial focus,
focus trap/restoration, or automatic close after applying a preset.

Fix direction: one sheet at a time, visible Close, correct dialog/region semantics, Escape, focus
movement/restoration, and close Presets after selection on small screens.

### UX-12 - Medium: selected states are visual-only

Preset categories, selected layers, and the active tool rely on classes without `aria-pressed`,
`aria-current`, tabs, or semantic toolbars/groups.

Fix direction: use appropriate roles/state and expose a programmatic relationship between selected
layer, canvas, and Inspector.

### UX-13 - Medium: contrast and text sizing miss the stated accessibility target

Several 7-9 px labels and muted colors fall below 4.5:1; input borders are below the 3:1 component
threshold. The tiny effect actions are difficult even for mouse users.

Fix direction: raise the muted token, make 11-12 px the practical UI floor, strengthen control
boundaries, and validate focus/disabled/error states with automated and manual contrast checks.

### UX-14 - Medium: selection outline is hard to see on either checker color

The cyan dashed line is roughly 1.1-1.5:1 against the artboard/checker and disappears over bright
art. Use a dark solid under-stroke plus cyan dashed over-stroke and keep it visible at all zooms.

### UX-15 - Medium: several affordances do not do what they say

- `/` is shown in preset search but no shortcut exists.
- Fit sets zoom to 1 instead of fitting.
- Initial autofocus does not select `WordWarp`, so typing inserts rather than replaces.
- Warp appears as a disabled top-level tool.
- The renderer badge says WEBGL2 although all effects are CPU Canvas2D.

Fix direction: implement or relabel each promise. Status chrome should report useful facts such as
autosave state, selected dimensions, coordinates, and render quality. PR `#27` removes autofocus and
implements `/`; PR `#30` implements Fit.

### UX-16 - Medium: motion actions are enabled for static documents

Play and APNG/GIF remain available with no tracks. Static animation export creates duplicate frames
because no-animation duration defaults to two seconds.

Fix direction: disable motion controls for static documents, explain how to add motion, and never
encode duplicate-frame animations by default.

### UX-17 - Medium: loading, errors, progress, and toasts are incomplete

Render errors lack alert/recovery semantics; export progress is only button text and cannot cancel;
shared import makes the shell inert with no visible overlay; all toast tones looked alike and
accumulated indefinitely on audited `main`. PR `#25` handles expiry only.

Fix direction: explicit pending overlays, semantic progressbar/cancel, assertive actionable errors,
bounded notifications, and visually distinct tones.

### UX-18 - Medium: empty/no-selection actions fail silently

Preset cards remain enabled with no selected text but do nothing. Empty canvas and no-selection
messages are not actions.

Fix direction: let a preset create a text layer, or disable it with an explanation; turn empty states
into Add Text/Choose Style actions.

### UX-19 - Medium: touch target policy is viewport-based and incomplete

24-32 px categories/toolbars remain on common touch tablets because 44 px sizing applies only below
740 px and only to some Inspector controls.

Fix direction: use `@media (pointer: coarse)` and 44 px primary targets regardless of viewport.

### UX-20 - Medium: global Delete can remove a layer from unrelated controls

The shortcut guard excludes inputs/textareas/contenteditable but not selects or buttons
(`src/app/useKeyboardShortcuts.ts`). Pressing Delete while Export format or another button is focused
can delete the selected layer.

Fix direction: protect all interactive targets and scope destructive shortcuts to canvas/layer
context. PR `#27` protects selects but still treats focused buttons as canvas context; a small stacked
follow-up remains an implementation-now candidate.

### UX-21 - Low/medium: semantics and status can be factually wrong

Canvas/status always announce transparency even if an imported document has a background. Layers
are a site `<footer>`/content-info landmark. There is no studio heading. The canvas is not focusable
and has no keyboard manipulation/live movement announcement.

Fix direction: derive accessible text from the document, label a Layers region/toolbar, add an `h1`,
and make selection/movement keyboard accessible.

### UX-22 - Medium: layer lock is partial and core layer properties remain unreachable

`locked` prevents canvas dragging, but preset application, text/effect edits, deletion, and layer
reordering ignore it. Visibility is absent on audited `main`, while lock, opacity, blend mode, and
rename have no UI despite being serialized.

Fix direction: define lock semantics for every mutation path, enforce them in commands rather than
only pointer code, and expose rename/lock/opacity/blend controls. PR `#34` adds visibility and
duplication only.

## Missing or Incomplete Product Capabilities

These are not all defects in isolation, but they are advertised by README or declared complete by
the plan and therefore need either implementation or honest scope language.

| Capability | Current reality | Priority |
|---|---|---|
| Outline-native text/HarfBuzz | Native Canvas bitmap text, then mesh-warped | Strategic P0 |
| Cached WebGL render graph | CPU renderer plus presentation texture upload | Strategic P0 |
| Editable effect stack | One scalar per effect; many model controls ignored | Product P0 |
| True preset previews | Generic swatches with identical `Ww` | Product P0 |
| Export studio | Immediate fixed choices | Product P0 |
| Path/mesh/perspective authoring | Mapping primitives only; Warp tool disabled | P1 after outlines |
| Animation authoring/semantics | No add/edit UI; several named tracks are whole-layer approximations | P1 |
| Direct transforms | Move only; no numeric parity/handles/pan/pinch | P1 |
| Recent projects/user presets | Active-document restore only | P1 |
| Deterministic font shelf/assets | System-font datalist; no blob store | P1 |
| Shape/image/group rendering | Model accepts them; renderer skips them | P1 or remove |
| Full materials/extrusion | CPU approximations, not normals/matcaps/walls | Strategic P1 |
| Golden/alpha/determinism tests | Structural/unit coverage only | Quality P0 |
| Firefox/desktop WebKit structure | Not in Playwright projects | Quality P1 |
| i18n/externalized strings | Hard-coded English | P2 |
| `.wordwarp` portable assets | Not implemented | P2 |

## Delightful Product Directions

### D-01 - Seeded "Make It Weird" and "Make It Mellow"

Offer two prominent remix actions. A deterministic seed mutates only safe ranges such as warp bend,
palette rotation, bevel depth, glow spread, extrusion angle, and post intensity. Let users lock any
parameter before remixing. Store resulting values, not an opaque random effect, so undo/share/export
remain deterministic.

Acceptance: same source plus seed produces byte-identical serialized values; one remix is one undo
entry; no remix exceeds bounds or export limits.

### D-02 - Stack Autopsy

Hold Space for raw text versus full stack, Shift-click to solo an effect, and drag an "X-ray" scrubber
through Back/Body/Front/Post passes. This turns technical depth into a delightful teaching tool and
makes the effect stack easier to debug.

### D-03 - A truthful Office-97-inspired gallery

Make the preset chooser the visual hero: real warped silhouettes, chrome/rainbow lettering, category
plaques, large previews, recently used/favorites, and a tasteful Surprise Me. Preserve the restrained
editor workspace, but let the gallery feel like opening a mysterious 1997 CD-ROM.

### D-04 - Nostalgic micro-delight without copying Microsoft IP

Use an original "Warp Wizard" paperclip/squiggle helper for contextual tips, a tiny floppy-disk glint
after autosave, modem chirp-inspired visual pulses with sound off by default, and a chrome sparkle on
successful export. Respect reduced motion and never block the workflow with a tour.

### D-05 - Existing-primitive style pack

These can become compelling once paint/fill-mask fidelity and real thumbnails land:

| Mood | Style | Recipe |
|---|---|---|
| Freaky | Haunted Fax | Wave4, ivory fill, double stroke, hard shadow, halftone, glitch, grain |
| Freaky | Dial-Up Portal | Ring Inside, Chrome II, cyan/magenta glows, scanline roll |
| Freaky | Printer Jam | Slant, monochrome ink, horizontal glitch tears, misregistered shadow |
| Mellow | Mall Fountain | Calm Water ramp, soft bevel, pale inner glow, reflection, slow sweep |
| Mellow | Airbrush Yearbook | Pastel gradient, Arch Up, white outline, diffused shadow, fine grain |
| Mellow | Lavender Lava Lamp | Inflate, purple/pink gradient, pillow bevel, soft cyan glow |
| Fancy | Champagne Hologram | Gold/pearl angular gradient, white rim, restrained sparkle |
| Fancy | Velvet Rope | Burgundy satin, gold bevel, deep soft shadow, subtle grain |
| Astonishing | CD-ROM Deluxe | Holographic angular fill, bevel, rim, aberration, hue cycle |
| Maximal | Maximum Presentation | Fire ramp, Stop warp, deep extrusion, hard offset shadow |

### D-06 - Ambitious astonishing styles

| Direction | Experience | Required architecture |
|---|---|---|
| Lenticular Sticker | Pointer/tilt changes quantized gloss and hue; export converts it to a loop | Real matcaps plus deterministic track capture |
| Infinite Word Tunnel | Ring-warped depth echoes converge into a vanishing point | Effect-aware bounds and geometry extrusion |
| Mercury Screensaver | Slow seeded mesh deformation under liquid metal | Outline mesh, circular noise, material normals |
| Magic Eye Headline | Text depth drives a seeded autostereogram | Depth field and explicit opaque background mode |
| Desktop Aquarium | Glass/pearl letters, seeded bubbles, caustic sweep | Scene decorations, sprites, better materials |
| Laser-Etched Ice | Refractive pale body, internal cracks, cold rim glow | Height/normals, procedural texture, refraction approximation |

Interactive pointer/tilt state must be committed as document parameters or converted to a procedural
track before export. Ephemeral input must never make output nondeterministic.

## Recommended Delivery Sequence

### 0. Restore trust

Reconcile and verify the concurrent renderer/layout/UI PR stacks; do not merge model-changing `#8`
or `#31` without plan/version decisions. Fix unsafe validation/persistence/PWA boundaries; surface
unsupported content; add alpha, hero-preset, preview/export, and warp-reference tests. Update README
claims where architecture remains aspirational.

### 1. Make the first minute excellent

Real thumbnails, select-all first typing, reliable mobile Undo/Delete, four-tap mobile
Text -> Style -> Export, truthful Fit, clear selection, document title/autosave status, and Export
Studio.

### 2. Make depth honest

Progressive effect inspector, numeric transforms, keyboard parity, four motion macros (Shimmer,
Flicker, Bounce, VHS Jitter), recent projects, user styles, and deterministic bundled fonts.

### 3. Build the actual renderer

Outline shaping/raster worker, independent coverage masks, cached render graph, bounded/GPU effects,
worker animation/export, runtime memory probing, and only then free-form warp authoring and true
materials.

### 4. Become unforgettable

Seeded Weird/Mellow remixing, Stack Autopsy, the curated style packs above, and selected scene/material
experiments with deterministic export semantics.

## Implementation Disposition

The following changes are small, independently testable, high-confidence, and relatively isolated
from concurrent renderer/UI work. Each should use its own branch and PR:

| Candidate | Finding | Likely files |
|---|---|---|
| Evaluate animated preview at time zero (stack on `#26`) | C-11 | `src/app/App.tsx`, animation/browser tests |
| Make case transforms deterministic | C-12 | `src/text/layout.ts`, layout tests |
| Close same-millisecond cross-tab overwrite | C-15 | `src/persistence/database.ts`, database tests |
| Ignore non-contributing effects consistently | C-17 | renderer/export bounds tests |
| Protect focused buttons from destructive Delete (stack on `#27`) | UX-20 | keyboard shortcut hook, browser test |
| Reuse EDT work buffers | PERF-02 | `src/render/effects/fields.ts`, effect tests/measurement |
| Add a high-contrast two-pass selection outline | UX-14 | `DocumentCanvas.tsx`, `styles.css` |

Large renderer, export-memory, project-management, effect-inspector, and mobile-flow changes are
high-confidence priorities but not safe to improvise as isolated patches while stacked renderer and
layout PRs are open. Schema tightening for C-02/C-10/C-14/C-19 also needs a document-version migration,
not a small validation patch. Those items belong in planned follow-up work with explicit acceptance
fixtures.

## Existing Strengths Worth Preserving

- Client-only, static, secret-free architecture and explicit hosting/base-path model.
- Versioned model, Zod import validation, and migration boundary.
- Separate document/editor/UI state concepts.
- Patch-based history and autosave with page-hide flushing.
- Compressed share URLs that clone identity on import.
- Nonempty default composition and transparency checkerboard.
- Thirty data-driven presets and 24 Office ramps as a strong content foundation.
- Forty-one finite warp mappings and deterministic procedural animation evaluation.
- Real PNG/APNG/GIF codecs, tiled rendering checks, reduced-motion handling, and offline PWA tests.
- A distinctive dark workstation shell that can support a more expressive nostalgic gallery.

The right improvement strategy is not to discard Claude's foundation. It is to make the product
truthful at every boundary, preserve deterministic document semantics, and invest where WordWarp can
actually become singular: outline warps, editable materials, alpha-honest export, and a gallery that
makes people grin before they understand how deep the editor is.
