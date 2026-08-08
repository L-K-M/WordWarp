import { createCanvasSurface, get2dContext, type CanvasSurface } from '../surface';
import { createPaintStyle } from '../fallback2d/paint';
import { alphaChannel, blurAlpha, offsetAlpha, signedDistanceField } from './fields';
import type { Bounds } from '../../geometry/bounds';
import type {
  BevelEffect,
  BlendMode,
  Effect,
  Paint,
  PostEffect,
  Rgba,
  TextureOverlayEffect,
} from '../../model/types';

interface EffectOptions {
  scale: number;
  globalLight: { angle: number; altitude: number };
  originX: number;
  originY: number;
  extentWidth: number;
  extentHeight: number;
}

export function renderEffectStack(
  face: CanvasSurface,
  effects: Effect[],
  options: EffectOptions,
): CanvasSurface {
  const width = face.width;
  const height = face.height;
  const faceContext = get2dContext(face, true);
  const faceImage = faceContext.getImageData(0, 0, width, height);
  const faceAlpha = alphaChannel(faceImage.data);
  const output = createCanvasSurface(width, height);
  const outputContext = get2dContext(output, true);
  let distance: Float32Array | null = null;
  const getDistance = () => (distance ??= signedDistanceField(faceAlpha, width, height));
  let paintBounds: Bounds | null = null;
  const getPaintBounds = () =>
    (paintBounds ??= alphaBounds(faceAlpha, width, height) ?? { x: 0, y: 0, width, height });

  for (const effect of effects) {
    if (!effect.enabled || effect.opacity <= 0 || effectSlot(effect) !== 'back') continue;
    const layer = renderBackEffect(effect, faceAlpha, getDistance, getPaintBounds, width, height, options);
    if (layer) drawLayer(outputContext, layer, effect.blendMode);
  }

  outputContext.globalCompositeOperation = 'source-over';
  outputContext.globalAlpha = 1;
  outputContext.drawImage(face, 0, 0);

  for (const effect of effects) {
    if (!effect.enabled || effect.opacity <= 0) continue;
    const slot = effectSlot(effect);
    if (slot !== 'body' && slot !== 'front') continue;
    if (effect.kind === 'reflection') {
      drawReflection(output, effect.offset * options.scale, effect.height, effect.opacity);
      continue;
    }
    const layers = renderFaceEffect(effect, faceAlpha, getDistance, getPaintBounds, width, height, options);
    for (const layer of layers) drawLayer(outputContext, layer, effect.blendMode);
  }

  for (const effect of effects) {
    if (!effect.enabled || effect.opacity <= 0 || effect.kind !== 'post') continue;
    applyPostEffect(outputContext, effect, width, height, options);
  }
  outputContext.globalAlpha = 1;
  outputContext.globalCompositeOperation = 'source-over';
  return output;
}

function renderBackEffect(
  effect: Effect,
  faceAlpha: Uint8Array,
  getDistance: () => Float32Array,
  getPaintBounds: () => Bounds,
  width: number,
  height: number,
  options: EffectOptions,
): CanvasSurface | null {
  if (effect.kind === 'dropShadow') {
    const size = effect.size * options.scale;
    const spread = effect.spread * size;
    const distance = getDistance();
    const expanded = new Uint8Array(faceAlpha.length);
    for (let index = 0; index < expanded.length; index += 1) {
      expanded[index] = distance[index]! <= spread ? 255 : 0;
    }
    const angle = ((effect.useGlobalLight ? options.globalLight.angle : effect.angle) * Math.PI) / 180;
    const offset = offsetAlpha(
      expanded,
      width,
      height,
      -Math.cos(angle) * effect.distance * options.scale,
      Math.sin(angle) * effect.distance * options.scale,
    );
    const blurred = blurAlpha(offset, width, height, Math.max(0.01, (size - spread) / 3));
    if (effect.knockout) {
      for (let index = 0; index < blurred.length; index += 1) {
        blurred[index] = Math.round(blurred[index]! * (1 - faceAlpha[index]! / 255));
      }
    }
    applyContour(blurred, effect.contour);
    return colorize(blurred, width, height, effect.color, effect.opacity);
  }

  if (effect.kind === 'outerGlow') {
    const size = Math.max(1, effect.size * options.scale);
    const spread = effect.spread * size;
    const distance = getDistance();
    const mask = new Uint8Array(faceAlpha.length);
    for (let index = 0; index < mask.length; index += 1) {
      const value = distance[index]!;
      if (value >= 0 && value <= size) {
        mask[index] = value <= spread ? 255 : Math.round(255 * (1 - (value - spread) / Math.max(1, size - spread)));
      }
    }
    applyContour(mask, effect.contour);
    return colorizePaint(mask, width, height, effect.paint, effect.opacity, getPaintBounds());
  }

  if (effect.kind === 'extrude' || effect.kind === 'longShadow') {
    const depthValue = effect.kind === 'extrude'
      ? effect.depth
      : effect.length === 'toEdge'
        ? Math.hypot(options.extentWidth, options.extentHeight) / options.scale
        : effect.length;
    const depth = Math.min(Math.hypot(width, height), depthValue * options.scale);
    const radians = (effect.angle * Math.PI) / 180;
    // Step count now follows the effect's own `steps` when it is set, instead of always being
    // derived from depth and capped at 96 -- at large depths that cap spaced the copies far enough
    // apart to leave gaps in thin stems.
    const requested = effect.kind === 'extrude' && effect.steps !== 'auto' ? effect.steps : Math.ceil(depth);
    const steps = Math.max(1, Math.min(512, requested));
    const perspective = effect.kind === 'extrude' && effect.mode === 'perspective';

    const union = new Uint8Array(faceAlpha.length);
    if (perspective) {
      // Converge on a vanishing point instead of sliding along a fixed vector. The point is
      // expressed relative to the glyph, so map it into face pixels first.
      const bounds = getPaintBounds();
      const vanishX = bounds.x + effect.vanishingPoint[0] * bounds.width;
      const vanishY = bounds.y + effect.vanishingPoint[1] * bounds.height;
      const strength = clamp01(effect.strength);
      for (let step = steps; step >= 1; step -= 1) {
        const scale = 1 - (step / steps) * strength;
        projectInto(union, faceAlpha, width, height, scale, vanishX, vanishY, 1);
      }
    } else {
      for (let step = steps; step >= 1; step -= 1) {
        const amount = (step / steps) * depth;
        const shifted = offsetAlpha(faceAlpha, width, height, Math.cos(radians) * amount, Math.sin(radians) * amount);
        const fade = effect.kind === 'longShadow' && effect.fade ? 1 - step / (steps + 1) : 1;
        for (let index = 0; index < union.length; index += 1) {
          union[index] = Math.max(union[index]!, Math.round(shifted[index]! * fade));
        }
      }
    }

    const paint = effect.kind === 'extrude' ? effect.sidePaint : effect.paint;
    const layer = colorizePaint(union, width, height, paint, effect.opacity, getPaintBounds());
    if (effect.kind === 'extrude' && effect.autoShade && effect.shadeAmount > 0) {
      darkenSurface(layer, clamp01(effect.shadeAmount));
    }
    return layer;
  }

  return null;
}

function renderFaceEffect(
  effect: Effect,
  faceAlpha: Uint8Array,
  getDistance: () => Float32Array,
  getPaintBounds: () => Bounds,
  width: number,
  height: number,
  options: EffectOptions,
): CanvasSurface[] {
  if (effect.kind === 'fill' || effect.kind === 'reflection') return [];

  if (effect.kind === 'stroke') {
    const distance = getDistance();
    const widthPx = effect.width * options.scale;
    // Thresholding the distance field produced hard, aliased stroke edges. Take the band's
    // per-pixel coverage instead so the stroke is anti-aliased like everything else.
    const lo = effect.position === 'inside' ? -widthPx : effect.position === 'outside' ? 0 : -widthPx / 2;
    const hi = effect.position === 'inside' ? 0 : effect.position === 'outside' ? widthPx : widthPx / 2;
    const mask = new Uint8Array(faceAlpha.length);
    for (let index = 0; index < mask.length; index += 1) {
      mask[index] = Math.round(255 * bandCoverage(distance[index]!, lo, hi));
    }
    return [colorizePaint(mask, width, height, effect.paint, effect.opacity, getPaintBounds())];
  }

  if (effect.kind === 'innerGlow') {
    const distance = getDistance();
    const size = Math.max(1, effect.size * options.scale);
    const mask = new Uint8Array(faceAlpha.length);
    for (let index = 0; index < mask.length; index += 1) {
      const insideDistance = -distance[index]!;
      if (insideDistance >= 0 && insideDistance <= size) {
        const edge = 1 - insideDistance / size;
        mask[index] = Math.round(255 * (effect.source === 'edge' ? edge : 1 - edge) * (faceAlpha[index]! / 255));
      }
    }
    applyContour(mask, effect.contour);
    return [colorizePaint(mask, width, height, effect.paint, effect.opacity, getPaintBounds())];
  }

  if (effect.kind === 'innerShadow') {
    const inverted = faceAlpha.map((value) => 255 - value);
    const angle = (effect.angle * Math.PI) / 180;
    const shifted = offsetAlpha(
      inverted,
      width,
      height,
      -Math.cos(angle) * effect.distance * options.scale,
      Math.sin(angle) * effect.distance * options.scale,
    );
    const blurred = blurAlpha(shifted, width, height, Math.max(0.01, effect.size * options.scale / 3));
    for (let index = 0; index < blurred.length; index += 1) {
      blurred[index] = Math.round(blurred[index]! * (faceAlpha[index]! / 255));
    }
    applyContour(blurred, effect.contour);
    return [colorize(blurred, width, height, effect.color, effect.opacity)];
  }

  if (effect.kind === 'satin') {
    const radians = (effect.angle * Math.PI) / 180;
    const dx = Math.cos(radians) * effect.distance * options.scale;
    const dy = Math.sin(radians) * effect.distance * options.scale;
    const sigma = Math.max(0.01, effect.size * options.scale / 3);
    const first = blurAlpha(offsetAlpha(faceAlpha, width, height, dx, dy), width, height, sigma);
    const second = blurAlpha(offsetAlpha(faceAlpha, width, height, -dx, -dy), width, height, sigma);
    const mask = new Uint8Array(faceAlpha.length);
    for (let index = 0; index < mask.length; index += 1) {
      const difference = Math.abs(first[index]! - second[index]!);
      mask[index] = Math.round((effect.invert ? 255 - difference : difference) * (faceAlpha[index]! / 255));
    }
    applyContour(mask, effect.contour);
    return [colorize(mask, width, height, effect.color, effect.opacity)];
  }

  if (effect.kind === 'bevel') return renderBevel(effect, faceAlpha, getDistance(), width, height, options);

  if (effect.kind === 'textureOverlay') {
    return [renderTexture(effect, faceAlpha, getDistance, width, height, options)];
  }

  return [];
}

function renderBevel(
  effect: BevelEffect,
  faceAlpha: Uint8Array,
  distance: Float32Array,
  width: number,
  height: number,
  options: EffectOptions,
): CanvasSurface[] {
  const size = Math.max(1, effect.size * options.scale);
  const angle = ((effect.useGlobalLight ? options.globalLight.angle : effect.angle) * Math.PI) / 180;
  const altitude = ((effect.useGlobalLight ? options.globalLight.altitude : effect.altitude) * Math.PI) / 180;
  const lightX = Math.cos(angle) * Math.cos(altitude);
  const lightY = -Math.sin(angle) * Math.cos(altitude);
  const lightZ = Math.sin(altitude);
  const highlight = new Uint8Array(faceAlpha.length);
  const shadow = new Uint8Array(faceAlpha.length);

  // Build an explicit height field first. Differentiating the distance field directly -- which is
  // what this used to do -- cannot express a bevel profile at all: a true distance field has unit
  // gradient everywhere, so the surface normal came out the same regardless of technique and
  // `technique` was silently ignored. Shaping a height from the distance and differentiating that
  // gives each technique its own surface.
  const rawHeight = new Float32Array(faceAlpha.length);
  for (let index = 0; index < rawHeight.length; index += 1) {
    rawHeight[index] = bevelHeight(distance[index]!, size, effect.style, effect.technique);
  }
  // The height is derived from a distance field, and a distance field's gradient *direction* is
  // quantised: it points at the nearest boundary pixel, which sits a whole number of pixels away.
  // Along a near-vertical stroke that direction swings in discrete steps, so differentiating the
  // height straight away laid a ladder of horizontal notches down every stroke. Reconstruct the
  // surface first -- a roughly one-pixel Gaussian is the matched filter for pixel-grid
  // quantisation. The radius follows the render scale so an export shades like the preview, and it
  // stays a fraction of the bevel so a fine bevel is smoothed rather than washed away.
  const reconstruction = Math.min(1.6 * options.scale, size / 4);
  const heightField = blurFloat(
    rawHeight,
    width,
    height,
    Math.max(reconstruction, (effect.soften * options.scale) / 3),
  );

  const relief = effect.depth / 100;
  const direction = effect.direction === 'up' ? 1 : -1;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value = distance[index]!;
      const inBand = effect.style === 'outer'
        ? value >= -1 && value <= size
        : effect.style === 'emboss'
          ? Math.abs(value) <= size
          : value <= 1 && value >= -size;
      if (!inBand) continue;
      // Sobel rather than a two-tap central difference, so the slope is read across the
      // neighbouring rows too and stays steady where the nearest-edge direction flips. The /8
      // keeps it the same scale as the central difference it replaces; z stays at 1 so depth
      // alone controls how far the normal tilts away from vertical.
      const slope = (size * relief) / 8;
      const dx = (heightField[index + 1 - width]! + 2 * heightField[index + 1]! + heightField[index + 1 + width]!
        - heightField[index - 1 - width]! - 2 * heightField[index - 1]! - heightField[index - 1 + width]!) * slope;
      const dy = (heightField[index + width - 1]! + 2 * heightField[index + width]! + heightField[index + width + 1]!
        - heightField[index - width - 1]! - 2 * heightField[index - width]! - heightField[index - width + 1]!) * slope;
      const magnitude = Math.hypot(dx, dy, 1);
      const dot = ((-dx / magnitude) * lightX + (-dy / magnitude) * lightY + (1 / magnitude) * lightZ) * direction;
      const coverage = effect.style === 'outer' ? 1 : faceAlpha[index]! / 255;
      highlight[index] = Math.round(Math.max(0, dot) * 255 * coverage);
      shadow[index] = Math.round(Math.max(0, -dot) * 255 * coverage);
    }
  }
  applyContour(highlight, effect.glossContour);
  applyContour(shadow, effect.glossContour);
  return [
    colorize(highlight, width, height, effect.highlight.color, effect.opacity * effect.highlight.opacity),
    colorize(shadow, width, height, effect.shadow.color, effect.opacity * effect.shadow.opacity),
  ];
}

/** Spacing between contour rings, in logical pixels, before the effect's own `scale` is applied. */
const TOPOGRAPHY_PERIOD = 4;
/** Weight of an ordinary contour, in logical pixels. Index contours are drawn at twice this. */
const TOPOGRAPHY_LINE_WIDTH = 1;
/** Every fifth contour is an index contour. This is the cartographic convention, not a free knob. */
const TOPOGRAPHY_INDEX_INTERVAL = 5;
/**
 * Distance the unclipped outer ring field reaches, counted in ring periods.
 *
 * The falloff is linear and hits zero exactly here, so the outermost ring that is actually visible
 * is the one before it: six rings are drawn outside the glyph, and the seventh is the fade's
 * endpoint rather than a ring anybody sees.
 */
const TOPOGRAPHY_OUTER_RINGS = 7;

/**
 * Ring spacing in logical pixels, floored so the rings can never merge into a solid.
 *
 * The floor has to live in logical space, not render space. `textureOverlayReach` grows the render
 * bounds from the logical spacing while `renderTexture` paints from the render-space spacing, and
 * a floor applied only to the latter would let the paint run past the room reserved for it -- at
 * the inspector's minimum texture scale of 0.2 the rings would reach two and a half times as far
 * as the bounds allowed and get sliced off at the layer edge.
 */
function topographyPeriod(effectScale: number): number {
  return Math.max(2, TOPOGRAPHY_PERIOD * effectScale);
}
/** Width of the coarsest mottle cell, in logical pixels, before the effect's `scale` is applied. */
const MOTTLE_CELL = 16;
/**
 * Octave weights. Front-loaded, so the shape reads as blotches with detail rather than as fog.
 *
 * The frequency ratios are deliberately not powers of two: octaves that line up on a common grid
 * reinforce each other in the same places every cell, and the pattern starts to look woven.
 */
const MOTTLE_OCTAVES = [
  { frequency: 1, weight: 0.55 },
  { frequency: 2.3, weight: 0.29 },
  { frequency: 5.7, weight: 0.16 },
];
/** Contrast applied about the midpoint, so patches resolve into ink and no-ink rather than a haze. */
const MOTTLE_CONTRAST = 2.1;
/** Per-octave seed stride. Rounded, so every seed reaching `hashNoise` is a whole number. */
const MOTTLE_SEED_STRIDE = 977;

function renderTexture(
  effect: TextureOverlayEffect,
  faceAlpha: Uint8Array,
  getDistance: () => Float32Array,
  width: number,
  height: number,
  options: EffectOptions,
): CanvasSurface {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const pattern = effect.source.type === 'procedural' ? effect.source.pattern : 'noise';
  const seed = hashString(effect.id);
  // Every other procedural pattern is a function of the pixel grid alone. Topography is the first
  // that is a function of the *shape*, so it needs the distance field the bevel and stroke already
  // build -- read lazily so the other patterns never pay for it.
  const distance = pattern === 'topography' ? getDistance() : null;
  // Contour spacing and line weight both follow the render scale, because they describe the
  // artwork rather than the display: an export has to put the same number of rings inside the same
  // letter. `scale` is the effect's own multiplier and is what the inspector slider already edits.
  const period = topographyPeriod(effect.scale) * options.scale;
  const lineWidth = Math.max(1, TOPOGRAPHY_LINE_WIDTH * options.scale);
  const outerReach = period * TOPOGRAPHY_OUTER_RINGS;
  // Blotch size is a property of the ink, not of the screen it is displayed on, so it tracks the
  // render scale the way a bevel size does. The grid-locked patterns deliberately do not: `noise`
  // and `grain` are film artefacts and belong in device pixels.
  //
  // The sampler is built once for the whole surface, not per pixel, because it carries the corner
  // cache that makes the pattern affordable -- see `createMottleSampler`.
  const sampleMottle = pattern === 'mottle'
    ? createMottleSampler(seed, Math.max(2, MOTTLE_CELL * effect.scale * options.scale))
    : null;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const coverage = effect.clipToShape ? faceAlpha[index]! / 255 : 1;
      const globalX = x + options.originX;
      const globalY = y + options.originY;
      const offset = index * 4;
      if (distance) {
        // The other patterns fill their whole rectangle with an opaque grey and rely on
        // `clipToShape` to hide the parts that miss the glyph. Contours cannot: unclipped they are
        // meant to keep going past the letterform, and an opaque black field around them would
        // composite as a visible box. So they paint white and carry the line in alpha instead --
        // the gaps between rings are genuinely empty, whatever the blend mode.
        // The field is positive outside the glyph and negative inside, so negate it: `depth` is
        // how far *in* a pixel sits, and a negative depth means it fell outside the letterform.
        const depth = -distance[index]!;
        const falloff = depth < 0 ? clamp01(1 + depth / outerReach) : 1;
        const line = topographyCoverage(depth, period, lineWidth) * falloff;
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = Math.round(255 * coverage * line * effect.opacity);
        continue;
      }
      // Branch rather than compute-then-overwrite: `mottle` is by far the most expensive pattern
      // here, and a hash thrown away on top of it is the last thing this loop needs.
      let value: number;
      if (pattern === 'weave') {
        value = ((Math.floor(globalX / 3) + Math.floor(globalY / 3)) & 1) === 0 ? 0.8 : 0.25;
      } else if (pattern === 'halftone') {
        value = (modulo(globalX, 8) - 4) ** 2 + (modulo(globalY, 8) - 4) ** 2 < 8 ? 0.9 : 0.1;
      } else if (pattern === 'grain') {
        value = 0.35 + hashNoise(globalX, globalY, seed) * 0.3;
      } else if (sampleMottle) {
        value = sampleMottle(globalX, globalY);
      } else {
        value = hashNoise(globalX, globalY, seed);
      }
      const channel = Math.round(value * 255);
      pixels[offset] = channel;
      pixels[offset + 1] = channel;
      pixels[offset + 2] = channel;
      pixels[offset + 3] = Math.round(255 * coverage * effect.opacity);
    }
  }
  return imageSurface(pixels, width, height);
}

/**
 * How far outside the glyph a topography overlay paints, in logical pixels.
 *
 * Unclipped contours keep going past the letterform -- that outward ring field is what turns a
 * word into an island on a map -- so the render bounds have to be grown to hold them or the last
 * rings are sliced off by the layer edge. Every other procedural pattern is clipped to the shape
 * and needs no reach at all.
 *
 * This must stay the same expression `renderTexture` paints from, scaled: both go through
 * `topographyPeriod`, so the floor applies identically on each side and the bounds can never come
 * out smaller than the paint.
 */
export function textureOverlayReach(effect: TextureOverlayEffect): number {
  if (effect.clipToShape) return 0;
  if (effect.source.type !== 'procedural' || effect.source.pattern !== 'topography') return 0;
  return topographyPeriod(effect.scale) * TOPOGRAPHY_OUTER_RINGS;
}

/**
 * Coverage of the contour line nearest `depth`, anti-aliased over one pixel.
 *
 * `depth` is how far inside the glyph a pixel sits, so rings land on iso-distance curves: they
 * follow the letterform rather than the pixel grid, tighten where a stem narrows, and close into
 * islands around a counter. That is what makes the result read as elevation instead of as stripes.
 *
 * Every fifth ring is drawn heavier. Real contour maps do this -- the index contour is what lets a
 * reader count elevation without tracing every line -- and it is the single detail that separates
 * "concentric rings" from "a map".
 */
export function topographyCoverage(depth: number, period: number, lineWidth: number): number {
  if (!(period > 0)) return 0;
  const nearestRing = Math.round(depth / period);
  const distanceToRing = Math.abs(depth - nearestRing * period);
  const isIndex = modulo(nearestRing, TOPOGRAPHY_INDEX_INTERVAL) === 0;
  const width = lineWidth * (isIndex ? 2 : 1);
  return clamp01(width / 2 - distanceToRing + 0.5);
}

/**
 * Fractal mottling: uneven ink coverage, in 0..1, centred on the midpoint.
 *
 * `hashNoise` is white noise -- independent per pixel, so it can only ever look like film grain,
 * which is exactly why the existing `noise` and `grain` patterns use it raw. Sampling it on a
 * coarse lattice and interpolating between the four corners instead gives features the size of the
 * cell, which is what an uneven ink lay-down or a wash actually looks like. Three octaves put a
 * large blotch shape underneath smaller variation, and a contrast curve about the middle pushes
 * the result toward "ink" and "no ink" rather than an even haze.
 *
 * Centring on 0.5 means the symmetric blend modes -- `overlay`, `soft-light` -- leave the average
 * tone alone and only redistribute it, so a mottled fill stays the colour it was.
 *
 * ## Why this is a factory
 *
 * Done naively this is four hashes per octave per pixel: twelve, against one for every other
 * procedural pattern, and measurably too slow -- 85ms for a megapixel against 14ms for plain
 * noise, which alone would eat most of the 100ms preset-switch budget on a large canvas.
 *
 * But the caller scans row-major, and a lattice cell is several pixels wide, so consecutive
 * samples land in the same cell and want the same four corners. Holding them per octave until the
 * cell changes cuts the hashes to roughly two per pixel. The state is per sampler and depends only
 * on position, so it is a cache and not a mode: sampling in any order gives the same answer, just
 * more slowly.
 */
export function createMottleSampler(seed: number, cell: number): (x: number, y: number) => number {
  const octaves = MOTTLE_OCTAVES.map((octave) => ({
    frequency: octave.frequency,
    weight: octave.weight,
    seed: seed + Math.round(octave.frequency * MOTTLE_SEED_STRIDE),
    cellX: Number.NaN,
    cellY: Number.NaN,
    topLeft: 0,
    topRight: 0,
    bottomLeft: 0,
    bottomRight: 0,
  }));

  return (x, y) => {
    let total = 0;
    for (const octave of octaves) {
      const gridX = (x * octave.frequency) / cell;
      const gridY = (y * octave.frequency) / cell;
      const cellX = Math.floor(gridX);
      const cellY = Math.floor(gridY);
      if (cellX !== octave.cellX || cellY !== octave.cellY) {
        octave.cellX = cellX;
        octave.cellY = cellY;
        octave.topLeft = hashNoise(cellX, cellY, octave.seed);
        octave.topRight = hashNoise(cellX + 1, cellY, octave.seed);
        octave.bottomLeft = hashNoise(cellX, cellY + 1, octave.seed);
        octave.bottomRight = hashNoise(cellX + 1, cellY + 1, octave.seed);
      }
      const fractionX = gridX - cellX;
      const fractionY = gridY - cellY;
      const smoothX = fractionX * fractionX * (3 - 2 * fractionX);
      const smoothY = fractionY * fractionY * (3 - 2 * fractionY);
      const top = octave.topLeft + (octave.topRight - octave.topLeft) * smoothX;
      const bottom = octave.bottomLeft + (octave.bottomRight - octave.bottomLeft) * smoothX;
      total += (top + (bottom - top) * smoothY) * octave.weight;
    }
    return clamp01((total - 0.5) * MOTTLE_CONTRAST + 0.5);
  };
}

/** One-off sample. Same maths as the sampler, with no cache to reuse -- for tests and callers
 * that are not scanning a surface. */
export function mottleValue(x: number, y: number, seed: number, cell: number): number {
  return createMottleSampler(seed, cell)(x, y);
}

function drawReflection(output: CanvasSurface, offset: number, heightRatio: number, opacity: number): void {
  const width = output.width;
  const height = output.height;
  const context = get2dContext(output, true);
  const snapshot = createCanvasSurface(width, height);
  get2dContext(snapshot).drawImage(output, 0, 0);
  const alpha = alphaChannel(context.getImageData(0, 0, width, height).data);
  const bounds = alphaBounds(alpha, width, height);
  if (!bounds) return;
  const reflectionHeight = Math.max(1, Math.round(bounds.height * heightRatio));
  const layer = createCanvasSurface(width, height);
  const layerContext = get2dContext(layer);
  const axis = bounds.y + bounds.height;
  layerContext.save();
  layerContext.translate(0, axis * 2 + offset);
  layerContext.scale(1, -1);
  layerContext.drawImage(snapshot, 0, 0);
  layerContext.restore();
  layerContext.globalCompositeOperation = 'destination-in';
  const gradient = layerContext.createLinearGradient(0, axis + offset, 0, axis + offset + reflectionHeight);
  gradient.addColorStop(0, `rgba(0,0,0,${opacity})`);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  layerContext.fillStyle = gradient;
  layerContext.fillRect(bounds.x, axis + offset, bounds.width, reflectionHeight);
  context.globalCompositeOperation = 'source-over';
  context.drawImage(layer, 0, 0);
}

function applyPostEffect(
  context: ReturnType<typeof get2dContext>,
  effect: PostEffect,
  width: number,
  height: number,
  options: EffectOptions,
): void {
  const image = context.getImageData(0, 0, width, height);
  const source = image.data.slice();
  const transformed = image.data.slice();
  const amount = numericParam(effect, 'amount', 0.22);

  if (effect.type === 'grain') {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        if (transformed[index + 3] === 0) continue;
        const noise = (hashNoise(x + options.originX, y + options.originY, effect.seed) - 0.5) * 255 * amount;
        transformed[index] = clampByte(transformed[index]! + noise);
        transformed[index + 1] = clampByte(transformed[index + 1]! + noise);
        transformed[index + 2] = clampByte(transformed[index + 2]! + noise);
      }
    }
  } else if (effect.type === 'scanlines') {
    const period = Math.max(2, Math.round(numericParam(effect, 'period', 4)));
    const lineOffset = Math.round(numericParam(effect, 'offset', 0) * period);
    for (let y = 0; y < height; y += 1) {
      if (modulo(y + options.originY - lineOffset, period) !== 0) continue;
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        transformed[offset] = Math.round(transformed[offset]! * (1 - amount));
        transformed[offset + 1] = Math.round(transformed[offset + 1]! * (1 - amount));
        transformed[offset + 2] = Math.round(transformed[offset + 2]! * (1 - amount));
      }
    }
  } else if (effect.type === 'aberration') {
    const shift = Math.max(1, Math.round(numericParam(effect, 'amount', 3)));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        transformed[offset] = sampleChannel(source, width, height, x + shift, y, 0);
        transformed[offset + 2] = sampleChannel(source, width, height, x - shift, y, 2);
      }
    }
  } else if (effect.type === 'glitch') {
    for (let y = 0; y < height; y += 1) {
      const globalY = y + options.originY;
      const shift = hashNoise(globalY, effect.seed, 17) > 0.78
        ? Math.round((hashNoise(globalY, 9, effect.seed) - 0.5) * 30)
        : 0;
      for (let x = 0; x < width; x += 1) {
        const destination = (y * width + x) * 4;
        const sourceX = Math.min(width - 1, Math.max(0, x - shift));
        const sourceOffset = (y * width + sourceX) * 4;
        transformed.set(source.subarray(sourceOffset, sourceOffset + 4), destination);
      }
    }
  } else if (effect.type === 'dither') {
    // Ordered (Bayer) dithering: quantise every channel to `levels` steps, but bias each pixel by
    // its position in a recursive Bayer matrix before rounding. The bias is what turns a flat band
    // of quantisation error into an interleaved dot pattern, so a smooth ramp survives a two-level
    // palette as texture rather than as a hard step.
    //
    // The matrix is indexed in the effect layer's global coordinates, like grain and scanlines, so
    // a tiled large export lays down one continuous pattern instead of restarting it per tile.
    const levels = Math.max(2, Math.min(32, Math.round(numericParam(effect, 'levels', 2))));
    const matrix = bayerMatrix(numericParam(effect, 'matrix', 8));
    // `amount` fades the positional bias out. At 0 the effect is a plain posterise with hard
    // banding; at 1 the dot pattern carries the full step. It is deliberately the parameter the
    // inspector's generic post slider writes.
    const strength = clamp01(numericParam(effect, 'amount', 1));
    const hardEdge = booleanParam(effect, 'hardEdge', true);
    // Dot pitch is the one post parameter here that follows the render scale. Grain, scanlines and
    // aberration model the *display* a picture is shown on, so they stay in device pixels; a dither
    // pattern is part of the picture, like a bevel or a stroke. If the pitch stayed in device
    // pixels a 4x export would render the same style at a quarter the dot size and lose the look
    // entirely, so it is snapped to whole device pixels at the current scale instead.
    const dot = Math.max(1, Math.round(numericParam(effect, 'dot', 1) * options.scale));
    const step = 255 / (levels - 1);
    for (let y = 0; y < height; y += 1) {
      const matrixY = modulo(Math.floor((y + options.originY) / dot), matrix.size) * matrix.size;
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const alpha = source[offset + 3]!;
        if (alpha === 0) continue;
        const column = modulo(Math.floor((x + options.originX) / dot), matrix.size);
        const bias = matrix.values[matrixY + column]! * strength;
        for (let channel = 0; channel < 3; channel += 1) {
          transformed[offset + channel] = ditherQuantise(source[offset + channel]!, step, bias);
        }
        // Anti-aliased coverage is the one thing a genuine one-bit image cannot have, so the same
        // matrix optionally thresholds alpha too. Without this a 1-bit fill still shows a smooth
        // grey fringe around every stem and the illusion collapses at the edges.
        if (hardEdge) transformed[offset + 3] = alpha / 255 + bias >= 0.5 ? 255 : 0;
      }
    }
  } else if (effect.type === 'halftone') {
    const frequency = Math.max(3, Math.round(numericParam(effect, 'frequency', 8)));
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        const luminance = (source[offset]! + source[offset + 1]! + source[offset + 2]!) / (3 * 255);
        const dx = modulo(x + options.originX, frequency) - frequency / 2;
        const dy = modulo(y + options.originY, frequency) - frequency / 2;
        const dot = Math.hypot(dx, dy) < (frequency * luminance) / 2;
        const value = dot ? 255 : 0;
        transformed[offset] = value;
        transformed[offset + 1] = value;
        transformed[offset + 2] = value;
      }
    }
  }

  const mix = effect.opacity;
  for (let index = 0; index < image.data.length; index += 1) {
    image.data[index] = Math.round(source[index]! + (transformed[index]! - source[index]!) * mix);
  }
  context.putImageData(image, 0, 0);
}

function drawLayer(context: ReturnType<typeof get2dContext>, layer: CanvasSurface, blendMode: BlendMode): void {
  context.globalAlpha = 1;
  context.globalCompositeOperation = compositeOperation(blendMode);
  context.drawImage(layer, 0, 0);
}

function colorize(mask: Uint8Array, width: number, height: number, color: Rgba, opacity: number): CanvasSurface {
  const pixels = new Uint8ClampedArray(mask.length * 4);
  const red = Math.round(color[0] * 255);
  const green = Math.round(color[1] * 255);
  const blue = Math.round(color[2] * 255);
  for (let index = 0; index < mask.length; index += 1) {
    const alpha = Math.round(mask[index]! * color[3] * opacity);
    const offset = index * 4;
    if (alpha > 0) {
      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    }
  }
  return imageSurface(pixels, width, height);
}

function imageSurface(pixels: Uint8ClampedArray, width: number, height: number): CanvasSurface {
  const surface = createCanvasSurface(width, height);
  const context = get2dContext(surface);
  const image = context.createImageData(width, height);
  image.data.set(pixels);
  context.putImageData(image, 0, 0);
  return surface;
}

/**
 * Colourise a coverage mask with a Paint.
 *
 * Solid paints take the cheap path. Everything else is rasterised through the same
 * `createPaintStyle` the fill uses, so a gradient stroke is an actual gradient rather than one
 * sample from the middle of it, and a ramp or matcap keeps its shape instead of collapsing to a
 * representative colour.
 *
 * The paint is laid out over `paintBounds` -- the visible glyph -- rather than the effect layer,
 * which is padded out by blur and glow reach. Anchoring to the padded layer would make a gradient
 * shift around whenever an unrelated effect changed the padding.
 */
function colorizePaint(
  mask: Uint8Array,
  width: number,
  height: number,
  paint: Paint,
  opacity: number,
  paintBounds: Bounds,
): CanvasSurface {
  if (paint.kind === 'solid') return colorize(mask, width, height, paint.color, opacity);

  const surface = createCanvasSurface(width, height);
  const context = get2dContext(surface, true);
  context.fillStyle = createPaintStyle(context, paint, paintBounds);
  context.fillRect(0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const data = image.data;
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const alpha = Math.round(mask[index]! * (data[offset + 3]! / 255) * opacity);
    if (alpha > 0) {
      data[offset + 3] = alpha;
      continue;
    }
    data[offset] = 0;
    data[offset + 1] = 0;
    data[offset + 2] = 0;
    data[offset + 3] = 0;
  }
  context.putImageData(image, 0, 0);
  return surface;
}

/**
 * Accumulate the mask scaled about a vanishing point into `target`, keeping the maximum coverage.
 * Nearest-neighbour is adequate here: the result is unioned across many steps, so resampling
 * softness would be lost anyway.
 */
function projectInto(
  target: Uint8Array,
  source: Uint8Array,
  width: number,
  height: number,
  scale: number,
  vanishX: number,
  vanishY: number,
  weight: number,
): void {
  if (scale <= 0) return;
  for (let y = 0; y < height; y += 1) {
    // Invert p' = vanish + (p - vanish) * scale to find which source pixel lands here.
    const sourceY = Math.round(vanishY + (y - vanishY) / scale);
    if (sourceY < 0 || sourceY >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.round(vanishX + (x - vanishX) / scale);
      if (sourceX < 0 || sourceX >= width) continue;
      const value = Math.round(source[sourceY * width + sourceX]! * weight);
      const index = y * width + x;
      if (value > target[index]!) target[index] = value;
    }
  }
}

/** Multiply a surface's RGB toward black, leaving alpha untouched. */
function darkenSurface(surface: CanvasSurface, amount: number): void {
  const context = get2dContext(surface, true);
  const image = context.getImageData(0, 0, surface.width, surface.height);
  const data = image.data;
  const keep = 1 - amount;
  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] === 0) continue;
    data[offset] = Math.round(data[offset]! * keep);
    data[offset + 1] = Math.round(data[offset + 1]! * keep);
    data[offset + 2] = Math.round(data[offset + 2]! * keep);
  }
  context.putImageData(image, 0, 0);
}

/**
 * Surface height of a bevel at signed distance `d`, normalised to 0..1.
 *
 * `t` runs 0 at the outer end of the bevel band to 1 at its inner end; each technique is a
 * different profile across it. `pillow` rises and falls again, which is what gives it the puffed
 * look, so it is treated as a style rather than a technique -- matching the effect's parameters.
 */
export const bevelHeightForTest = bevelHeight;

function bevelHeight(
  distance: number,
  size: number,
  style: BevelEffect['style'],
  technique: BevelEffect['technique'],
): number {
  let t: number;
  if (style === 'outer') t = clamp01(1 - distance / size);
  else if (style === 'emboss' || style === 'pillow') t = clamp01(1 - Math.abs(distance) / size);
  else t = clamp01(-distance / size);

  if (style === 'pillow') return Math.sin(clamp01(t) * Math.PI);
  if (technique === 'chiselHard') return t;
  if (technique === 'chiselSoft') return t * t * (3 - 2 * t);
  return Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
}

function blurFloat(source: Float32Array, width: number, height: number, sigma: number): Float32Array {
  if (sigma <= 0.01) return source;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = weight;
    total += weight;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] = kernel[index]! / total;

  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = Math.min(width - 1, Math.max(0, x + offset));
        value += source[y * width + sampleX]! * kernel[offset + radius]!;
      }
      horizontal[y * width + x] = value;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = Math.min(height - 1, Math.max(0, y + offset));
        value += horizontal[sampleY * width + x]! * kernel[offset + radius]!;
      }
      output[y * width + x] = value;
    }
  }
  return output;
}

/** Coverage of the distance band [lo, hi] at signed distance d, anti-aliased over one pixel. */
function bandCoverage(distance: number, lo: number, hi: number): number {
  return clamp01(distance - lo + 0.5) * clamp01(hi - distance + 0.5);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function applyContour(mask: Uint8Array, contour: number[]): void {
  if (contour.length < 2) return;
  for (let index = 0; index < mask.length; index += 1) {
    const position = (mask[index]! / 255) * (contour.length - 1);
    const lower = Math.floor(position);
    const upper = Math.min(contour.length - 1, lower + 1);
    const amount = position - lower;
    mask[index] = Math.round((contour[lower]! + (contour[upper]! - contour[lower]!) * amount) * 255);
  }
}

function effectSlot(effect: Effect): 'back' | 'body' | 'front' | 'post' {
  if (effect.kind === 'dropShadow' || effect.kind === 'outerGlow' || effect.kind === 'extrude' || effect.kind === 'longShadow') return 'back';
  if (effect.kind === 'stroke' || effect.kind === 'reflection') return 'front';
  if (effect.kind === 'post') return 'post';
  return 'body';
}

function compositeOperation(mode: BlendMode): GlobalCompositeOperation {
  if (mode === 'normal') return 'source-over';
  if (mode === 'linear-dodge') return 'lighter';
  return mode;
}

function alphaBounds(alpha: Uint8Array, width: number, height: number): { x: number; y: number; width: number; height: number } | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] === 0) continue;
      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }
  return right < left ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

function numericParam(effect: PostEffect, name: string, fallback: number): number {
  const value = effect.params[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanParam(effect: PostEffect, name: string, fallback: boolean): boolean {
  const value = effect.params[name];
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Snap one channel to the nearest of `255 / step + 1` palette levels, nudged by a dither bias.
 *
 * With `bias` at 0 this is a plain posterise. A bias in (-0.5, 0.5) moves the rounding boundary,
 * so a value that sits between two levels lands on the higher one in some pixels and the lower one
 * in others -- in exactly the proportion needed to average back to where it started.
 */
export function ditherQuantise(value: number, step: number, bias: number): number {
  return clampByte(Math.round(value / step + bias) * step);
}

/**
 * Recursive Bayer threshold matrix, returned centred on zero.
 *
 * The classic construction doubles an n x n matrix into 2n x 2n as
 * `[[4M, 4M+2], [4M+3, 4M+1]]`, which spreads consecutive thresholds as far apart on the grid as
 * possible -- that even spread is what stops the pattern reading as stripes. Values come back in
 * (-0.5, 0.5) so a caller can add one straight to a quantisation index: a threshold of -0.5 always
 * rounds down, +0.5 always rounds up, and the average bias across the tile is zero, so dithering
 * preserves the mean colour it started from.
 *
 * `requested` is snapped to a power of two in [2, 16]; the 2x2 is coarse and stripy on purpose,
 * 8x8 is the size the black-and-white bitmap era standardised on.
 */
export function bayerMatrix(requested: number): { size: number; values: Float32Array } {
  const exponent = Math.max(1, Math.min(4, Math.round(Math.log2(Math.max(2, requested)))));
  const size = 2 ** exponent;
  let values = new Float32Array([0]);
  let current = 1;
  while (current < size) {
    const next = new Float32Array(current * current * 4);
    for (let y = 0; y < current; y += 1) {
      for (let x = 0; x < current; x += 1) {
        const base = values[y * current + x]! * 4;
        next[y * current * 2 + x] = base;
        next[y * current * 2 + x + current] = base + 2;
        next[(y + current) * current * 2 + x] = base + 3;
        next[(y + current) * current * 2 + x + current] = base + 1;
      }
    }
    values = next;
    current *= 2;
  }
  const total = size * size;
  for (let index = 0; index < values.length; index += 1) {
    values[index] = (values[index]! + 0.5) / total - 0.5;
  }
  return { size, values };
}

function sampleChannel(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number {
  if (x < 0 || x >= width || y < 0 || y >= height) return 0;
  return pixels[(y * width + x) * 4 + channel]!;
}

function hashNoise(x: number, y: number, seed: number): number {
  let value = (Math.trunc(x) * 374761393 + Math.trunc(y) * 668265263 + seed * 1442695041) | 0;
  value = (value ^ (value >>> 13)) * 1274126177;
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
