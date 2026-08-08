# WordWarp — Design & Implementation Plan

> A browser-based text-effects studio for metallic, synthwave, pseudo-3D, embossed and shadowed
> type. Compose elements on a canvas, export a genuinely transparent PNG — shadows and glows
> included — plus animated APNG/GIF.

**Status:** v1 implemented through the five-PR roadmap; this document remains the architecture reference.
**Repo:** `L-K-M/WordWarp` · **Branch:** `main`

> **Naming note.** The brief calls the tool "WordWrap"; the repository is `WordWarp`. This document
> uses **WordWarp** throughout — it matches the repo and describes what the tool actually does
> (warping type), whereas "word wrap" is an unrelated typographic term that would fight for search
> results. Easy to change if the other name was intended.

---

## Table of contents

1. [Vision and positioning](#1-vision-and-positioning)
2. [Competitive research](#2-competitive-research)
3. [Design principles](#3-design-principles)
4. [The style library](#4-the-style-library)
5. [Core data model](#5-core-data-model)
6. [Rendering architecture](#6-rendering-architecture)
7. [Text and geometry pipeline](#7-text-and-geometry-pipeline)
8. [The warp engine](#8-the-warp-engine)
9. [The effect catalogue](#9-the-effect-catalogue)
10. [Materials: metal, gradients, textures](#10-materials-metal-gradients-textures)
11. [Pseudo-3D: extrusion and long shadow](#11-pseudo-3d-extrusion-and-long-shadow)
12. [Shadows and glows](#12-shadows-and-glows)
13. [Animation system](#13-animation-system)
14. [Export pipeline](#14-export-pipeline)
15. [Presets](#15-presets)
16. [UI and UX](#16-ui-and-ux)
17. [Application architecture](#17-application-architecture)
18. [Performance budget](#18-performance-budget)
19. [Testing strategy](#19-testing-strategy)
20. [Accessibility, mobile, i18n](#20-accessibility-mobile-i18n)
21. [Roadmap](#21-roadmap)
22. [Risks and mitigations](#22-risks-and-mitigations)
23. [Open questions](#23-open-questions)
24. [Appendices](#24-appendices)

---

## 1. Vision and positioning

### 1.1 What WordWarp is

A single-page web app where you type a word, pick a style, and get something that looks like it was
made by someone who knew Photoshop in 1997 — chrome that actually reflects, bevels that actually
catch light, extrusions with real vanishing points — then export it as a transparent PNG that drops
cleanly onto any background.

Three commitments distinguish it:

1. **The effect stack is real, not a filter preset.** Every style is a reorderable stack of
   parameterised effects (fill, bevel, stroke, extrude, glow, shadow…), modelled on Photoshop layer
   styles. Presets are just saved stacks. Nothing is a black box — click any preset and you can
   take it apart.
2. **The warp engine deforms outlines, not baselines.** Existing web tools bend text along a path
   (SVG `textPath`), which curves the baseline but leaves glyphs undistorted. Real WordArt maps
   glyphs into a two-curve *envelope*. WordWarp implements the envelope model, covering all 40
   OOXML preset warps plus free-form mesh warping.
3. **Transparency is a first-class output, not an afterthought.** Correct premultiplied-alpha
   compositing throughout, so a soft drop shadow fades to `alpha = 0` with no grey fringe. This is
   the single most common failure in competing tools and the most common user complaint.

### 1.2 Who it is for

| Audience | Need | What they use today |
|---|---|---|
| Meme / social creators | Fast, funny, nostalgic type | Screenshots of Word, Canva |
| Streamers, YouTubers | Channel art, transparent overlays | Photoshop, Photopea |
| Indie game & zine makers | Retro title treatments | Aseprite, Illustrator |
| Designers prototyping | Quick chrome/synthwave mock | Photoshop layer styles |
| Nostalgia browsers | Play with WordArt | makewordart.com |

The first four all need **transparent PNG at a usable resolution**. That is the wedge.

### 1.3 Non-goals (v1)

- Not a general vector editor. No pen tool, no arbitrary path drawing.
- No vector export (SVG/PDF). The effects are pixel-based by nature; this is settled scope.
- No multi-user realtime collaboration.
- No account system or server-side rendering in v1. Fully client-side, static-hosted.
- No AI generation. (A style-suggestion feature is a possible v2.)

---

## 2. Competitive research

Findings below come from fetching the live sites and, where the site is a single-page app, reading
its shipped JavaScript bundle.

### 2.1 makewordart.com

A polished nostalgia play: pick one of the classic gallery styles, type text, download. The bundle
(`WordArtGenerator.astro_…js`, ~425 KB) reveals the renderer's vocabulary — heavy use of `stroke`
(288 occurrences), `skew` (107), `shadow` and `gradient` (56 each), `arch` (15), a single `wave`,
and **zero** occurrences of `bevel`, `emboss`, `extrude` or `warp`. The colour set is the 140 CSS
named colours, not a designed palette.

**Read:** faithful to the 1990s *look*, but the implementation is CSS/SVG text with strokes, skews
and gradients. No true bevel, no envelope warp, no metal shading. Fine for nostalgia, a dead end
for "more powerful/creative".

### 2.2 wordart97.net

The most technically interesting competitor, and a genuinely careful reimplementation. Its bundle
(`index-CFouf1EP.js`, ~406 KB) contains the actual Microsoft Office asset names, which makes it a
useful specification source. Its render settings object:

```js
{ font:"Arial Black", isBold, isItalic, wordSpacing:100, characterSpacing:100, size:100,
  color:"#ffffff", color2:"#0000ff", darkness:0.5, fillOpacity:100, hasOutline:false,
  shape:"none", shapeFactor:0.5, gradientType:"oneColor", shadingStyle:"horizontal",
  variant:1, texture:"01", colorRamp:"Rainbow", stretchWidth:100, stretchHeight:100,
  rotation:0, showBorders:false, lineColor:"#000000", lineDashStyle:"none", lineWeight:1,
  radialGradientMode:"glossy", effectType:"simple",
  depth3DOffsetX:13, depth3DOffsetY:-11, depth3DDistance:0.955,
  depth3DColor:"#c23a00", depth3DAutoColor:false, depth3DLighting:true }
```

It carries all 24 Office **preset colour ramps** (Rainbow, Rainbow II, Early Sunset, Late Sunset,
Nightfall, Daybreak, Horizon, Desert, Ocean, Calm Water, Fire, Fog, Moss, Peacock, Wheat,
Parchment, Mahogany, Gold, Gold II, Brass, Chrome, Chrome II, Silver, Sapphire) at 20 stops each,
and all 24 Office **fill textures** (Papyrus, Canvas, Denim, Woven mat, Water droplets, Paper bag,
Fish fossil, Sand, Green marble, White marble, Brown marble, Granite, Newsprint, Recycled paper,
Parchment, Stationery, Blue tissue paper, Pink tissue paper, Purple mesh, Bouquet, Cork, Walnut
wood, Oak wood, Medium wood). Those ramps are reproduced in [Appendix A](#appendix-a-office-preset-colour-ramps).

**Its ceiling is the warp.** The shape dispatcher implements exactly seven shapes:

```js
switch (shape) {
  case "arch-up": … case "arch-down": … case "circle": …
  case "wave-1": … case "wave-2": … case "double-wave-1": … case "double-wave-2": …
  case "none": default: return null
}
```

Each returns an SVG **path for `textPath`** — arcs built from `A` commands, waves from ~100–200
sampled `L` segments. `slant-up`/`slant-down` are implemented as a skew of ±`shapeFactor × 45°`.
So: baseline-following only. Glyphs never deform. Real WordArt has 40 warps, most of which
(Inflate, Deflate, Can, Triangle, Chevron, Fade, Button, Ring, Cascade, Stop) are *impossible*
with `textPath` because they require the top and bottom of each glyph to move independently.

The 3-D effect is a fixed offset-repeat (`depth3DOffsetX/Y`, `depth3DDistance`) — no vanishing
point, no per-face shading. Shadows are a single `feGaussianBlur`.

### 2.3 cooltext.com

The deepest preset library on the web: 100+ named styles including *Burning, Liquid Gold, Ice Cube,
Chrome One, Chrome Two, Chromium, Gunmetal, Glowing Steel, Gradient Bevel, GOLD BEVEL, Embossed,
3D Outline Gradient, 3D Outline Textured, Neon, Neon Glow, Alien Glow, Glitter, Blinkie, Animated
Glow, Plastic, Glossy, Molten Core, Supernova, Starburst, Lasers, Studio 54, Tie Dyed, Graffiti
Creator, Epic Stone, Sushi, Trogdor*.

Its per-style controls are narrow — font, size, text colour, shadow (No Shadow / Sharp / Light Blur
/ Medium Blur / Heavy Blur), shadow offset X/Y, colour, opacity, alignment, background.

Its **export list is the best in the category** and sets the bar:
`.GIF`, `.GIF w/ Transparency`, `.GIF w/ Transparency No Dither`, `.JPG`, `.PNG`,
`.PNG w/ Transparency`, `.PSD (Photoshop w/ Layers)`, `.XCF (Native Gimp Format)`.
It also supports multi-layer composites with z-ordering and rotation, and animated GIF styles.

**Read:** server-rendered (originally PHP/ImageMagick lineage), dated UI, but the preset breadth
and export honesty are real strengths to match. The offer of *layered* PSD export is notable — a
strong v2 idea for WordWarp given its stack is already layered.

### 2.4 inkpx.com

Category-organised presets (3D, Retro Comic, Gloss, Lined, Metal, Nature, Technology, Distressed,
Overlay, Gem, Sign, seasonal). PNG and JPEG export, and the site explicitly educates users that
"only the PNG format supports transparency" — evidence that transparency confusion is a live
user problem worth designing around. Controls are thin (mostly a Background tab); styles are
essentially fixed image treatments.

### 2.5 canva.com word art

Not a real WordArt tool — a landing page funnelling into the Canva editor, where "word art" means
font + colour + a handful of text effects (shadow, lift, hollow, splice, echo, glitch, neon,
background, curve). Effects are shallow but the *interaction* is excellent: live preview, one
slider per concept, instant. Canva owns ease; it does not own depth.

### 2.6 Summary: the gap

| Capability | makewordart | wordart97 | cooltext | inkpx | Canva | **WordWarp** |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Envelope warps (glyph deformation) | ✗ | ✗ (7 baseline) | ✗ | ✗ | ✗ (curve only) | **40 + mesh** |
| True bevel/emboss from a height field | ✗ | ✗ | ~ (baked) | ~ (baked) | ✗ | **✓** |
| Metal / matcap shading | ✗ | ramp only | ~ (baked) | ~ (baked) | ✗ | **✓** |
| Perspective extrusion | ✗ | offset only | ✗ | ~ | ✗ | **✓** |
| Editable effect stack | ✗ | ✗ | ✗ | ✗ | ✗ | **✓** |
| Multiple elements per canvas | ✗ | ✗ | ✓ | ✗ | ✓ | **✓** |
| Transparent PNG | ~ | ✓ | ✓ | ✓ | ✓ (paid) | **✓** |
| Correct alpha on soft shadows | ✗ | ~ | ~ | ~ | ~ | **✓** |
| Animated export | ✗ | ✗ | ✓ (GIF) | ✗ | ✗ | **✓ APNG/GIF** |
| Layered source export | ✗ | ✗ | ✓ (PSD) | ✗ | ✗ | v2 |

**The wedge:** real envelope warps + a real, editable effect stack + alpha-correct export.
Nobody currently offers any one of the three, let alone all three.

---

## 3. Design principles

1. **Two minutes to delight, two hours to mastery.** Landing → typed word → chosen preset →
   downloaded PNG in under 60 seconds, with no account. Every preset then opens into its full
   parameter stack.
2. **Presets are data, not code.** A preset is a serialised effect stack. Users can save, fork and
   share them by URL. The built-in library and user creations use the identical format.
3. **Deterministic rendering.** Same document + same seed + same `t` ⇒ byte-identical output.
   Non-negotiable for animation export, golden-image tests and shareable URLs.
4. **Preview is the export.** The on-canvas preview runs the same shader graph as the exporter, at
   lower resolution. No "looks different when saved" surprises.
5. **Alpha honesty.** All internal compositing is premultiplied; the only un-premultiply happens at
   readback. Never composite against an implicit white or black.
6. **Degrade, don't fail.** No WebGL2 → Canvas2D fallback renderer with a clear banner about which
   effects are unavailable. Huge export → tile it. Missing font → substitute and warn.
7. **Respect the source material.** Where Microsoft, Adobe or the 1990s established a name or a
   parameter, use it. Users searching for "Deflate Inflate" or "gloss contour" should find it.

---

## 4. The style library

The style catalogue drives the preset library (§15) and is the product's soul. Each entry lists a
palette and the effect stack that reproduces it.

> Provenance: metallic ramps marked ⟨MS⟩ are the exact Microsoft Office preset gradients extracted
> from wordart97.net's bundle ([Appendix A](#appendix-a-office-preset-colour-ramps)). Palettes
> marked ⟨R⟩ are researched community-standard values. Unmarked palettes are designed for this
> project and should be reviewed by a designer before shipping.

### 4.1 Metallic

| # | Style | Palette | Stack |
|---|---|---|---|
| M1 | **Chrome Classic** ⟨MS⟩ | Office *Chrome*: `#efefef #b5b6b5 #6b6d6b #323431 #efefef … #8c8e8c` (20 stops) | Vertical banded ramp fill → bevel (chisel hard, size 8) → stroke 2px `#1a1a1a` → drop shadow |
| M2 | **Liquid Chrome** | Env-map matcap, blue-grey sky `#c8d8ea` → horizon `#ffffff` → ground `#4a4a52` | Matcap fill (normals from SDF) → high-gloss contour → fresnel rim → soft contact shadow |
| M3 | **Gold Bar** ⟨MS⟩ | Office *Gold II*: `#f3e0ac #e2c87f #c6a058 #b6903e #7f6625 … #ecdfb3` | Ramp fill (angle 90°) → bevel (smooth, depth 120%) → inner shadow → stroke `#6b4f18` → drop shadow |
| M4 | **Brass Plaque** ⟨MS⟩ | Office *Brass*: `#7e5f1c #ad7f2a #db9a35 #f2aa3c … #dca137` | Ramp fill → emboss (pillow) → subtle noise texture → engraved inner shadow |
| M5 | **Cold Steel** ⟨MS⟩ | Office *Silver* + anisotropic brushed noise | Matcap fill → horizontal brushed-metal noise → chisel bevel → hard specular line |
| M6 | **Gunmetal** | `#2b2d33 #3f434c #5a5f6b #8a909c #c3c8d2` | Dark ramp → chisel bevel → thin `#0b0c0e` stroke → tight drop shadow |
| M7 | **Rose Gold** | `#f7d4c4 #e8a08d #d97f68 #b85c47 #7d3423` | Ramp → smooth bevel → warm inner glow → soft shadow |
| M8 | **Holographic Foil** | Iridescent hue sweep over normal: `#ff6ec7 #6ec7ff #6effb8 #fff36e` | Iridescence shader (hue = f(normal·view)) → gloss contour → white rim stroke |

### 4.2 Synthwave / outrun

| # | Style | Palette | Stack |
|---|---|---|---|
| S1 | **Outrun Sunset** ⟨R⟩ | `#ff00ff #ff1493 #ff7f50 #ffd700` over `#191970` | Vertical gradient fill with hard horizontal stripe mask → chrome bevel top → magenta outer glow → cyan offset shadow |
| S2 | **Neon Grid** ⟨R⟩ | `#00ffff #ff00ff #191970 #0d0221` | Hollow fill → 3px neon stroke → double outer glow (tight `#00ffff`, wide `#ff00ff`) → perspective grid backdrop |
| S3 | **Miami Vice** ⟨R⟩ | `#40e0d0 #ff7f50 #fc8eac #98fb98 #2d1b4e` | Two-colour diagonal gradient → thin white stroke → long shadow 45° → pastel glow |
| S4 | **Chrome & Magenta** | Office *Chrome II* body + `#ff0090` glow | Chrome ramp fill → italic skew 12° → magenta outer glow → cyan drop shadow at 180° |
| S5 | **Laser Beam** | `#39ff14 #00ffff #ffffff` | Thin stroke only → intense bloom → scanline post → chromatic aberration 2px |
| S6 | **VHS Tracking** | `#ff0000 #00ffff #ffffff #1a1a1a` | Flat fill → RGB split ±3px → horizontal jitter bands → noise → soft vertical blur |

### 4.3 Y2K / 2000s

| # | Style | Palette | Stack |
|---|---|---|---|
| Y1 | **Aqua Gel** | `#ffffff #7ec8ff #0a84ff #00417a` | Vertical gradient → glossy top highlight (elliptical white, 45% opacity) → inner shadow bottom → 1px `#004b8d` stroke → soft drop shadow |
| Y2 | **Web 2.0 Gloss** | `#ffffff #d0e8ff #5aa9e6 #1b6ca8` | Gradient fill → gloss sweep mask → reflection below (flipped, faded) → outer glow |
| Y3 | **Bubble Inflate** | `#ff9ec7 #ff5fa2 #d61f69` | Inflate warp → pillow emboss → rim light → contact shadow |
| Y4 | **Carbon Fibre** | `#1c1c1e #2c2c2e #3a3a3c` + gloss | Tiled weave texture → chisel bevel → sharp specular sweep |
| Y5 | **Glitter Text** | `#ff69b4 #ffd700 #ffffff` + sparkle sprites | Flat fill → animated sparkle overlay (seeded) → soft glow. *Animated preset.* |

### 4.4 1990s

| # | Style | Palette | Stack |
|---|---|---|---|
| N1 | **WordArt Classic** ⟨MS⟩ | Office *Rainbow* ramp | Ramp fill → 40° skew → extrude offset (13, −11) → auto-darkened depth colour |
| N2 | **Memphis Party** | `#ffd93d #ff6b6b #4ecdc4 #1a1a2e` on `#ffe66d` | Flat fill → thick `#1a1a2e` stroke → hard offset shadow (no blur) → confetti backdrop |
| N3 | **Nickelodeon Splat** | `#f57d0d #ffffff` | Bold fill → white outline → arch-up warp → splat shape backdrop |
| N4 | **Extreme Sports** | `#000000 #ff3b00 #ffffff` | Italic skew 20° → chisel bevel → hard drop shadow at 135° → grunge mask |
| N5 | **Lisa Frank** | `#ff6ec7 #a06eff #6ec7ff #6effb8 #fff36e` | Rainbow angular gradient → white stroke → rainbow outer glow → sparkles |
| N6 | **Graffiti Wildstyle** | `#00d4ff #ff00a0 #ffe600 #000000` | Fill → double stroke (`#000000` 6px outside, `#ffffff` 2px) → offset shadow → drip warp |

### 4.5 Dimensional

| # | Style | Palette | Stack |
|---|---|---|---|
| D1 | **Deep Extrude** | Face `#ff4757`, sides auto-darkened 40% | Perspective extrusion (depth 60, vanish below) → face gradient → contact shadow |
| D2 | **Isometric Block** | `#5352ed` face, `#3742a0` side, `#2f3542` bottom | Parallel extrusion at 30° → per-face flat shading → hard edge stroke |
| D3 | **Long Shadow Flat** | `#ff6348` + shadow `rgba(0,0,0,.18)` | Flat fill → 45° long shadow to canvas edge → no blur |
| D4 | **Letterpress** | Paper `#efe7d8`, ink `#3a3226` | Subtractive: inner shadow top-left, inner highlight bottom-right, no fill change |
| D5 | **Inflated Balloon** | `#ff4d6d #ffffff` | Inflate warp → pillow emboss size 40 → strong rim light → glossy specular blob → contact shadow |

### 4.6 Post / texture

Glitch (RGB split + block displacement), Halftone (dot screen, angle + frequency), Riso
Misregistration (2–3 flat inks offset 2–4px, multiply), Scanlines (period, opacity, roll offset),
CRT Bloom, Film Grain, Distressed (mask by noise threshold), Chromatic Aberration (radial RGB
offset). **Cross-Polar Crystal** adds seeded mineral cells with dark extinction boundaries over an
interference-colour field, chisel relief and a faceted Stop warp.
offset). **Satin Stitch Sampler** adds directional thread bundles, padded relief and a nested
embroidered border with a gentle fabric-sag warp.

### 4.7 Sweets / candy

| # | Style | Palette | Stack |
|---|---|---|---|
| C1 | **Candy Cane** | `#ff2e4d #ffffff` stripes | Hard-edged striped fill at 45° → inner bevel → white inner glow → arch-up warp |
| C2 | **Cotton Candy** | `#ffd1ec #ff9ec7 #b8a8ff` | Pastel gradient fill → grain texture → soft pink glow → inflate warp |
| C3 | **Gumdrop** | `#ff5fa2 #c2185b #ffffff` | Radial highlight fill → pillow bevel → white inner glow → satin sheen |
| C4 | **Bubblegum Blow** | `#ffffff #ff8fc0 #ff2e88` | Gloss gradient → big pillow bevel → strong inner glow → halftone dot texture. *Animated: pulse.* |
| C5 | **Lollipop** | full hue sweep | Angular (conic) rainbow fill → circle warp → white gloss. *Animated: hue cycle.* |
| C6 | **Licorice Twist** | `#2a2a2e #000000 #8a1538` | Near-black fill → chisel bevel → red satin sheen → wave-twist warp |
| C7 | **Chocolate Bar** | `#b06b2e #6b3a16 #3a1d08` | Chocolate gradient → weave texture (moulded squares) → inner bevel → inner shadow |
| C8 | **Peppermint** | `#ffffff #ff2e4d` | Hard-edged angular stripe swirl → inner bevel → white inner glow |

### 4.7 Spooky / horror

| # | Style | Palette | Stack |
|---|---|---|---|
| H1 | **Blood Drip** | `#d31c2e #8a0a12 #4a0508` | Wet pillow bevel → inner glow → chromatic aberration → can-down drip warp |
| H2 | **Ghost** | `#eaf0ff #b9c8ff #5c6aa8` | Translucent fill → pale blue outer glow → satin sheen → wave warp. *Animated: flicker.* |
| H3 | **Gravestone** | `#aab0bc #6e747e #3a3f47` + moss | Stone gradient → noise grain → emboss bevel → carved inner shadow → moss satin |
| H4 | **Toxic Slime** | `#b6ff9c #39ff14 #0d5c0a` | Gloss pillow bevel → inner glow → green bloom → aberration → inflate |
| H5 | **Pumpkin Carve** | `#ffb35c #ff8c1a #d45700` | Chisel bevel → carved inner shadow → warm inner glow → arch-down warp |
| H6 | **Vampire** | `#3a0d14 #1a0508 #8a1538` | Dark fill → red satin sheen → chisel bevel → tight shadow → slant |
| H7 | **Witchcraft** | `#a84dff #5a1fd6 #1a0533` | Purple gradient → satin → glitch → double-wave warp. *Animated: flicker.* |
| H8 | **Zombie** | `#9caf66 #6b8238 #39441c` | Sickly fill → grain → inner shadow → film grain → deflate warp |

### 4.7 Cosmic / space

| # | Style | Palette | Stack |
|---|---|---|---|
| X1 | **Aurora** | `#7dffd6 #39ff88 #1b6a4d #6a4dff` | Glow → green→violet gradient → satin sheen → inner glow → wave warp |
| X2 | **Nebula** | `#ff9ec7 #c86bff #5a1fd6 #1a0533` | Radial gradient → grain dust → glow → inner glow. *Animated: hue cycle.* |
| X3 | **Comet Trail** | `#ffffff #ffd166 #6a8aff` | Perspective extrude (180°) → glow head → white stroke → slant |
| X4 | **Solar Flare** | `#fff3a0 #ffb84d #ff6a1a #c62800` | Intense glow → pillow bevel → inner glow → chromatic aberration → inflate |
| X5 | **Galaxy Spiral** | `#ff6ec7 #a84dff #3a2fd6 #6ec7ff` | Conic rainbow spiral → satin → grain → thin stroke → circle warp. *Animated: specular sweep.* |
| X6 | **Black Hole** | `#ffd166 #a84dff #000000` | Double glow → near-black body → gold stroke → aberration → scanlines → ring-inside warp |
| X7 | **Red Giant** | `#ffc9a0 #ff7a4d #d6153a #6a0018` | Glow → chisel bevel → inner glow → grain → deflate warp |
| X8 | **Starfield** | `#e8ecff #ffd166 #0a0a1f` | Light fill → halftone star dots → grain → white stroke → wave warp. *Animated: sparkle.* |

---

## 5. Core data model

Versioned, JSON-serialisable, migration-aware. TypeScript is the source of truth; a Zod schema
validates on import.

```ts
export const DOC_VERSION = 1;

export interface Document {
  version: number;
  id: string;
  name: string;
  canvas: CanvasSpec;
  elements: Element[];          // index 0 = backmost
  assets: AssetTable;           // embedded fonts/images, content-addressed
  meta: { created: string; modified: string; app: string };
}

export interface CanvasSpec {
  width: number;                // logical px
  height: number;
  background: Paint | null;     // null = transparent
  autoFit: boolean;             // shrink-wrap to content bbox on export
  exportPadding: number;        // extra px so blurs are never clipped
}

export type Element = TextElement | ShapeElement | ImageElement | GroupElement;

interface ElementBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;              // 0..1
  blendMode: BlendMode;
  transform: Transform;
  effects: Effect[];            // ordered; see §9.1 for slot semantics
  animations: AnimationTrack[];
}

export interface Transform {
  x: number; y: number;
  rotation: number;             // degrees
  scaleX: number; scaleY: number;
  skewX: number; skewY: number; // degrees
  originX: number; originY: number; // 0..1 within element bbox
}

export interface TextElement extends ElementBase {
  type: 'text';
  text: string;                 // may contain \n
  font: FontSpec;
  layout: TextLayout;
  warp: WarpSpec;
}

export interface FontSpec {
  family: string;
  source: 'google' | 'bundled' | 'user' | 'local';
  assetId?: string;             // for user-uploaded
  weight: number;               // 100..900
  italic: boolean;
  variations?: Record<string, number>;  // variable-font axes: wght, wdth, slnt…
  features?: Record<string, boolean>;   // OpenType: liga, dlig, smcp, ss01…
}

export interface TextLayout {
  size: number;                 // px
  align: 'left' | 'center' | 'right';
  lineHeight: number;           // multiplier
  letterSpacing: number;        // em
  wordSpacing: number;          // em
  transform: 'none' | 'upper' | 'lower' | 'title';
  direction: 'ltr' | 'rtl';
  curveSpacing: 'uniform' | 'arc-length';  // spacing model under warp
}
```

### 5.1 Paint

```ts
export type Paint =
  | { kind: 'solid'; color: RGBA }
  | { kind: 'gradient'; gradient: Gradient }
  | { kind: 'texture'; assetId: string; scale: number; rotation: number; blend: BlendMode }
  | { kind: 'matcap'; matcapId: string; rotation: number; intensity: number }
  | { kind: 'ramp'; rampId: string; angle: number; variant: 1|2|3|4 };  // Office-style presets

export interface Gradient {
  type: 'linear' | 'radial' | 'angular' | 'reflected' | 'diamond';
  stops: Array<{ offset: number; color: RGBA }>;   // offset 0..1
  angle: number;                // degrees, for linear/reflected/angular
  center: [number, number];     // 0..1, for radial/diamond/angular
  scale: number;
  dither: boolean;              // ordered dither to kill banding
  interpolation: 'srgb' | 'oklab';   // oklab default — avoids muddy midpoints
}
```

Gradient interpolation defaults to **OKLab**. sRGB interpolation between saturated complements
(the magenta→cyan of every synthwave preset) passes through a desaturated grey; OKLab does not.
sRGB remains available for exact reproduction of the Office ramps.

### 5.2 Effects

Every effect shares an envelope, so the stack UI is uniform:

```ts
interface EffectBase {
  id: string;
  enabled: boolean;
  opacity: number;              // 0..1
  blendMode: BlendMode;
}

export type Effect =
  | FillEffect | StrokeEffect | BevelEffect | ExtrudeEffect
  | InnerShadowEffect | InnerGlowEffect | SatinEffect
  | OuterGlowEffect | DropShadowEffect | LongShadowEffect
  | TextureOverlayEffect | ReflectionEffect
  | PostEffect;                 // glitch, halftone, scanlines, grain, aberration
```

Full parameter lists in §9.

### 5.3 Warp

```ts
export interface WarpSpec {
  kind: 'none' | 'preset' | 'path' | 'mesh' | 'perspective';
  preset?: PresetWarpId;        // one of the 40 — see §8.2
  adj: [number, number];        // adjustment handles, normalised 0..1
  bend: number;                 // -1..1
  distortH: number;             // -1..1  (Illustrator "Horizontal Distortion")
  distortV: number;             // -1..1
  path?: PathData;              // for kind:'path'
  mesh?: { cols: number; rows: number; points: Float32Array };  // (cols+1)*(rows+1)*2
  corners?: [Pt, Pt, Pt, Pt];   // for kind:'perspective'
  keepUpright: boolean;         // glyphs stay vertical instead of rotating with the envelope
}
```

### 5.4 Migrations

`migrations/` holds `vN → vN+1` pure functions; loading runs them in sequence. Every migration ships
with a fixture pair (`before.json`, `after.json`) tested in CI. Documents never load unmigrated.

---

## 6. Rendering architecture

### 6.1 Decision

**Hybrid: CPU vector geometry → GPU (WebGL2) field-based shading → premultiplied composite.**

Text is shaped and outlined on the CPU (exact, resolution-independent, warpable as geometry), then
rasterised to a coverage mask, from which a signed distance field and surface normals are derived
on the GPU, feeding a small fixed shader graph.

### 6.2 Why not the alternatives

**Pure Canvas2D.** Cannot express bevel, matcap, or per-pixel material shading. `shadowBlur` is
implementation-defined and differs across browsers, breaking determinism. `ctx.filter` support is
uneven. Kept only as a degraded fallback renderer.

**Pure SVG filters.** Theoretically capable — `feSpecularLighting` + `feGaussianBlur` +
`feDisplacementMap` is the textbook bevel recipe — but in practice: filter-region clipping bugs,
`color-interpolation-filters` defaulting to linearRGB (a constant source of "why is my glow
brighter in Firefox"), significant Safari divergence, poor performance at high resolution, and no
control over resampling when rasterised. Determinism is unachievable across browsers. Rejected as
the primary path; retained as an *export-time* idea only if a vector path is ever added.

**Pure WebGL text (MSDF atlas).** Excellent for rendering glyphs at many sizes, but an atlas is the
wrong primitive here: we need *warped outlines*, not transformed quads, and we need one mask per
element, not per glyph. MSDF is still useful — see §7.5.

**WebGPU.** Better compute story for the distance transform, but as of 2026 Safari support remains
the limiting factor for a consumer web toy. The renderer is written behind a backend interface so a
WebGPU backend can be added without touching the effect graph.

**PixiJS v8 / three.js.** Both viable; both bring a scene-graph and filter model oriented toward
sprite post-processing that we would spend effort working around. Our graph is small, fixed and
bespoke. We use a ~600-line WebGL2 wrapper instead (FBO pool, program cache, fullscreen-quad
helper). Pixi remains the documented fallback if the custom renderer becomes a maintenance burden.

### 6.3 The render graph

Per element, back to front:

```
 ┌─ GEOMETRY (CPU, Worker) ──────────────────────────────────────────┐
 │ text → shape (HarfBuzz) → glyph outlines → layout → warp → paths  │
 └───────────────────────────────┬───────────────────────────────────┘
                                 ▼
 ┌─ RASTER ──────────────────────────────────────────────────────────┐
 │ paths → coverage mask A8 @ working scale (analytic AA)            │
 └───────────────────────────────┬───────────────────────────────────┘
                                 ▼
 ┌─ FIELDS (GPU) ────────────────────────────────────────────────────┐
 │ mask → SDF (jump flood) → ∇SDF → normals → bevel height h(d)      │
 └───────────────────────────────┬───────────────────────────────────┘
                                 ▼
 ┌─ LAYERS (GPU, each an RGBA premultiplied texture) ────────────────┐
 │ back:  drop shadows · long shadow · extrusion · outer glow        │
 │ body:  fill · texture overlay · satin · inner glow · inner shadow │
 │        · bevel shading                                            │
 │ front: strokes · reflection                                       │
 │ post:  glitch · halftone · scanlines · grain · aberration         │
 └───────────────────────────────┬───────────────────────────────────┘
                                 ▼
 ┌─ COMPOSITE ───────────────────────────────────────────────────────┐
 │ element layers → element texture → document composite → output    │
 └───────────────────────────────────────────────────────────────────┘
```

All intermediate textures are `RGBA8` premultiplied by default; `RGBA16F` when a glow's HDR
headroom matters (bloom) and the extension is available.

### 6.4 Caching

The graph is content-addressed. Each stage hashes its inputs (geometry hash, effect params, working
scale) and skips recomputation on a hit. Dragging a *shadow offset* slider must not re-shape text or
recompute the SDF — in practice it invalidates only the shadow layer and the composite, which is
what keeps interaction at 60fps.

---

## 7. Text and geometry pipeline

### 7.1 Shaping

**HarfBuzz via `harfbuzzjs` (WASM).** Correct kerning, ligatures, contextual alternates, OpenType
feature toggles, variable-font instancing, and complex scripts — none of which a hand-rolled
`cmap` + `kern` reader gets right. `hbjs.js` also exposes `glyphToPath(glyphId)`, so shaping and
outline extraction come from one source of truth, eliminating a whole class of mismatch bugs.

- Cost: ~300 KB WASM, lazy-loaded on first text edit, cached in IndexedDB.
- Variable fonts: `hb_font_set_variations` before drawing gives correctly interpolated outlines.
- `opentype.js` is kept only for cheap metadata reads in the font picker (family name, axes,
  glyph coverage) where booting WASM would be overkill.

### 7.2 Layout

1. Split text into lines on `\n`; per line, shape a buffer → glyph IDs + advances + offsets.
2. Apply `letterSpacing` / `wordSpacing` as advance deltas (em-relative, so size-independent).
3. Position lines by `lineHeight × size`, aligned per `align`.
4. Baseline from the font's `hhea`/`OS/2` metrics, not from an ad-hoc `size × 0.8`.
5. Accumulate a **tight bounding box from the outlines**, not from font metrics — essential for
   export cropping, since a swash or a heavy stroke routinely exceeds the em box.

### 7.3 Outlines

Each glyph yields a `Path` of move/line/quad/cubic/close commands in font units, scaled by
`size / unitsPerEm`. Contours carry winding direction; counters (the hole in "o") are preserved and
filled with the **non-zero** rule.

### 7.4 Flattening

Warping requires polylines. Adaptive subdivision by flatness tolerance:

```
tol_device = 0.2 px            // sub-pixel at working scale
tol_curve  = tol_device / scale
subdivide while  flatness(curve) > tol_curve
```

with flatness measured as max control-point deviation from the chord. Under high-curvature warps
(Circle, Ring) the tolerance is tightened by the local Jacobian determinant of the warp — otherwise
straight stems visibly facet after deformation. Re-fitting curves post-warp is deliberately *not*
done: we rasterise the polylines directly, so faceting is controlled purely by tolerance.

### 7.5 Rasterisation

Coverage mask rendered at `workingScale` (preview 1×, export 2–4×) via analytic-AA scanline fill on
the CPU in a Worker, uploaded as an `R8` texture. Rationale over GPU triangulation: exact
non-zero-winding fills with holes, no tessellation artefacts, and it runs off the main thread.

For very large exports the mask is tiled (§14.5).

---

## 8. The warp engine

The differentiator. Everything here operates on **glyph outlines**, so glyphs genuinely deform.

### 8.1 The envelope model

A warp is a map `W: [0,1]² → ℝ²`. Each flattened outline point is normalised to the element's
pre-warp bbox as `(u,v)`, mapped, then scaled back.

The classic WordArt/Office warps are **two-curve envelopes**: a top curve `T(u)` and a bottom curve
`B(u)`, with points interpolated vertically between them:

```
W(u,v) = lerp( T(u), B(u), v )
```

where `T` and `B` are each a function of the preset and its adjustment values. This single formula
covers the great majority of the 40 presets; the radial family (Circle, Ring, Button, Arch-Pour)
needs a polar mapping instead:

```
θ  = θ₀ + u·Δθ
r  = lerp(r_outer, r_inner, v)
W  = (cx + r·cos θ,  cy + r·sin θ)
```

`keepUpright` controls whether glyphs additionally rotate to follow the envelope tangent.

### 8.2 The 40 presets

Complete `ST_TextShapeType` enumeration, extracted from the OOXML schema. Grouped by
implementation family:

**Identity (1):** `textNoShape`, `textPlain`

**Linear envelope (8)** — `T`,`B` are straight lines:
`textStop`, `textTriangle`, `textTriangleInverted`, `textChevron`, `textChevronInverted`,
`textSlantUp`, `textSlantDown`, `textCascadeUp`/`textCascadeDown`

**Scale envelope — fades (4)** — one edge fixed, the other ramps:
`textFadeUp`, `textFadeDown`, `textFadeLeft`, `textFadeRight`

**Quadratic envelope — inflate/deflate (7)**:
`textInflate`, `textDeflate`, `textInflateTop`, `textInflateBottom`, `textDeflateTop`,
`textDeflateBottom`, `textDeflateInflate`, `textDeflateInflateDeflate`

**Sinusoidal envelope (4)**:
`textWave1`, `textWave2`, `textWave4`, `textDoubleWave1`

**Arc / circular envelope (10)**:
`textArchUp`, `textArchDown`, `textArchUpPour`, `textArchDownPour`, `textCircle`,
`textCirclePour`, `textButton`, `textButtonPour`, `textCurveUp`, `textCurveDown`

**Cylindrical (2):** `textCanUp`, `textCanDown`

**Ring (2):** `textRingInside`, `textRingOutside`

The distinction between a plain and a *Pour* variant matters: **Curve** fits text to the arc while
keeping a constant height (the baseline bends, glyph height is preserved), whereas **Pour** stretches
glyphs to fill the full annulus between the two arcs. wordart97.net implements only the Curve
behaviour, and only for three shapes.

### 8.3 Reference implementations

```ts
// Arch Up — the canonical two-curve case.
// adj0 controls arc sweep (0 = flat, 1 = full semicircle).
function archUp(u: number, v: number, adj0: number): Pt {
  const bend = adj0 * Math.PI;              // total sweep
  const top    = -Math.sin(u * Math.PI) * bend * 0.5;
  const bottom = -Math.sin(u * Math.PI) * bend * 0.5 * 0.35;  // bottom bends less
  return [u, lerp(top, bottom + 1, v)];
}

// Inflate — both edges bow outward, glyphs stretch vertically at the centre.
function inflate(u: number, v: number, adj0: number): Pt {
  const k = adj0 * 0.5;
  const bulge = Math.sin(u * Math.PI);
  return [u, 0.5 + (v - 0.5) * (1 + k * bulge) ];
}

// Wave 1 — both edges follow the same sinusoid (no vertical stretch).
function wave1(u: number, v: number, adj0: number, phase = 0): Pt {
  const amp = adj0 * 0.4;
  return [u, v + Math.sin(u * Math.PI * 2 + phase) * amp];
}

// Circle Pour — glyphs fill the annulus.
function circlePour(u: number, v: number, adj0: number): Pt {
  const theta = -Math.PI / 2 + u * Math.PI * 2;
  const rOuter = 0.5, rInner = rOuter * (1 - adj0 * 0.6);
  const r = rOuter + (rInner - rOuter) * v;
  return [0.5 + r * Math.cos(theta), 0.5 + r * Math.sin(theta)];
}
```

Each preset is a pure function `(u, v, adj0, adj1) → [x, y]` in `src/warp/presets/`, unit-tested
against a table of expected corner and midpoint mappings.

### 8.4 Free-form warps

- **Path warp.** User draws or picks a path; text follows it. Requires arc-length
  reparameterisation: sample the path into a cumulative length table, binary-search per glyph
  advance. Two spacing modes — `uniform` (equal arc length) and `arc-length` (true advance
  widths, correct but visually uneven on tight curves).
- **Mesh warp.** An `n × m` grid of draggable control points; interior points mapped by bicubic
  (Coons patch) interpolation. Default 4 × 3.
- **Perspective warp.** Four draggable corners → 3×3 homography solved from the 8-DOF linear
  system, applied per point with the `w` divide. Because a homography is not affine, curves must be
  flattened *before* transform — a straight-line segment stays straight under a homography, so no
  extra subdivision is required beyond §7.4.

### 8.5 Warp ordering

Warp applies **after** layout and **before** effects. Consequence: strokes and bevels follow the
warped silhouette rather than being warped bitmaps — which is the entire point, and the reason
this cannot be done as a post-process on a rendered image.

---

## 9. The effect catalogue

### 9.1 Stack semantics

The stack is user-reorderable, but each effect declares a **slot** so a newly added effect lands
somewhere sensible. Default back-to-front order follows Photoshop's (which CS6 rationalised):

```
BACK   drop shadow(s) · long shadow · extrusion · outer glow
BODY   fill · texture overlay · gradient overlay · satin
       · inner glow · inner shadow · bevel & emboss
FRONT  stroke(s) · reflection
POST   glitch · halftone · scanlines · grain · chromatic aberration
```

Drop Shadow and Outer Glow are the only effects rendered *behind* the element body — matching
Photoshop, and matching user expectation. Effects marked *multi* may appear several times in one
stack: stroke, inner shadow, drop shadow, all overlays.

### 9.2 Parameters

**Fill** — `paint: Paint`, `opacity`, `blendMode`.

**Stroke** *(multi)* — `width` 0–200px, `position` `inside|center|outside`, `paint`,
`join` `miter|round|bevel`, `miterLimit` 1–20, `dash` `[on,off]`, `dashOffset`, `opacity`,
`blendMode`. Implemented by **path offsetting** (Clipper2-WASM) rather than SDF thresholding,
because outside strokes on sharp corners need true miters — an SDF band always rounds them.

**Bevel & Emboss** —
`style` `outer|inner|emboss|pillow|strokeEmboss`;
`technique` `smooth|chiselHard|chiselSoft`;
`depth` 1–1000 %; `direction` `up|down`; `size` 0–250 px; `soften` 0–16 px;
`angle` 0–360°; `altitude` 0–90°; `useGlobalLight` bool;
`glossContour` curve; `highlight {color, blendMode, opacity}`; `shadow {color, blendMode, opacity}`.

**Inner Shadow** *(multi)* — `blendMode`, `color`, `opacity`, `angle`, `distance` 0–250 px,
`choke` 0–100 %, `size` 0–250 px, `contour`, `noise` 0–100 %.

**Inner Glow** — `blendMode`, `opacity`, `noise`, `paint`, `technique` `softer|precise`,
`source` `center|edge`, `choke` 0–100 %, `size` 0–250 px, `contour`, `range` 1–100 %, `jitter`.

**Satin** — `blendMode`, `color`, `opacity`, `angle`, `distance`, `size`, `contour`, `invert`.
(Implemented as the mask blurred and offset in two opposing directions, multiplied.)

**Outer Glow** — `blendMode`, `opacity`, `noise`, `paint` (solid or gradient),
`technique` `softer|precise`, `spread` 0–100 %, `size` 0–250 px, `contour`, `range`, `jitter`.

**Drop Shadow** *(multi)* — `blendMode`, `color`, `opacity`, `angle`, `useGlobalLight`,
`distance` 0–1000 px, `spread` 0–100 %, `size` 0–250 px, `contour`, `noise`,
`knockout` bool (layer knocks out drop shadow).

**Long Shadow** — `angle`, `length` px or `toEdge`, `paint` (solid or gradient fade),
`opacity`, `fade` bool.

**Extrude** — see §11.

**Texture Overlay** — `assetId` or procedural (`noise|weave|halftone|grain`), `scale`, `rotation`,
`blendMode`, `opacity`, `clipToShape` bool.

**Reflection** — `offset`, `height` %, `opacity`, `fade` curve, `blur`.

**Post effects** — `glitch {seed, blocks, maxOffset, rgbSplit}`,
`halftone {frequency, angle, shape, contrast}`, `scanlines {period, opacity, offset, curvature}`,
`grain {amount, size, seed, monochrome}`, `aberration {amount, mode: linear|radial}`.

### 9.3 Global light

A document-level `{angle, altitude}` that any effect can subscribe to via `useGlobalLight`. Turning
the master light rotates every bevel highlight and drop shadow together — the single fastest way to
make a multi-element composition look coherent, and a feature every serious tool has.

### 9.4 Blend modes

Implemented per the W3C Compositing and Blending spec (which Canvas
`globalCompositeOperation` and Photoshop agree on for the common set): `normal, multiply, screen,
overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion,
hue, saturation, color, luminosity`, plus `linear-dodge (add)` for glow work.

All blending happens in **premultiplied linear space** for the separable modes; the four
non-separable modes (hue/saturation/color/luminosity) un-premultiply, convert, blend, re-premultiply.

---

## 10. Materials: metal, gradients, textures

### 10.1 Fields from the mask

```
mask (R8, coverage 0..1)
  └─ SDF  d(x,y)   signed distance in px, negative inside
       ├─ ∇d = (dFdx(d), dFdy(d))     → 2D gradient, unit length in a true SDF
       ├─ n  = normalize(vec3(-∇d.x, -∇d.y, k))   → surface normal
       └─ h  = profile(d)              → bevel height
```

**Distance transform.** Jump Flooding (JFA) on the GPU: seed with edge pixels, then
`log₂(n)` passes at step sizes `n/2, n/4, … 1`, each sampling 9 neighbours. `O(n² log n)` total,
runs in ~2 ms for 1024², and needs no CPU readback. For export-quality output the exact
Felzenszwalb–Huttenlocher `O(n²)` Euclidean transform runs in the Worker instead — JFA's rare
off-by-one-pixel errors are invisible at preview scale but can produce a faint stair-step on a
4× export bevel.

**Bevel profiles** — `h = profile(d)` for `d ∈ [-size, 0]`, `t = 1 + d/size`:

| Technique | Profile |
|---|---|
| `smooth` (round) | `h = sqrt(1 - (1-t)²)` |
| `chiselHard` (flat) | `h = t` |
| `chiselSoft` | `h = smoothstep(0, 1, t)` |
| `pillow` | `h = sin(t·π)` — rises then falls, giving the puffed look |

The `depth` parameter scales `h`; `soften` blurs `h` before differentiation.

**Normal:**
```glsl
vec3 normalFromHeight(sampler2D H, vec2 uv, vec2 texel, float depth) {
  float hx = texture(H, uv + vec2(texel.x, 0)).r - texture(H, uv - vec2(texel.x, 0)).r;
  float hy = texture(H, uv + vec2(0, texel.y)).r - texture(H, uv - vec2(0, texel.y)).r;
  return normalize(vec3(-hx * depth, -hy * depth, 1.0));
}
```
The `z = 1.0` convention means `depth` alone controls how pronounced the relief is; higher `depth`
tilts normals further from vertical. Typical useful range `depth ∈ [0.5, 8]`.

### 10.2 Bevel shading

```glsl
vec3 L = vec3(cos(angle) * cos(altitude), sin(angle) * cos(altitude), sin(altitude));
float ndl = dot(n, L);
float hi  = max(ndl, 0.0);
float lo  = max(-ndl, 0.0);
hi = texture(glossContour, vec2(hi, 0.5)).r;   // gloss contour is a 1D LUT
lo = texture(glossContour, vec2(lo, 0.5)).r;
vec4 col = base;
col = blend(col, highlightColor, hi * highlightOpacity, highlightBlend);
col = blend(col, shadowColor,    lo * shadowOpacity,    shadowBlend);
```

Gloss contour as a 256×1 LUT texture, authored in the UI by a curve editor. A contour with multiple
peaks is exactly how the classic "ringed chrome" look is produced.

### 10.3 Metal

Two mechanisms, both driven by the normal:

**Ramp mapping (1D).** Index a gradient by `n.y` — the sky-to-ground reflection model. This is what
the Office *Chrome* ramp encodes: alternating light/dark bands producing the illusion of a
reflected horizon.

```glsl
float t = n.y * 0.5 + 0.5;
vec3 metal = texture(rampLUT, vec2(t, 0.5)).rgb;
```

**Matcap (2D).** Index a lit-sphere texture by the full normal — richer, captures highlights that a
1D ramp cannot:

```glsl
vec2 uv = n.xy * 0.5 + 0.5;            // optionally rotated by matcapRotation
vec3 metal = texture(matcap, uv).rgb;
```

Matcaps are generated procedurally at build time (sky gradient + horizon line + specular blob +
ground) into a 256×256 texture, then hand-tuned. Ship ~12: chrome, dark chrome, gold, rose gold,
copper, brass, steel, gunmetal, iridescent, glass, pearl, liquid mercury.

**Fresnel rim** for the last 10 % of realism:
```glsl
float fres = pow(1.0 - abs(n.z), 3.0);
metal = mix(metal, rimColor, fres * rimStrength);
```

**Anisotropic brushed metal:** perturb `n.x` by a 1D noise sampled along the brush axis before
lookup.

**Iridescence:** hue-shift by view angle —
`hsv2rgb(vec3(fract(baseHue + n.z * spread), sat, val))`.

### 10.4 Gradients

Rendered as shaders, not baked, so they stay crisp at export scale. Five geometries (linear,
radial, angular, reflected, diamond), OKLab interpolation by default, and **ordered 8×8 Bayer
dithering** applied at ±0.5/255 — without it, a large slow gradient bands visibly in an 8-bit PNG,
which is the single most common quality complaint about gradient-heavy exports.

---

## 11. Pseudo-3D: extrusion and long shadow

### 11.1 The two extrusion models

**Parallel (oblique).** Every point offsets along a constant vector — the classic WordArt look, and
what wordart97.net implements via `depth3DOffsetX/Y`. Cheap: no perspective, faces never converge.

**Perspective.** Faces converge on a vanishing point `V`. Point `p` at depth `t ∈ [0,1]` maps to
`lerp(p, V, t · strength)`. Dramatically better for titles, and something no competitor offers.

### 11.2 Building the geometry

Naïve repeated-offset drawing (`n` copies of the path stepped toward the vanishing point) is what
most tools do. It is cheap and, at high step counts, acceptable — but it cannot shade faces
independently, and it produces visible banding on curves at low counts.

WordWarp builds **real side walls**:

1. Compute the **silhouette** of the front face: the subset of outline edges whose normal faces
   away from the extrusion direction. For a 2D outline extruded along `d`, edge `e` is on the
   silhouette when `dot(normal(e), d) > 0`.
2. For each silhouette edge `(a, b)`, emit the quad `(a, b, b + Δ, a + Δ)` where `Δ` is the
   extrusion offset (constant for parallel, perspective-divided for vanishing-point).
3. Sort quads back-to-front by depth along `d` (painter's algorithm — correct here because the
   geometry is a prism with no self-intersection in the projection).
4. Shade each face by its own normal: `faceNormal = normalize(perp(b - a))`, lit by the same global
   light as the bevel, so the extrusion and the face agree.
5. Union all quads with the front face via Clipper2 to get a single clean silhouette for the
   *outer* stroke and drop shadow — otherwise the shadow shows internal seams.

Holes (counters) matter: the inside of an "O" also generates silhouette edges, and they must be
shaded as *interior* walls (facing the opposite way) or the letter looks hollow-wrong.

### 11.3 Extrude parameters

`depth` 0–500 px · `mode` `parallel|perspective` · `angle` 0–360° (parallel) ·
`vanishingPoint [x,y]` + `strength` (perspective) · `facePaint` · `sidePaint` ·
`autoShade` bool (derive side colours by darkening the face) · `shadeAmount` 0–100 % ·
`steps` (quality; `auto` picks from curvature) · `capBack` bool.

### 11.4 Long shadow

A degenerate extrusion: extrude the silhouette to a great length in one direction, fill flat, then
optionally fade along the extrusion axis. `toEdge` computes the length needed to reach the canvas
corner. Rendered as geometry, not as `n` stacked copies — which keeps a 2000px shadow as cheap as
a 20px one.

---

## 12. Shadows and glows

### 12.1 Blur

Separable Gaussian on the GPU: horizontal pass then vertical, into half-resolution FBOs for large
radii. For `σ > 32`, downsample by 4 first — visually indistinguishable and ~16× cheaper. Kernel
weights computed on the CPU and uploaded as a uniform array; taps clamped to 33 with linear-sampling
tap-pairing (a 33-tap Gaussian costs 17 samples).

Canvas2D's `shadowBlur` is deliberately not used anywhere: its σ mapping is unspecified and browsers
disagree, which would break determinism and golden-image tests.

### 12.2 Spread / choke

`spread` on an outer shadow and `choke` on an inner one are the same operation — a morphological
dilate/erode before the blur. Implemented in distance space, which makes it exact and free:

```glsl
float alpha = smoothstep(spreadPx + 0.5, spreadPx - 0.5, d);   // dilate by spreadPx
```

### 12.3 The alpha-correctness rule

This is the feature users actually notice, so it is stated as an invariant:

> Every intermediate texture stores **premultiplied** RGBA. Blur, blend and composite all operate on
> premultiplied values. The *only* un-premultiply in the system happens once, at readback, in the
> exporter.

Blurring straight (non-premultiplied) alpha is the classic bug: fully transparent pixels carry
arbitrary RGB (often black), and the blur drags that RGB into the visible fringe, producing the grey
halo around exported glows. Blurring premultiplied values is mathematically correct because a
transparent pixel contributes `(0,0,0,0)` — no colour at all.

### 12.4 Contours

Shadow and glow `contour` remaps the falloff through a 256×1 LUT — the mechanism behind ringed
glows and the hard-edged "sticker" shadow. Same curve-editor UI as gloss contour.

---

## 13. Animation system

### 13.1 Model: procedural, not keyframed

Every animatable effect is a pure function of normalised loop time `t ∈ [0,1)`. No keyframe
interpolation, no timeline scrubbing state — which makes seamless looping automatic (`t=1` ≡ `t=0`)
and export deterministic.

```ts
export interface AnimationTrack {
  id: string;
  kind: AnimationKind;
  enabled: boolean;
  duration: number;             // seconds for one loop
  params: Record<string, number | string>;
  seed: number;                 // for noise-driven kinds
  stagger?: {                   // per-character offsets — the After Effects "range selector" idea
    amount: number;             // 0..1 phase spread across characters
    order: 'forward' | 'backward' | 'center' | 'random';
  };
}
```

Randomness comes from a seeded PRNG (`alea`) and seeded simplex noise — never `Math.random()`, so
frame `k` renders identically on every run and on every machine.

### 13.2 The catalogue

| Kind | Drives | Loops by |
|---|---|---|
| `specularSweep` | matcap/ramp rotation offset | full 2π cycle |
| `glossSweep` | position of a gloss band mask | wraps off-shape |
| `neonFlicker` | glow opacity via seeded noise | noise sampled on a circle |
| `hueCycle` | gradient stop hue rotation | 360° |
| `rainbowScroll` | gradient offset | one period |
| `scanlineRoll` | scanline `offset` | one period |
| `vhsJitter` | per-band x-offset + rgb split | noise on a circle |
| `glitchBlocks` | block displacement seed | stepped, `floor(t·n)` |
| `sparkle` | sprite positions/phases | per-sprite phase |
| `waveUndulate` | warp `adj0` / wave phase | full period |
| `bounce` | per-char y with squash & stretch | eased period |
| `typewriter` | per-char reveal | hold at end |
| `extrudeSpin` | extrusion angle | 360° |
| `pulse` | scale / glow size | sine |

"Loops by sampling noise on a circle" is the trick that makes flicker and jitter loop: sample 2D
noise along a circular path `(cos 2πt, sin 2πt)` rather than along a line, so the value at `t=1`
equals the value at `t=0`.

### 13.3 Export budget

Defaults: 24 fps, 2 s loop, 48 frames. UI shows an estimated file size live and warns past 5 MB.
Frames render sequentially into the same FBO chain and are handed to the encoder in a Worker, so
memory stays bounded at one frame plus the encoder's buffer.

---

## 14. Export pipeline

### 14.1 The algorithm

```
1. Determine content bounds
     union of every element's effect-inclusive bbox
     (body ⊕ max(stroke width, glow size + spread, |shadow offset| + size, extrude depth,
                 long-shadow length))
     + canvas.exportPadding
2. Choose scale S  (1×, 2×, 4×, or explicit target px)
3. Validate  W·S × H·S  against browser limits  → tile if needed (§14.5)
4. Allocate RGBA8 FBO, clear to (0,0,0,0)
5. Render the document graph at scale S, premultiplied throughout
6. readPixels → Uint8ClampedArray  (premultiplied)
7. Un-premultiply:  for a>0:  c = round(c·255/a)      // exactly once, here
8. Optional supersample downsample to target (box for 2×/4×, Lanczos-3 otherwise)
9. Encode
10. Deliver (§14.6)
```

Step 1 is the step tools get wrong: exporting the *element* bounds clips the glow. The bbox must be
dilated by every effect's reach.

### 14.2 WebGL context settings

```js
const gl = canvas.getContext('webgl2', {
  alpha: true,
  premultipliedAlpha: true,   // matches our internal convention and PNG
  antialias: false,           // we do our own AA via coverage masks + supersampling
  preserveDrawingBuffer: true,// required to read back after compositing
  desynchronized: false,
});
```

`antialias: false` is deliberate: MSAA on the default framebuffer resolves *before* we can read it,
and interacts badly with premultiplied readback at edges. Our AA comes from analytic coverage plus
supersampling, which is both higher quality and deterministic.

### 14.3 Un-premultiplication

```ts
function unpremultiply(px: Uint8ClampedArray): void {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a === 0) { px[i] = px[i+1] = px[i+2] = 0; continue; }
    const s = 255 / a;
    px[i]   = Math.min(255, Math.round(px[i]   * s));
    px[i+1] = Math.min(255, Math.round(px[i+1] * s));
    px[i+2] = Math.min(255, Math.round(px[i+2] * s));
  }
}
```

Note the `a === 0` branch writes explicit zeros rather than leaving stale RGB. Some PNG optimisers
and some image editors surface those hidden values when a user later adjusts alpha; zeroing them
also compresses better.

Rounding introduces up to 1/255 of error at low alpha — unavoidable in 8-bit straight alpha, and
imperceptible. (16-bit PNG output would avoid it entirely; deferred as a niche v2 option.)

### 14.4 Encoders

| Format | Library | Notes |
|---|---|---|
| PNG | `canvas.toBlob('image/png')` | Browser-native, fastest. Default path. |
| PNG (optimised) | `UPNG.js` | Lossless recompression, or lossy palette quantisation. **Quantising destroys smooth alpha gradients** — offered only with an explicit warning and a live preview of the damage. |
| APNG | `UPNG.encode(frames, w, h, 0, delays)` | `cnum = 0` for lossless truecolour + full alpha. Per-frame delays in ms. |
| GIF | `gifenc` | Chosen over `gif.js` for speed and quality (no Web Worker orchestration required, better quantiser). |
| WebP (animated) | deferred | Encoder cost is high; APNG covers the need with better alpha. |
| WebM (alpha) | `WebCodecs VideoEncoder` | v2. Chrome/Firefox support VP9 alpha; **Safari does not**. Alpha can flicker at chunk boundaries. Behind a capability check. |

**GIF and transparency.** GIF has 1-bit alpha — a pixel is either fully opaque or fully invisible.
Every soft shadow and glow therefore degrades. WordWarp handles this honestly rather than silently:

- Default: **matte** the animation against a user-chosen colour and export opaque GIF. Sharp, no
  artefacts, and correct when the user knows their background.
- Alternative: 1-bit alpha with ordered dithering in the transition band — stipple, not fringe.
- The export dialog shows a side-by-side preview of APNG vs GIF and steers users to APNG, which is
  now supported in all major browsers.

### 14.5 Size limits and tiling

| Browser | Max dimension | Max area |
|---|---|---|
| Chrome | 32,767 px | ~268 MP |
| Firefox | 32,767 px | ~472 MP |
| Safari (desktop) | — | ~16.7 MP |
| iOS Safari | 4,096 px | 4096 × 4096 |

Safari's ~16.7 MP area cap is the real constraint — a 4096×4096 export is already at the ceiling.
The exporter probes actual limits at runtime (allocate-and-test, the `canvas-size` technique),
caches the result, and **tiles** beyond them: render `T×T` tiles with an overlap of
`ceil(maxBlurRadius)`, then stitch. Tiles must be rendered with the *global* transform, not
re-centred, or effects break at seams. The UI caps the resolution slider at the probed limit and
explains why.

### 14.6 Delivery

1. `showSaveFilePicker()` (File System Access API) where available — real save dialog, user picks
   the location.
2. Fallback: `<a download>` with an object URL, revoked after 60 s.
3. "Copy to clipboard" via `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`.
   Chrome/Edge fully; Safari requires the write to occur in the same user-gesture task, so the blob
   is prepared *before* the click handler resolves.
4. iOS Safari: downloads are unreliable; show the image in a sheet with "press and hold to save".

---

## 15. Presets

### 15.1 Format

A preset is a partial `TextElement` — effect stack, paint, warp, and optionally font — with no text
content or transform:

```ts
export interface Preset {
  id: string;
  name: string;
  category: 'metallic' | 'synthwave' | 'y2k' | 'nineties' | 'dimensional' | 'texture' | 'sweets' | 'spooky' | 'user';
  category: 'metallic' | 'synthwave' | 'y2k' | 'nineties' | 'dimensional' | 'texture' | 'cosmic' | 'user';
  tags: string[];
  author?: string;
  thumbnail?: string;           // pre-rendered WebP for the built-ins
  animated: boolean;
  apply: Pick<TextElement, 'effects' | 'warp'> & { font?: Partial<FontSpec> };
}
```

Applying a preset **preserves the user's text, position and size** and replaces the style. A
"replace font too" toggle defaults on for the first application and off thereafter — copying the
behaviour that makes Canva feel predictable.

### 15.2 Thumbnails

100+ live thumbnails would be 100+ full render graphs. Instead:

- Built-in presets ship **pre-rendered 240×120 WebP** thumbnails, generated at build time by a
  Node script driving the same renderer headlessly. Zero runtime cost, and the gallery works before
  WebGL initialises.
- User presets render once on save, cached in IndexedDB as a blob.
- Hovering a thumbnail swaps in a live render of *the user's actual text* — the moment that sells
  the tool — rendered at low resolution into a shared 240×120 FBO, debounced to one at a time.

### 15.3 Sharing

Presets and whole documents serialise to a URL fragment: JSON → `CompressionStream('deflate-raw')`
→ base64url. Typical styled document compresses to 1.5–3 KB, comfortably inside the ~8 KB that
browsers and chat apps handle reliably. Documents with embedded user fonts exceed this and instead
produce a downloadable `.wordwarp` file (a zip of `document.json` + assets).

---

## 16. UI and UX

### 16.1 Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  WordWarp        [Undo] [Redo]            [Share] [Export ▾]         │
├────────────┬────────────────────────────────────────┬────────────────┤
│            │                                        │  INSPECTOR     │
│  PRESETS   │                                        │                │
│            │            C A N V A S                 │  ▸ Text        │
│  [search]  │         (checkerboard =                │  ▸ Font        │
│            │          transparent)                  │  ▸ Warp        │
│  ▸ Metal   │                                        │  ─────────────  │
│  ▸ Synth   │      ┌──────────────────┐              │  EFFECTS       │
│  ▸ Y2K     │      │  ╔═╗ WordWarp    │              │  ⣿ Bevel    ⏻  │
│  ▸ 90s     │      │  ╚═╝              │              │  ⣿ Fill     ⏻  │
│  ▸ 3D      │      └──────────────────┘              │  ⣿ Stroke   ⏻  │
│  ▸ Texture │                                        │  ⣿ Shadow   ⏻  │
│  ▸ Mine    │   [fit] [100%] [+] [−]   [▶ animate]   │  [+ Add effect]│
├────────────┴────────────────────────────────────────┴────────────────┤
│  LAYERS   [T] WordWarp   [T] subtitle   [▣] badge        [+] [🗑]    │
└──────────────────────────────────────────────────────────────────────┘
```

- **Canvas** shows a checkerboard for transparency — the visual promise of the product.
- **Effect stack** is drag-reorderable with per-effect enable toggles and an opacity/blend row,
  directly mirroring Photoshop's Layers panel so the mental model transfers.
- **Layers strip** at the bottom for multi-element documents; drag to reorder z-order.
- Panels collapse; canvas is never smaller than 50 % of the viewport.

### 16.2 The first 60 seconds

1. Land on a canvas already showing "WordWarp" in **Chrome Classic**. Nothing is empty.
2. The text is focused — typing immediately replaces it.
3. Click any preset: instant restyle, text preserved.
4. **Export** → PNG (transparent) → downloaded.

No modal, no signup, no tour. The preset gallery *is* the tutorial.

### 16.3 Direct manipulation

Everything adjustable by dragging on the canvas, not only by slider:

- Drag the element to move; handles to scale; corner to rotate.
- **Warp handles** — yellow diamonds, exactly like the Office adjustment handles they descend from.
- **Shadow/glow**: drag the shadow itself to set angle and distance.
- **Extrusion**: drag the vanishing point.
- **Gradient**: on-canvas gradient line with draggable stops.
- **Mesh warp**: drag grid points; double-click an edge to subdivide.

### 16.4 Controls

- **Colour picker**: `react-colorful` (~2.8 KB, no dependencies) wrapped with eyedropper
  (`EyeDropper` API where available), recent swatches, and palette suggestions drawn from the
  current preset.
- **Gradient editor**: stop bar with drag/add/delete, interpolation toggle, angle dial.
- **Curve editor**: for gloss and shadow contours — a small bezier editor with named presets
  (Linear, Cone, Ring, Rolling, Gaussian, Half Round).
- **Numeric inputs**: every slider has a typeable field; shift-drag = fine, alt-drag = coarse.
- **Font picker**: virtualised list, family names rendered *in their own font* using lazy
  `FontFace` loading with `font-display: swap`; search by name and by tag (heavy, script, pixel,
  techno, condensed).

### 16.5 Onboarding depth

Progressive disclosure: the inspector shows the 4–6 parameters that matter per effect, with an
"Advanced" disclosure for the rest. A first-run coach mark points at the effect stack: *"Every
preset is just these — take one apart."*

---

## 17. Application architecture

### 17.1 Stack

| Concern | Choice | Why |
|---|---|---|
| Framework | **React 19** + TypeScript 5.x | Team familiarity, ecosystem, Radix/shadcn availability |
| Build | **Vite 7** | Fast HMR, first-class Worker and WASM handling |
| Styling | **Tailwind v4** + CSS variables for theming | Dark-first UI |
| Components | **Radix UI** primitives | Accessible popovers, sliders, dialogs, drag handles |
| State | **Zustand** + Immer middleware | Small, no boilerplate, easy to snapshot for undo |
| Validation | **Zod** | Runtime document validation on import |
| Geometry | **Clipper2-WASM** | Boolean ops + offsetting for strokes and extrusion silhouettes |
| Text | **harfbuzzjs** (WASM); `opentype.js` for metadata | Correct shaping + outlines from one source |
| Encoders | `UPNG.js`, `gifenc` | APNG and GIF |
| Persistence | **idb** | IndexedDB wrapper for documents, fonts, thumbnails |
| Testing | **Vitest**, **Playwright** | Unit + visual regression |
| Hosting | Static (Vercel / Netlify / Pages) + PWA | No backend in v1 |

Deliberately **not** used: a canvas framework (Pixi/Konva/Fabric) — see §6.2; a CRDT — no
collaboration in v1; a component kit heavier than Radix.

### 17.2 Module layout

```
src/
  app/            shell, routing, layout, keyboard map
  state/          zustand stores, command bus, history
  model/          types, zod schemas, migrations, defaults
  text/           harfbuzz bindings, shaping, layout, outlines
  warp/           envelope math, 40 presets, path/mesh/perspective
  geometry/       flatten, bbox, clipper bindings, extrusion builder
  render/
    gl/           context, FBO pool, program cache, quad
    passes/       sdf, normals, blur, bevel, metal, gradient, post
    graph.ts      the render graph + cache keys
    fallback2d/   Canvas2D degraded renderer
  effects/        one module per effect: params, defaults, pass wiring
  animation/      tracks, easing, seeded noise, frame driver
  export/         bounds, tiling, readback, unpremultiply, encoders
  presets/        built-in library + build-time thumbnail generator
  ui/             panels, inspector, canvas overlays, controls
  workers/        raster.worker, export.worker, encode.worker
```

### 17.3 State and undo

Three separate stores so unrelated re-renders don't cascade:

- `documentStore` — the `Document`. The only thing that is undoable and persisted.
- `editorStore` — selection, zoom, pan, active tool, panel state. Ephemeral.
- `uiStore` — modals, toasts, preferences.

**Undo** is a command bus over Immer patches. Every mutation dispatches a command producing
`{ patches, inversePatches }`; the history stack holds those pairs. This is far cheaper than
snapshotting whole documents and makes coalescing trivial:

```ts
// Continuous controls: begin/commit brackets so a whole drag is one undo entry.
history.beginTransaction('shadow-size');
onSliderChange(v => update(d => { d.elements[i].effects[j].size = v; }));
history.commitTransaction();     // merges every intermediate patch into one entry
```

Transactions also merge same-target edits inside a 500 ms window, so keystrokes in a text field
collapse into one undo step rather than one per character.

### 17.4 Threading

- **Main thread:** React, input, WebGL draw calls.
- **Raster worker:** glyph outline extraction, flattening, warping, coverage rasterisation. The
  expensive CPU work, off the critical path. Transfers `ArrayBuffer`s zero-copy.
- **Export worker:** owns an `OffscreenCanvas` + its own WebGL2 context, so a 4× export never
  stalls the UI. Falls back to main-thread export on browsers without `OffscreenCanvas` WebGL.
- **Encode worker:** PNG/APNG/GIF encoding.

### 17.5 Persistence

- Autosave the current document to IndexedDB on a 2 s debounce.
- Recent documents list with thumbnails.
- User fonts stored as blobs in IndexedDB, content-addressed by SHA-256 so the same font uploaded
  twice costs one copy.
- `.wordwarp` file = zip of `document.json` + `assets/`.

---

## 18. Performance budget

| Interaction | Target | Strategy |
|---|---|---|
| Keystroke → preview | < 16 ms | Only geometry + affected passes invalidate |
| Slider drag | 60 fps | Cache above the changed pass; render at 0.5× during drag |
| Preset switch | < 100 ms | Warm program cache; presets pre-compiled at startup |
| First paint | < 1.5 s | Route-split; WASM lazy; presets as static thumbnails |
| Export 4096² PNG | < 3 s | Worker + OffscreenCanvas |
| 48-frame APNG | < 15 s | Sequential render, streaming encode |
| Bundle (initial) | < 250 KB gz | HarfBuzz/Clipper/encoders all lazy |

Additional measures: shader programs compiled lazily and cached by permutation key; FBO pool keyed
by size to avoid reallocation churn; `requestAnimationFrame`-coalesced rendering (never render
twice in a frame); preview at device pixel ratio capped at 2.

---

## 19. Testing strategy

**Unit (Vitest).** Warp presets against a table of corner/midpoint expectations; bbox computation
including effect dilation; premultiply/un-premultiply round-trips; blend-mode formulas against
W3C reference values; document migrations against fixtures; gradient interpolation.

**Golden-image (Playwright + pixelmatch).** The core safety net. A fixture document per built-in
preset renders headlessly and diffs against a committed PNG at a 0.1 % pixel tolerance. Catches
shader regressions that unit tests structurally cannot. Goldens are regenerated by an explicit
`pnpm test:goldens:update` and reviewed as images in the PR diff.

**Alpha-correctness suite.** Explicit tests for the thing most likely to silently regress:
render a soft shadow on transparency, export, assert that every pixel with `a < 255` has RGB within
tolerance of the shadow colour — i.e. no grey fringing. Also assert `a === 0 ⇒ rgb === 0`.

**Determinism.** Render the same animated document twice with the same seed; assert byte-identical
frames. Guards against `Math.random()` or `Date.now()` sneaking into an effect.

**Cross-browser.** Playwright across Chromium, Firefox and WebKit for export correctness and canvas
limits. Note: golden images are Chromium-only — GPU rasterisation differs enough between engines
that per-engine goldens would be noise. Firefox/WebKit runs assert *structural* properties (bounds,
alpha invariants, no exceptions) rather than pixel equality.

**Performance.** Benchmark the render graph on a fixed document; fail CI on a > 20 % regression.

---

## 20. Accessibility, mobile, i18n

**Accessibility.** Full keyboard operation: tab through the effect stack, arrows to nudge, `[`/`]`
to reorder. Every canvas manipulation has a numeric-input equivalent. Radix gives correct ARIA for
popovers/sliders/dialogs. Contrast ≥ 4.5:1 in the chrome UI. `prefers-reduced-motion` pauses
animated previews. The canvas itself carries an `aria-label` describing the current composition,
and export announces completion via a live region.

**Mobile.** The full editor is a desktop experience, but a genuinely useful mobile mode ships in
v1.1: preset gallery + text field + export, with the inspector as a bottom sheet. Touch targets
≥ 44 px; pinch-zoom and two-finger pan on canvas. iOS canvas limits (4096²) are enforced in the UI
rather than discovered as a failure.

**i18n.** UI strings externalised from day one. Text rendering must handle RTL (HarfBuzz does),
CJK (works, but warps behave oddly on tall glyphs — documented), and emoji (colour fonts are *not*
supported by the outline pipeline; detect and warn rather than render tofu).

---

## 21. Roadmap

### Phase 0 — Foundations (week 1)

Vite + React + TS scaffold, CI (lint, typecheck, test), document model + Zod schema, Zustand stores,
undo/redo command bus, app shell. **Exit:** empty canvas, add a text element, edit text, undo it.

### Phase 1 — Text & render core (weeks 2–3)

HarfBuzz integration, layout, outline extraction, flattening, coverage rasterisation in a Worker,
WebGL2 context + FBO pool + program cache, solid fill, premultiplied composite, PNG export.
**Exit:** type a word in any Google Font, export a transparent PNG with correct alpha.

### Phase 2 — The effect stack (weeks 4–6)

SDF (JFA + exact CPU), normals, bevel profiles + shading, gradients (5 types, OKLab, dithered),
stroke via Clipper2, drop shadow, outer glow, inner shadow, inner glow, blend modes, effect-stack
UI with reordering. **Exit:** rebuild the Photoshop "gradient bevel" look from scratch in the UI.

### Phase 3 — Warp engine (weeks 7–8)

Envelope framework, all 40 presets, on-canvas adjustment handles, path warp with arc-length
reparameterisation, perspective warp. **Exit:** every OOXML warp renders correctly and matches its
reference image.

### Phase 4 — Metal & dimension (weeks 9–10)

Matcap generation + shading, ramp materials, all 24 Office ramps, fresnel, brushed/anisotropic,
iridescence, extrusion (parallel + perspective, silhouette-based, per-face shading), long shadow.
**Exit:** Chrome Classic, Liquid Chrome, Deep Extrude ship and look genuinely good.

### Phase 5 — Presets & polish (weeks 11–12)

The full style library (§4), build-time thumbnail generation, gallery with live hover preview,
multi-element documents, layers strip, global light, textures, post effects.
**Exit:** feature-complete for static export; usable by someone who has never seen it.

### Phase 6 — Animation (weeks 13–14)

Animation tracks, the kind catalogue, per-character stagger, seeded noise, frame driver, APNG via
UPNG.js, GIF via gifenc, export dialog with size estimation and format comparison.
**Exit:** animated chrome sweep exports as a seamless looping APNG.

### Phase 7 — Ship (week 15)

Tiled export for large sizes, Canvas2D fallback renderer, PWA/offline, share URLs, mobile mode,
performance pass, cross-browser QA, docs.

**Post-v1 candidates:** layered PSD export (cooltext offers it; our stack is already layered);
WebGPU backend; user-uploaded textures/matcaps; community preset gallery; a Figma plugin;
16-bit PNG; WebM-with-alpha export.

---

## 22. Risks and mitigations

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Warp engine harder than estimated (40 presets, unclear reference geometry) | High | **High** | Ship 12 highest-value warps in Phase 3, remainder in 3.5. Build a reference-image comparison harness early. |
| Safari WebGL/canvas divergence | High | Medium | Structural (not pixel) tests on WebKit; probe canvas limits at runtime; Canvas2D fallback. |
| Bundle bloat from WASM (HarfBuzz + Clipper) | Medium | Medium | Both lazy-loaded and cached in IndexedDB; initial route needs neither. |
| Font licensing on user uploads | **Legal** | Medium | Uploads never leave the browser; no server storage; ToS states the user warrants their rights. Bundled fonts are OFL only, with attribution. |
| GIF transparency disappoints users | Medium | **High** | Default to matte + steer to APNG with a side-by-side preview. Explain, don't silently degrade. |
| Export exceeds device memory on mobile | Medium | Medium | Probe limits, cap the slider, tile, and show an explicit ceiling. |
| Perf collapse with many elements | Medium | Low | Per-element caching; render only dirty elements; cap at 20 elements in v1. |
| Scope creep into "a vector editor" | High | Medium | Non-goals in §1.3 are load-bearing. Every new tool request is tested against "does this serve text effects?" |

---

## 23. Open questions

1. **Name.** WordWarp or WordWrap? (§ preamble.) Domain availability should decide.
2. **Reference geometry for the 40 warps.** The OOXML *names* are authoritative (extracted from the
   schema) but the *formulas* are in `presetTextWarpDefinitions` in ECMA-376 Part 4, which is a
   large document not yet mined; LibreOffice's implementation is behind a proof-of-work wall that
   blocked automated access. **Action:** obtain ECMA-376 Part 4 directly and extract the preset
   geometry definitions before Phase 3 planning. Until then, presets are implemented from visual
   reference, which is adequate but not exact.
3. **Monetisation.** Free with attribution? Paid high-resolution export? The plan assumes free and
   static-hosted; a paid tier would need a backend and changes §17.
4. **Preset library size at launch.** 40 (curated, all excellent) or 100 (broad, uneven)? Leaning
   40 — cooltext already owns "most presets" and its quality is uneven.
5. **Emoji and colour fonts (COLR/CPAL, SVG-in-OpenType).** Out of scope for the outline pipeline.
   Detect-and-warn, or invest in a colour-glyph path?
6. **Server-side render API.** A `?text=…&preset=…` image endpoint would be excellent for sharing
   and SEO, but requires a backend and contradicts the v1 static-hosting decision.

---

## 24. Appendices

### Appendix A — Office preset colour ramps

Extracted verbatim from wordart97.net's bundle; these are the Microsoft Office "Preset colors"
gradients. All 24 have 20 stops at 0, 5, 11, 16, 21, 26, 32, 37, 42, 47, 53, 58, 63, 68, 74, 79,
84, 89, 95, 100 %. The metallic ones are directly useful for WordWarp's core styles.

**Chrome** — `#efefef #b5b6b5 #6b6d6b #323431 #efefef #bdbebd #a5a6a5 #8c8e8c #636563 #8c8e8c
#bdbebd #cecfce #d6d7d6 #cecfce #6b6d6b #222421 #efefef #c6c7c6 #a5a6a5 #8c8e8c`

**Chrome II** — `#bdbebd #9c9e9c #7b7d7b #636563 #5b5d5a #6b6d6b #848684 #949694 #adaead #c6c7c6
#cecfce #efefef #f7f7f7 #adaead #2a2c29 #636563 #7b7d7b #949694 #bdbebd #dedfde`

**Silver** — `#ffffff #e7e7e7 #dedfde #c6c7c6 #afb6bc #9c9eac #848693 #8f9eab #bdbecd #e7e7e7
#dedfde #cecfce #bfc7c6 #adaebc #a5a6b4 #9496a4 #868e9b #7d8693 #b5b6c5 #d1dfde`

**Gold** — `#e4d8ab #e6dfa4 #e4d895 #dbcf8d #d3c77e #cab768 #c2af5a #cbbf70 #dbcf86 #e4d895
#dbcf8d #d3c77e #d2bf76 #cbbf70 #cab768 #c2af5a #cab76f #d2bf7d #dbcf94 #e4d8ab`

**Gold II** — `#f3e0ac #e2c87f #c6a058 #b79845 #b6903e #c09f4c #c1a753 #c9af67 #d9bf77 #e2c87f
#ead095 #ecdfa4 #f4e7ad #b6903e #7f6625 #8f763c #9a8e54 #b2a66c #d3c793 #ecdfb3`

**Brass** — `#7e5f1c #ad7f2a #db9a35 #f2aa3c #bd892e #8d6720 #8d6720 #b4802a #e3a238 #db9a35
#b4802a #855f1d #9d6f24 #c4892e #eba93b #c49130 #a57727 #7e5f1c #b4802a #dca137`

**Fire** — `#fcef50 #fbe84d #f9d949 #f6c944 #f5c142 #f3b13e #f2aa3c #f19b38 #ee8432 #ee7d30
#ec682c #eb4e27 #ea4425 #ea3b24 #ea3423 #c42a1c #ad2718 #8f1d11 #69140a #52140e`

**Nightfall** — `#010400 #01040f #01041f #020c2f #020c3f #020c56 #090c66 #0b1476 #0b1486 #0b148e
#11149e #131ca6 #191cae #191cb5 #191cbe #3416c6 #4b19c6 #6217c6 #7124b6 #7a3997`

**Late Sunset** — `#010400 #01040f #01041f #01042f #01043f #0e043f #15053f #1e063f #2c073f #34083f
#3c0a40 #4b0d40 #621241 #691441 #791741 #8f243b #ae3f2c #ce6529 #e99335 #f3b13e`

**Sapphire** — `#020c86 #0a23ae #163bd5 #1a44f5 #0e2bc6 #020c8e #04148e #0a23b5 #163be6 #1233de
#0e2bb6 #020c86 #04149e #0e2bc6 #1a44ee #1233ce #071ba6 #01047e #0a23ae #163be6`

**Ocean** — `#61d4a8 #62d4b6 #63d4be #64d4cd #64d4d5 #66d4dc #60ccdb #5dc4db #57bbe3 #53b3da
#50abe2 #4ba3e1 #479ce1 #4294e0 #3e8ce0 #3a84d7 #367bd7 #3273cf #2e6bc7 #2a63bf`

**Horizon** — `#d1dfed #a8b6d3 #8dadbb #7a95b2 #829dba #9fadcb #acc6d4 #c0cedc #d1dfed #e8eff6
#ffffff #956f65 #894136 #a15346 #b85c56 #bb7975 #c4918e #d1b7a7 #e4d8c8 #876e65`

**Daybreak** — `#709df8 #709df8 #78a4f8 #7aacf9 #82b4f9 #82b4f9 #8abcf9 #91bcfa #93c5fa #9fc6f3
#a5c6f3 #adcef3 #b4ceec #c2d6ed #c9d7ed #d1dfed #d8dff5 #dedfee #eee7f6 #f4e7f6`

**Peacock** — `#539cf0 #54abe9 #53b3da #5ac4cc #5bc4d3 #60bbda #68b4da #6face9 #84a5f1 #969ef8
#7f8dd8 #4e74a1 #3c6c91 #374caf #3234c6 #2e5ce6 #3573f6 #306bd7 #306bb7 #2e6ba0`

**Mahogany** — `#c9af9e #d0af98 #d0af90 #cfa889 #c8a781 #c6a072 #cfa87a #c5986b #be9062 #bd895b
#b48053 #a47043 #aa693c #a26135 #9b5933 #8b512b #835025 #7c4829 #6b381a #64371e`

**Desert** — `#eba9c5 #f2aa98 #ecb16f #ecb15d #edb95e #edb96a #eec078 #efc98d #f1d0a2 #f7d1b2
#f2d8c8 #fae0d8 #fbe8ef #e5619a #b6294c #ae3971 #a84c82 #b96374 #d28a62 #e4a961`

*(Rainbow, Rainbow II, Early Sunset, Calm Water, Fog, Moss, Wheat, Parchment follow the same
structure and are captured in `src/presets/office-ramps.ts` at implementation time.)*

Note the **Chrome** ramp's structure: sharp light→dark→light transitions at 0–21 % and 68–84 %.
Those hard bands are the reflected horizon, and they are why the ramp reads as metal rather than as
a grey gradient. Any hand-authored metal ramp should preserve that discontinuity.

### Appendix B — Office fill textures

`01` Papyrus · `02` Canvas · `03` Denim · `04` Woven mat · `05` Water droplets · `06` Paper bag ·
`07` Fish fossil · `08` Sand · `09` Green marble · `10` White marble · `11` Brown marble ·
`12` Granite · `13` Newsprint · `14` Recycled paper · `15` Parchment · `16` Stationery ·
`17` Blue tissue paper · `18` Pink tissue paper · `19` Purple mesh · `20` Bouquet · `21` Cork ·
`22` Walnut wood · `23` Oak wood · `24` Medium wood

These are Microsoft assets and **must not be copied**. WordWarp ships original procedurally
generated or CC0 equivalents under the same names-as-categories (paper, canvas, denim, marble,
granite, newsprint, cork, wood…).

### Appendix C — Complete `ST_TextShapeType` enumeration

Extracted from the OOXML schema (41 values including `textNoShape`):

```
textArchDown      textArchDownPour  textArchUp        textArchUpPour    textButton
textButtonPour    textCanDown       textCanUp         textCascadeDown   textCascadeUp
textChevron       textChevronInverted                 textCircle        textCirclePour
textCurveDown     textCurveUp       textDeflate       textDeflateBottom textDeflateInflate
textDeflateInflateDeflate           textDeflateTop    textDoubleWave1   textFadeDown
textFadeLeft      textFadeRight     textFadeUp        textInflate       textInflateBottom
textInflateTop    textNoShape       textPlain         textRingInside    textRingOutside
textSlantDown     textSlantUp       textStop          textTriangle      textTriangleInverted
textWave1         textWave2         textWave4
```

### Appendix D — Font shortlist (Google Fonts, OFL)

**Heavy display / chrome-friendly:** Anton, Archivo Black, Bungee, Bungee Shade, Bungee Inline,
Bungee Outline, Bungee Spice, Titan One, Passion One, Alfa Slab One, Ultra, Bowlby One,
Luckiest Guy, Fredoka One, Baloo 2, Lilita One, Chango, Rowdies.

**Techno / sci-fi (80s–00s):** Orbitron, Audiowide, Michroma, Syncopate, Rajdhani, Chakra Petch,
Wallpoet, Iceland, Nova Square, Zen Dots.

**Neon / signage:** Monoton, Rubik Glitch, Rubik Puddles, Rubik Moonrocks, Sacramento, Kaushan
Script, Lobster, Pacifico, Bebas Neue.

**Pixel / arcade:** Press Start 2P, Silkscreen, VT323, DotGothic16, Pixelify Sans.

**Groovy / retro:** Righteous, Bungee, Shrikhand, Rampart One, Bree Serif, Poller One, Sigmar One,
Bowlby One SC, Fugaz One.

**Condensed / poster:** Oswald, Fjalla One, Big Shoulders Display, Archivo Narrow, Saira Condensed.

Additional permissive sources worth mining: The League of Moveable Type, Velvetyne Type Foundry,
Collletttivo, Open Foundry. **DaFont must be treated with care** — a large share is
free-for-personal-use only and cannot be bundled.

### Appendix E — Research sources

Tools: [makewordart.com](https://www.makewordart.com/) ·
[wordart97.net](https://wordart97.net/) (bundle analysis) ·
[cooltext.com](https://cooltext.com/) and its [Chrome One generator](https://cooltext.com/Logo-Design-Chrome-One) ·
[inkpx.com](https://inkpx.com/word-art-generator) ·
[Canva word art](https://www.canva.com/word-art-generator/)

Specifications: [OOXML `ST_TextShapeType`](http://www.datypic.com/sc/ooxml/t-a_ST_TextShapeType.html) ·
[OOXML `prstTxWarp`](http://www.datypic.com/sc/ooxml/e-a_prstTxWarp-1.html) ·
[Adobe: layer style effects and options](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/layer-style-effects-and-options-overview.html) ·
[Smashing Magazine: mastering layer styles](https://www.smashingmagazine.com/2011/08/mastering-photoshop-techniques-layer-styles/)

Rendering: [Red Blob Games: distance field text effects](https://www.redblobgames.com/x/2404-distance-field-effects/) ·
[Shaderfun: SDF gradients, bevels and noise](https://shaderfun.com/2018/07/23/signed-distance-fields-part-8-gradients-bevels-and-noise/) ·
[WebGL and Alpha](https://webglfundamentals.org/webgl/lessons/webgl-and-alpha.html) ·
[Why does my WebGL alpha-transparency look wrong?](https://jameshfisher.com/2020/08/12/why-does-my-webgl-alpha-transparency-look-wrong/) ·
[Alpha premultiplication explained](https://www.ppimage.com/blog/alpha-premultiplication-guide)

Geometry: [Clipper2](https://www.angusj.com/clipper2/Docs/Overview.htm) ·
[Clipper2-WASM](https://github.com/ErikSom/Clipper2-WASM) ·
[paper-clipper](https://github.com/northamerican/paper-clipper) ·
[Illustrator Envelope Distort](https://logosbynick.com/envelope-distort-in-illustrator/)

Fonts: [HarfBuzz](https://github.com/harfbuzz/harfbuzz) ·
[fontkit OpenType shaping](https://deepwiki.com/foliojs/fontkit/6.2-opentype-shaping-(gsub-and-gpos))

Export: [UPNG.js](https://github.com/photopea/UPNG.js/) ·
[canvas-size](https://github.com/jhildenbiddle/canvas-size) ·
[Canvas area exceeds the maximum limit](https://pqina.nl/blog/canvas-area-exceeds-the-maximum-limit/) ·
[WebCodecs alpha support](https://github.com/w3c/webcodecs/issues/200) ·
[Video with alpha transparency on the web](https://jakearchibald.com/2024/video-with-transparency/)

Architecture: [tldraw history](https://tldraw.dev/sdk-features/history) ·
[tldraw editor](https://tldraw-tldraw.mintlify.app/concepts/editor) ·
[Excalidraw architecture](https://deepwiki.com/almarales/excalidraw/1.2-architecture-overview)

Styles: [Outrun colour palette guide](https://retrowave.com/the-ultimate-outrun-color-palette-guide-for-retro-vibes/) ·
[Synthwave palette](https://www.backgroundremover.com/color-palettes/synthwave) ·
[Retro Google Fonts](https://www.graphicpie.com/retro-google-fonts/)
