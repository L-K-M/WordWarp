import { getExportBounds, validateExportSize } from './bounds';
import { encodePngPixels } from './png-codec';
import type { WordWarpDocument } from '../model/types';
import { renderDocument2d } from '../render/fallback2d/renderer';
import { get2dContext } from '../render/surface';

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
  const context = get2dContext(surface, true);
  const bounds = getExportBounds(document, context);
  const { width, height } = validateExportSize(bounds, scale);
  surface.width = width;
  surface.height = height;
  renderDocument2d(context, document, { scale, viewport: bounds });
  const pixels = context.getImageData(0, 0, width, height).data;
  const bytes = await encodePngPixels(pixels, width, height);
  return { bytes, width, height };
}
