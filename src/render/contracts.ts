import type { Bounds } from '../geometry/bounds';

export interface RenderDiagnostic {
  elementId?: string;
  effectId?: string;
  severity: 'warning' | 'error';
  message: string;
}

export interface RenderResult {
  elementBounds: Map<string, Bounds>;
  diagnostics: RenderDiagnostic[];
}

export type RenderViewport = Bounds;
