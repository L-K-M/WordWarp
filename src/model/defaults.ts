import { DOC_VERSION } from './types';
import type { FillEffect, TextElement, WordWarpDocument } from './types';

interface DefaultOptions {
  documentId?: string;
  elementId?: string;
  fillId?: string;
  now?: string;
}

const newId = (): string => crypto.randomUUID();

export function createDefaultFill(id = newId()): FillEffect {
  return {
    id,
    kind: 'fill',
    slot: 'body',
    enabled: true,
    opacity: 1,
    blendMode: 'normal',
    paint: {
      kind: 'gradient',
      gradient: {
        type: 'linear',
        stops: [
          { offset: 0, color: [0.96, 0.99, 1, 1] },
          { offset: 0.28, color: [0.29, 0.9, 1, 1] },
          { offset: 0.56, color: [0.13, 0.23, 0.52, 1] },
          { offset: 0.72, color: [1, 0.31, 0.78, 1] },
          { offset: 1, color: [1, 0.87, 0.32, 1] },
        ],
        angle: 90,
        center: [0.5, 0.5],
        scale: 1,
        dither: true,
        interpolation: 'oklab',
      },
    },
  };
}

export function createDefaultTextElement(id = newId(), fillId = newId()): TextElement {
  return {
    id,
    type: 'text',
    name: 'WordWarp',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: {
      x: 600,
      y: 315,
      rotation: -2,
      scaleX: 1,
      scaleY: 1,
      skewX: -7,
      skewY: 0,
      originX: 0.5,
      originY: 0.5,
    },
    effects: [createDefaultFill(fillId)],
    animations: [],
    text: 'WordWarp',
    font: {
      family: 'Arial Black',
      source: 'local',
      weight: 900,
      italic: false,
      features: { liga: true, kern: true },
    },
    layout: {
      size: 164,
      align: 'center',
      lineHeight: 1,
      letterSpacing: -0.055,
      wordSpacing: 0,
      transform: 'none',
      direction: 'ltr',
      curveSpacing: 'arc-length',
    },
    warp: {
      kind: 'none',
      adj: [0.5, 0.5],
      bend: 0,
      distortH: 0,
      distortV: 0,
      keepUpright: false,
    },
  };
}

export function createDefaultDocument(options: DefaultOptions = {}): WordWarpDocument {
  const now = options.now ?? new Date().toISOString();
  return {
    version: DOC_VERSION,
    id: options.documentId ?? newId(),
    name: 'Untitled warp',
    canvas: {
      width: 1200,
      height: 630,
      background: null,
      autoFit: true,
      exportPadding: 48,
    },
    elements: [createDefaultTextElement(options.elementId, options.fillId)],
    assets: {},
    globalLight: { angle: 120, altitude: 35 },
    meta: { created: now, modified: now, app: 'WordWarp/0.1' },
  };
}
