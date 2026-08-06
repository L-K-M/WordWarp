import { expandBounds, roundOutBounds, unionBounds, type Bounds } from '../geometry/bounds';
import type { TextContext } from '../text/layout';
import type { WordWarpDocument } from '../model/types';
import { effectReach, measureTextElement } from '../render/fallback2d/renderer';

export function getExportBounds(document: WordWarpDocument, context: TextContext): Bounds {
  const fullCanvas: Bounds = { x: 0, y: 0, width: document.canvas.width, height: document.canvas.height };
  if (!document.canvas.autoFit || document.canvas.background) return fullCanvas;

  let content: Bounds | null = null;
  for (const element of document.elements) {
    if (!element.visible || element.opacity <= 0 || element.type !== 'text') continue;
    let bounds = measureTextElement(context, element);
    let reach = 0;
    for (const effect of element.effects) {
      reach = Math.max(reach, effectReach(effect));
      if (effect.kind === 'reflection' && effect.enabled) {
        reach = Math.max(reach, effect.offset + effect.height * bounds.height + effect.blur);
      }
      if (effect.kind === 'longShadow' && effect.enabled && effect.length === 'toEdge') {
        reach = Math.max(reach, Math.hypot(document.canvas.width, document.canvas.height));
      }
    }
    bounds = expandBounds(bounds, reach);
    content = unionBounds(content, bounds);
  }

  if (!content) return fullCanvas;
  return roundOutBounds(expandBounds(content, document.canvas.exportPadding));
}

export function validateExportSize(bounds: Bounds, scale: number): { width: number; height: number } {
  const width = Math.ceil(bounds.width * scale);
  const height = Math.ceil(bounds.height * scale);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Export scale must be positive');
  if (width > 16384 || height > 16384 || width * height > 67_108_864) {
    throw new Error('This export exceeds the current single-canvas limit');
  }
  return { width, height };
}
