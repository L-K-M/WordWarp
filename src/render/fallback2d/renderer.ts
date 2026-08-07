import { elementMatrix, transformBounds, type Matrix } from '../../geometry/matrix';
import { layoutText, type LaidOutText, type TextContext } from '../../text/layout';
import type { BlendMode, Effect, FillEffect, TextElement, WordWarpDocument } from '../../model/types';
import { expandBounds, intersectBounds, roundOutBounds, type Bounds } from '../../geometry/bounds';
import type { RenderResult, RenderViewport } from '../contracts';
import { renderEffectStack } from '../effects/cpu-effects';
import { createCanvasSurface, get2dContext } from '../surface';
import { createPaintStyle } from './paint';
import { drawWarpedSurface, getWarpedBounds } from './warp';

export interface Render2dOptions {
  scale?: number;
  viewport?: RenderViewport;
  effectViewport?: RenderViewport;
}

export function renderDocument2d(
  context: TextContext,
  document: WordWarpDocument,
  options: Render2dOptions = {},
): RenderResult {
  const scale = options.scale ?? 1;
  const viewport = options.viewport ?? {
    x: 0,
    y: 0,
    width: document.canvas.width,
    height: document.canvas.height,
  };
  const effectViewport = options.effectViewport ?? viewport;
  const canvas = context.canvas;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, -viewport.x * scale, -viewport.y * scale);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';

  if (document.canvas.background) {
    context.fillStyle = createPaintStyle(context, document.canvas.background, {
      x: 0,
      y: 0,
      width: document.canvas.width,
      height: document.canvas.height,
    });
    context.fillRect(0, 0, document.canvas.width, document.canvas.height);
  }

  const result: RenderResult = { elementBounds: new Map(), diagnostics: [] };
  for (const element of document.elements) {
    if (!element.visible || element.opacity <= 0) continue;
    if (element.type !== 'text') {
      result.diagnostics.push({
        elementId: element.id,
        severity: 'warning',
        message: `${element.type} rendering is not available in the text-core renderer`,
      });
      continue;
    }
    drawTextElement(context, element, result, scale, viewport, effectViewport, document.globalLight);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  return result;
}

export function measureTextElement(context: TextContext, element: TextElement): Bounds {
  const layout = layoutText(context, element);
  const warpedBounds = getWarpedBounds(layout.bounds, element.warp);
  return transformBounds(warpedBounds, elementMatrix(element.transform, layout.bounds));
}

function drawTextElement(
  context: TextContext,
  element: TextElement,
  result: RenderResult,
  scale: number,
  viewport: RenderViewport,
  effectViewport: RenderViewport,
  globalLight: { angle: number; altitude: number },
): void {
  const layout = layoutText(context, element);
  const matrix = elementMatrix(element.transform, layout.bounds);
  const warpedBounds = getWarpedBounds(layout.bounds, element.warp);
  const transformedBounds = transformBounds(warpedBounds, matrix);
  const reach = effectStackReach(transformedBounds, element.effects, effectViewport);
  const fullRenderBounds = roundOutBounds(expandBounds(transformedBounds, reach));
  const renderBounds = intersectBounds(fullRenderBounds, viewport);
  result.elementBounds.set(element.id, transformedBounds);
  if (!renderBounds) return;
  // The glyph source must be rasterised at the export scale. Rendering it at logical size and
  // letting the scaled destination context enlarge it turns every high-resolution export into an
  // upscaled 1x bitmap, which is exactly the artefact supersampling is supposed to avoid.
  const sourceScale = sourceRasterScale(layout.bounds, scale);
  const sourceWidth = Math.max(1, Math.ceil(layout.bounds.width * sourceScale));
  const sourceHeight = Math.max(1, Math.ceil(layout.bounds.height * sourceScale));
  const source = createCanvasSurface(sourceWidth, sourceHeight);
  const sourceContext = get2dContext(source);
  sourceContext.setTransform(
    sourceWidth / layout.bounds.width,
    0,
    0,
    sourceHeight / layout.bounds.height,
    (-layout.bounds.x * sourceWidth) / layout.bounds.width,
    (-layout.bounds.y * sourceHeight) / layout.bounds.height,
  );
  configureLayoutContext(sourceContext, layout);
  const fills = element.effects.filter(
    (effect): effect is FillEffect => effect.enabled && effect.kind === 'fill',
  );

  if (fills.length === 0) {
    sourceContext.globalAlpha = 1;
    sourceContext.globalCompositeOperation = 'source-over';
    sourceContext.fillStyle = '#ffffff';
    drawLines(sourceContext, layout);
  } else {
    for (const fill of fills) {
      sourceContext.globalAlpha = fill.opacity;
      sourceContext.globalCompositeOperation = mapBlendMode(fill.blendMode);
      sourceContext.fillStyle = createPaintStyle(sourceContext, fill.paint, layout.bounds);
      drawLines(sourceContext, layout);
    }
  }

  const faceWidth = Math.max(1, Math.ceil(renderBounds.width * scale));
  const faceHeight = Math.max(1, Math.ceil(renderBounds.height * scale));
  const face = createCanvasSurface(faceWidth, faceHeight);
  const faceContext = get2dContext(face);
  faceContext.setTransform(scale, 0, 0, scale, -renderBounds.x * scale, -renderBounds.y * scale);
  applyCanvasMatrix(faceContext, matrix);
  drawWarpedSurface(faceContext, source, layout.bounds, element.warp);
  const hasEffects = element.effects.some((effect) => effectContributesPixels(effect) && effect.kind !== 'fill');
  const rendered = hasEffects
    ? renderEffectStack(face, element.effects, {
      scale,
      globalLight,
      originX: Math.round((renderBounds.x - fullRenderBounds.x) * scale),
      originY: Math.round((renderBounds.y - fullRenderBounds.y) * scale),
      extentWidth: effectViewport.width * scale,
      extentHeight: effectViewport.height * scale,
    })
    : face;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = element.opacity;
  context.globalCompositeOperation = mapBlendMode(element.blendMode);
  context.drawImage(
    rendered,
    (renderBounds.x - viewport.x) * scale,
    (renderBounds.y - viewport.y) * scale,
  );
  context.restore();
  if (element.warp.keepUpright && element.warp.kind !== 'none') {
    result.diagnostics.push({
      elementId: element.id,
      severity: 'warning',
      message: 'Keep upright requires an outline-backed font and is unavailable for native-font raster warps',
    });
  }
  for (const message of unsupportedFontFeatures(element)) {
    result.diagnostics.push({ elementId: element.id, severity: 'warning', message });
  }
}

export function effectContributesPixels(effect: Effect): boolean {
  return effect.enabled && effect.opacity > 0;
}

export function effectStackReach(
  faceBounds: Bounds,
  effects: Effect[],
  viewport: Pick<RenderViewport, 'width' | 'height'>,
): number {
  let reach = 2;
  let postReach = 0;
  for (const effect of effects) {
    if (!effectContributesPixels(effect)) continue;
    if (effect.kind === 'reflection') continue;
    if (effect.kind === 'post') {
      postReach += effectReach(effect);
      continue;
    }
    reach = Math.max(reach, effectReach(effect));
    if (effect.kind === 'longShadow' && effect.length === 'toEdge') {
      reach = Math.max(reach, Math.hypot(viewport.width, viewport.height));
    }
  }
  for (const effect of effects) {
    if (!effectContributesPixels(effect) || effect.kind !== 'reflection') continue;
    const reflectedHeight = effect.height * (faceBounds.height + reach * 2);
    reach = Math.max(reach, reach + Math.abs(effect.offset) + reflectedHeight + effect.blur);
  }
  return reach + postReach;
}

/**
 * Report font settings the Canvas2D text path cannot honour.
 *
 * Text is drawn with `fillText` against a CSS font shorthand, which carries family, style, weight
 * and size and nothing else. Variable-font axes need a registered FontFace, and arbitrary OpenType
 * features need a shaper -- neither is reachable from a context font string. Kerning and standard
 * ligatures are the exception: `fontKerning` is set explicitly and `liga` is on by default, so
 * leaving those enabled is honoured and only disabling them is not.
 *
 * These stay in the document model rather than being deleted, because an outline-backed text
 * pipeline would apply them. Until then, say so instead of silently ignoring them.
 */
export function unsupportedFontFeatures(element: TextElement): string[] {
  const messages: string[] = [];
  const variations = Object.keys(element.font.variations ?? {});
  if (variations.length > 0) {
    messages.push(
      `Variable font axes (${variations.join(', ')}) need an outline-backed font and are not applied`,
    );
  }
  const features = Object.entries(element.font.features ?? {});
  const unsupported = features
    .filter(([tag, enabled]) => !(enabled && (tag === 'liga' || tag === 'kern')))
    .map(([tag]) => tag);
  if (unsupported.length > 0) {
    messages.push(
      `OpenType features (${unsupported.join(', ')}) need an outline-backed font and are not applied`,
    );
  }
  return messages;
}

// A pathological element (very large bounds at a high export scale) could otherwise ask for a
// source canvas big enough to fail allocation. Back the scale off rather than throwing: a slightly
// soft glyph beats a failed export.
const MAX_SOURCE_PIXELS = 64_000_000;

export function sourceRasterScale(bounds: Bounds, scale: number): number {
  const requested = Math.max(1, scale);
  const area = Math.max(1, bounds.width * bounds.height);
  const affordable = Math.sqrt(MAX_SOURCE_PIXELS / area);
  return Math.max(1, Math.min(requested, affordable));
}

function configureLayoutContext(context: TextContext, layout: LaidOutText): void {
  context.font = layout.font;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.direction = layout.direction;
  context.fontKerning = 'normal';
  context.letterSpacing = layout.letterSpacing;
  context.wordSpacing = layout.wordSpacing;
}

function drawLines(context: TextContext, layout: LaidOutText): void {
  for (const line of layout.lines) context.fillText(line.text, line.x, line.baseline);
}

function applyCanvasMatrix(context: TextContext, matrix: Matrix): void {
  context.transform(...matrix);
}

function mapBlendMode(mode: BlendMode): GlobalCompositeOperation {
  const mapping: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
    normal: 'source-over',
    multiply: 'multiply',
    screen: 'screen',
    overlay: 'overlay',
    darken: 'darken',
    lighten: 'lighten',
    'color-dodge': 'color-dodge',
    'color-burn': 'color-burn',
    'hard-light': 'hard-light',
    'soft-light': 'soft-light',
    difference: 'difference',
    exclusion: 'exclusion',
    hue: 'hue',
    saturation: 'saturation',
    color: 'color',
    luminosity: 'luminosity',
    'linear-dodge': 'lighter',
  };
  return mapping[mode] ?? 'source-over';
}

export function effectReach(effect: Effect): number {
  if (!effectContributesPixels(effect)) return 0;
  if (effect.kind === 'stroke') return effect.width;
  if (effect.kind === 'bevel') return effect.style === 'outer' || effect.style === 'emboss' ? effect.size : 0;
  if (effect.kind === 'extrude') return effect.depth;
  if (effect.kind === 'dropShadow' || effect.kind === 'innerShadow') return effect.distance + effect.size;
  if (effect.kind === 'outerGlow' || effect.kind === 'innerGlow') return effect.size;
  if (effect.kind === 'longShadow') return effect.length === 'toEdge' ? 0 : effect.length;
  if (effect.kind === 'reflection') return effect.offset + effect.blur;
  if (effect.kind === 'satin') return effect.distance + effect.size;
  if (effect.kind === 'post' && effect.type === 'glitch') return 16;
  // A block straddles up to one block width of neighbouring pixels, so a tiled export needs that
  // much halo for every core pixel's block to be complete inside its own tile.
  if (effect.kind === 'post' && effect.type === 'pixelate') {
    const size = effect.params.size;
    return typeof size === 'number' && Number.isFinite(size) ? Math.max(1, size) : 8;
  }
  if (effect.kind === 'post' && effect.type === 'aberration') {
    const amount = effect.params.amount;
    return typeof amount === 'number' && Number.isFinite(amount) ? Math.max(1, amount) : 3;
  }
  return 0;
}
