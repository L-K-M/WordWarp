import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clampPresetSizeStep,
  clampRackPreference,
  clampRackWidth,
  DEFAULT_PRESET_SIZE_STEP,
  defaultPresetSizeStep,
  maxRackWidth,
  PRESET_SIZE_LABELS,
  PRESET_SIZES,
  RACK_DEFAULT_WIDTH,
  RACK_MIN_WIDTH,
  useEditorStore,
} from './editor-store';

const initialRackWidth = useEditorStore.getState().rackWidth;
const initialPresetSizeStep = useEditorStore.getState().presetSizeStep;

afterEach(() => {
  useEditorStore.setState({ rackWidth: initialRackWidth, presetSizeStep: initialPresetSizeStep });
  vi.unstubAllGlobals();
});

describe('rack width', () => {
  it('leaves the canvas and inspector their space', () => {
    // 712px is the canvas column's 360px minimum plus the inspector's 352px. A rack wider than
    // the remainder would push the workspace grid past the window.
    expect(maxRackWidth(1440)).toBe(1440 - 712);
    expect(clampRackWidth(2000, 1440)).toBe(728);
  });

  it('never collapses below the minimum, even in a window too small to hold it', () => {
    expect(clampRackWidth(10, 1440)).toBe(RACK_MIN_WIDTH);
    // The tablet layout takes over well before this, but the clamp must not invert and return a
    // negative width if it is ever asked about a narrow window.
    expect(maxRackWidth(600)).toBe(RACK_MIN_WIDTH);
    expect(clampRackWidth(400, 600)).toBe(RACK_MIN_WIDTH);
  });

  it('falls back to the default rather than propagating a non-finite width', () => {
    expect(clampRackWidth(Number.NaN, 1440)).toBe(RACK_DEFAULT_WIDTH);
    expect(clampRackPreference(Number.NaN)).toBe(RACK_DEFAULT_WIDTH);
  });

  it('keeps a stored preference the current window cannot draw', () => {
    // Below 1051px the rack is an overlay and its width costs the canvas nothing, so opening the
    // app on a tablet must not shrink the remembered width to that window's desktop allowance --
    // which would have pinned it to the 240px minimum.
    expect(clampRackPreference(RACK_DEFAULT_WIDTH)).toBe(RACK_DEFAULT_WIDTH);
    expect(clampRackWidth(RACK_DEFAULT_WIDTH, 900)).toBe(RACK_MIN_WIDTH);
    expect(clampRackPreference(99_999)).toBeLessThan(2000);
  });

  it('opens wide enough for three default cards plus the panel\'s own chrome', () => {
    const gridWidth = 3 * PRESET_SIZES[DEFAULT_PRESET_SIZE_STEP] + 2 * 14;
    const chrome = 2 * 16 + 3 + 15; // padding, the divider, and a classic scrollbar
    expect(RACK_DEFAULT_WIDTH).toBe(gridWidth + chrome);
  });

  it('rounds what a drag reports so the width never carries subpixels', () => {
    vi.stubGlobal('window', { innerWidth: 1600 });
    useEditorStore.getState().setRackWidth(503.4);
    expect(useEditorStore.getState().rackWidth).toBe(503);
  });

  it('clamps a drag against the live window', () => {
    vi.stubGlobal('window', { innerWidth: 1280 });
    useEditorStore.getState().setRackWidth(900);
    expect(useEditorStore.getState().rackWidth).toBe(1280 - 712);
  });

  it('restores the default width on reset', () => {
    vi.stubGlobal('window', { innerWidth: 1600 });
    useEditorStore.getState().setRackWidth(400);
    useEditorStore.getState().resetRackWidth();
    expect(useEditorStore.getState().rackWidth).toBe(RACK_DEFAULT_WIDTH);
  });

  it('resets to the full default even in a window too narrow to draw it', () => {
    // Storing the window-clamped default instead would follow the user to their next display: a
    // reset on a 1280px laptop remembered 568px and stayed there on a 1600px monitor.
    vi.stubGlobal('window', { innerWidth: 1280 });
    expect(maxRackWidth(1280)).toBeLessThan(RACK_DEFAULT_WIDTH);
    useEditorStore.getState().setRackWidth(300);
    useEditorStore.getState().resetRackWidth();
    expect(useEditorStore.getState().rackWidth).toBe(RACK_DEFAULT_WIDTH);
  });
});

describe('preview size', () => {
  it('labels every size', () => {
    expect(PRESET_SIZE_LABELS).toHaveLength(PRESET_SIZES.length);
  });

  it('defaults to a card 40% wider than the two-across rack used to show', () => {
    // The old rack was a fixed 312px with two fixed columns, which worked out to 133px a card.
    expect(PRESET_SIZES[DEFAULT_PRESET_SIZE_STEP]).toBe(186);
    expect(186 / 133).toBeGreaterThan(1.39);
  });

  it('gives every step its own column count in a default-width rack', () => {
    // A step that lands on the column count of its neighbour cannot change the card size, because
    // the cards stretch to fill the row either way -- the stepper would look broken.
    const content = RACK_DEFAULT_WIDTH - 2 * 16 - 3 - 15;
    const columns = PRESET_SIZES.map((size) => Math.floor((content + 14) / (size + 14)));
    expect(columns).toEqual([5, 4, 3, 2, 1]);
  });

  it('stops at both ends instead of wrapping round', () => {
    const { stepPresetSize } = useEditorStore.getState();
    for (let index = 0; index < PRESET_SIZES.length + 2; index += 1) stepPresetSize(1);
    expect(useEditorStore.getState().presetSizeStep).toBe(PRESET_SIZES.length - 1);
    for (let index = 0; index < PRESET_SIZES.length + 2; index += 1) stepPresetSize(-1);
    expect(useEditorStore.getState().presetSizeStep).toBe(0);
  });

  it('rejects a stored step that no longer names a size', () => {
    expect(clampPresetSizeStep(99)).toBe(PRESET_SIZES.length - 1);
    expect(clampPresetSizeStep(-3)).toBe(0);
    expect(clampPresetSizeStep(Number.NaN)).toBe(DEFAULT_PRESET_SIZE_STEP);
  });

  it('opens one step down where a rack cannot hold two default cards', () => {
    const chrome = 2 * 16 + 3 + 15; // padding, the divider, and a classic scrollbar
    const twoAcross = (step: number) => 2 * (PRESET_SIZES[step] ?? 0) + 14 + chrome;

    // A 1100px window leaves the rack 388px, which is short of the 436px two default cards want.
    expect(defaultPresetSizeStep(1100)).toBe(1);
    expect(twoAcross(defaultPresetSizeStep(1100))).toBeLessThanOrEqual(maxRackWidth(1100));
    expect(twoAcross(DEFAULT_PRESET_SIZE_STEP)).toBeGreaterThan(maxRackWidth(1100));

    // And the moment two do fit, the rack opens at the default size again.
    expect(defaultPresetSizeStep(1148)).toBe(DEFAULT_PRESET_SIZE_STEP);
    expect(twoAcross(DEFAULT_PRESET_SIZE_STEP)).toBeLessThanOrEqual(maxRackWidth(1148));
    expect(defaultPresetSizeStep(1440)).toBe(DEFAULT_PRESET_SIZE_STEP);
  });
});
