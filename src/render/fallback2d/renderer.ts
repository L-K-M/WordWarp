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
  const sourceWidth = Math.max(1, Math.ceil(layout.bounds.width));
  const sourceHeight = Math.max(1, Math.ceil(layout.bounds.height));
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
  const hasEffects = element.effects.some((effect) => effect.enabled && effect.kind !== 'fill');
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
}

export function effectStackReach(
  faceBounds: Bounds,
  effects: Effect[],
  viewport: Pick<RenderViewport, 'width' | 'height'>,
): number {
  let reach = 2;
  let postReach = 0;
  for (const effect of effects) {
    if (!effect.enabled) continue;
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
    if (!effect.enabled || effect.kind !== 'reflection') continue;
    const reflectedHeight = effect.height * (faceBounds.height + reach * 2);
    reach = Math.max(reach, reach + Math.abs(effect.offset) + reflectedHeight + effect.blur);
  }
  return reach + postReach;
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
  if (!effect.enabled) return 0;
  if (effect.kind === 'stroke') return effect.width;
  if (effect.kind === 'bevel') return effect.style === 'outer' || effect.style === 'emboss' ? effect.size : 0;
  if (effect.kind === 'extrude') return effect.depth;
  if (effect.kind === 'dropShadow' || effect.kind === 'innerShadow') return effect.distance + effect.size;
  if (effect.kind === 'outerGlow' || effect.kind === 'innerGlow') return effect.size;
  if (effect.kind === 'longShadow') return effect.length === 'toEdge' ? 0 : effect.length;
  if (effect.kind === 'reflection') return effect.offset + effect.blur;
  if (effect.kind === 'satin') return effect.distance + effect.size;
  if (effect.kind === 'post' && effect.type === 'glitch') return 16;
  if (effect.kind === 'post' && effect.type === 'aberration') {
    const amount = effect.params.amount;
    return typeof amount === 'number' && Number.isFinite(amount) ? Math.max(1, amount) : 3;
  }
  return 0;
}
