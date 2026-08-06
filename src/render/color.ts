import type { Gradient, Rgba } from '../model/types';

export function rgbaToCss([red, green, blue, alpha]: Rgba): string {
  return `rgba(${Math.round(red * 255)}, ${Math.round(green * 255)}, ${Math.round(blue * 255)}, ${alpha})`;
}

export function sampleGradient(gradient: Gradient, offset: number): Rgba {
  const stops = gradient.stops;
  if (stops.length === 0) return [0, 0, 0, 0];
  if (offset <= stops[0]!.offset) return [...stops[0]!.color];
  if (offset >= stops.at(-1)!.offset) return [...stops.at(-1)!.color];

  const rightIndex = stops.findIndex((stop) => stop.offset >= offset);
  const left = stops[rightIndex - 1]!;
  const right = stops[rightIndex]!;
  const span = right.offset - left.offset;
  const amount = span === 0 ? 0 : (offset - left.offset) / span;
  return gradient.interpolation === 'oklab'
    ? interpolateOklab(left.color, right.color, amount)
    : interpolateRgba(left.color, right.color, amount);
}

export function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

function interpolateRgba(a: Rgba, b: Rgba, amount: number): Rgba {
  return [
    lerp(a[0], b[0], amount),
    lerp(a[1], b[1], amount),
    lerp(a[2], b[2], amount),
    lerp(a[3], b[3], amount),
  ];
}

function interpolateOklab(a: Rgba, b: Rgba, amount: number): Rgba {
  const labA = linearSrgbToOklab(a.map((value, index) => (index < 3 ? srgbToLinear(value) : value)) as Rgba);
  const labB = linearSrgbToOklab(b.map((value, index) => (index < 3 ? srgbToLinear(value) : value)) as Rgba);
  const lab: Rgba = [
    lerp(labA[0], labB[0], amount),
    lerp(labA[1], labB[1], amount),
    lerp(labA[2], labB[2], amount),
    lerp(a[3], b[3], amount),
  ];
  const linear = oklabToLinearSrgb(lab);
  return [
    clamp01(linearToSrgb(linear[0])),
    clamp01(linearToSrgb(linear[1])),
    clamp01(linearToSrgb(linear[2])),
    clamp01(lab[3]),
  ];
}

function linearSrgbToOklab([red, green, blue, alpha]: Rgba): Rgba {
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    alpha,
  ];
}

function oklabToLinearSrgb([lightness, greenRed, blueYellow, alpha]: Rgba): Rgba {
  const l = (lightness + 0.3963377774 * greenRed + 0.2158037573 * blueYellow) ** 3;
  const m = (lightness - 0.1055613458 * greenRed - 0.0638541728 * blueYellow) ** 3;
  const s = (lightness - 0.0894841775 * greenRed - 1.291485548 * blueYellow) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    alpha,
  ];
}

function lerp(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
