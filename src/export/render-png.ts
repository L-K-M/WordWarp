import { getExportBounds, validateExportSize } from './bounds';
import { encodePngPixels } from './png-codec';
import { planTiles } from './tiling';
import type { Bounds } from '../geometry/bounds';
import type { WordWarpDocument } from '../model/types';
import {
  effectContributesPixels,
  effectStackReach,
  measureTextElement,
  renderDocument2d,
} from '../render/fallback2d/renderer';
import { get2dContext } from '../render/surface';
import { ensureFontsForDocument, missingBundledFonts } from '../text/fonts';

export interface RenderedPng {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface RenderedRgba {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

type ExportSurface = OffscreenCanvas | HTMLCanvasElement;

export async function renderPngOnSurface(
  document: WordWarpDocument,
  scale: number,
  createSurface: () => ExportSurface,
): Promise<RenderedPng> {
  // Bundled fonts must be registered before any text is measured or drawn -- in a worker (the
  // preferred export path) that set is separate from the window's, so this cannot be hoisted to
  // the caller. A font that fails to load leaves the fallback face in place rather than failing.
  await ensureFontsForDocument(document);
  const rendered = renderRgbaOnSurface(document, scale, createSurface);
  const bytes = await encodePngPixels(rendered.pixels, rendered.width, rendered.height);
  return { bytes, width: rendered.width, height: rendered.height };
}

/**
 * Rasterise a document to straight (un-premultiplied) RGBA pixels.
 *
 * Precondition: every bundled font the document uses must already be registered in this realm's
 * FontFaceSet -- call `ensureFontsForDocument` first (`renderPngOnSurface` and `exportAnimation`
 * both do). Skipping it renders fallback glyphs instead of failing, which is worse: it is wrong
 * silently.
 */
export function renderRgbaOnSurface(
  document: WordWarpDocument,
  scale: number,
  createSurface: () => ExportSurface,
  fixedBounds?: Bounds,
): RenderedRgba {
  // The precondition from the docstring, enforced as a signal rather than a silent wrong render.
  const missingFonts = missingBundledFonts(document);
  if (missingFonts.length > 0) {
    console.warn(`WordWarp is rendering with unloaded bundled fonts (${missingFonts.join(', ')}); call ensureFontsForDocument first`);
  }
  const surface = createSurface();
  const context = get2dContext(surface, true);
  const bounds = fixedBounds ?? getExportBounds(document, context);
  const { width, height } = validateExportSize(bounds, scale);
  const shouldTile = width > 4096 || height > 4096 || width * height > 16_777_216;
  if (shouldTile && hasTiledExportBlockingReflection(document)) {
    throw new Error('Reflection effects cannot currently be combined with tiled large-image export');
  }
  const maximumReach = maximumEffectReach(document, context, bounds);
  const scaledReach = Math.ceil(maximumReach * scale);
  if (shouldTile && scaledReach > 1024) {
    throw new Error('Effects on this large export require more than 1024 pixels of tile overlap');
  }
  const halo = shouldTile ? scaledReach : 0;
  const coreSize = Math.max(512, 4096 - halo * 2);
  const tiles = shouldTile
    ? planTiles(width, height, coreSize, halo)
    : planTiles(width, height, Math.max(width, height), 0);
  const pixels = new Uint8ClampedArray(width * height * 4);

  for (const tile of tiles) {
    surface.width = tile.render.width;
    surface.height = tile.render.height;
    const tileContext = get2dContext(surface, true);
    renderDocument2d(tileContext, document, {
      scale,
      viewport: {
        x: bounds.x + tile.render.x / scale,
        y: bounds.y + tile.render.y / scale,
        width: tile.render.width / scale,
        height: tile.render.height / scale,
      },
      effectViewport: bounds,
    });
    const source = tileContext.getImageData(
      tile.core.x - tile.render.x,
      tile.core.y - tile.render.y,
      tile.core.width,
      tile.core.height,
    ).data;
    for (let row = 0; row < tile.core.height; row += 1) {
      const sourceOffset = row * tile.core.width * 4;
      const destinationOffset = ((tile.core.y + row) * width + tile.core.x) * 4;
      pixels.set(source.subarray(sourceOffset, sourceOffset + tile.core.width * 4), destinationOffset);
    }
  }
  return { pixels, width, height };
}

export function hasTiledExportBlockingReflection(document: WordWarpDocument): boolean {
  return document.elements.some((element) => (
    element.visible
    && element.opacity > 0
    && element.effects.some((effect) => effect.kind === 'reflection' && effectContributesPixels(effect))
  ));
}

function maximumEffectReach(
  document: WordWarpDocument,
  context: ReturnType<typeof get2dContext>,
  viewport: Bounds,
): number {
  let reach = 2;
  for (const element of document.elements) {
    if (!element.visible || element.opacity <= 0 || element.type !== 'text') continue;
    const elementBounds = measureTextElement(context, element);
    reach = Math.max(reach, effectStackReach(elementBounds, element.effects, viewport));
  }
  return reach;
}
