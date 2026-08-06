# WordWarp — analysis & roadmap

Living document for future work. It consolidates the 2026-08 review (`k3.md`) with completed
items cleared out; the "Recently landed" table preserves what was done and where. Historical
detail on finished items lives in `k3.md` §1–§6.

## Recently landed

| PR | What | Notes |
|---|---|---|
| #24 | Fixed workspace layout pushing the artboard off-screen | The single biggest visual bug; shell height + workspace row constraints |
| #25 | Toasts auto-dismiss | 4s info/success, 8s warning; errors persist until dismissed, and hover/focus holds the countdown |
| #26 | Static documents no longer re-render every frame during Play | Play disabled when no tracks are enabled |
| #27 | Keyboard shortcuts | `/` search, Escape deselect, arrows nudge, Ctrl+D duplicate; selection + autoFocus fixes |
| #30 | Fit zoom actually fits | 100% remains a separate button |
| #32 | Color swatches in the effect stack | Solid paints/colors + bevel highlight/shadow |
| #33 | 11 new presets + texture (FX) category | 41 presets across six categories; Disco Fever is animated |
| #34 | Layer visibility toggles + DUP button | Stacked on #27 |
| #35 | Favicon, tablet undo buttons, local e2e base-path fix | `check.sh` exports `VITE_BASE_PATH=/` locally |
| #6 | Glyphs rasterised at the export scale | 1x-4x resolution control; edge band held flat instead of doubling |
| #7 | Effect paints render as paints; strokes anti-aliased | A gradient stroke was one flat sample |
| #8 | Real bevel profiles; extrude parameters wired up | `facePaint`/`capBack` removed with a v1→v2 migration |
| #9 | Unused HarfBuzz/opentype.js shaping code deleted | Never reachable from any render path |
| #28 | Bevel shading no longer staircases down a stroke | The ladder of horizontal notches across glyphs |
| #29 | Style library scrolls; legible categories; real previews | Only 12 of 30 styles had been reachable |
| #31 | Bend and shape run past 1 | Arch sweep capped at half a turn to stay monotonic |
| #37 | Actionable message when an export chunk fails to load | Translated at the call site to keep the lazy chunk tree-shaken |
| #38 | PWA manifest test resolves URLs before comparing | Was failing on `main` for every PR |
| #39 | Animated previews evaluate at frame zero | |
| #40 | Deterministic text case transforms | Locale-independent, so a shared document renders identically |
| #41 | Same-millisecond stale saves rejected | |
| #42 | Invisible effects ignored in export bounds | |
| #43 | Focused controls protected from canvas shortcuts | |
| #44 | Selection outline contrast | Dark underlay under the cyan dashes |
| #45 | Distance-transform work buffers reused | |

---

## Open bugs

### Rendering (mostly in files owned by other agents' branches)

- **Texture overlay ignores `scale`/`rotation`** — the inspector slider is a no-op
  (`renderTexture`, `cpu-effects.ts`). Fix in the pattern sampling after their branches land.
- **SDF threshold at alpha ≥ 128 loses anti-aliasing** — strokes take their coverage from the
  band edge as of #7, and #28 reconstructs the bevel surface before differentiating it, so the
  visible symptoms are gone. The field itself is still built from a binarised mask, which is
  worth revisiting if another effect starts showing whole-pixel structure. Note that seeding the
  transform from coverage was measured and did *not* help on its own: a scalar distance transform
  combines a sub-pixel seed in quadrature with an integer pixel separation.
- **Fake rulers** — `.canvas-rulers` hardcodes 0–1200 regardless of zoom/scroll/canvas size.
  Recommend removal (implies precision the app doesn't have), or generate real ticks.
- **GIF/APNG export of a static document renders ~24 identical frames** — now cheap to detect
  via `hasEnabledAnimationTracks`; short-circuit to 1 frame or warn.
- **Text rendering depends on local fonts** — "Arial Black" is absent on most Linux/Android;
  metrics (and thus layout, warps, export bounds) differ per machine, breaking share-link
  fidelity and any golden tests. Needs bundled/web fonts (the removed `harfbuzz.ts` pipeline
  was the start) or `document.fonts.load` + metrics-stable fallbacks.
- **`preserveDrawingBuffer: false`** — the preview canvas can't be read back. Preset thumbnails
  no longer need it (#29 renders each preset into its own offscreen canvas rather than reading
  the live one), but pixel-asserting tests still go through PNG export to get at the pixels.
- **Renderer badge says "WEBGL2"** — the GL path is only a fullscreen blit of the CPU render.
  Rename or drop the badge.

### Interaction

- **Ctrl+Z inside text fields is hijacked by global undo** — intentional-ish (each keystroke
  is a merged history entry), but native field undo no longer works. Decide and document.
- **Selection overlay has no drag handles** — users will expect corner handles for scale;
  the transform model supports it.
- **Effect drag grip is decorative** — stack reordering is UP/DN buttons only; real
  drag-and-drop would be a usability win.
- **Slider outputs are read-only** — clicking the numeric value should allow typing.

---

## Performance (measured ~150–195ms per keystroke on the default stack)

Root cause: every store update re-runs layout, face rasterisation, EDT-based SDF, all blurs,
the ≤96-pass extrude union, and post effects on the main thread with no caching.

- Cache the SDF per face-alpha content (largest single cost), then blurs.
- Cache `layoutText` per (text, font, layout) tuple.
- `drawWarpedSurface` uses a fixed 24×12 grid (576 clipped triangle draws per element per
  frame) — adapt grid density to warp curvature; slants/fades need 2×1.
- `applyPostEffect` does 2 full-buffer copies + a mix pass even for no-op amounts — early-out.
- `blurAlpha` is O(n·radius) with no downscale for large σ (PLAN says 4× downsample σ>32).
- Animation export re-renders everything per frame; static layers could be composited once
  and reused across frames.

---

## Missing features (by user impact)

1. **Gradient/ramp editing** — solid colors are done (#32); gradient stops, angles, and ramp
   selection are still preset-only. Unlocks true fire/ice/custom metal styles.
2. **Font management** — 7-entry system-font datalist; no Google Fonts, no upload, no
   weight/italic/axis/feature UI despite `FontSpec` supporting all of it. Related to the
   local-font determinism bug above.
3. **Warp UI depth** — `adj[1]`, `distortH/V`, `keepUpright` and the mesh/path/perspective
   warps (all implemented in the engine) have no UI; the Warp toolbar button is disabled.
4. **Full effect parameter editing** — one slider + colors per effect today; no angle,
   distance, spread, blend mode, or contour editing.
5. **Canvas size/background UI** — CanvasSpec fields exist; only 1200×630 transparent is
   reachable. Include autoFit/padding controls.
6. **Document management** — one autosaved document; no New/Open/list, no `.ww` file
   import/export (the DB `by-modified` index is ready for a document browser).
7. **Animation UI** — tracks exist only via presets; can't add/remove/tune tracks; the
   inspector never shows `element.animations`.
8. **Layer operations** — rename (double-click), lock, opacity, blend mode still missing
   (visibility/duplicate done in #34/#27).
9. **Export options** — scale UI is landing via another agent; still missing JPEG/WebP,
   copy-to-clipboard (one-liner with `navigator.clipboard.write`), and a live size estimate.
10. **User presets** — save/fork/share stacks (PLAN's "presets are data" promise).
11. **Shape/image elements** — model supports them; nothing renders or edits them.

---

## Delightful ideas (picked from k3.md §7, ranked by wow-per-effort)

1. **Live preset thumbnails** — render "Aa" with each preset's real stack into tiny offscreen
   canvases at startup; turns the library into the product's best salesperson. Needs
   `preserveDrawingBuffer` (or render straight to 2D canvases).
2. **Mesh-warp overlay** — the engine is complete; add a 4×3 draggable grid on the canvas
   when the Warp tool is active. Nothing else on the web has it.
3. **Time scrubber** — slider over t∈[0,1) next to Play; also enables "export this frame".
4. **Remix dice** — seeded randomization of post seeds/hue rotation/warp adj; shareable by
   URL for free.
5. **Global-light sun-dial** — drag to rotate `globalLight.angle`; already drives bevel +
   shadows together.
6. **WordArt-97 tribute toggle** — force Office ramps + slant + extrude on new text.
7. **Meme templates** — canned multi-layer documents (Impact top/bottom, VHS title card).
8. **Ping-pong loop flag** for APNG/GIF export.
9. **`?embed=1` chromeless share-card mode.**

## Future style directions

Engine unlocks needed for the next tier of styles: gradient-stop editing (fire, ice, custom
metals), matcap library (only one generic matcap exists), stroke dashes (modelled, ignored by
renderer), text-on-path UI, contour editor (ringed glows, sticker shadows). Style candidates
that then become possible: Liquid Gold, Burning, Ice Cube, Gunmetal Brushed, Neon Outline
(double-stroke), Riso Misregistration print set, and a full Office-ramp gallery picker.

---

## Recently completed (archive)

See the "Recently landed" table above and `k3.md` for the original detailed write-ups of:
workspace layout, toast TTL, static-animation fast path, keyboard shortcuts, fit zoom, effect
color controls, new presets, layer controls, favicon/tablet-undo/e2e-base-path.
