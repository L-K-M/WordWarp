import { elementMatrix, transformBounds, type Matrix } from '../../geometry/matrix';
import { layoutText, type LaidOutText, type TextContext } from '../../text/layout';
import type { BlendMode, Effect, FillEffect, TextElement, WordWarpDocument } from '../../model/types';
import type { Bounds } from '../../geometry/bounds';
import type { RenderResult, RenderViewport } from '../contracts';
import { createPaintStyle } from './paint';

export interface Render2dOptions {
  scale?: number;
  viewport?: RenderViewport;
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
    drawTextElement(context, element, result);
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  return result;
}

export function measureTextElement(context: TextContext, element: TextElement): Bounds {
  const layout = layoutText(context, element);
  return transformBounds(layout.bounds, elementMatrix(element.transform));
}

function drawTextElement(context: TextContext, element: TextElement, result: RenderResult): void {
  context.save();
  const layout = layoutText(context, element);
  const matrix = elementMatrix(element.transform);
  applyCanvasMatrix(context, matrix);
  configureLayoutContext(context, layout);
  const fills = element.effects.filter(
    (effect): effect is FillEffect => effect.enabled && effect.kind === 'fill',
  );

  if (fills.length === 0) {
    context.globalAlpha = element.opacity;
    context.globalCompositeOperation = mapBlendMode(element.blendMode);
    context.fillStyle = '#ffffff';
    drawLines(context, layout);
  } else {
    for (const fill of fills) {
      context.globalAlpha = element.opacity * fill.opacity;
      context.globalCompositeOperation = mapBlendMode(fill.blendMode);
      context.fillStyle = createPaintStyle(context, fill.paint, layout.bounds);
      drawLines(context, layout);
    }
  }

  for (const effect of element.effects) {
    if (!effect.enabled || effect.kind === 'fill') continue;
    result.diagnostics.push({
      elementId: element.id,
      effectId: effect.id,
      severity: 'warning',
      message: `${effect.kind} is deferred to the effect renderer`,
    });
  }
  result.elementBounds.set(element.id, transformBounds(layout.bounds, matrix));
  context.restore();
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
  if (effect.kind === 'reflection') return effect.offset + effect.height * 500 + effect.blur;
  if (effect.kind === 'satin') return effect.distance + effect.size;
  return 0;
}
