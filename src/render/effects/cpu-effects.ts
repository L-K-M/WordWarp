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
    return [renderTexture(effect, faceAlpha, width, height, options)];
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

function renderTexture(
  effect: TextureOverlayEffect,
  faceAlpha: Uint8Array,
  width: number,
  height: number,
  options: EffectOptions,
): CanvasSurface {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const pattern = effect.source.type === 'procedural' ? effect.source.pattern : 'noise';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const coverage = effect.clipToShape ? faceAlpha[index]! / 255 : 1;
      const globalX = x + options.originX;
      const globalY = y + options.originY;
      let value = hashNoise(globalX, globalY, hashString(effect.id));
      if (pattern === 'weave') value = ((Math.floor(globalX / 3) + Math.floor(globalY / 3)) & 1) === 0 ? 0.8 : 0.25;
      if (pattern === 'halftone') value = (modulo(globalX, 8) - 4) ** 2 + (modulo(globalY, 8) - 4) ** 2 < 8 ? 0.9 : 0.1;
      if (pattern === 'grain') value = 0.35 + value * 0.3;
      const offset = index * 4;
      const channel = Math.round(value * 255);
      pixels[offset] = channel;
      pixels[offset + 1] = channel;
      pixels[offset + 2] = channel;
      pixels[offset + 3] = Math.round(255 * coverage * effect.opacity);
    }
  }
  return imageSurface(pixels, width, height);
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
  } else if (effect.type === 'pixelate') {
    // Resolution is part of the artwork, not of the screen showing it, so the block follows the
    // render scale -- the same reasoning a bevel size does. Left in device pixels, a 4x export
    // would quarter the block relative to the letterform and the sprite would dissolve.
    const block = Math.max(1, Math.round(numericParam(effect, 'size', PIXELATE_DEFAULT_SIZE) * options.scale));
    pixelateBlocks(source, transformed, width, height, {
      originX: options.originX,
      originY: options.originY,
      block,
      crisp: booleanParam(effect, 'crisp', true),
    });
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
 * Block edge, in logical pixels, for a pixelate pass that does not state one.
 *
 * Shared with `effectReach`: the halo it reserves has to be computed from the same number the
 * renderer will actually use, or a document that omits `size` gets a tile overlap sized for a
 * different grid than the one it draws.
 */
export const PIXELATE_DEFAULT_SIZE = 8;

interface PixelateOptions {
  /** Where this surface sits inside the element's whole effect layer, in device pixels. */
  originX: number;
  originY: number;
  /** Block edge, in device pixels. */
  block: number;
  /** Round each block's coverage in or out, rather than leaving a partly covered edge. */
  crisp: boolean;
}

/**
 * Quantise `source` onto a block grid, writing the result into `transformed`.
 *
 * Blocks are indexed in the layer's global coordinates, not the surface's, so a tiled export lands
 * them on one grid rather than restarting it in every tile. Every *core* pixel's block is complete
 * within its own tile because `effectReach` reserves a block of halo for exactly this; the partial
 * blocks along a tile's rendered edge all fall in the halo and are discarded before the tile is
 * copied out, so no seam reaches the output.
 */
export function pixelateBlocks(
  source: Uint8ClampedArray,
  transformed: Uint8ClampedArray,
  width: number,
  height: number,
  { originX, originY, block, crisp }: PixelateOptions,
): void {
  const firstBlockX = Math.floor(originX / block);
  const lastBlockX = Math.floor((originX + width - 1) / block);
  const firstBlockY = Math.floor(originY / block);
  const lastBlockY = Math.floor((originY + height - 1) / block);
  for (let blockY = firstBlockY; blockY <= lastBlockY; blockY += 1) {
    const top = Math.max(0, blockY * block - originY);
    const bottom = Math.min(height, (blockY + 1) * block - originY);
    for (let blockX = firstBlockX; blockX <= lastBlockX; blockX += 1) {
      const left = Math.max(0, blockX * block - originX);
      const right = Math.min(width, (blockX + 1) * block - originX);
      const mean = averageBlock(source, width, left, top, right, bottom);
      if (!mean) continue;
      // Coverage decides the silhouette: a genuine low-resolution image has no partly filled
      // pixels, so `crisp` rounds each block in or out instead of leaving a soft edge.
      const covered = !crisp || mean[3] >= 128;
      const alpha = crisp ? (covered ? 255 : 0) : Math.round(mean[3]);
      // A block that rounds itself out of existence gets zeroed rather than keeping the colour it
      // would have had. Nothing composites an RGB sitting under a zero alpha, but leaving one
      // behind makes the buffer's empty regions non-canonical, and readback paths that
      // un-premultiply have to special-case it.
      const red = covered ? mean[0] : 0;
      const green = covered ? mean[1] : 0;
      const blue = covered ? mean[2] : 0;
      for (let y = top; y < bottom; y += 1) {
        for (let x = left; x < right; x += 1) {
          const offset = (y * width + x) * 4;
          transformed[offset] = red;
          transformed[offset + 1] = green;
          transformed[offset + 2] = blue;
          transformed[offset + 3] = alpha;
        }
      }
    }
  }
}

/**
 * Mean colour of a rectangle of `source`, as `[r, g, b, meanAlpha]`, or null for an empty rect.
 *
 * The colour is averaged in premultiplied space -- each channel weighted by its own pixel's alpha,
 * then divided by the total alpha rather than the pixel count. Straight RGBA averaging would let
 * the colour of fully transparent pixels into the result, and a transparent pixel's colour is
 * arbitrary: it is whatever was last written under a zero alpha. Every block straddling the glyph
 * edge would then drift toward that value, which is the classic dark or white halo around a
 * naively downsampled sprite.
 *
 * Alpha itself comes back as a plain mean over the rectangle, because coverage is what it is.
 */
export function averageBlock(
  source: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): [number, number, number, number] | null {
  let red = 0;
  let green = 0;
  let blue = 0;
  let alpha = 0;
  let count = 0;
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4;
      const pixelAlpha = source[offset + 3]!;
      red += source[offset]! * pixelAlpha;
      green += source[offset + 1]! * pixelAlpha;
      blue += source[offset + 2]! * pixelAlpha;
      alpha += pixelAlpha;
      count += 1;
    }
  }
  if (count === 0) return null;
  if (alpha === 0) return [0, 0, 0, 0];
  return [Math.round(red / alpha), Math.round(green / alpha), Math.round(blue / alpha), alpha / count];
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
