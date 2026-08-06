import type { TextContext } from '../text/layout';

export type CanvasSurface = OffscreenCanvas | HTMLCanvasElement;

export function createCanvasSurface(width: number, height: number): CanvasSurface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function get2dContext(surface: CanvasSurface, readFrequently = false): TextContext {
  if ('transferControlToOffscreen' in surface) {
    const context = surface.getContext('2d', { alpha: true, willReadFrequently: readFrequently });
    if (!context) throw new Error('Canvas2D context is unavailable');
    return context;
  }
  const context = surface.getContext('2d', { alpha: true, willReadFrequently: readFrequently });
  if (!context) throw new Error('Canvas2D context is unavailable');
  return context;
}
