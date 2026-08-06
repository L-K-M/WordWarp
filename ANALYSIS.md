# WordWarp Analysis and Roadmap

Living document for future work. It consolidates the complete 2026-08 audits in `k3.md` and
`sol.md`. Finished work is kept out of the active backlog and recorded in the implementation tables;
the audit documents preserve evidence, measurements, file references, and original reasoning.

`PLAN.md` remains the architecture and product-scope authority. When implementation and plan differ,
resolve the decision in `PLAN.md` before deleting serialized fields, widening persisted ranges, or
changing rendering/export guarantees.

## Current Diagnosis

WordWarp already has a strong client-only foundation: a versioned model, validation/migrations,
patch history, autosave, compressed share URLs, deterministic animation evaluation, 41 warp mappings,
data-driven presets, transparent PNG plus APNG/GIF encoding, tiling, and offline PWA behavior.

The central gap is that the product describes a deep outline/GPU effects studio while the shipped
renderer is a CPU Canvas2D implementation with a WebGL presentation blit. Native browser text is
rasterized before bitmap warping; every edit recomputes expensive fields/effects on the main thread;
many serialized controls are approximated or ignored. Work should first make every boundary safe and
truthful, then make the first minute excellent, then build the planned renderer as a coherent program.

## Implementation Status

### Merged During The Review

| PR | Completed scope | Follow-up still open |
|---|---|---|
| `#6` | Rasterize glyph sources at export scale; initial render-quality/alpha tests | Runtime memory policy, preview/export parity, broader alpha matrix |
| `#7` | Effect paints and antialiased strokes | Complete every paint discriminant/parameter and scale semantics |
| `#8` | Bevel profiles, extrusion wiring, document v2 migration | Reconcile removed `facePaint`/`capBack` with `PLAN.md` |
| `#9` | Remove unused HarfBuzz/font metadata modules | Build the real deterministic outline/font pipeline |
| `#24` | Constrain workspace/artboard to the viewport | Tablet overlay placement and short-mobile flow |
| `#28` | Reduce bevel staircasing with smoothed height/Sobel normals | Golden tests for all hero materials |
| `#29` | Scrollable/legible style library and lazy real-render previews | Current-text audition, favorites/recent, performance budget |
| `#31` | Wider warp bend/shape controls | Resolve same-version compatibility and documented range mismatch |
| `#37` | Actionable exporter chunk-load recovery message | Progress/cancel and terminal worker-error behavior |
| `#38` | Resolve relative manifest values before base-path assertions | Offline export/share and portable artifact coverage |

### Open Implementation PRs

Do not duplicate these. Open means implemented and under review, not landed.

| PR | Scope | Base/coordination |
|---|---|---|
| `#25` | Auto-dismiss toasts | `main` |
| `#26` | Static-animation fast path and disabled static Play | `main` |
| `#27` | Search/Escape/nudge/duplicate shortcuts and focus fixes | `main` |
| `#30` | Real Fit zoom | `main` |
| `#32` | Solid effect-color controls | `main` |
| `#33` | Eleven presets and Texture category | `main` |
| `#34` | Layer visibility and duplicate controls | Stacked on `#27` |
| `#35` | Favicon, tablet Undo, explicit local root-base gate | Additional coverage after merged `#38` |
| `#39` | Evaluate animated preview at frame zero | Stacked on `#26` |
| `#40` | Locale-independent case transforms | `main` |
| `#41` | Strict same-millisecond cross-tab revision checks | `main` |
| `#42` | Exclude invisible effects from reach/tiling checks | `main` |
| `#43` | Protect focused controls from destructive shortcuts | Stacked on `#27` |
| `#44` | High-contrast two-pass selection outline | `main` |
| `#45` | Reuse EDT work buffers | Merged current `main` into branch after resolving `#28` overlap |

## P0: Correctness, Safety, and Truthfulness

### Reconcile public claims with shipped behavior

`PLAN.md` says v1 is complete and README advertises outline-backed warps, editable effects, direct
manipulation, and other semantics that are currently bitmap approximations, inaccessible controls,
or absent workflows.

Required outcome: update `PLAN.md` status and narrow README claims until the outline pipeline, full
editable semantics, deterministic fonts, and cached render graph exist. Keep capability documentation
truthful after every model decision; do not use aspirational architecture as a current feature list.

### Separate geometry coverage from fill alpha (`sol.md` C-01)

The only text source surface contains painted fill alpha, and SDF/effects derive geometry from it.
Disabled fills produce a white fallback; translucent fills alter or erase stroke/bevel/glow/shadow
geometry. Neon Grid's 30% fill can fall below the SDF threshold.

Required outcome: rasterize independent opaque glyph coverage, derive fields from that mask, and
composite fill effects separately. Add disabled/zero/translucent-fill pixel tests.

### Add render budgets before allocations (`sol.md` C-02, C-10, C-18; PERF-06)

Schema-valid share data can request huge blur kernels, canvas areas, loop LCMs, and contiguous export
buffers. Tiling still allocates the entire final RGBA image, up to 256 MiB before effects/encoding.

Required outcome:

- Runtime guards before canvas, typed-array, blur-kernel, frame, and LCM allocation.
- Aggregate memory budget, not dimension-only checks.
- Preview at displayed CSS size times capped DPR, not logical canvas dimensions.
- Capability/context-loss handling and physical iOS/Android validation.
- Streaming/tiled PNG encoding or conservative rejection.
- A document migration for any newly invalid persisted v1/v2 values; do not silently tighten schema.

### Prevent invalid editor state from becoming an invalid autosave (`sol.md` C-03)

Clearing Size commits zero although schema requires a positive value. Persistence/share do not parse
outgoing documents, so ordinary UI input can create an unrestorable autosave.

Required outcome: support transient input text without committing invalid model values; validate at
command and persistence/share boundaries; test clear, blur, autosave, reload, and share.

### Never silently omit accepted layers (`sol.md` C-04)

Shape/image/group elements validate but do not render; diagnostics are discarded and export succeeds
with missing content.

Required outcome: preserve and visibly diagnose unsupported layers and block incomplete export until
they render. Removing/rejecting documented types is a model decision plus migration, not a shortcut.

### Make model controls honest (`sol.md` C-06, C-08, C-09)

Audit every serialized field and prove it changes output. Remaining gaps include stroke joins/dashes,
effect slot/order semantics, texture scale/rotation/assets, glow/shadow noise/range/jitter/choke,
reflection fade/blur, some paint geometry/intensity/variant/dither behavior, and logical-pixel scaling
for textures/post effects.

Required outcome: implement each accepted field or make a documented model/migration decision.
Group the near-term UI by truthful fixed render slots rather than implying arbitrary graph order.

### Fix text bounds and deterministic font behavior (`sol.md` C-05, C-13)

Native system fonts make layout, share links, warps, and export bounds machine-dependent. Arial Black
is not universal. Horizontal ink bounds ignore actual left/right overhang, clipping italics/swashes.

Required outcome:

- Small lazy OFL font shelf with one visual-test anchor font.
- Explicit font readiness/substitution warning and worker consistency.
- Content-addressed font assets, then shaping/outlines in the raster worker.
- Actual ink bounds plus antialias margin.
- Complex-script/RTL/variable-axis/feature acceptance fixtures.

### Make warp validation and bounds conservative (`sol.md` C-14)

Missing mesh data maps silently to identity; empty paths/degenerate perspective can validate; several
controls do nothing; render meshes can be denser than the fixed 24x12 bounds sampler, allowing sharp
control points to clip. Merged `#31` also widened persisted bend/adjustment ranges beyond `PLAN.md`
without a document-version transition.

Required outcome: reject unsafe runtime mappings, compute adaptive/conservative bounds, surface
unsupported semantics, and resolve range compatibility in plan/model/migrations. Later replace bitmap
triangulation with warped outlines/adaptive geometry.

### Repair corrupt-document recovery (`sol.md` C-16)

"Start a new document" starts autosave clean without replacing the corrupt active record. An
immediate reload can return to recovery.

Required outcome: quarantine/delete the bad record and persist the fresh document before leaving
recovery. Test reload without an intervening edit.

### Validate nested identity (`sol.md` C-19)

Duplicate effect/animation IDs validate although commands and React keys assume uniqueness.

Required outcome: define ID scope and ship a document migration that repairs/rejects ambiguous IDs.

### Finish pointer transaction lifecycle (`sol.md` C-20)

Lost pointer capture or unmount can leave history in an active transaction, disabling undo/redo.

Required outcome: handle `lostpointercapture`, clean up active drag on unmount, cache the drag
rectangle, and test cancellation/commit semantics.

### Make export errors terminal and cancellable (`sol.md` C-22; PERF-05)

Any PNG worker rejection/timeout reruns the export on the main thread. Animated export evaluates
bounds/frames twice, renders on main, retains every frame, and cannot cancel.

Required outcome: fallback only on pre-work capability failure; propagate domain/timeouts; move
evaluation, bounds, render, and encode to workers; stream a bounded frame buffer; support progress
and `AbortSignal` with tested cancellation latency.

### Prove alpha and blend guarantees (`sol.md` C-23)

Canvas2D readback is straight alpha, while CPU effect arrays and Canvas color/blend behavior are not
the planned premultiplied linear render graph. Merged tests are a start, not proof of the full claim.

Required outcome: exported soft colored glow/shadow fixtures over black/white, zero-alpha RGB checks,
blend references, preview/export comparisons, determinism, and structural cross-browser assertions.

### Align animation names with behavior (`sol.md` C-24)

Bounce is whole-element motion, Gloss Sweep moves reflection, Sparkle pulses texture opacity, and
Typewriter erases during the final 30% instead of holding as documented.

Required outcome: rename approximations honestly or implement specified semantics after glyph-level
animation exists; add rendered loop-seam tests.

The animation contract also disagrees on per-character staggering: `PLAN.md` and TypeScript expose
it, while schema/evaluator reject it. Make one coordinated decision across plan, types, schema,
evaluator, UI, README, and tests; persisted changes require migration discipline.

## P1: Performance and Responsiveness

The measured audited-main baseline was roughly 233 ms for a text edit, 317 ms for Gold Bar apply,
and a longest 478 ms long task on a local headless run. Treat these as diagnostic, not stable CI
benchmarks.

### Build a cached render graph (`sol.md` PERF-01)

All preview effects run synchronously on main. WebGL only uploads and displays the completed CPU
canvas, adding a full-frame copy.

Required sequence:

1. Instrument layout, raster, warp, SDF, each effect, composite, upload, and event-to-paint.
2. Cache text/layout/font, warp, coverage/SDF, individual effects, styled element, and composite.
3. Reuse styled surfaces for transform-only movement.
4. Render directly to visible 2D until WebGL does real work.
5. Move CPU raster/effects to a persistent worker, then implement planned GPU passes.

The final displayed WebGL surface currently uses `preserveDrawingBuffer: false`, unlike
`PLAN.md:1067`, so reliable preview readback is unavailable. Resolve this through a readable render
target, direct visible 2D, or an explicit justified plan change; final-surface thumbnails/tests must
not silently read a cleared buffer.

### Bound and pool CPU kernels (`sol.md` PERF-02)

After `#45`, continue with bounded/downsampled blur, pooled typed arrays/canvases, initial
`willReadFrequently` contexts, invariant texture hashes outside pixel loops, direct glitch channel
copies, and cached coverage/SDF. Preserve merged subpixel SDF behavior.

### Stop document updates on every pointer/slider event (`sol.md` PERF-03)

Continuous events run Immer, timestamps, React, autosave timer churn, and transaction-array copying;
patch accumulation is approximately quadratic.

Required outcome: transient interaction state outside the document; commit once at pointer-up or at
least once per frame; compact by path; timestamp/autosave at commit; one gesture equals one undo.

### Isolate animation from React (`sol.md` PERF-04)

Even after static fast paths, active animation drives the entire App through React and clones the
document each frame.

Required outcome: external clock subscribed by renderer only, small evaluated-property overlays,
affected-pass invalidation, adaptive preview FPS, visibility pause, and no full App commits per frame.

### Split subscriptions and avoid redundant bounds state (`sol.md` PERF-07)

Presets, inspector, layers, canvas, history, and export rerender from one full-document subscription;
canvas bounds trigger a second React update.

Required outcome: narrowly subscribed components and bounds refs that update UI only on material
selection-bound changes. Profile before incidental memoization.

### Preprocess and adapt warps (`sol.md` PERF-08)

Preset bitmap warp uses 576 clipped full-source draws per element. Path tables and homographies can
be recomputed per sample.

Required outcome: preprocess path/homography per revision, share/cache grid vertices, adapt density to
curvature, and eventually use outlines or a GPU mesh.

### Budget startup and offline feature chunks (`sol.md` PERF-09)

Animation/share codecs are eagerly reachable and Workbox broadly precaches generated assets (audited
precache 627.88 KiB).

Required outcome: dynamic/worker-only codecs where practical and CI bundle/precache budgets, while
retaining first-session offline APNG/GIF/share or introducing explicit offline readiness. Add offline
export/share tests, not shell reload only.

### Remove redundant persistence/share work (`sol.md` PERF-10)

Autosave reads/clones whole documents redundantly; fallback stringify/localStorage and level-9 share
compression are synchronous.

Required outcome: separate revision metadata, remove redundant clones, and move large serialization
and compression to a worker.

### Enforce performance gates (`sol.md` PERF-11)

Add representative fixtures for keystroke/drag/slider p95, stage timings, long tasks, cancellation,
memory, bundle bytes, and 1x/2x/4x/large animation exports. Keep CPU-heavy correctness tests from
flaking under unconstrained parallel workers. Validate mobile on physical devices outside deterministic
CI.

## P1: UX, Accessibility, and Visual Quality

### Finish responsive controls and layout (`sol.md` UX-02, UX-03, UX-10, UX-19)

- Phone users still need visible Undo/Redo and Delete; tablet work is in `#35`.
- Opening Presets at tablet width can collapse Canvas to zero width; use explicit grid areas/portal.
- Replace the 642 px mobile minimum with `100dvh`; design short/landscape layouts.
- Use `pointer: coarse`, not viewport width, for 44 px target policy.

### Turn the effect list into an honest inspector (`sol.md` UX-04)

Build expandable cards with 4-6 working primary controls, typeable values, opacity/blend, and Advanced.
Start from solid colors in `#32`, then gradients/ramps, shadow/glow geometry, bevel/light, extrusion,
texture, reflection, and post controls. One slider drag must create one undo entry.

### Complete preset discovery (`sol.md` UX-05)

Merged `#29` gives truthful lazy previews. Add current-text audition on hover/focus/long press using
one debounced low-resolution surface, selected-preset state, favorites, and recent styles. Measure
30-card CPU/memory and honor reduced motion.

### Build an Export Studio (`sol.md` UX-06)

Show exact dimensions, scale/target pixels, auto-fit/full canvas, padding, memory/file estimate,
background fringe preview, and format guidance. GIF should offer explicit matte versus one-bit dither
and recommend APNG for soft alpha. Add progress/cancel, Copy PNG, Save As, and iOS save guidance.

### Complete direct manipulation and keyboard parity (`sol.md` UX-07, UX-08, UX-21)

Add numeric transforms first, then accessible scale/rotate handles, a yellow preset-warp handle,
shadow/gradient/extrusion handles, keyboard focus/nudge announcements, pan/pinch, and tap-vs-drag
thresholds. Restore native touch behavior wherever editor gestures are absent.

### Add project and layer workflows (`sol.md` UX-09, UX-22)

Expose document title/autosave state and existing modified index as New/Recent/Duplicate/Rename/Delete.
Make shared-copy replacement reversible. Define lock semantics for every command, not only dragging,
then expose lock, opacity, blend mode, and rename. User presets need an independent DB migration.

Add multi-select, alignment, and distribution only after single-layer transform/lock semantics are
complete; these serve text composition without expanding into a general vector editor.

### Expose canvas configuration

Canvas width/height, background, auto-fit, and export padding exist in the model but the UI fixes
users at 1200x630 transparent. Add common social presets plus exact dimensions, transparent/solid
background, auto-fit, and padding controls with immediate memory/export preflight.

### Make responsive sheets real sheets (`sol.md` UX-11)

Only one small-screen sheet at a time; backdrop, visible Close, Escape, initial focus, focus trap and
restoration, appropriate dialog/region semantics, and close Presets after apply.

### Fix semantics, contrast, and state (`sol.md` UX-12, UX-13, UX-21)

Add semantic toolbars/groups and `aria-pressed`/selected state; raise muted contrast/type floor and
control boundaries; derive transparency/status from actual background; replace Layers `<footer>` with
a labeled region; add an `h1`; make render errors assertive/actionable. `#44` handles selection outline
only.

### Remove false affordances (`sol.md` UX-15)

After `#27`/`#30`, remaining false chrome includes disabled Warp, hardcoded rulers, static transparency
status, decorative effect drag grips, and the misleading WEBGL2 renderer badge. Implement or remove;
replace ornamental status with autosave, coordinates, selected dimensions, and render quality.

Decide explicitly whether command Undo/Redo should override native text-field history. If global
document history wins, document it and ensure the merged typing transaction behaves predictably.

Restore the promised first interaction without reopening the mobile keyboard problem: the first
intentional text entry should replace the default `WordWarp`, not append to it. Use explicit
first-edit/select-all behavior rather than unconditional autofocus.

### Finish animation/export states (`sol.md` UX-16, UX-17)

After `#26`/`#39`, static APNG/GIF still encodes duplicate frames; disable/warn or export a still.
Provide visible import/update overlays, semantic progress and cancel, distinct toast tones, bounded
notifications, and actionable render/export recovery.

### Make empty states productive (`sol.md` UX-18)

Applying a preset with no text currently does nothing. Either create a text layer or disable with an
explanation. Turn empty/no-selection copy into Add Text and Choose Style actions.

## Strategic Product Programs

| Program | Current gap | Exit criterion |
|---|---|---|
| Outline-native text | Browser bitmap text, no asset pipeline | Shaped outlines warped before raster; deterministic bundled/imported fonts; same preview/export surface |
| Real materials/render graph | CPU approximations and presentation-only WebGL | Cached premultiplied linear passes; normals/matcaps/Fresnel; measured interaction budgets |
| Warp Workshop | Mapping primitives but no authoring UI | Path, perspective, smooth mesh authoring with conservative bounds and accessible handles |
| Motion Studio | Preset-only tracks and approximate semantics | Add/edit/scrub four honest macros; deterministic loops; bounded worker export |
| Projects/assets/styles | Active document only | Recent projects, user styles, content-addressed assets, portable `.wordwarp` files |
| Text-serving scenes | Non-text layers silently skipped | Deterministic splat/grid/confetti/starburst/badge backdrops without becoming a vector editor |

P2 platform work: externalize hard-coded English strings and define the document/UI locale policy
before claiming i18n. Text transformation/rendering must remain deterministic for persisted inputs.

## Quality Gates Before Calling V1 Complete

1. Hero-preset golden images, then all built-ins, anchored by a bundled font.
2. Alpha fringe and zero-alpha RGB decode tests across representative blends/colors.
3. Preview versus 1x/2x/4x export comparisons and rendered-frame determinism.
4. Reference corner/midpoint plus image checks for all OOXML warps.
5. Structural export/offline tests in Chromium, desktop WebKit, Firefox, and mobile projects.
6. Complete 320 px Text -> Style -> Export journey with Undo/Delete and no horizontal overflow.
7. Performance/memory/cancellation/bundle budgets with representative multi-element fixtures.
8. Unsupported layers/fonts/effects produce visible diagnostics and cannot silently export partially.

## Delightful Near-Term Ideas

### Seeded Weird/Mellow Remix

Deterministically mutate safe warp, palette, bevel, glow, extrusion, and post ranges. Let users lock
parameters. Same source plus seed must serialize identically; one remix is one undo; no invalid bounds.

### Stack Autopsy

Hold Space for raw versus styled text, Shift-click to solo an effect, and scrub through
Back/Body/Front/Post passes. This teaches the model and makes complex styles debuggable.

### Better 1997 Energy

Keep the editor restrained but make the gallery feel like a mysterious late-90s CD-ROM: real warped
silhouettes, chrome/rainbow category plaques, recent/favorites, and Surprise Me. Add original, subtle
Warp Wizard/floppy/glint moments without copying Microsoft characters, blocking work, adding default
sound, or ignoring reduced motion. Keep the specific moments distinct: a tiny floppy glint after
autosave, a modem-inspired visual pulse with sound off by default, and a chrome sparkle after a
successful export.

### Small High-Leverage Delights

| Idea | Value |
|---|---|
| Time scrubber + Export This Frame | Makes procedural motion understandable and useful for stills |
| Global-light sun dial | Turns the existing shared angle/altitude into direct visual play |
| WordArt tribute starter | One-click Office ramp + slant + extrusion nostalgia without locking users in |
| Deterministic meme templates | Reusable multi-layer VHS/title/top-bottom compositions |
| Ping-pong export | Smooth loops for tracks that are not naturally cyclic |
| Chromeless `?embed=1` mode | Share-card/Notion/website embeds from the same deterministic document |
| Copy PNG and optional JPEG/WebP | Faster creator workflow while keeping PNG transparency primary |

### Existing-Primitive Style Pack

| Mood | Style | Recipe |
|---|---|---|
| Freaky | Haunted Fax | Wave4, ivory fill, double stroke, hard shadow, halftone, glitch, grain |
| Freaky | Dial-Up Portal | Ring Inside, Chrome II, cyan/magenta glows, scanline roll |
| Freaky | Printer Jam | Slant, monochrome ink, horizontal tears, misregistered shadow |
| Mellow | Mall Fountain | Calm Water ramp, soft bevel, pale inner glow, reflection, slow sweep |
| Mellow | Airbrush Yearbook | Pastel gradient, Arch Up, white outline, diffused shadow, fine grain |
| Mellow | Lavender Lava Lamp | Inflate, purple/pink gradient, pillow bevel, soft cyan glow |
| Fancy | Champagne Hologram | Gold/pearl angular gradient, white rim, restrained sparkle |
| Fancy | Velvet Rope | Burgundy satin, gold bevel, deep soft shadow, subtle grain |
| Astonishing | CD-ROM Deluxe | Holographic angular fill, bevel, rim, aberration, hue cycle |
| Maximal | Maximum Presentation | Fire ramp, Stop warp, deep extrusion, hard offset shadow |

### Ambitious Style Research

| Direction | Needed architecture |
|---|---|
| Lenticular Sticker | Real matcaps plus deterministic tilt-to-track capture |
| Infinite Word Tunnel | Ring warp, geometry depth echoes, effect-aware bounds |
| Mercury Screensaver | Outline mesh, circular noise, liquid-metal normals |
| Printer Jam Dissolve | Seeded tears, ink misregistration, ordered alpha dissolve |
| Magic Eye Headline | Text depth field and explicit opaque-background mode |
| Desktop Aquarium | Scene sprites, glass/pearl materials, caustic sweep |
| Laser-Etched Ice | Height/normals, cracks texture, refraction approximation |

Pointer/tilt state must be committed as parameters or converted to deterministic tracks before
export. Ephemeral input must never make output nondeterministic.

## Recommended Delivery Order

1. Land/reconcile the open small PRs, especially stacked bases `#26`/`#39` and `#27`/`#34`/`#43`.
2. Close P0 allocation, invalid-state, silent-omission, fill-mask, recovery, and export-error risks.
3. Establish alpha/golden/preview-export/performance gates before adding broad controls.
4. Deliver the first-minute UX: mobile actions, truthful presets, effect inspector, Export Studio,
   document title/autosave, and deterministic fonts.
5. Build cached worker/GPU rendering and outline text as explicit milestones.
6. Add Warp Workshop, Motion Studio, projects/assets/user styles, then the creative programs above.

Detailed evidence and original line references remain in `sol.md`; complementary live measurements,
screenshots, and the first implementation log remain in `k3.md`.
