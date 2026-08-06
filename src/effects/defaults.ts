import { createId } from '../lib/id';
import type { Effect, Paint } from '../model/types';

export type EffectKind = Effect['kind'];

const linearContour = [0, 0.25, 0.5, 0.75, 1];
const contour = () => [...linearContour];
const white: Paint = { kind: 'solid', color: [1, 1, 1, 1] };

const base = <Kind extends EffectKind>(kind: Kind, slot: Effect['slot']) => ({
  id: createId(),
  kind,
  slot,
  enabled: true,
  opacity: 1,
  blendMode: 'normal' as const,
});

export function createEffect(kind: EffectKind): Effect {
  if (kind === 'fill') return { ...base(kind, 'body'), paint: white };
  if (kind === 'stroke') {
    return {
      ...base(kind, 'front'),
      width: 5,
      position: 'outside',
      paint: white,
      join: 'round',
      miterLimit: 4,
      dash: null,
      dashOffset: 0,
    };
  }
  if (kind === 'bevel') {
    return {
      ...base(kind, 'body'),
      style: 'inner',
      technique: 'smooth',
      depth: 120,
      direction: 'up',
      size: 10,
      soften: 1,
      angle: 120,
      altitude: 35,
      useGlobalLight: true,
      glossContour: contour(),
      highlight: { color: [1, 1, 1, 1], blendMode: 'screen', opacity: 0.8 },
      shadow: { color: [0.03, 0.04, 0.08, 1], blendMode: 'multiply', opacity: 0.65 },
    };
  }
  if (kind === 'extrude') {
    return {
      ...base(kind, 'back'),
      depth: 36,
      mode: 'parallel',
      angle: 45,
      vanishingPoint: [0.5, 1.4],
      strength: 0.4,
      facePaint: white,
      sidePaint: { kind: 'solid', color: [0.12, 0.16, 0.3, 1] },
      autoShade: true,
      shadeAmount: 0.45,
      steps: 'auto',
      capBack: true,
    };
  }
  if (kind === 'innerShadow') {
    return {
      ...base(kind, 'body'),
      color: [0, 0, 0, 1],
      angle: 120,
      distance: 5,
      size: 8,
      contour: contour(),
      noise: 0,
      choke: 0.05,
    };
  }
  if (kind === 'innerGlow') {
    return {
      ...base(kind, 'body'),
      paint: white,
      noise: 0,
      technique: 'softer',
      size: 12,
      contour: contour(),
      range: 0.75,
      jitter: 0,
      source: 'edge',
      choke: 0,
    };
  }
  if (kind === 'satin') {
    return {
      ...base(kind, 'body'),
      color: [0.12, 0.03, 0.2, 1],
      angle: 20,
      distance: 10,
      size: 12,
      contour: contour(),
      invert: false,
    };
  }
  if (kind === 'outerGlow') {
    return {
      ...base(kind, 'back'),
      paint: { kind: 'solid', color: [0.1, 0.9, 1, 1] },
      noise: 0,
      technique: 'softer',
      size: 24,
      contour: contour(),
      range: 0.75,
      jitter: 0,
      spread: 0.08,
      blendMode: 'screen',
    };
  }
  if (kind === 'dropShadow') {
    return {
      ...base(kind, 'back'),
      color: [0.02, 0.03, 0.08, 1],
      angle: 120,
      distance: 14,
      size: 14,
      contour: contour(),
      noise: 0,
      spread: 0.08,
      useGlobalLight: true,
      knockout: true,
      opacity: 0.7,
      blendMode: 'multiply',
    };
  }
  if (kind === 'longShadow') {
    return {
      ...base(kind, 'back'),
      angle: 45,
      length: 90,
      paint: { kind: 'solid', color: [0.04, 0.06, 0.14, 1] },
      fade: false,
      opacity: 0.65,
    };
  }
  if (kind === 'textureOverlay') {
    return {
      ...base(kind, 'body'),
      source: { type: 'procedural', pattern: 'grain' },
      scale: 1,
      rotation: 0,
      clipToShape: true,
      opacity: 0.22,
      blendMode: 'overlay',
    };
  }
  if (kind === 'reflection') {
    return {
      ...base(kind, 'front'),
      offset: 8,
      height: 0.45,
      fade: [1, 0.7, 0.25, 0],
      blur: 2,
      opacity: 0.35,
    };
  }
  if (kind === 'post') {
    return {
      ...base(kind, 'post'),
      type: 'grain',
      seed: 1337,
      params: { amount: 0.16, size: 1 },
      opacity: 0.5,
    };
  }
  throw new Error('Unsupported effect kind');
}

export const EFFECT_KINDS: EffectKind[] = [
  'fill',
  'stroke',
  'bevel',
  'extrude',
  'innerShadow',
  'innerGlow',
  'satin',
  'outerGlow',
  'dropShadow',
  'longShadow',
  'textureOverlay',
  'reflection',
  'post',
];
