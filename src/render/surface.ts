import type { TextContext } from '../text/layout';

export type CanvasSurface = OffscreenCanvas | HTMLCanvasElement;

interface Canvas2dProvider {
  getContext(
    contextId: '2d',
    options?: CanvasRenderingContext2DSettings,
  ): TextContext | null;
}

export function createCanvasSurface(width: number, height: number): CanvasSurface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function get2dContext(surface: CanvasSurface, readFrequently = false): TextContext {
  const context = (surface as Canvas2dProvider).getContext('2d', {
    alpha: true,
    willReadFrequently: readFrequently,
  });
  if (!context) throw new Error('Canvas2D context is unavailable');
  return context;
}
