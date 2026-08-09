import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { decode } from 'fast-png';

import { createEffect } from '../src/effects/defaults';
import { createDefaultDocument } from '../src/model/defaults';
import { encodeShareFragment } from '../src/share/url';
import type { StrokeEffect, TextElement } from '../src/model/types';

// `createDefaultDocument` stamps the build's version through Vite's `__APP_VERSION__` define.
// Vitest inherits that from the Vite config, but Playwright compiles specs with esbuild and
// applies no Vite defines, so the global is absent when this spec builds a document here in Node.
const testGlobals = globalThis as unknown as { __APP_VERSION__?: string };
testGlobals.__APP_VERSION__ ??= '0.0.0-test';

/**
 * A gradient-painted stroke, built directly and handed to the app through its own share-link
 * importer -- so the paint model is exercised on its own, independently of the inspector's
 * gradient editor (which the test below drives).
 */
function gradientStrokeDocumentFragment(): string {
  const document = createDefaultDocument({ now: '2020-01-01T00:00:00.000Z', documentId: 'paint-test' });
  const element = document.elements[0] as TextElement;
  element.text = 'PAINT';
  element.layout.size = 150;

  const fill = createEffect('fill');
  fill.paint = { kind: 'solid', color: [0, 0, 0, 1] };

  const stroke: StrokeEffect = createEffect('stroke');
  stroke.width = 14;
  stroke.position = 'outside';
  stroke.paint = {
    kind: 'gradient',
    gradient: {
      type: 'linear',
      angle: 90,
      center: [0.5, 0.5],
      scale: 1,
      dither: false,
      interpolation: 'srgb',
      stops: [
        { offset: 0, color: [1, 0, 0, 1] },
        { offset: 1, color: [0, 0, 1, 1] },
      ],
    },
  };

  element.effects = [fill, stroke];
  return encodeShareFragment(document);
}

test('a gradient stroke renders a gradient rather than one flat sample', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');

  await page.goto(`/#${encodeURI(gradientStrokeDocumentFragment().replace(/^#/, ''))}`);
  await expect(page.getByLabel('Content')).toHaveValue('PAINT');

  await page.getByLabel('Export resolution').selectOption('2');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export PNG/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not provide the downloaded PNG path');
  const image = decode(await readFile(path));

  // Ignore the black fill and count only colours belonging to the stroke.
  const strokeColours = new Set<string>();
  for (let index = 0; index < image.width * image.height; index += 1) {
    const offset = index * 4;
    const red = Number(image.data[offset]);
    const green = Number(image.data[offset + 1]);
    const blue = Number(image.data[offset + 2]);
    const alpha = Number(image.data[offset + 3]);
    if (alpha < 250) continue;
    if (red < 20 && green < 20 && blue < 20) continue;
    strokeColours.add(`${red},${green},${blue}`);
  }

  // Collapsing the paint to its midpoint sample yields exactly one stroke colour (#800080).
  // An actual gradient sweeps red to blue across the element.
  expect(strokeColours.size).toBeGreaterThan(40);

  const reds = [...strokeColours].map((colour) => Number(colour.split(',')[0]));
  expect(Math.max(...reds) - Math.min(...reds)).toBeGreaterThan(120);
});

test('authors a gradient fill in the inspector and exports the sweep', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.getByLabel('Content')).toHaveValue('WordWarp');

  // The default fill arrives as the chrome ramp, so the switch also proves the conversion path:
  // the ramp becomes editable stops rather than being replaced by a default.
  await page.getByLabel('Fill paint style').selectOption('gradient');
  const removeStop = page.getByRole('button', { name: 'Remove fill gradient stop' });
  for (let clicks = 0; clicks < 5; clicks += 1) await removeStop.click();
  // The floor is two stops; the editor must refuse to hollow a gradient out entirely.
  await expect(removeStop).toBeDisabled();

  await page.getByLabel('Fill gradient stop 1').fill('#ff0000');
  await page.getByLabel('Fill gradient stop 2').fill('#0000ff');
  await expect(page.locator('.render-error')).toHaveCount(0);

  await page.getByLabel('Export resolution').selectOption('2');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export PNG/ }).click();
  const download = await downloadPromise;
  const path = await download.path();
  if (!path) throw new Error('Playwright did not provide the downloaded PNG path');
  const image = decode(await readFile(path));

  // The default bevel and outline repaint greys over parts of the face, so only saturated pixels
  // are the gradient's own. The authored sweep must reach a red end and a blue end with a run of
  // blends between -- a collapsed or unapplied edit fails all three checks.
  const saturated = new Set<string>();
  let sawRed = false;
  let sawBlue = false;
  for (let index = 0; index < image.width * image.height; index += 1) {
    const offset = index * 4;
    const red = Number(image.data[offset]);
    const green = Number(image.data[offset + 1]);
    const blue = Number(image.data[offset + 2]);
    const alpha = Number(image.data[offset + 3]);
    if (alpha < 250) continue;
    if (Math.max(red, green, blue) - Math.min(red, green, blue) < 60) continue;
    saturated.add(`${red},${green},${blue}`);
    if (red > blue + 80) sawRed = true;
    if (blue > red + 80) sawBlue = true;
  }
  expect(sawRed).toBe(true);
  expect(sawBlue).toBe(true);
  expect(saturated.size).toBeGreaterThan(40);
});
