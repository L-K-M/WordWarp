import { getExportBounds, validateExportSize } from './bounds';
import { encodePngPixels } from './png-codec';
import type { WordWarpDocument } from '../model/types';
import { renderDocument2d } from '../render/fallback2d/renderer';

export interface RenderedPng {
  bytes: Uint8Array;
  width: number;
  height: number;
}

type ExportSurface = OffscreenCanvas | HTMLCanvasElement;

export async function renderPngOnSurface(
  document: WordWarpDocument,
  scale: number,
  createSurface: () => ExportSurface,
): Promise<RenderedPng> {
  const surface = createSurface();
  const context = surface.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!context) throw new Error('Canvas2D is unavailable for PNG export');
  const bounds = getExportBounds(document, context);
  const { width, height } = validateExportSize(bounds, scale);
  surface.width = width;
  surface.height = height;
  const resizedContext = surface.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!resizedContext) throw new Error('Canvas2D export context was lost during resize');
  renderDocument2d(resizedContext, document, { scale, viewport: bounds });
  const pixels = resizedContext.getImageData(0, 0, width, height).data;
  const bytes = await encodePngPixels(pixels, width, height);
  return { bytes, width, height };
}
