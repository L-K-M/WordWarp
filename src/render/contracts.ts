import type { Bounds } from '../geometry/bounds';
import type { ElementFrame } from '../geometry/handles';

export interface RenderDiagnostic {
  elementId?: string;
  effectId?: string;
  severity: 'warning' | 'error';
  message: string;
}

export interface RenderResult {
  /**
   * Each drawn element's own box and the matrix that placed it.
   *
   * The frame rather than the bounding rectangle it works out to, because on-canvas manipulation
   * needs the box the element was actually drawn in: a rotated word's bounding rectangle is
   * bigger than the word and shares none of its edges, so handles hung off it would sit nowhere
   * near the thing they resize. `transformBounds` recovers the rectangle when that is all a
   * caller wants.
   */
  elementFrames: Map<string, ElementFrame>;
  diagnostics: RenderDiagnostic[];
}

export type RenderViewport = Bounds;
