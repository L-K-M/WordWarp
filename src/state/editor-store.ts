import { create } from 'zustand';

import { documentStore } from './document-store';

export type EditorTool = 'select' | 'text' | 'warp' | 'gradient';

type ViewportMode = 'mobile' | 'tablet' | 'desktop';

const initialViewportMode = viewportMode(typeof window === 'undefined' ? 1200 : window.innerWidth);

/**
 * Style-rack sizing.
 *
 * The default width opens the rack on a three-across gallery of default-sized cards: three 186px
 * previews, two 14px gaps, 32px of panel padding, the 3px divider, and room for a 15px classic
 * scrollbar. Platforms with overlay scrollbars spend that last 15px on wider cards instead of
 * a fourth column, because the grid needs 638px of content before it takes one.
 */
export const RACK_MIN_WIDTH = 240;
export const RACK_DEFAULT_WIDTH = 636;
/** Sanity bound on the stored preference; the drawn width is limited by the window, below. */
const RACK_MAX_WIDTH = 1400;

/**
 * The canvas column's minimum plus the inspector's fixed width. The rack may take whatever the
 * window has beyond these two; `.workspace` re-applies the same limit in CSS so a window that
 * shrinks after the fact cannot leave the grid overflowing.
 */
const RESERVED_WORKSPACE_WIDTH = 712;

/**
 * Preview card widths, in CSS pixels, that the rack's size stepper walks through.
 *
 * A card is *at least* its step's width and then stretches to fill the row, so a step only shows
 * up as a size change when it also changes how many cards fit. These five are the widths at which
 * a default-width rack breaks to five, four, three, two and one across -- so at the width the rack
 * opens at, every press of the stepper visibly resizes the cards rather than doing nothing. A rack
 * dragged far from its default can still land two neighbouring steps on the same column count.
 */
export const PRESET_SIZES = [106, 136, 186, 286, 400] as const;
export const PRESET_SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL'] as const;
export const DEFAULT_PRESET_SIZE_STEP = 2;

/**
 * Two default-sized cards need 386px of grid, so a rack narrower than 436px once its padding,
 * divider and scrollbar are paid for can only show one -- stretched the full width of the panel,
 * which reads as a bug rather than a preview. That is a window of 1148px, below which the rack
 * opens one step down. A starting point only: a size the user picks is kept whatever the window
 * does afterwards.
 */
const NARROW_DESKTOP_WIDTH = 1148;
const NARROW_PRESET_SIZE_STEP = 1;

const RACK_WIDTH_KEY = 'wordwarp:rack-width';
const PRESET_SIZE_KEY = 'wordwarp:preset-size';

/** The widest the rack may be drawn in a window of this size without starving the canvas. */
export function maxRackWidth(viewportWidth: number): number {
  return Math.max(RACK_MIN_WIDTH, viewportWidth - RESERVED_WORKSPACE_WIDTH);
}

export function clampRackWidth(width: number, viewportWidth: number): number {
  if (!Number.isFinite(width)) return RACK_DEFAULT_WIDTH;
  return Math.round(Math.min(Math.max(width, RACK_MIN_WIDTH), maxRackWidth(viewportWidth)));
}

/**
 * What the *stored preference* is worth, which is not what a given window can draw.
 *
 * Clamping the preference to the window at startup instead lost it: opening the app on a tablet
 * pinned the rack to its 240px minimum -- and below 1051px the rack is an overlay whose width
 * costs the canvas nothing, so it went needlessly narrow. `.workspace` clamps the drawn width in
 * CSS, which is where the window belongs in this decision.
 */
export function clampRackPreference(width: number): number {
  if (!Number.isFinite(width)) return RACK_DEFAULT_WIDTH;
  return Math.round(Math.min(Math.max(width, RACK_MIN_WIDTH), RACK_MAX_WIDTH));
}

export function clampPresetSizeStep(step: number): number {
  if (!Number.isFinite(step)) return DEFAULT_PRESET_SIZE_STEP;
  return Math.min(Math.max(Math.round(step), 0), PRESET_SIZES.length - 1);
}

export function defaultPresetSizeStep(viewportWidth: number): number {
  return viewportWidth < NARROW_DESKTOP_WIDTH ? NARROW_PRESET_SIZE_STEP : DEFAULT_PRESET_SIZE_STEP;
}

interface EditorState {
  selectedElementId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  activeTool: EditorTool;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  viewportMode: ViewportMode;
  rackWidth: number;
  presetSizeStep: number;
  selectElement: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setActiveTool: (tool: EditorTool) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  syncPanelsForViewport: (width: number) => void;
  setRackWidth: (width: number) => void;
  resetRackWidth: () => void;
  stepPresetSize: (direction: -1 | 1) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedElementId: documentStore.getState().document.elements[0]?.id ?? null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  activeTool: 'select',
  leftPanelOpen: initialViewportMode === 'desktop',
  rightPanelOpen: initialViewportMode !== 'mobile',
  viewportMode: initialViewportMode,
  rackWidth: clampRackPreference(readStoredNumber(RACK_WIDTH_KEY) ?? RACK_DEFAULT_WIDTH),
  presetSizeStep: clampPresetSizeStep(
    readStoredNumber(PRESET_SIZE_KEY) ?? defaultPresetSizeStep(viewportWidth()),
  ),
  selectElement: (selectedElementId) => set({ selectedElementId }),
  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.1, zoom)) }),
  setPan: (x, y) => set({ pan: { x, y } }),
  setActiveTool: (activeTool) => set({ activeTool }),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  syncPanelsForViewport: (width) => set((state) => {
    const nextMode = viewportMode(width);
    if (nextMode === state.viewportMode) return state;
    return {
      viewportMode: nextMode,
      leftPanelOpen: nextMode === 'desktop',
      rightPanelOpen: nextMode !== 'mobile',
    };
  }),
  // Clamped against the live window rather than the stored preference, so the handle stays under
  // the pointer instead of running past the width CSS will actually draw. The preference itself is
  // kept as dragged: a wide window later gets the rack the user asked for back.
  setRackWidth: (width) => set(() => {
    const rackWidth = clampRackWidth(width, viewportWidth());
    storeNumber(RACK_WIDTH_KEY, rackWidth);
    return { rackWidth };
  }),
  // Reset stores the default itself, not what this window can draw of it. Clamping here would
  // mean a reset on a 1280px window remembered 568px and stayed there on a 1600px display -- the
  // preference is the intent, and CSS draws whatever fits.
  resetRackWidth: () => set(() => {
    const rackWidth = clampRackPreference(RACK_DEFAULT_WIDTH);
    storeNumber(RACK_WIDTH_KEY, rackWidth);
    return { rackWidth };
  }),
  stepPresetSize: (direction) => set((state) => {
    const presetSizeStep = clampPresetSizeStep(state.presetSizeStep + direction);
    if (presetSizeStep === state.presetSizeStep) return state;
    storeNumber(PRESET_SIZE_KEY, presetSizeStep);
    return { presetSizeStep };
  }),
}));

function viewportMode(width: number): ViewportMode {
  if (width <= 740) return 'mobile';
  if (width <= 1050) return 'tablet';
  return 'desktop';
}

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1200 : window.innerWidth;
}

function readStoredNumber(key: string): number | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Storage can be blocked outright by a privacy setting. A layout preference is not worth
    // failing to open the editor over.
    return null;
  }
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function storeNumber(key: string, value: number): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Full or blocked storage: the preference lasts the session instead of surviving a reload.
  }
}
