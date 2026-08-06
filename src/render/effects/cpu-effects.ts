import { sampleGradient } from '../color';
import { createCanvasSurface, get2dContext, type CanvasSurface } from '../surface';
import { alphaChannel, blurAlpha, offsetAlpha, signedDistanceField } from './fields';
import type {
  BevelEffect,
  BlendMode,
  Effect,
  Paint,
  PostEffect,
  Rgba,
  TextureOverlayEffect,
} from '../../model/types';
import { officeRampColors } from '../../presets/office-ramps';

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

  for (const effect of effects) {
    if (!effect.enabled || effect.opacity <= 0 || effectSlot(effect) !== 'back') continue;
    const layer = renderBackEffect(effect, faceAlpha, getDistance, width, height, options);
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
    const layers = renderFaceEffect(effect, faceAlpha, getDistance, width, height, options);
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
    return colorize(mask, width, height, paintColor(effect.paint), effect.opacity);
  }

  if (effect.kind === 'extrude' || effect.kind === 'longShadow') {
    const depthValue = effect.kind === 'extrude'
      ? effect.depth
      : effect.length === 'toEdge'
        ? Math.hypot(options.extentWidth, options.extentHeight) / options.scale
        : effect.length;
    const depth = Math.min(Math.hypot(width, height), depthValue * options.scale);
    const radians = (effect.angle * Math.PI) / 180;
    const union = new Uint8Array(faceAlpha.length);
    const steps = Math.max(1, Math.min(96, Math.ceil(depth / 3)));
    for (let step = steps; step >= 1; step -= 1) {
      const amount = (step / steps) * depth;
      const shifted = offsetAlpha(faceAlpha, width, height, Math.cos(radians) * amount, Math.sin(radians) * amount);
      const fade = effect.kind === 'longShadow' && effect.fade ? 1 - step / (steps + 1) : 1;
      for (let index = 0; index < union.length; index += 1) {
        union[index] = Math.max(union[index]!, Math.round(shifted[index]! * fade));
      }
    }
    const paint = effect.kind === 'extrude' ? effect.sidePaint : effect.paint;
    return colorize(union, width, height, paintColor(paint), effect.opacity);
  }

  return null;
}

function renderFaceEffect(
  effect: Effect,
  faceAlpha: Uint8Array,
  getDistance: () => Float32Array,
  width: number,
  height: number,
  options: EffectOptions,
): CanvasSurface[] {
  if (effect.kind === 'fill' || effect.kind === 'reflection') return [];

  if (effect.kind === 'stroke') {
    const distance = getDistance();
    const widthPx = effect.width * options.scale;
    const mask = new Uint8Array(faceAlpha.length);
    for (let index = 0; index < mask.length; index += 1) {
      const value = distance[index]!;
      const visible = effect.position === 'inside'
        ? value <= 0 && value >= -widthPx
        : effect.position === 'outside'
          ? value >= 0 && value <= widthPx
          : Math.abs(value) <= widthPx / 2;
      mask[index] = visible ? 255 : 0;
    }
    return [colorize(mask, width, height, paintColor(effect.paint), effect.opacity)];
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
    return [colorize(mask, width, height, paintColor(effect.paint), effect.opacity)];
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

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const value = distance[index]!;
      const inBand = effect.style === 'outer'
        ? value >= 0 && value <= size
        : effect.style === 'emboss'
          ? Math.abs(value) <= size
          : value <= 0 && value >= -size;
      if (!inBand) continue;
      const dx = (distance[index + 1]! - distance[index - 1]!) * (effect.depth / 100);
      const dy = (distance[index + width]! - distance[index - width]!) * (effect.depth / 100);
      const magnitude = Math.hypot(dx, dy, 1);
      const direction = effect.direction === 'up' ? 1 : -1;
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

function paintColor(paint: Paint): Rgba {
  if (paint.kind === 'solid') return paint.color;
  if (paint.kind === 'gradient') return sampleGradient(paint.gradient, 0.5);
  if (paint.kind === 'ramp') {
    const colors = officeRampColors(paint.rampId);
    return colors?.[Math.floor(colors.length / 2)] ?? [0.62, 0.7, 0.78, 1];
  }
  if (paint.kind === 'matcap') return [0.68, 0.76, 0.86, 1];
  return [0.5, 0.5, 0.5, 1];
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
