import { sampleGradient } from '../render/color';
import type { Gradient, GradientStop, Paint, Rgba } from '../model/types';
import { officeRampColors } from '../presets/office-ramps';

/** The most stops the inspector offers; enough for a banded metal, few enough to stay tappable. */
export const MAX_GRADIENT_STOPS = 8;

export const MIN_GRADIENT_STOPS = 2;

/**
 * Rebuild a paint as a gradient, keeping as much of its colour as the old kind can give.
 *
 * A solid becomes a three-stop ramp through its own colour -- a lighter tint above, a deeper shade
 * below -- because that is what "make this a gradient" means to someone looking at a flat letter:
 * the same colour, lit. A ramp already is a colour run, so it converts by sampling; the paint
 * stays recognisable and every stop becomes editable, which is the point of converting. The kinds
 * with no colours of their own (matcap, texture) fall back to a neutral steel, which at least
 * lands on the gradient the metal presets start from.
 */
export function toGradientPaint(paint: Paint): Paint {
  if (paint.kind === 'gradient') return paint;
  if (paint.kind === 'solid') {
    return gradientPaintOf([
      { offset: 0, color: mix(paint.color, [1, 1, 1, paint.color[3]], 0.65) },
      { offset: 0.45, color: [...paint.color] },
      { offset: 1, color: mix(paint.color, [0, 0, 0, paint.color[3]], 0.55) },
    ]);
  }
  if (paint.kind === 'ramp') {
    const colors = officeRampColors(paint.rampId);
    if (colors) {
      const stops = Array.from({ length: 7 }, (_, index) => {
        const offset = index / 6;
        return { offset, color: colors[Math.round(offset * (colors.length - 1))]! };
      });
      return gradientPaintOf(stops, paint.angle);
    }
  }
  return gradientPaintOf([
    { offset: 0, color: [0.93, 0.95, 0.97, 1] },
    { offset: 0.45, color: [0.62, 0.66, 0.73, 1] },
    { offset: 1, color: [0.29, 0.32, 0.4, 1] },
  ]);
}

/** Collapse a paint to one colour: a gradient's midpoint, a ramp's middle entry, or neutral. */
export function toSolidPaint(paint: Paint): Paint {
  if (paint.kind === 'solid') return paint;
  if (paint.kind === 'gradient') return { kind: 'solid', color: sampleGradient(paint.gradient, 0.5) };
  if (paint.kind === 'ramp') {
    const colors = officeRampColors(paint.rampId);
    if (colors) return { kind: 'solid', color: [...colors[Math.floor(colors.length / 2)]!] };
  }
  return { kind: 'solid', color: [0.45, 0.48, 0.55, 1] };
}

/**
 * Add a stop in the largest gap, coloured from the gradient itself.
 *
 * Splitting the widest span keeps hand-placed bands where they are, and sampling the new stop's
 * colour makes the addition invisible until it is edited -- adding a handle must not change the
 * paint it is a handle for.
 */
export function withAddedStop(gradient: Gradient): Gradient {
  if (gradient.stops.length >= MAX_GRADIENT_STOPS) return gradient;
  if (gradient.stops.length < 2) {
    const color = gradient.stops[0]?.color ?? [1, 1, 1, 1];
    return { ...gradient, stops: [{ offset: 0, color: [...color] }, { offset: 1, color: [...color] }] };
  }
  let gapIndex = 1;
  let gapSize = -1;
  gradient.stops.forEach((stop, index) => {
    if (index === 0) return;
    const gap = stop.offset - gradient.stops[index - 1]!.offset;
    if (gap > gapSize) {
      gapSize = gap;
      gapIndex = index;
    }
  });
  const offset = gradient.stops[gapIndex - 1]!.offset + gapSize / 2;
  const stops = [...gradient.stops];
  stops.splice(gapIndex, 0, { offset, color: sampleGradient(gradient, offset) });
  return { ...gradient, stops };
}

/** Drop the last stop, never going below two -- one stop is a solid wearing a gradient's costume. */
export function withRemovedStop(gradient: Gradient): Gradient {
  if (gradient.stops.length <= MIN_GRADIENT_STOPS) return gradient;
  return { ...gradient, stops: gradient.stops.slice(0, -1) };
}

function gradientPaintOf(stops: GradientStop[], angle = 180): Paint {
  return {
    kind: 'gradient',
    gradient: {
      type: 'linear',
      stops,
      angle,
      center: [0.5, 0.5],
      scale: 1,
      dither: true,
      interpolation: 'oklab',
    },
  };
}

function mix(a: Rgba, b: Rgba, amount: number): Rgba {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
    a[3],
  ];
}
