import { createDefaultDocument } from '../model/defaults';
import type { WordWarpDocument } from '../model/types';
import { renderDocument2d } from '../render/fallback2d/renderer';
import { get2dContext } from '../render/surface';
import { ensureFontsForDocument } from '../text/fonts';
import { applyPresetToElement } from './library';
import type { Preset } from './types';

/**
 * Thumbnails for the style library, rendered by the real pipeline.
 *
 * The cards used to show a CSS gradient built from a hand-written list of swatch colours, so they
 * only ever hinted at a preset's palette -- never its bevel, warp, stroke or glow, and nothing kept
 * the swatches honest when a preset's effects changed. Running the same renderer the canvas uses
 * means a card shows what applying the preset will actually do.
 */

/** Rendered at 2x and shown at half that, so the thumbnail stays sharp on dense displays. */
const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 220;
const PREVIEW_TEXT = 'Ww';

// Rendering a preset costs a full effect stack, so hold onto the result: the library re-renders on
// every search keystroke and category switch, and cards scroll in and out of view constantly.
const cache = new Map<string, string>();

export function getCachedPresetPreview(preset: Preset): string | undefined {
  return cache.get(preset.id);
}

export function renderPresetPreview(preset: Preset): string | undefined {
  const cached = cache.get(preset.id);
  if (cached) return cached;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = PREVIEW_WIDTH;
    canvas.height = PREVIEW_HEIGHT;
    const context = get2dContext(canvas);
    renderDocument2d(context, previewDocument(preset));
    const url = canvas.toDataURL('image/png');
    cache.set(preset.id, url);
    return url;
  } catch {
    // A preview is decoration; if this environment cannot rasterise one, the card keeps its
    // swatch placeholder rather than taking the panel down with it.
    return undefined;
  }
}

/**
 * Font-aware variant of `renderPresetPreview`. A preset that sets a bundled font must not render
 * before the face is registered, or the cache would hold a fallback-glyph thumbnail forever.
 */
export async function renderPresetPreviewAsync(preset: Preset): Promise<string | undefined> {
  if (cache.has(preset.id)) return cache.get(preset.id);
  await ensureFontsForDocument(previewDocument(preset));
  return renderPresetPreview(preset);
}

function previewDocument(preset: Preset): WordWarpDocument {
  const value = createDefaultDocument({ now: '1970-01-01T00:00:00.000Z' });
  value.canvas = {
    ...value.canvas,
    width: PREVIEW_WIDTH,
    height: PREVIEW_HEIGHT,
    background: null,
    autoFit: false,
    exportPadding: 0,
  };
  const element = value.elements[0];
  if (element?.type === 'text') {
    element.text = PREVIEW_TEXT;
    element.name = PREVIEW_TEXT;
    element.layout = { ...element.layout, size: 104, letterSpacing: -0.02 };
    element.transform = {
      ...element.transform,
      x: PREVIEW_WIDTH / 2,
      y: PREVIEW_HEIGHT / 2,
      rotation: 0,
      skewX: 0,
    };
    // The warp comes with the preset, so a warped style reads as warped on the card.
    applyPresetToElement(element, preset);
  }
  return value;
}
