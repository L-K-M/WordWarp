import type { Point, PresetWarpId, WarpSpec } from '../model/types';

type PresetSpec = Pick<WarpSpec, 'adj' | 'bend' | 'distortH' | 'distortV'> & {
  preset: PresetWarpId;
};

export function mapPresetPoint(u: number, v: number, spec: PresetSpec): Point {
  const amount = Math.min(1, Math.abs(spec.bend));
  if (amount === 0 || spec.preset === 'textNoShape' || spec.preset === 'textPlain') {
    return applyDistortion([u, v], u, v, spec);
  }

  const direction = spec.bend < 0 ? -1 : 1;
  const target = presetTarget(spec.preset, u, v, clamp01(spec.adj[0]), clamp01(spec.adj[1]), direction);
  const mapped: Point = [mix(u, target[0], amount), mix(v, target[1], amount)];
  return applyDistortion(mapped, u, v, spec);
}

function presetTarget(
  preset: PresetWarpId,
  u: number,
  v: number,
  adjustment: number,
  secondary: number,
  direction: number,
): Point {
  const biasedU = bias(u, secondary);
  const quadratic = 4 * biasedU * (1 - biasedU);
  const tent = 1 - Math.abs(2 * biasedU - 1);
  const linear = 2 * biasedU - 1;
  const amplitude = 0.08 + adjustment * 0.34;

  switch (preset) {
    case 'textNoShape':
    case 'textPlain':
      return [u, v];
    case 'textStop': {
      const edge = Math.abs(2 * v - 1);
      const inset = Math.max(0, (edge - 0.45) / 0.55) * (0.08 + adjustment * 0.22);
      return [0.5 + (u - 0.5) * (1 - inset), v];
    }
    case 'textTriangle':
      return [mix(0.5 + (u - 0.5) * (0.12 + adjustment * 0.3), u, v), v];
    case 'textTriangleInverted':
      return [mix(u, 0.5 + (u - 0.5) * (0.12 + adjustment * 0.3), v), v];
    case 'textChevron':
      return [u, v - direction * amplitude * tent];
    case 'textChevronInverted':
      return [u, v + direction * amplitude * tent];
    case 'textSlantUp':
      return [u, v - direction * (0.18 + adjustment * 0.42) * (u - secondary)];
    case 'textSlantDown':
      return [u, v + direction * (0.18 + adjustment * 0.42) * (u - secondary)];
    case 'textCascadeUp':
      return ribbon(u, v, -direction * amplitude * linear, 1 - 0.3 * linear);
    case 'textCascadeDown':
      return ribbon(u, v, direction * amplitude * linear, 1 + 0.3 * linear);
    case 'textFadeUp':
      return horizontalFade(u, v, 1 - v, adjustment, secondary);
    case 'textFadeDown':
      return horizontalFade(u, v, v, adjustment, secondary);
    case 'textFadeLeft':
      return verticalFade(u, v, 1 - u, adjustment, secondary);
    case 'textFadeRight':
      return verticalFade(u, v, u, adjustment, secondary);
    case 'textInflate':
      return ribbon(u, v, 0, 1 + direction * amplitude * quadratic);
    case 'textDeflate':
      return ribbon(u, v, 0, 1 - direction * amplitude * quadratic);
    case 'textInflateTop':
      return envelope(u, v, -direction * amplitude * quadratic, 1);
    case 'textInflateBottom':
      return envelope(u, v, 0, 1 + direction * amplitude * quadratic);
    case 'textDeflateTop':
      return envelope(u, v, direction * amplitude * quadratic, 1);
    case 'textDeflateBottom':
      return envelope(u, v, 0, 1 - direction * amplitude * quadratic);
    case 'textDeflateInflate':
      return ribbon(u, v, 0, 1 + direction * amplitude * linear);
    case 'textDeflateInflateDeflate':
      return ribbon(u, v, 0, 1 + direction * amplitude * (quadratic * 2 - 1));
    case 'textWave1':
      return wave(u, v, adjustment, secondary, direction, 1, false);
    case 'textWave2':
      return wave(u, v, adjustment, secondary, direction, 1, true);
    case 'textDoubleWave1':
      return wave(u, v, adjustment, secondary, direction, 2, false);
    case 'textWave4': {
      const phase = secondary * Math.PI * 2 - Math.PI;
      const stretch = Math.sin(u * Math.PI * 4 + phase) * amplitude * direction;
      return ribbon(u, v, 0, 1 + stretch);
    }
    case 'textCurveUp':
      return [u, v - direction * amplitude * quadratic];
    case 'textCurveDown':
      return [u, v + direction * amplitude * quadratic];
    case 'textCanUp':
      return envelope(u, v, -direction * amplitude * quadratic, 1 - direction * amplitude * quadratic * 0.35);
    case 'textCanDown':
      return envelope(u, v, direction * amplitude * quadratic * 0.35, 1 + direction * amplitude * quadratic);
    case 'textArchUp':
      return arch(u, v, adjustment, secondary, -direction, false);
    case 'textArchDown':
      return arch(u, v, adjustment, secondary, direction, false);
    case 'textArchUpPour':
      return arch(u, v, adjustment, secondary, -direction, true);
    case 'textArchDownPour':
      return arch(u, v, adjustment, secondary, direction, true);
    case 'textCircle':
      return circle(u, v, adjustment, secondary, direction, 0.16, 1);
    case 'textCirclePour':
      return circle(u, v, adjustment, secondary, direction, 0.3, 1);
    case 'textButton':
      return circle(u, v, adjustment, secondary, direction, 0.14, 0.42 + adjustment * 0.38);
    case 'textButtonPour':
      return circle(u, v, adjustment, secondary, direction, 0.28, 0.42 + adjustment * 0.38);
    case 'textRingOutside':
      return circle(u, v, adjustment, secondary, direction, 0.08 + adjustment * 0.1, 1);
    case 'textRingInside': {
      const point = circle(1 - u, 1 - v, adjustment, secondary, -direction, 0.08 + adjustment * 0.1, 1);
      return point;
    }
  }
}

function envelope(u: number, v: number, top: number, bottom: number): Point {
  return [u, mix(top, bottom, v)];
}

function ribbon(u: number, v: number, centerOffset: number, height: number): Point {
  const safeHeight = Math.max(0.14, height);
  return [u, 0.5 + centerOffset + (v - 0.5) * safeHeight];
}

function horizontalFade(u: number, v: number, narrowing: number, adjustment: number, secondary: number): Point {
  const tip = 0.22 + adjustment * 0.6;
  const scale = 1 - (1 - tip) * narrowing;
  const offset = (secondary - 0.5) * 0.25 * narrowing;
  return [0.5 + offset + (u - 0.5) * scale, v];
}

function verticalFade(u: number, v: number, narrowing: number, adjustment: number, secondary: number): Point {
  const tip = 0.22 + adjustment * 0.6;
  const scale = 1 - (1 - tip) * narrowing;
  const offset = (secondary - 0.5) * 0.25 * narrowing;
  return [u, 0.5 + offset + (v - 0.5) * scale];
}

function wave(
  u: number,
  v: number,
  adjustment: number,
  secondary: number,
  direction: number,
  cycles: number,
  rolling: boolean,
): Point {
  const phase = secondary * Math.PI * 2 - Math.PI;
  const angle = u * Math.PI * 2 * cycles + phase;
  const amplitude = 0.04 + adjustment * 0.18;
  const center = Math.sin(angle) * amplitude * direction;
  const height = rolling ? 1 + Math.cos(angle) * amplitude * 0.7 * direction : 1;
  return ribbon(u, v, center, height);
}

function arch(
  u: number,
  v: number,
  adjustment: number,
  secondary: number,
  direction: number,
  pour: boolean,
): Point {
  const sweep = Math.PI * (0.25 + adjustment * 0.7);
  const theta = sweep * (bias(u, secondary) - 0.5);
  const radius = 1 / Math.max(0.2, 2 * Math.sin(sweep / 2));
  const centerX = 0.5 + radius * Math.sin(theta);
  const centerY = 0.5 + direction * radius * (Math.cos(theta) - Math.cos(sweep / 2));
  if (!pour) return [centerX, v + centerY - 0.5];
  const thickness = 0.28 + secondary * 0.5;
  return [
    centerX + (v - 0.5) * thickness * direction * Math.sin(theta),
    centerY + (v - 0.5) * thickness * Math.cos(theta),
  ];
}

function circle(
  u: number,
  v: number,
  adjustment: number,
  secondary: number,
  direction: number,
  thickness: number,
  ovalY: number,
): Point {
  const theta = -Math.PI / 2 + direction * (u * Math.PI * 2 + (secondary - 0.5) * Math.PI * 2);
  const outer = 0.5;
  const inner = outer - Math.min(0.42, thickness + adjustment * 0.08);
  const radius = mix(outer, inner, v);
  return [0.5 + radius * Math.cos(theta), 0.5 + radius * Math.sin(theta) * ovalY];
}

function applyDistortion(point: Point, u: number, v: number, spec: Pick<WarpSpec, 'distortH' | 'distortV'>): Point {
  const scaleX = 1 + spec.distortH * 0.45 * (2 * v - 1);
  const scaleY = 1 + spec.distortV * 0.45 * (2 * u - 1);
  return [0.5 + (point[0] - 0.5) * scaleX, 0.5 + (point[1] - 0.5) * scaleY];
}

function bias(value: number, adjustment: number): number {
  return value + 0.3 * (adjustment * 2 - 1) * value * (1 - value);
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
