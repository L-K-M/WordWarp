import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { decode } from 'fast-png';
import { deflateSync, strToU8 } from 'fflate';

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

test('evaluates the initial animated preview at frame zero', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.addInitScript(() => {
    const getContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as (
      this: HTMLCanvasElement,
      contextId: string,
      ...args: unknown[]
    ) => unknown;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value(this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
        if (contextId === 'webgl2') return null;
        return Reflect.apply(getContext, this, [contextId, ...args]);
      },
    });
  });
  const document = {
    version: 1,
    id: 'frame-zero-document',
    name: 'Frame zero',
    canvas: { width: 320, height: 180, background: null, autoFit: true, exportPadding: 0 },
    elements: [{
      id: 'frame-zero-element',
      type: 'text',
      name: 'Frame zero',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      transform: { x: 160, y: 90, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, originX: 0.5, originY: 0.5 },
      effects: [],
      animations: [{ id: 'typewriter', kind: 'typewriter', enabled: true, duration: 2, params: {}, seed: 1 }],
      text: 'Frame zero',
      font: { family: 'Arial', source: 'local', weight: 400, italic: false },
      layout: { size: 48, align: 'center', lineHeight: 1, letterSpacing: 0, wordSpacing: 0, transform: 'none', direction: 'ltr', curveSpacing: 'uniform' },
      warp: { kind: 'none', adj: [0.5, 0.5], bend: 0, distortH: 0, distortV: 0, keepUpright: false },
    }],
    assets: {},
    globalLight: { angle: 120, altitude: 35 },
    meta: { created: '2026-01-02T03:04:05.000Z', modified: '2026-01-02T03:04:05.000Z', app: 'WordWarp/test' },
  };
  const payload = Buffer.from(deflateSync(strToU8(JSON.stringify(document)), { level: 9 })).toString('base64url');

  await page.goto(`./#ww=1.${payload}`);
  await expect(page.getByLabel('Content')).toHaveValue('Frame zero');
  await expect(page.locator('.renderer-badge')).toHaveText('2D FALLBACK');
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  const hasVisiblePixels = await page.locator('canvas').evaluate((node) => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error('Expected a canvas');
    const context = node.getContext('2d');
    if (!context) throw new Error('Expected a 2D canvas context');
    return context.getImageData(0, 0, node.width, node.height).data.some((value, index) => index % 4 === 3 && value > 0);
  });
  expect(hasVisiblePixels).toBe(false);
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
    // Resolve each value against the manifest's own URL before handing it back. `vite.config.ts`
    // defaults `base` to './' and stamps that straight into the manifest, which is the portable
    // choice -- a relative id, scope and start_url follow the app wherever it is deployed. They
    // are only comparable to a pathname once resolved the way a browser resolves them; comparing
    // the raw './' against '/' fails while the manifest is in fact correct.
    const resolve = (value: unknown) => (typeof value === 'string' ? new URL(value, href).pathname : undefined);
    return {
      id: resolve(record.id),
      scope: resolve(record.scope),
      start_url: resolve(record.start_url),
    };
  });
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);

  expect(manifest.id).toBe(expectedPath);
  expect(manifest.scope).toBe(expectedPath);
  expect(manifest.start_url).toBe(expectedPath);
  expect(new URL(scope).pathname).toBe(expectedPath);
});

test('style library scrolls to every preset and previews the real render', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'WORDWARP TYPE EFFECTS LAB' })).toBeVisible();

  const panel = page.locator('.preset-panel');
  const cards = page.locator('.preset-card');
  const total = await cards.count();
  expect(total).toBeGreaterThan(12);

  // Every category has to be reachable -- they used to sit on one horizontally scrolling row with
  // the scrollbar hidden, so the last ones were off the edge of the panel. Checked before the
  // panel is scrolled, since the row scrolls away with the rest of the panel's content.
  const categories = page.locator('.preset-categories button');
  const categoryCount = await categories.count();
  for (let index = 0; index < categoryCount; index += 1) {
    await expect(categories.nth(index)).toBeInViewport();
  }
  const categoryFontSize = await categories.first().evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize));
  expect(categoryFontSize).toBeGreaterThanOrEqual(10);

  // The shell used to grow past the viewport, which left the panel taller than the window with
  // nothing to scroll, so the styles below the fold were simply unreachable.
  const metrics = await panel.evaluate((node) => ({
    client: node.clientHeight,
    scroll: node.scrollHeight,
  }));
  expect(metrics.scroll).toBeGreaterThan(metrics.client);

  const scrolled = await panel.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
    return node.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(0);
  await expect(cards.nth(total - 1)).toBeInViewport();

  // Cards show a render from the real pipeline rather than a swatch gradient standing in for one.
  await expect(page.locator('.preset-preview img').first()).toBeVisible({ timeout: 15_000 });
  const distinct = await page.locator('.preset-preview img').evaluateAll((nodes) =>
    new Set(nodes.map((node) => (node as HTMLImageElement).src)).size);
  expect(distinct).toBeGreaterThan(4);
});

test('Fit zoom fits the artboard and is idempotent', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');

  const readZoom = async () => (await page.locator('.zoom-strip output').textContent())?.trim();
  const fit = page.getByRole('button', { name: 'Fit', exact: true });
  const fitsInViewport = () => page.evaluate(() => {
    const viewport = document.querySelector('.canvas-viewport');
    const wrap = document.querySelector('.artboard-wrap');
    if (!viewport || !wrap) throw new Error('Canvas viewport is unavailable');
    const styles = getComputedStyle(viewport);
    const availableWidth = viewport.clientWidth
      - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight);
    const availableHeight = viewport.clientHeight
      - Number.parseFloat(styles.paddingTop) - Number.parseFloat(styles.paddingBottom);
    const rect = wrap.getBoundingClientRect();
    return rect.width <= availableWidth + 1 && rect.height <= availableHeight + 1;
  });

  await fit.click();
  const fitted = await readZoom();
  // `.artboard-wrap` transitions its transform, so the rendered rect trails the committed zoom.
  await expect.poll(fitsInViewport).toBe(true);

  // Fit computes an absolute zoom, so clicking it again must be a no-op. Multiplying the current
  // zoom into the result instead compounds: it measured 124% then 154% then 254%, overflowing.
  await fit.click();
  expect(await readZoom()).toBe(fitted);
  await expect.poll(fitsInViewport).toBe(true);

  // And it has to reach the same answer from a different starting zoom, not a scaled one.
  for (let step = 0; step < 6; step += 1) await page.getByRole('button', { name: 'Zoom in' }).click();
  expect(await readZoom()).not.toBe(fitted);
  await fit.click();
  expect(await readZoom()).toBe(fitted);
  await expect.poll(fitsInViewport).toBe(true);
});

test('stops playback when the last animation track goes away', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.goto('./');

  const play = page.locator('.zoom-strip button[aria-pressed]').first();
  await page.getByRole('button', { name: 'Glitter Text' }).click();
  await expect(play).toBeEnabled();
  await play.click();
  await expect(play).toHaveAttribute('aria-pressed', 'true');

  // Swapping to a preset with no tracks disables the button. If playback is not stopped with it,
  // the loop keeps ticking behind a control the user can no longer reach to stop it.
  await page.getByRole('button', { name: 'Chrome Classic' }).click();
  await expect(play).toBeDisabled();
  await expect(play).toHaveAttribute('aria-pressed', 'false');
});

test('slash focuses the preset search even when the panel is closed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  // The panel can only be closed below 1051px -- that is where the toggle is shown and where the
  // workspace starts with it collapsed, so it is also the only width where this bug is reachable.
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.goto('./');

  const workspace = page.locator('.workspace');
  const search = page.locator('#preset-search');
  await expect(workspace).toHaveClass(/left-closed/);

  // A closed panel is `visibility: hidden` rather than unmounted, and hidden elements cannot take
  // focus. Focusing in the same tick as the toggle was therefore a silent no-op: the panel opened
  // and focus stayed on the body.
  await page.keyboard.press('/');
  await expect(workspace).not.toHaveClass(/left-closed/);
  await expect(search).toBeFocused();

  // And it still works when the panel is already open.
  await search.blur();
  await page.keyboard.press('/');
  await expect(search).toBeFocused();
});
