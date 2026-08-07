import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { decode } from 'fast-png';

interface Rgba {
  data: Uint8Array | Uint16Array;
  width: number;
  height: number;
}

async function exportAt(page: Page, scale: string): Promise<Rgba> {
  await page.getByLabel('Export resolution').selectOption(scale);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export PNG/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not provide the downloaded PNG path');
  const image = decode(await readFile(path));
  expect(image.channels).toBe(4);
  return { data: image.data as Uint8Array, width: image.width, height: image.height };
}

function alphaAt(image: Rgba, index: number): number {
  return Number(image.data[index * 4 + 3]);
}

/**
 * Mean width, in pixels, of the anti-aliased alpha transition band along scanlines.
 *
 * This is the metric that distinguishes a genuinely higher-resolution render from an upscaled
 * one. A resolution-independent renderer holds the band at roughly a pixel no matter the export
 * scale; a renderer that rasterises at 1x and enlarges produces a band that grows with the scale.
 */
function edgeBandWidth(image: Rgba): number {
  let bandPixels = 0;
  let transitions = 0;
  for (let y = 0; y < image.height; y += 1) {
    let run = 0;
    for (let x = 0; x < image.width; x += 1) {
      const alpha = alphaAt(image, y * image.width + x);
      if (alpha > 8 && alpha < 247) {
        run += 1;
        continue;
      }
      if (run > 0) {
        bandPixels += run;
        transitions += 1;
        run = 0;
      }
    }
    if (run > 0) {
      bandPixels += run;
      transitions += 1;
    }
  }
  return transitions === 0 ? 0 : bandPixels / transitions;
}

test.describe('render quality', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'chromium');
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'WordWarp GOO TYPE LAB' })).toBeVisible();
  });

  test('exporting at a higher scale adds resolution instead of upscaling', async ({ page }) => {
    await page.getByLabel('Content').fill('SHARP');

    // Soft effects legitimately widen with resolution: a 14px blur at 4x really is 56px of
    // gradient. Turn them off so the only semi-transparent pixels left are glyph edges, whose
    // width must NOT depend on the export scale.
    await page.getByRole('button', { name: 'Disable Drop shadow' }).click();
    await page.getByRole('button', { name: 'Disable Bevel' }).click();

    const single = await exportAt(page, '1');
    const quadruple = await exportAt(page, '4');

    // The canvas really is four times larger.
    expect(quadruple.width).toBeGreaterThan(single.width * 3.5);
    expect(quadruple.height).toBeGreaterThan(single.height * 3.5);

    const singleBand = edgeBandWidth(single);
    const quadrupleBand = edgeBandWidth(quadruple);
    expect(singleBand).toBeGreaterThan(0);

    // Upscaling a 1x raster grows the edge band in step with the scale factor: measured at
    // 2.96 / 5.84 / 11.66 px for 1x / 2x / 4x before this was fixed. Re-rasterising at the export
    // scale holds it flat (2.96 / 3.03 / 2.92). The 1.6x bound passes the latter comfortably and
    // fails the former decisively.
    expect(quadrupleBand).toBeLessThan(singleBand * 1.6);
  });

  test('bevel shading does not staircase down a stroke', async ({ page }) => {
    await page.getByLabel('Content').fill('WWW');
    await page.getByRole('button', { name: 'Bubble Inflate' }).click();

    const image = await exportAt(page, '2');

    // The bevel normal comes from a distance field, whose gradient direction can only point at a
    // whole-pixel neighbour. Differentiating it raw made that direction flip in steps down a
    // near-vertical stroke, printing a ladder of horizontal notches across the glyph. The
    // signature is vertical, so a second difference down each column isolates it -- shading that
    // varies smoothly has almost none, a staircase has a spike at every step.
    let total = 0;
    let counted = 0;
    const opaque = (x: number, y: number) => alphaAt(image, y * image.width + x) > 250;
    const luma = (x: number, y: number) => {
      const offset = (y * image.width + x) * 4;
      return (Number(image.data[offset]) + Number(image.data[offset + 1]) + Number(image.data[offset + 2])) / 3;
    };
    for (let y = 1; y < image.height - 1; y += 1) {
      for (let x = 1; x < image.width - 1; x += 1) {
        // Interior only, so glyph edges are not mistaken for steps.
        if (!opaque(x, y) || !opaque(x, y - 1) || !opaque(x, y + 1) || !opaque(x - 1, y) || !opaque(x + 1, y)) continue;
        total += Math.abs(luma(x, y + 1) - 2 * luma(x, y) + luma(x, y - 1));
        counted += 1;
      }
    }
    expect(counted).toBeGreaterThan(500);

    // Measured 2.49 before this was fixed and 1.06 after, against a floor of 0.54 with the bevel
    // switched off entirely. 1.6 sits clear of both.
    expect(total / counted).toBeLessThan(1.6);
  });

  test('transparent export keeps shadows free of grey fringing', async ({ page }) => {
    await page.getByLabel('Content').fill('ALPHA');
    await page.getByRole('button', { name: 'Deep Extrude' }).click();

    const image = await exportAt(page, '2');

    let fullyTransparentWithColour = 0;
    let lowAlphaPixels = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let index = 0; index < image.width * image.height; index += 1) {
      const offset = index * 4;
      const red = Number(image.data[offset]);
      const green = Number(image.data[offset + 1]);
      const blue = Number(image.data[offset + 2]);
      const alpha = Number(image.data[offset + 3]);
      if (alpha === 0 && (red | green | blue) !== 0) fullyTransparentWithColour += 1;
      if (alpha > 4 && alpha < 60) {
        lowAlphaPixels += 1;
        sumR += red;
        sumG += green;
        sumB += blue;
      }
    }

    // Fully transparent pixels must not smuggle colour into the file.
    expect(fullyTransparentWithColour).toBe(0);

    // The faint edge of this preset's shadow is a warm dark red. Blurring straight (rather than
    // premultiplied) alpha drags black into that band and desaturates it towards grey, so assert
    // the fringe stayed chromatic.
    expect(lowAlphaPixels).toBeGreaterThan(0);
    const meanR = sumR / lowAlphaPixels;
    const meanG = sumG / lowAlphaPixels;
    const meanB = sumB / lowAlphaPixels;
    expect(meanR).toBeGreaterThan(meanG + 8);
    expect(Math.max(meanR, meanG, meanB)).toBeGreaterThan(24);
  });
});
