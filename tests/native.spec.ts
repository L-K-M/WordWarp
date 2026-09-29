import { expect, test, type Page } from '@playwright/test';
import { decode } from 'fast-png';
import { readFileSync } from 'node:fs';

import type { NativeEvent } from '../src/native/protocol';
import type { InspectorField, InspectorSection } from '../src/native/inspector';
import type { TextElement } from '../src/model/types';
import { createEffect } from '../src/effects/defaults';
import { BUILT_IN_PRESETS } from '../src/presets/library';

type NativeWindow = Window & {
  nativeEvents: NativeEvent[];
  wordwarp: { dispatch: (command: unknown) => void };
};

async function launch(page: Page, host: 'mac' | 'android' = 'mac') {
  await page.addInitScript((platform) => {
    const target = window as unknown as NativeWindow & {
      webkit: { messageHandlers: { wordwarp: { postMessage: (event: NativeEvent) => void } } };
      WordWarpAndroid: { postMessage: (value: string) => void };
    };
    target.nativeEvents = [];
    if (platform === 'mac') {
      target.webkit = { messageHandlers: { wordwarp: { postMessage: (event) => target.nativeEvents.push(event) } } };
    } else {
      target.WordWarpAndroid = { postMessage: (value) => target.nativeEvents.push(JSON.parse(value) as NativeEvent) };
    }
  }, host);
  await page.goto('/native.html');
  await expect.poll(() => events(page, 'ready')).toHaveLength(1);
}

async function events<T extends NativeEvent['type']>(page: Page, type: T) {
  return page.evaluate((kind) => (window as unknown as NativeWindow).nativeEvents.filter((event) => event.type === kind), type) as Promise<Extract<NativeEvent, { type: T }>[]>;
}

async function currentState(page: Page) {
  return page.evaluate(() => {
    const event = (window as unknown as NativeWindow).nativeEvents.findLast((event) => event.type === 'state' || event.type === 'ready');
    if (!event || !('state' in event)) throw new Error('The native bridge has not sent its state');
    return event.state;
  });
}

async function dispatch(page: Page, command: unknown) {
  await page.evaluate((value) => (window as unknown as NativeWindow).wordwarp.dispatch(value), command);
}

async function rendered(page: Page) {
  const state = await currentState(page);
  await expect.poll(async () => (await events(page, 'rendered')).at(-1)?.revision).toBe(state.revision);
  return state;
}

async function exportPng(page: Page, id: string, scale = 1) {
  await dispatch(page, { type: 'exportPng', id, scale });
  await expect.poll(async () => (await events(page, 'export')).some((event) => event.id === id)).toBe(true);
  const result = (await events(page, 'export')).find((event) => event.id === id);
  if (!result) throw new Error(`No PNG received for ${id}`);
  return result;
}

test('boots the complete native preset catalog with no web controls, network dependency, or service worker', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await launch(page);
  const [ready] = await events(page, 'ready');
  expect(ready.version).toBe(2);
  expect(ready.state).toMatchObject({ presetId: 'chrome-classic', canUndo: false, canRedo: false });
  expect(ready.state.text.length).toBeGreaterThan(0);
  expect(ready.presets.map((preset) => preset.id)).toEqual(BUILT_IN_PRESETS.map((preset) => preset.id));
  expect(ready.presets.find((preset) => preset.id === 'chrome-classic')?.name).toBe('Chrome Classic');
  expect(ready.stamps.length).toBeGreaterThan(40);
  expect(ready.effectKinds).toContainEqual({ value: 'bevel', label: 'Bevel' });
  expect(ready.animationKinds).toContainEqual({ value: 'pulse', label: 'Pulse' });
  await rendered(page);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('input, textarea, select')).toHaveCount(0);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((items) => items.length))).toBe(0);
  expect(requests.every((url) => new URL(url).origin === 'http://127.0.0.1:4174')).toBe(true);
  expect(requests.some((url) => /(?:sw\.js|manifest\.webmanifest)/.test(url))).toBe(false);
  expect(await events(page, 'error')).toEqual([]);
});

test('round-trips native text safely, preserves it when picking a preset, and supports undo and redo', async ({ page }) => {
  await launch(page);
  const original = await currentState(page);
  const text = 'Native "type" \\ test\n</script><b>🌈</b>';
  await dispatch(page, { type: 'setText', text });
  expect(await currentState(page)).toMatchObject({ text, canUndo: true, canRedo: false });
  await dispatch(page, { type: 'setPreset', presetId: 'gold-bar' });
  expect(await currentState(page)).toMatchObject({ text, presetId: 'gold-bar' });
  await dispatch(page, { type: 'undo' });
  expect(await currentState(page)).toMatchObject({ text, presetId: 'chrome-classic', canRedo: true });
  await dispatch(page, { type: 'undo' });
  expect(await currentState(page)).toMatchObject({ text: original.text, canUndo: false, canRedo: true });
  await dispatch(page, { type: 'redo' });
  expect(await currentState(page)).toMatchObject({ text, presetId: 'chrome-classic' });
  await dispatch(page, { type: 'setText', text: 'A different branch' });
  expect((await currentState(page)).canRedo).toBe(false);
  await rendered(page);
  await dispatch(page, { type: 'setText', text: '' });
  expect((await rendered(page)).text).toBe('');
  await dispatch(page, { type: 'setText', text: 'Type again' });
  expect((await rendered(page)).text).toBe('Type again');
  expect(await events(page, 'error')).toEqual([]);
});

test('coalesces rapid Android edits to the latest preview and exports a deterministic transparent PNG', async ({ page }) => {
  await launch(page, 'android');
  await page.evaluate(() => {
    const bridge = (window as unknown as NativeWindow).wordwarp;
    for (const text of ['N', 'Na', 'Nat', 'Nati', 'Native']) bridge.dispatch({ type: 'setText', text });
    bridge.dispatch({ type: 'setPreset', presetId: 'gold-bar' });
  });
  expect(await rendered(page)).toMatchObject({ text: 'Native', presetId: 'gold-bar' });
  const first = await exportPng(page, 'first');
  const second = await exportPng(page, 'second');
  expect(first.mimeType).toBe('image/png');
  expect(first.filename).toMatch(/\.png$/);
  expect(second.base64).toBe(first.base64);
  const image = decode(Buffer.from(first.base64, 'base64'));
  expect(image.channels).toBe(4);
  expect(image.width).toBe(first.width);
  expect(image.height).toBe(first.height);
  expect(image.width).toBeGreaterThan(100);
  expect(image.height).toBeGreaterThan(30);
  let visible = 0;
  let translucent = 0;
  let transparent = 0;
  for (let index = 3; index < image.data.length; index += 4) {
    const alpha = image.data[index];
    if (alpha === 0) transparent += 1;
    else if (alpha === 255) visible += 1;
    else translucent += 1;
  }
  expect(visible).toBeGreaterThan(100);
  expect(translucent).toBeGreaterThan(100);
  expect(transparent).toBeGreaterThan(100);
  expect(image.data[3]).toBe(0);
  const doubled = await exportPng(page, 'double', 2);
  expect(doubled.width).toBe(first.width * 2);
  expect(doubled.height).toBe(first.height * 2);
  expect(await events(page, 'error')).toEqual([]);
});

test('captures the document at export request time even when another edit arrives immediately', async ({ page }) => {
  await launch(page);
  await dispatch(page, { type: 'setText', text: 'Snapshot' });
  const baseline = await exportPng(page, 'baseline');
  await page.evaluate(() => {
    const bridge = (window as unknown as NativeWindow).wordwarp;
    bridge.dispatch({ type: 'exportPng', id: 'snapshot', scale: 1 });
    bridge.dispatch({ type: 'setText', text: 'Changed while exporting' });
  });
  await expect.poll(async () => (await events(page, 'export')).some((event) => event.id === 'snapshot')).toBe(true);
  expect((await events(page, 'export')).find((event) => event.id === 'snapshot')?.base64).toBe(baseline.base64);
  expect((await rendered(page)).text).toBe('Changed while exporting');
});

test('restores saved documents through validation and resets native undo history', async ({ page }) => {
  await launch(page);
  await dispatch(page, { type: 'setText', text: 'Saved native document' });
  await dispatch(page, { type: 'setPreset', presetId: 'gold-bar' });
  const saved = await currentState(page);
  await dispatch(page, { type: 'setText', text: 'Temporary change' });
  await dispatch(page, { type: 'restore', document: saved.document, presetId: saved.presetId });
  expect(await rendered(page)).toMatchObject({ text: saved.text, presetId: saved.presetId, canUndo: false, canRedo: false });
  const beforeInvalid = await currentState(page);
  const malformed = [null, {}, { ...saved.document, version: 999999 }, { ...saved.document, canvas: { ...saved.document.canvas, width: -1 } }];
  for (const document of malformed) {
    const count = (await events(page, 'error')).length;
    await dispatch(page, { type: 'restore', document, presetId: saved.presetId });
    await expect.poll(async () => (await events(page, 'error')).length).toBe(count + 1);
    expect(await currentState(page)).toEqual(beforeInvalid);
  }
  expect((await exportPng(page, 'after-invalid')).width).toBeGreaterThan(0);
});

test('reports rejected commands with export IDs and remains usable after failures', async ({ page }) => {
  await launch(page);
  const initial = await currentState(page);
  for (const command of [
    { type: 'setText', text: 'x'.repeat(5001) },
    { type: 'setPreset', presetId: 'missing-preset' },
    { type: 'exportPng', id: 'bad-scale', scale: 3 },
  ]) {
    const count = (await events(page, 'error')).length;
    await dispatch(page, command);
    await expect.poll(async () => (await events(page, 'error')).length).toBe(count + 1);
    expect(await currentState(page)).toEqual(initial);
  }
  expect((await events(page, 'error')).at(-1)).toMatchObject({ id: 'bad-scale', message: expect.any(String) });
  expect(await events(page, 'export')).toEqual([]);
  await dispatch(page, { type: 'setText', text: 'Recovered' });
  expect((await rendered(page)).text).toBe('Recovered');
  expect((await exportPng(page, 'recovered')).width).toBeGreaterThan(0);
});

function fields(sections: InspectorSection[]): InspectorField[] {
  return sections.flatMap((section) => [...section.fields, ...fields(section.children ?? [])]);
}

async function setField(page: Page, path: (string | number)[], value: unknown) {
  const state = await currentState(page);
  const field = fields(state.inspector).find((item) => JSON.stringify(item.path) === JSON.stringify(path));
  if (!field) throw new Error(`No inspector field at ${JSON.stringify(path)}`);
  await dispatch(page, { type: 'setField', fieldId: field.id, value });
}

test('manages text and stamp layers with locks, stable identities, ordering, and undo', async ({ page }) => {
  await launch(page);
  const originalId = (await currentState(page)).selectedElementId!;
  await dispatch(page, { type: 'addText' });
  const textId = (await currentState(page)).selectedElementId!;
  expect(textId).not.toBe(originalId);
  await dispatch(page, { type: 'setText', text: 'Second layer' });
  await dispatch(page, { type: 'addStamp', stampId: 'planet' });
  const stampId = (await currentState(page)).selectedElementId!;
  await dispatch(page, { type: 'setPreset', presetId: 'gold-bar' });
  let state = await currentState(page);
  expect(state.layers.map((layer) => layer.id)).toEqual([originalId, textId, stampId]);
  expect(state.document.elements[2]).toMatchObject({ type: 'shape', shape: 'planet' });
  expect(state.document.elements[2].effects.length).toBeGreaterThan(1);
  await dispatch(page, { type: 'layer', action: 'lock', elementId: stampId });
  const locked = await currentState(page);
  await setField(page, ['elements', 2, 'width'], 300);
  expect(await currentState(page)).toEqual(locked);
  expect((await events(page, 'error')).at(-1)?.message).toMatch(/unlock/i);
  await dispatch(page, { type: 'layer', action: 'visibility', elementId: stampId });
  expect((await currentState(page)).layers[2]).toMatchObject({ visible: false, locked: true });
  await dispatch(page, { type: 'layer', action: 'lock', elementId: stampId });
  await dispatch(page, { type: 'layer', action: 'duplicate', elementId: stampId });
  state = await currentState(page);
  const copyId = state.selectedElementId!;
  expect(copyId).not.toBe(stampId);
  expect(state.layers).toHaveLength(4);
  expect(state.document.elements[3].effects.map((effect) => effect.id)).not.toEqual(state.document.elements[2].effects.map((effect) => effect.id));
  await dispatch(page, { type: 'layer', action: 'back', elementId: copyId });
  expect((await currentState(page)).layers[0].id).toBe(copyId);
  await dispatch(page, { type: 'undo' });
  expect((await currentState(page)).layers[3].id).toBe(copyId);
  await dispatch(page, { type: 'layer', action: 'delete', elementId: copyId });
  expect((await currentState(page)).layers).toHaveLength(3);
  await dispatch(page, { type: 'select', elementId: textId });
  expect((await rendered(page)).text).toBe('Second layer');
});

test('edits native inspector fields, gradient stops and effect order through the safe field catalog', async ({ page }) => {
  await launch(page);
  await setField(page, ['elements', 0, 'layout', 'size'], 96);
  await setField(page, ['elements', 0, 'font', 'family'], 'Titan One');
  await setField(page, ['elements', 0, 'warp'], 'preset');
  await setField(page, ['elements', 0, 'warp', 'preset'], 'textWave1');
  await dispatch(page, { type: 'effect', action: 'add', kind: 'fill' });
  let state = await currentState(page);
  const effectIndex = state.document.elements[0].effects.length - 1;
  const effectId = state.document.elements[0].effects[effectIndex].id;
  await setField(page, ['elements', 0, 'effects', effectIndex, 'paint'], 'gradient');
  state = await currentState(page);
  const paintGroup = state.inspector.find((section) => section.id === 'effects')!.children!.find((section) => section.id === effectId)!.children![0];
  const addStop = paintGroup.actions!.find((action) => action.kind === 'addGradientStop')!;
  await dispatch(page, { type: 'inspectorAction', actionId: addStop.id });
  await setField(page, ['elements', 0, 'effects', effectIndex, 'paint', 'gradient', 'stops', 1, 'color'], [1, 0, 0.5, 0.4]);
  state = await currentState(page);
  const opacity = fields(state.inspector).find((item) => item.path.join('/') === `elements/0/effects/${effectIndex}/opacity`)!;
  await dispatch(page, { type: 'effect', action: 'down', effectId });
  await dispatch(page, { type: 'setField', fieldId: opacity.id, value: 0.6 });
  const changedEffect = (await currentState(page)).document.elements[0].effects.find((effect) => effect.id === effectId)!;
  expect(changedEffect).toMatchObject({ opacity: 0.6, paint: { kind: 'gradient', gradient: { stops: [
    { offset: 0 }, { offset: 0.5, color: [1, 0, 0.5, 0.4] }, { offset: 1 },
  ] } } });
  const beforeRejected = await currentState(page);
  for (const command of [
    { type: 'setField', fieldId: '__proto__/polluted', value: true },
    { type: 'setField', fieldId: opacity.id, value: 5 },
    { type: 'inspectorAction', actionId: 'delete-document' },
  ]) {
    await dispatch(page, command);
    expect(await currentState(page)).toEqual(beforeRejected);
  }
  await rendered(page);
  expect((await exportPng(page, 'inspector')).width).toBeGreaterThan(0);
});

test('saves complete documents, opens older migrated stamps, and starts a fresh document', async ({ page }) => {
  await launch(page);
  await dispatch(page, { type: 'setText', text: 'Persistent text' });
  await dispatch(page, { type: 'addStamp', stampId: 'star' });
  await dispatch(page, { type: 'getDocument', id: 'saved-file' });
  const saved = (await events(page, 'document')).find((event) => event.id === 'saved-file')!.document;
  expect(saved.elements).toHaveLength(2);
  await dispatch(page, { type: 'newDocument', id: 'fresh' });
  expect((await currentState(page)).layers).toHaveLength(1);
  expect((await currentState(page)).canUndo).toBe(false);
  expect((await events(page, 'restored')).at(-1)?.id).toBe('fresh');
  const legacy = { ...saved, version: 2, elements: saved.elements.map((element) => {
    if (element.type !== 'shape') return element;
    const { path: _path, ...oldShape } = element;
    void _path;
    return oldShape;
  }) };
  await dispatch(page, { type: 'restore', id: 'legacy-file', document: legacy });
  const restored = await rendered(page);
  expect(restored.document.version).toBe(3);
  expect(restored.document.elements[1]).toMatchObject({ type: 'shape', shape: 'star', path: null });
  expect(restored.text).toBe('Persistent text');
  expect(restored.canUndo).toBe(false);
  expect((await events(page, 'restored')).at(-1)?.id).toBe('legacy-file');
  expect(await events(page, 'error')).toEqual([]);
});

for (const host of ['mac', 'android'] as const) {
  test(`opens an Android-saved effect stack through the ${host} host's evaluated JavaScript bridge`, async ({ page }) => {
    // Captured from a real Android native save; only IDs, document name and timestamps changed.
    // Preserve its native JSON number values, effect order, font features and hidden locked stamp.
    const saved: unknown = JSON.parse(readFileSync(new URL('./fixtures/android-roundtrip.wordwarp.json', import.meta.url), 'utf8'));
    await launch(page, host);
    const command = JSON.stringify({ type: 'restore', id: 'android-file', document: saved }).replaceAll('/', '\\/');
    // WKWebView.evaluateJavaScript and Android.evaluateJavascript receive source text, whereas
    // the ordinary dispatch helper transfers a Playwright argument. Exercise the actual boundary.
    await page.evaluate(`window.wordwarp.dispatch(${command})`);
    await expect.poll(async () => (await events(page, 'restored')).some((event) => event.id === 'android-file')
      || (await events(page, 'error')).some((event) => event.id === 'android-file')).toBe(true);
    expect(await events(page, 'error')).toEqual([]);
    const restored = await rendered(page);
    expect(restored.document).toEqual(saved);
    expect(restored.layers).toHaveLength(3);
    expect(restored.layers[0]).toMatchObject({ type: 'shape', visible: false, locked: true });
    expect(restored.document.elements[1]).toMatchObject({ type: 'text', text: 'ANDROID PRO', animations: [{ kind: 'pulse', duration: 0.5 }] });
    await dispatch(page, { type: 'getDocument', id: 'resaved-file' });
    expect((await events(page, 'document')).find((event) => event.id === 'resaved-file')?.document).toEqual(saved);
    const png = await exportPng(page, 'reopened-artwork');
    expect(png.width).toBeGreaterThan(0);
    expect(png.height).toBeGreaterThan(0);
    expect([...Buffer.from(png.base64, 'base64').subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });
}

test('moves and resizes artwork with real canvas gestures, undoes each gesture, and pans without editing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await launch(page);
  await dispatch(page, { type: 'setText', text: 'Native' });
  await rendered(page);
  const original = (await currentState(page)).document.elements[0].transform;
  const outline = page.locator('.selection-outline');
  await expect(outline).toBeVisible();
  const box = (await outline.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await currentState(page)).document.elements[0].transform.x).toBeGreaterThan(original.x);
  await dispatch(page, { type: 'undo' });
  expect((await currentState(page)).document.elements[0].transform).toEqual(original);
  await rendered(page);
  const corner = page.locator('[data-handle="se"]');
  await expect(corner).toBeVisible();
  const handle = (await corner.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 35, handle.y + handle.height / 2 + 25, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await currentState(page)).document.elements[0].transform.scaleX).toBeGreaterThan(original.scaleX);
  await dispatch(page, { type: 'undo' });
  expect((await currentState(page)).document.elements[0].transform).toEqual(original);
  await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async () => (await currentState(page)).document.elements[0].transform.x).toBe(original.x + 10);
  await dispatch(page, { type: 'undo' });
  expect((await currentState(page)).document.elements[0].transform).toEqual(original);
  const beforePan = await currentState(page);
  await dispatch(page, { type: 'setView', tool: 'pan', zoom: 0.6 });
  await expect.poll(async () => (await events(page, 'view')).at(-1)?.view.zoom).toBe(0.6);
  const artboard = page.locator('.native-artboard-position');
  const left = await artboard.evaluate((element) => (element as HTMLElement).style.left);
  await page.mouse.move(200, 200);
  await page.mouse.down();
  await page.mouse.move(270, 235, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => artboard.evaluate((element) => (element as HTMLElement).style.left)).not.toBe(left);
  expect((await currentState(page)).document).toEqual(beforePan.document);
  await dispatch(page, { type: 'setView', tool: 'select', fit: true });
  await expect(page.locator('.native-viewport')).toHaveClass(/tool-select/);
  expect(await events(page, 'error')).toEqual([]);
});

test('releases every touch after a pinch crosses the viewport and keeps gesture undo available', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Real multitouch injection uses Chromium CDP.');
  await page.setViewportSize({ width: 1280, height: 900 });
  await launch(page, 'android');
  await dispatch(page, { type: 'setText', text: 'Native' });
  await rendered(page);
  const original = (await currentState(page)).document.elements[0].transform;
  const outline = page.locator('.selection-outline');
  await expect(outline).toBeVisible();
  const box = (await outline.boundingBox())!;
  const first = { id: 1, x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const second = { id: 2, x: first.x + 100, y: first.y + 80 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
  first.x += 15;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first] });
  await expect.poll(async () => (await currentState(page)).document.elements[0].transform.x).toBeGreaterThan(original.x);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] });
  await expect(page.locator('.selection-handle')).toHaveCount(0);

  // The first finger began an element drag. Starting a pinch must transfer that capture to the
  // viewport; otherwise moving/releasing outside it strands a stale pointer and future gestures.
  first.x = -40; first.y = -40;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [first, second] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [second] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await dispatch(page, { type: 'setView', fit: true });
  await dispatch(page, { type: 'undo' });
  expect((await currentState(page)).document.elements[0].transform).toEqual(original);
  await rendered(page);
  await expect(page.locator('[data-handle="se"]')).toBeVisible();

  const fresh = (await outline.boundingBox())!;
  const x = fresh.x + fresh.width / 2;
  const y = fresh.y + fresh.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 20, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await currentState(page)).document.elements[0].transform.x).toBeGreaterThan(original.x);
  await dispatch(page, { type: 'undo' });
  expect((await currentState(page)).document.elements[0].transform).toEqual(original);
  expect(await events(page, 'error')).toEqual([]);
});

test('previews animation and exports shared APNG/GIF frames plus higher-resolution PNG', async ({ page }) => {
  await launch(page, 'android');
  const doc = (await currentState(page)).document;
  doc.canvas = { width: 180, height: 120, autoFit: false, background: null, exportPadding: 8 };
  const text = doc.elements[0] as TextElement;
  text.text = 'Hi'; text.layout.size = 36;
  text.transform = { x: 90, y: 60, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, originX: 0.5, originY: 0.5 };
  text.effects = [createEffect('fill')];
  text.animations = [];
  await dispatch(page, { type: 'restore', document: doc });
  await dispatch(page, { type: 'animation', action: 'add', kind: 'pulse' });
  await setField(page, ['elements', 0, 'animations', 0, 'duration'], 1);
  await dispatch(page, { type: 'playback', playing: true });
  await expect.poll(async () => (await events(page, 'view')).at(-1)?.view.time ?? 0).toBeGreaterThan(0);
  await dispatch(page, { type: 'playback', playing: false, time: 0.25 });
  expect((await events(page, 'view')).at(-1)?.view).toMatchObject({ playing: false, time: 0.25, duration: 1 });
  for (const format of ['apng', 'gif'] as const) {
    await dispatch(page, { type: 'export', id: format, format, scale: 1, fps: 4 });
    await expect.poll(async () => (await events(page, 'export')).some((event) => event.id === format)).toBe(true);
    const result = (await events(page, 'export')).find((event) => event.id === format)!;
    expect(result).toMatchObject({ width: 180, height: 120, frameCount: 4, fps: 4, mimeType: `image/${format}` });
    const bytes = Buffer.from(result.base64, 'base64');
    if (format === 'apng') {
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const marker = bytes.indexOf(Buffer.from('acTL'));
      expect(marker).toBeGreaterThan(0);
      expect(bytes.readUInt32BE(marker + 4)).toBe(4);
    } else {
      expect(bytes.subarray(0, 6).toString()).toBe('GIF89a');
      expect(bytes.at(-1)).toBe(0x3b);
    }
    expect((await events(page, 'exportProgress')).filter((event) => event.id === format).at(-1)?.progress).toBe(1);
  }
  await dispatch(page, { type: 'export', id: 'large-png', format: 'png', scale: 3 });
  await expect.poll(async () => [
    ...await events(page, 'export'), ...await events(page, 'error'),
  ].some((event) => event.id === 'large-png')).toBe(true);
  expect((await events(page, 'error')).filter((event) => event.id === 'large-png')).toEqual([]);
  expect((await events(page, 'export')).find((event) => event.id === 'large-png')).toMatchObject({ width: 540, height: 360 });
  expect(await events(page, 'error')).toEqual([]);
});
