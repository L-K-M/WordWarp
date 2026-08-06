# WordWarp

WordWarp is a browser-based studio for warped, metallic, dimensional text with alpha-correct image
export. The product and rendering decisions are documented in [`PLAN.md`](./PLAN.md).

## Features

- 41 envelope warp presets plus path, mesh, and perspective mapping primitives
- Editable fill, stroke, bevel, glow, shadow, extrusion, texture, reflection, and post effects
- 30 built-in styles and 24 Office-compatible color ramps
- Transparent PNG, animated APNG, and GIF export
- Deterministic procedural animation with live reduced-motion-aware preview
- IndexedDB autosave, compressed share URLs, direct manipulation, undo/redo, and offline PWA support
- WebGL2 presentation with a Canvas2D fallback and tiled large-image export

## Development

Requires Node.js 22 or newer.

```bash
npm install
npx playwright install --with-deps chromium webkit
npm run dev
```

Quality checks:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

GIF transparency is one-bit and uses ordered dithering. APNG is the recommended animated format for
soft glows and shadows. Native system fonts use the browser raster path; exact outline-backed
`keepUpright` warping requires an imported TTF/OTF font.
Large exports that require tiling reject reflection effects rather than risk clipped or misaligned pixels.
