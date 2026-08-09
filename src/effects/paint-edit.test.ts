import { describe, expect, it } from 'vitest';

import { MAX_GRADIENT_STOPS, toGradientPaint, toSolidPaint, withAddedStop, withRemovedStop } from './paint-edit';
import { paintSchema } from '../model/schema';
import type { Gradient, Paint, Rgba } from '../model/types';

const red: Rgba = [0.8, 0.1, 0.2, 1];

function linearGradient(stops: Array<[number, Rgba]>): Gradient {
  return {
    type: 'linear',
    stops: stops.map(([offset, color]) => ({ offset, color })),
    angle: 180,
    center: [0.5, 0.5],
    scale: 1,
    dither: true,
    interpolation: 'srgb',
  };
}

describe('toGradientPaint', () => {
  it('turns a solid into a lit ramp through its own colour', () => {
    const paint = toGradientPaint({ kind: 'solid', color: [...red] });

    if (paint.kind !== 'gradient') throw new Error('Expected a gradient paint');
    expect(paintSchema.safeParse(paint).success).toBe(true);
    expect(paint.gradient.stops).toHaveLength(3);
    // Tint above, the colour itself in the middle, shade below -- and the ends stay ordered so
    // the schema's offset invariant holds.
    expect(paint.gradient.stops[1]!.color).toEqual(red);
    expect(paint.gradient.stops[0]!.color[0]).toBeGreaterThan(red[0]);
    expect(paint.gradient.stops[2]!.color[0]).toBeLessThan(red[0]);
  });

  it('keeps a translucent solid translucent at every stop', () => {
    const paint = toGradientPaint({ kind: 'solid', color: [0.8, 0.1, 0.2, 0.5] });

    if (paint.kind !== 'gradient') throw new Error('Expected a gradient paint');
    for (const stop of paint.gradient.stops) expect(stop.color[3]).toBe(0.5);
  });

  it('samples a ramp into editable stops and keeps its angle', () => {
    const paint = toGradientPaint({ kind: 'ramp', rampId: 'chrome', angle: 45, variant: 1 });

    if (paint.kind !== 'gradient') throw new Error('Expected a gradient paint');
    expect(paintSchema.safeParse(paint).success).toBe(true);
    expect(paint.gradient.angle).toBe(45);
    expect(paint.gradient.stops).toHaveLength(7);
    // Chrome's first ramp entry is near-white; the conversion must carry the ramp's colours
    // rather than substituting a default.
    expect(paint.gradient.stops[0]!.color[0]).toBeGreaterThan(0.9);
  });

  it('leaves an existing gradient untouched', () => {
    const paint: Paint = { kind: 'gradient', gradient: linearGradient([[0, red], [1, red]]) };
    expect(toGradientPaint(paint)).toBe(paint);
  });
});

describe('toSolidPaint', () => {
  it('collapses a gradient to its midpoint sample', () => {
    const paint = toSolidPaint({
      kind: 'gradient',
      gradient: linearGradient([[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]]),
    });

    expect(paint).toEqual({ kind: 'solid', color: [0.5, 0.5, 0.5, 1] });
  });

  it('round-trips a solid through gradient and back to the same colour', () => {
    const solid: Paint = { kind: 'solid', color: [...red] };
    const back = toSolidPaint(toGradientPaint(solid));

    if (back.kind !== 'solid') throw new Error('Expected a solid paint');
    // The middle stop sits at 0.45, so the 0.5 sample is one twentieth of the way into the shade
    // band -- close enough that flipping the switch twice is not a visible edit.
    for (const channel of [0, 1, 2, 3]) expect(back.color[channel]).toBeCloseTo(red[channel]!, 1);
  });
});

describe('withAddedStop', () => {
  it('splits the widest gap without moving hand-placed bands', () => {
    const gradient = linearGradient([[0, [1, 0, 0, 1]], [0.1, [0, 1, 0, 1]], [1, [0, 0, 1, 1]]]);
    const grown = withAddedStop(gradient);

    expect(grown.stops.map((stop) => stop.offset)).toEqual([0, 0.1, 0.55, 1]);
    // The new stop is sampled from the run it lands in, so adding it changes nothing visually.
    expect(grown.stops[2]!.color[2]).toBeCloseTo(0.5, 5);
    expect(paintSchema.safeParse({ kind: 'gradient', gradient: grown }).success).toBe(true);
  });

  it('stops growing at the inspector ceiling', () => {
    let gradient = linearGradient([[0, red], [1, red]]);
    for (let index = 0; index < 12; index += 1) gradient = withAddedStop(gradient);
    expect(gradient.stops).toHaveLength(MAX_GRADIENT_STOPS);
  });
});

describe('withRemovedStop', () => {
  it('drops the last stop and refuses to go below two', () => {
    const gradient = linearGradient([[0, red], [0.5, red], [1, red]]);
    const shrunk = withRemovedStop(gradient);
    expect(shrunk.stops.map((stop) => stop.offset)).toEqual([0, 0.5]);
    expect(withRemovedStop(shrunk).stops).toHaveLength(2);
  });
});
