import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { decode } from 'fast-png';

import { createEffect } from '../src/effects/defaults';
import { createDefaultDocument } from '../src/model/defaults';
import { encodeShareFragment } from '../src/share/url';
import type { TextElement } from '../src/model/types';

// `createDefaultDocument` stamps the build's version through Vite's `__APP_VERSION__` define, which
// Playwright's esbuild compilation of this spec does not apply.
const testGlobals = globalThis as unknown as { __APP_VERSION__?: string };
testGlobals.__APP_VERSION__ ??= '0.0.0-test';

/**
 * A warp is rasterised as a mesh of clipped triangles, and an accelerated Canvas2D anti-aliases
 * `clip()`. Two triangles that merely abut therefore each cover the pixels along their shared edge
 * partially, and no composite of two partial covers reaches full opacity -- the mesh prints a
 * lattice of alpha holes straight through the glyph, which the stroke traces and the bevel quilts.
 *
 * Chromium only anti-aliases the clip when the canvas is GPU-rasterised, and defaults to the
 * software path under headless, so ask for the accelerated one explicitly. If a machine cannot
 * provide it the render simply comes out seamless for a different reason and the test still passes.
 */
test.use({
  launchOptions: {
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
      '--disable-software-rasterizer',
    ],
  },
});

/**
 * A flat fill under a strong preset warp, and nothing else.
 *
 * No stroke, shadow or bevel, so the exported alpha is the warped glyph itself: every interior
 * pixel is either fully opaque or a seam. The inspector cannot author a bare effect stack, so hand
 * the document to the app through its own share-link importer.
 */
function warpedFillFragment(): string {
  const document = createDefaultDocument({ now: '2020-01-01T00:00:00.000Z', documentId: 'warp-seam-test' });
  const element = document.elements[0] as TextElement;
  element.text = 'SEAM';
  element.layout.size = 160;
  element.transform = { ...element.transform, rotation: 0, skewX: 0 };
  element.warp = { ...element.warp, kind: 'preset', preset: 'textArchUp', bend: 0.8, adj: [0.6, 0.5] };

  const fill = createEffect('fill');
  fill.paint = { kind: 'solid', color: [0, 0, 0, 1] };
  element.effects = [fill];
  return encodeShareFragment(document);
}

test('a warped glyph has no seams where its mesh triangles meet', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');

  await page.goto(`/#${encodeURI(warpedFillFragment().replace(/^#/, ''))}`);
  await expect(page.getByLabel('Content')).toHaveValue('SEAM');

  await page.getByLabel('Export resolution').selectOption('2');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export PNG/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not provide the downloaded PNG path');
  const image = decode(await readFile(path));
  const { width, height } = image;
  const alphaAt = (x: number, y: number) => Number(image.data[(y * width + x) * 4 + 3]);

  // Count pixels that are short of opaque despite sitting well inside the glyph. A seam runs
  // through the interior, so it is caught; the glyph's own anti-aliased outline is not, because
  // every one of its neighbours is not opaque.
  const reach = 3;
  const ring: [number, number][] = [
    [-reach, 0], [reach, 0], [0, -reach], [0, reach],
    [-reach, -reach], [reach, -reach], [-reach, reach], [reach, reach],
  ];
  let interior = 0;
  let seams = 0;
  for (let y = reach; y < height - reach; y += 1) {
    for (let x = reach; x < width - reach; x += 1) {
      if (!ring.every(([dx, dy]) => alphaAt(x + dx, y + dy) === 255)) continue;
      interior += 1;
      if (alphaAt(x, y) < 250) seams += 1;
    }
  }

  // The glyphs have to be substantial enough for the measurement to mean anything.
  expect(interior).toBeGreaterThan(5000);

  // Measured over the interior of this document: 5.4% of it was seam before the triangles were
  // given an overlapping clip, and none of it after. Anything above a handful of stray pixels is
  // the lattice coming back.
  expect(seams / interior).toBeLessThan(0.002);
});
