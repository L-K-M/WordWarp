import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { decode } from 'fast-png';

test('edits text, applies a preset, and exports transparent PNG', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'WORDWARP TYPE EFFECTS LAB' })).toBeVisible();

  const content = page.getByLabel('Content');
  await content.fill('Chrome test');
  await page.getByRole('button', { name: 'Gold Bar' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: /Chrome test/ })).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export PNG/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Playwright did not provide the downloaded PNG path');
  const image = decode(await readFile(downloadPath));
  expect(image.channels).toBe(4);
  expect(image.width).toBeGreaterThan(0);
  expect(image.height).toBeGreaterThan(0);

  await page.waitForTimeout(2200);
  await page.reload();
  await expect(page.getByLabel('Content')).toHaveValue('Chrome test');
});

test('renders a non-interactive dual-stroke selection outline', async ({ page }) => {
  await page.goto('./');

  const overlay = page.locator('.selection-overlay');
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  await expect(overlay).toHaveCSS('pointer-events', 'none');

  const layers = overlay.locator('rect');
  await expect(layers).toHaveClass(['selection-underlay', 'selection-outline']);
  const bounds = await layers.evaluateAll((rectangles) => rectangles.map((rectangle) => (
    ['x', 'y', 'width', 'height'].map((attribute) => rectangle.getAttribute(attribute))
  )));
  expect(bounds[0]).toEqual(bounds[1]);

  await expect(layers.nth(0)).toHaveCSS('stroke', 'rgb(7, 16, 24)');
  await expect(layers.nth(0)).toHaveCSS('stroke-dasharray', 'none');
  await expect(layers.nth(0)).toHaveCSS('stroke-width', '4px');
  await expect(layers.nth(0)).toHaveCSS('vector-effect', 'non-scaling-stroke');
  await expect(layers.nth(1)).toHaveCSS('stroke', 'rgb(72, 228, 255)');
  await expect(layers.nth(1)).toHaveCSS('stroke-dasharray', /8px.*5px/);
  await expect(layers.nth(1)).toHaveCSS('stroke-width', '2px');
  await expect(layers.nth(1)).toHaveCSS('vector-effect', 'non-scaling-stroke');
});

test('starts mobile panels closed and exposes touch-sized controls', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile-'));
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('./');
  const inspector = page.getByLabel('Inspector');
  await expect(inspector).not.toBeVisible();
  const inspectButton = page.getByRole('button', { name: 'Inspect' });
  expect((await inspectButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await inspectButton.click();
  await expect(inspector).toBeVisible();
  await page.locator('.layers-strip').scrollIntoViewIfNeeded();
  await expect(page.locator('.layers-strip')).toBeVisible();
});

test('saves pending edits before opening a shared document', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (value: string) => {
          sessionStorage.setItem('captured-share-url', value);
          return Promise.resolve();
        },
      },
    });
  });
  await page.goto('./');
  await page.getByLabel('Content').fill('Shared copy');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('captured-share-url'))).not.toBeNull();
  const shareUrl = await page.evaluate(() => sessionStorage.getItem('captured-share-url'));
  if (!shareUrl) throw new Error('Share did not write a URL to the clipboard');
  await page.getByLabel('Content').fill('Pending local edit');
  await page.evaluate((url) => { window.location.hash = new URL(url).hash; }, shareUrl);
  await expect(page.getByLabel('Content')).toHaveValue('Shared copy');
  await expect.poll(() => page.evaluate(async () => {
    const records = await new Promise<Array<{ elements: Array<{ type: string; text?: string }> }>>((resolve, reject) => {
      const openRequest = indexedDB.open('wordwarp');
      openRequest.onerror = () => reject(openRequest.error ?? new Error('Could not open the test database'));
      openRequest.onsuccess = () => {
        const request = openRequest.result.transaction('documents').objectStore('documents').getAll();
        request.onerror = () => reject(request.error ?? new Error('Could not read test documents'));
        request.onsuccess = () => {
          openRequest.result.close();
          resolve(request.result);
        };
      };
    });
    return records.some((record) => record.elements.some((element) => element.text === 'Pending local edit'));
  })).toBe(true);
});

test('exports APNG and GIF through the animation worker', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  test.setTimeout(120_000);
  await page.goto('./');
  await page.getByLabel('Content').fill('A');
  await page.getByRole('spinbutton', { name: 'Size' }).fill('48');
  await page.getByRole('button', { name: 'Glitter Text' }).click();

  await page.getByLabel('Export format').selectOption('apng');
  let downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export APNG/ }).click();
  let download = await downloadPromise;
  let downloadPath = await download.path();
  if (!downloadPath) throw new Error('Playwright did not provide the downloaded APNG path');
  let bytes = await readFile(downloadPath);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(bytes.indexOf(Buffer.from('acTL'))).toBeGreaterThan(0);

  await page.getByLabel('Export format').selectOption('gif');
  downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export GIF/ }).click();
  download = await downloadPromise;
  downloadPath = await download.path();
  if (!downloadPath) throw new Error('Playwright did not provide the downloaded GIF path');
  bytes = await readFile(downloadPath);
  expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
  expect(bytes.at(-1)).toBe(0x3b);
});

test('loads from the production service worker while offline', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await context.setOffline(true);
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: 'WORDWARP TYPE EFFECTS LAB' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('uses the configured PWA base path', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.goto('./');

  const expectedPath = new URL(page.url()).pathname;
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
    if (!href) throw new Error('Manifest link is unavailable');
    const response = await fetch(href);
    const data: unknown = await response.json();
    if (typeof data !== 'object' || data === null) throw new Error('Manifest is not an object');
    const record = data as Record<string, unknown>;
    return {
      id: typeof record.id === 'string' ? record.id : undefined,
      scope: typeof record.scope === 'string' ? record.scope : undefined,
      start_url: typeof record.start_url === 'string' ? record.start_url : undefined,
    };
  });
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);

  expect(manifest.id).toBe(expectedPath);
  expect(manifest.scope).toBe(expectedPath);
  expect(manifest.start_url).toBe(expectedPath);
  expect(new URL(scope).pathname).toBe(expectedPath);
});
