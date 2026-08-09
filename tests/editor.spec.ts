import { readFile } from 'node:fs/promises';

import { expect, test } from '@playwright/test';
import { decode } from 'fast-png';
import { deflateSync, strToU8 } from 'fflate';

import { STAMP_IDS } from '../src/model/types';

test('picks a bundled display font and still exports a PNG', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.goto('./');

  const picker = page.getByRole('button', { name: /Font family/ });
  await expect(picker).toContainText('Arial Black');
  await picker.click();

  const bungee = page.getByRole('option', { name: 'Bungee' });
  await expect(bungee).toBeVisible();
  await bungee.click();
  await expect(picker).toContainText('Bungee');
  await expect(page.locator('.render-error')).toHaveCount(0);

  // The worker export path registers the same bundled face in its own font set.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export PNG/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.png$/);
});

test('edits text, applies a preset, and exports transparent PNG', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'WordWarp Your Gooey Type Lab' })).toBeVisible();

  const content = page.getByLabel('Content');
  await content.fill('Chrome test');
  await page.getByRole('button', { name: 'Gold Bar' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('.layer-main').filter({ hasText: 'Chrome test' })).toBeVisible();

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

test('places a stamp, styles it from the rack, and exports it over a background', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'WordWarp Your Gooey Type Lab' })).toBeVisible();

  await page.getByRole('button', { name: 'Stamp', exact: true }).click();
  await page.locator('.stamp-choice', { hasText: /^Bolt$/ }).click();

  // Placing a stamp selects it, and the inspector should be showing stamp controls rather than
  // the text ones -- the two share a panel, so this is what proves the branch switched.
  await expect(page.getByLabel('Shape')).toHaveValue('bolt');
  await expect(page.locator('.layer-main').filter({ hasText: 'Bolt' })).toBeVisible();

  // A style from the rack has to land on a decoration the same way it lands on a word. Memphis
  // Confetti carries a warp that a stamp has no use for; applying it must not throw.
  await page.locator('#preset-search').fill('Memphis Confetti');
  await page.locator('.preset-card').first().click();
  await expect(page.locator('.effect-list li')).not.toHaveCount(0);

  // A background turns the export opaque and stops it cropping to the artwork, so the exported
  // frame should now be the full canvas rather than a tight crop around the content.
  await page.locator('.background-swatch', { hasText: 'Violet' }).click();
  await expect(page.locator('.canvas-status')).toContainText('GROUND');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export PNG/ }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Playwright did not provide the downloaded PNG path');
  const image = decode(await readFile(downloadPath));
  expect(image.width).toBe(2400);
  expect(image.height).toBe(1260);

  // Every pixel is opaque with a background set, and the corner is the ground colour rather than
  // anything the artwork put there.
  expect(image.data[3]).toBe(255);
  expect([image.data[0], image.data[1], image.data[2]]).toEqual([0x5b, 0x5b, 0xd6]);
});

test('groups the stamp menu by theme and places a pierced figure at its own proportion', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'WordWarp Your Gooey Type Lab' })).toBeVisible();

  await page.getByRole('button', { name: 'Stamp', exact: true }).click();
  const menu = page.locator('#stamp-menu');
  // Themed sections, not one wall of fifty-two icons. The panel scrolls, so the later sections
  // only exist below the fold -- which is what the count is really checking.
  await expect(menu.locator('.stamp-group')).toHaveCount(7);
  await expect(menu.getByRole('heading', { name: 'Spooky' })).toBeAttached();
  await expect(menu.getByRole('heading', { name: 'Cosmic' })).toBeAttached();

  await menu.locator('.stamp-choice', { hasText: /^Planet$/ }).click();
  await expect(page.getByLabel('Shape')).toHaveValue('planet');

  // A ringed planet is much wider than it is tall, and stamps are stretched to whatever box they
  // are given -- so placement has to hand it a box of its own proportion or it arrives as an egg.
  const width = Number(await page.locator('.range-field', { hasText: 'Width' }).locator('output').innerText());
  const height = Number(await page.locator('.range-field', { hasText: 'Height' }).locator('output').innerText());
  expect(width).toBeGreaterThan(height * 1.3);

  // The face is cut out of the fill, so the figure has to survive the effect stack as geometry
  // rather than as a picture: applying a style must leave the stamp rendering without error.
  await page.locator('#preset-search').fill('Nebula');
  await page.locator('.preset-card').first().click();
  await expect(page.locator('.effect-list li')).not.toHaveCount(0);
  await expect(page.locator('.render-error')).toHaveCount(0);
});

test.describe('expanded stamp picker', () => {
  test.describe('desktop', () => {
    test.skip(({ browserName, isMobile }) => browserName !== 'chromium' || isMobile, 'Desktop Chromium only');

    test('reaches the final item and restores trigger focus', async ({ page }) => {
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto('./');
      const trigger = page.getByRole('button', { name: 'Stamp', exact: true });
      await trigger.click();
      const menu = page.getByRole('group', { name: 'Place a stamp' });
      await expect(menu.locator('.stamp-choice')).toHaveCount(STAMP_IDS.length);
      const butterfly = menu.locator('.stamp-choice', { hasText: /^Butterfly$/ });
      await butterfly.scrollIntoViewIfNeeded();
      expect(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await butterfly.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return hit === element || element.contains(hit);
      })).toBe(true);
      await butterfly.click();
      await expect(trigger).toBeFocused();
      await expect(page.getByLabel('Shape')).toHaveValue('butterfly');

      await trigger.click();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(page.getByLabel('Shape')).toHaveValue('butterfly');
    });
  });

  test.describe('mobile', () => {
    test.skip(({ isMobile }) => !isMobile, 'Mobile projects only');

    test('keeps every theme reachable', async ({ page }) => {
      await page.goto('./');
      const trigger = page.getByRole('button', { name: 'Stamp', exact: true });
      await trigger.click();
      const menu = page.getByRole('group', { name: 'Place a stamp' });
      const butterfly = menu.locator('.stamp-choice', { hasText: /^Butterfly$/ });
      await expect(menu.locator('.stamp-choice')).toHaveCount(STAMP_IDS.length);
      await page.getByRole('button', { name: 'Inspect' }).click();
      await expect(page.getByLabel('Inspector')).toBeVisible();
      await butterfly.scrollIntoViewIfNeeded();
      expect(await menu.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
      expect(await butterfly.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return hit === element || element.contains(hit);
      })).toBe(true);
      await butterfly.click();
      await expect(trigger).toBeFocused();
      await expect(page.getByLabel('Shape')).toHaveValue('butterfly');
    });

    test('shows one complete choice in short landscape', async ({ page }) => {
      await page.setViewportSize({ width: 568, height: 320 });
      await page.goto('./');
      await page.getByRole('button', { name: 'Stamp', exact: true }).click();
      const menu = page.getByRole('group', { name: 'Place a stamp' });
      const choice = menu.locator('.stamp-choice').first();
      const [menuBounds, choiceBounds] = await Promise.all([menu.boundingBox(), choice.boundingBox()]);
      expect(menuBounds).not.toBeNull();
      expect(choiceBounds).not.toBeNull();
      expect(choiceBounds!.y + choiceBounds!.height).toBeLessThanOrEqual(menuBounds!.y + menuBounds!.height);
      expect(choiceBounds!.y + choiceBounds!.height).toBeLessThanOrEqual(320);
    });
  });
});

test('outlines the element box itself rather than a rectangle around it', async ({ page }) => {
  await page.goto('./');

  const overlay = page.locator('.selection-overlay');
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  await expect(overlay).toHaveCSS('pointer-events', 'none');

  const layers = overlay.locator('polygon');
  await expect(layers).toHaveClass(['selection-underlay', 'selection-outline']);
  const outlines = await layers.evaluateAll((shapes) => shapes.map((shape) => shape.getAttribute('points')));
  expect(outlines[0]).toEqual(outlines[1]);

  // The default word is rotated and slanted, so its box is a turned quad. An axis-aligned outline
  // would sit off the artwork, and the handles hung on its corners would sit off it with it.
  const corners = outlines[0]!.split(' ').map((pair) => pair.split(',').map(Number));
  expect(new Set(corners.map((corner) => corner[0])).size).toBe(4);
  expect(new Set(corners.map((corner) => corner[1])).size).toBe(4);

  await expect(layers.nth(0)).toHaveCSS('stroke', 'rgb(7, 16, 24)');
  await expect(layers.nth(0)).toHaveCSS('stroke-dasharray', 'none');
  await expect(layers.nth(0)).toHaveCSS('stroke-width', '4px');
  await expect(layers.nth(0)).toHaveCSS('vector-effect', 'non-scaling-stroke');
  await expect(layers.nth(1)).toHaveCSS('stroke', 'rgb(72, 228, 255)');
  await expect(layers.nth(1)).toHaveCSS('stroke-dasharray', /8px.*5px/);
  await expect(layers.nth(1)).toHaveCSS('stroke-width', '2px');
  await expect(layers.nth(1)).toHaveCSS('vector-effect', 'non-scaling-stroke');

  // The outline itself stays inert, so a drag on the element's edge still moves the element. The
  // corner handles are the part of the overlay that takes the pointer, and unlike the secondary
  // ones they are never dropped, however little room the box has.
  await expect(overlay.locator('[data-handle="se"]')).toHaveCSS('pointer-events', 'all');
  for (const corner of ['nw', 'ne', 'se', 'sw']) {
    await expect(overlay.locator(`[data-handle="${corner}"]`)).toHaveCount(1);
  }
});

test('resizes, slants and rotates the selection from its handles', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'WordWarp Your Gooey Type Lab' })).toBeVisible();

  // Eight resize handles, one rotate knob and the two slants -- one per degree of freedom the
  // transform has, all of them on screen at once rather than behind a mode.
  await expect(page.locator('.selection-handle')).toHaveCount(11);
  await expect(page.locator('[data-handle="rotate"] .handle-glyph')).toHaveCSS('fill', 'rgb(182, 255, 90)');
  await expect(page.locator('[data-handle="skew-x"] .handle-glyph')).toHaveCSS('fill', 'rgb(255, 95, 176)');

  // Rotation, Scale X, Scale Y, Slant X, Slant Y -- the numeric twins of the handles, and the
  // only place a gesture's result can be read exactly.
  const readout = () => page.locator('.transform-section output').allTextContents();
  const dragHandle = async (id: string, byX: number, byY: number) => {
    const box = (await page.locator(`[data-handle="${id}"]`).boundingBox())!;
    const fromX = box.x + box.width / 2;
    const fromY = box.y + box.height / 2;
    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(fromX + byX, fromY + byY, { steps: 8 });
    await page.mouse.up();
  };

  const start = await readout();
  expect(start).toHaveLength(5);

  // Dragging the bottom-right corner away from the top-left one grows both axes.
  await dragHandle('se', 90, 50);
  const resized = await readout();
  expect(Number(resized[1])).toBeGreaterThan(Number(start[1]));
  expect(Number(resized[2])).toBeGreaterThan(Number(start[2]));

  // Sliding the bottom edge to the right is exactly what a horizontal slant does to the geometry.
  await dragHandle('skew-x', 60, 0);
  const slanted = await readout();
  expect(Number(slanted[3])).toBeGreaterThan(Number(resized[3]));

  await dragHandle('rotate', 70, 40);
  const rotated = await readout();
  expect(Number(rotated[0])).not.toBe(Number(slanted[0]));

  // One transaction per gesture: three drags of many pointer moves each undo in three presses.
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Z');
  await page.keyboard.press('Control+Z');
  await expect.poll(readout).toEqual(start);

  // Dragging a corner past its anchor mirrors an element, so mirroring needs a keyboard-reachable
  // twin as well. The slider carries the magnitude and Flip carries the sign.
  const flipX = page.getByRole('button', { name: 'Flip X' });
  await flipX.click();
  await expect(flipX).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number((await readout())[1])).toBeLessThan(0);
});

test('keeps hold of a gesture whose handle is dropped under the pointer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.locator('[data-handle="n"]')).toHaveCount(1);

  const artboard = (await page.locator('.render-artboard').boundingBox())!;
  const outline = () => page.locator('.selection-outline').getAttribute('points');
  const before = await outline();

  // Squashing the box far enough takes the edge handles away with it, including the one being
  // dragged. Releasing clear of the artboard then leaves nothing under the pointer to notice --
  // unless the capture is held somewhere that outlives the handle.
  const top = (await page.locator('[data-handle="n"]').boundingBox())!;
  const bottom = (await page.locator('[data-handle="s"]').boundingBox())!;
  await page.mouse.move(top.x + top.width / 2, top.y + top.height / 2);
  await page.mouse.down();
  // Stop just short of the bottom edge, which is this handle's anchor. Going past it would mirror
  // the element and make the box tall enough to hold its handles again.
  await page.mouse.move(top.x + top.width / 2, bottom.y + bottom.height / 2 - 3, { steps: 10 });
  await expect(page.locator('[data-handle="n"]')).toHaveCount(0);
  await page.mouse.move(top.x + top.width / 2, artboard.y + artboard.height + 90, { steps: 6 });
  await page.mouse.up();

  // Undo is refused outright while a transaction is open, so getting the box back proves the
  // gesture closed. A fresh drag afterwards proves the drag state cleared with it.
  await page.keyboard.press('Control+Z');
  await expect.poll(outline).toBe(before);

  const centreX = artboard.x + artboard.width / 2;
  const centreY = artboard.y + artboard.height / 2;
  await page.mouse.move(centreX, centreY);
  await page.mouse.down();
  await page.mouse.move(centreX + 50, centreY, { steps: 6 });
  await page.mouse.up();
  await expect.poll(outline).not.toBe(before);
});

test('moves the element by dragging its body, and locks the drag to an axis with Shift', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.locator('.selection-outline')).toBeVisible();

  const box = (await page.locator('.render-artboard canvas').boundingBox())!;
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  const topLeft = async () => {
    const points = (await page.locator('.selection-outline').getAttribute('points'))!;
    return points.split(' ')[0].split(',').map(Number) as [number, number];
  };
  const drag = async (fromX: number, byX: number, byY: number) => {
    await page.mouse.move(fromX, centreY);
    await page.mouse.down();
    await page.mouse.move(fromX + byX, centreY + byY, { steps: 6 });
    await page.mouse.up();
  };

  const before = await topLeft();
  await drag(centreX, 60, 0);
  const moved = await topLeft();
  expect(moved[0]).toBeGreaterThan(before[0]);

  // Shift keeps a move on the axis the pointer travelled furthest along, so this one changes x
  // and leaves y exactly where it was.
  await page.keyboard.down('Shift');
  await drag(centreX + 60, 60, 40);
  await page.keyboard.up('Shift');
  const locked = await topLeft();
  expect(locked[0]).toBeGreaterThan(moved[0]);
  expect(locked[1]).toBeCloseTo(moved[1], 3);
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

test('ignores canvas shortcuts on a focused button while preserving undo and redo', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.goto('./');

  const layers = page.locator('.layer-list .layer-main');
  const addLayer = page.getByRole('button', { name: 'Add text layer' });
  await expect(layers).toHaveCount(1);
  await addLayer.click();
  await expect(layers).toHaveCount(2);

  const exportButton = page.getByRole('button', { name: /Export PNG/ });
  await exportButton.focus();
  await expect(exportButton).toBeFocused();
  await page.keyboard.press('Delete');
  await page.keyboard.press('Backspace');
  await expect(layers).toHaveCount(2);

  await page.keyboard.press('Control+Z');
  await expect(layers).toHaveCount(1);
  await page.keyboard.press('Control+Shift+Z');
  await expect(layers).toHaveCount(2);
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

// The test above shrinks the text to a single 48px glyph, which is what let the frame budget ship
// too small to pay for the app's own defaults. A new document already carries one text layer and
// exports at 1776 x 676 at the default 2x resolution; 24 frames of that came to 110 MB against a
// 64 MB ceiling, so every animated export failed on the first press of the button. The second
// layer here is the shape the bug was reported in and pushes it to 1776 x 720 -- both sizes were
// over. What matters is that no export control is touched beyond picking the format.
test('exports an animation of the default document at the default resolution', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  // 24 frames at 1776 x 676 measures ~33 s locally, so this is roughly a 3x margin rather than a
  // number picked for comfort. It matches the animation test above deliberately.
  test.setTimeout(120_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'Add text layer' }).click();

  await page.getByLabel('Export format').selectOption('gif');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export GIF/ }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('Playwright did not provide the downloaded GIF path');
  const bytes = await readFile(downloadPath);
  expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
  expect(bytes.at(-1)).toBe(0x3b);
  // The default 2 s loop at the exporter's 12 fps, at full rate: the budget must not be quietly
  // buying its way out of this by dropping frames either. The frame count alone implies that today
  // -- a reduction always lowers it -- but say it outright, so a reduction that ever kept the count
  // and took something else instead still fails here.
  await expect(page.getByText('Exported 24-frame GIF').first()).toBeVisible();
  await expect(page.getByText(/down from \d+ fps/)).toHaveCount(0);
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
    await expect(page.getByRole('button', { name: 'WordWarp Your Gooey Type Lab' })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('uses the configured PWA base path', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.goto('./');

  const expectedUrl = new URL('./', page.url()).href;
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
      href,
      id: resolve(record.id),
      scope: resolve(record.scope),
      start_url: resolve(record.start_url),
    };
  });
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);

  expect(new URL(manifest.id ?? '', manifest.href).href).toBe(expectedUrl);
  expect(new URL(manifest.scope ?? '', manifest.href).href).toBe(expectedUrl);
  expect(new URL(manifest.start_url ?? '', manifest.href).href).toBe(expectedUrl);
  expect(scope).toBe(expectedUrl);
});

test('style library scrolls to every preset and previews the real render', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'WordWarp Your Gooey Type Lab' })).toBeVisible();

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

test('the style rack opens three across and resizes by pointer and keyboard', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('./');

  const columnCount = () => page.locator('.preset-grid').evaluate((node) =>
    getComputedStyle(node).gridTemplateColumns.split(' ').length);
  const rackWidth = () => page.locator('.preset-panel').evaluate((node) =>
    Math.round(node.getBoundingClientRect().width));
  const noOverflow = () => page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth);

  expect(await columnCount()).toBe(3);
  const defaultWidth = await rackWidth();

  // Dragging the splitter widens the rack, and the extra room becomes another column rather than
  // wider cards -- the size stepper owns card width, the handle owns how many fit.
  const handle = page.locator('.rack-resizer');
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, 400);
  await page.mouse.down();
  await page.mouse.move(860, 400, { steps: 10 });
  await page.mouse.up();
  await expect.poll(rackWidth).toBe(860);
  expect(await columnCount()).toBe(4);
  expect(await noOverflow()).toBe(true);

  // Arrow keys drive the splitter. They must not also reach the canvas, where they nudge the
  // selected element: the shortcut handler treats a focusable separator as its own control.
  const selectionBefore = await page.locator('.selection-outline').getAttribute('points');
  await handle.focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect.poll(rackWidth).toBe(812);
  expect(await page.locator('.selection-outline').getAttribute('points')).toBe(selectionBefore);

  // The width outlives a reload, and double-clicking the handle puts it back.
  await page.reload();
  await expect(page.locator('.preset-card').first()).toBeVisible();
  expect(await rackWidth()).toBe(812);
  await handle.dblclick();
  await expect.poll(rackWidth).toBe(defaultWidth);
});

test('the first arrow key moves a rack carried over from a wider display', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  // A width set on a big monitor, reopened on a laptop. CSS draws what fits, and the stored
  // preference survives for the next wide window -- but stepping from the remembered width spent
  // the first keypress travelling back down to what was already on screen, moving nothing.
  await page.addInitScript(() => localStorage.setItem('wordwarp:rack-width', '900'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./');

  const rackWidth = () => page.locator('.preset-panel').evaluate((node) =>
    Math.round(node.getBoundingClientRect().width));
  const drawn = await rackWidth();
  expect(drawn).toBe(1280 - 712);

  await page.locator('.rack-resizer').focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(rackWidth).toBe(drawn - 24);
});

test('the preview size stepper resizes style cards and stops at both ends', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium');
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('./');

  const cardWidth = () => page.locator('.preset-card').first().evaluate((node) =>
    Math.round(node.getBoundingClientRect().width));
  const smaller = page.getByRole('button', { name: 'Smaller previews' });
  const larger = page.getByRole('button', { name: 'Larger previews' });
  const readout = page.locator('.preset-size-controls output');

  await expect(readout).toHaveText('M');
  const defaultCard = await cardWidth();
  // 40% wider than the 133px card the old two-across rack showed at a fixed 312px.
  expect(defaultCard).toBeGreaterThanOrEqual(186);

  await larger.click();
  await expect(readout).toHaveText('L');
  expect(await cardWidth()).toBeGreaterThan(defaultCard);

  await smaller.click();
  await smaller.click();
  await expect(readout).toHaveText('S');
  expect(await cardWidth()).toBeLessThan(defaultCard);

  await smaller.click();
  await expect(readout).toHaveText('XS');
  await expect(smaller).toBeDisabled();

  // The choice is a preference, so it survives a reload.
  await page.reload();
  await expect(page.locator('.preset-size-controls output')).toHaveText('XS');
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
