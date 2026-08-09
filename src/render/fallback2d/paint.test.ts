import { describe, expect, it } from 'vitest';

import { createPaintStyle } from './paint';
import { rgbaToCss } from '../color';
import type { Bounds } from '../../geometry/bounds';
import type { Gradient, Paint, Rgba } from '../../model/types';
import type { TextContext } from '../../text/layout';

/**
 * Canvas gradients are write-only, so the paint has to be observed at the seam: a stub context
 * that records every colour stop the paint adds instead of rasterising them.
 */
class StubGradient {
  stops: Array<{ offset: number; color: string }> = [];

  constructor(public args: number[]) {}

  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, color });
  }
}

function stubContext(): { context: TextContext; created: StubGradient[] } {
  const created: StubGradient[] = [];
  const make = (...args: number[]) => {
    const gradient = new StubGradient(args);
    created.push(gradient);
    return gradient;
  };
  const context = {
    createLinearGradient: make,
    createRadialGradient: make,
    createConicGradient: make,
  } as unknown as TextContext;
  return { context, created };
}

const bounds: Bounds = { x: 0, y: 0, width: 200, height: 100 };

const rgba = (red: number, green: number, blue: number): Rgba => [red, green, blue, 1];

function gradientPaint(gradient: Partial<Gradient>): Paint {
  return {
    kind: 'gradient',
    gradient: {
      type: 'linear',
      stops: [
        { offset: 0, color: rgba(0, 0, 0) },
        { offset: 1, color: rgba(1, 1, 1) },
      ],
      angle: 180,
      center: [0.5, 0.5],
      scale: 1,
      dither: false,
      interpolation: 'srgb',
      ...gradient,
    },
  };
}

describe('createPaintStyle gradient geometry', () => {
  it('spans a linear run across the bounds projection, not the diagonal', () => {
    const wide: Bounds = { x: 0, y: 0, width: 1000, height: 200 };
    const { context, created } = stubContext();
    // Vertical on a wide word: the run must cover exactly the height, so a bright-dark-bright
    // metal shows both bright ends on the glyphs instead of cropping them past the text box.
    const rounded = (gradient: StubGradient) => gradient.args.map((value) => Math.round(value) || 0);
    createPaintStyle(context, gradientPaint({ angle: 180 }), wide);
    expect(rounded(created[0]!)).toEqual([500, 0, 500, 200]);

    createPaintStyle(context, gradientPaint({ angle: 90 }), wide);
    expect(rounded(created[1]!)).toEqual([0, 100, 1000, 100]);
  });
});

describe('createPaintStyle gradient sampling', () => {
  it('keeps an evenly spaced sRGB gradient on its own stops', () => {
    const { context, created } = stubContext();
    createPaintStyle(context, gradientPaint({
      stops: [
        { offset: 0, color: rgba(1, 0, 0) },
        { offset: 0.5, color: rgba(0, 1, 0) },
        { offset: 1, color: rgba(0, 0, 1) },
      ],
    }), bounds);

    // The resampling grid for n evenly spaced stops is exactly those stops, so nothing is added.
    expect(created[0]!.stops.map((stop) => stop.offset)).toEqual([0, 0.5, 1]);
    expect(created[0]!.stops.map((stop) => stop.color)).toEqual([
      rgbaToCss(rgba(1, 0, 0)), rgbaToCss(rgba(0, 1, 0)), rgbaToCss(rgba(0, 0, 1)),
    ]);
  });

  it('samples hand-placed band offsets exactly rather than rounding them onto the grid', () => {
    const banded = [0, 0.1, 0.3, 0.55, 0.72, 0.88, 1];
    const { context, created } = stubContext();
    createPaintStyle(context, gradientPaint({
      interpolation: 'oklab',
      stops: banded.map((offset, index) => ({ offset, color: rgba(index / 6, index / 6, index / 6) })),
    }), bounds);

    const offsets = created[0]!.stops.map((stop) => stop.offset);
    const colorAt = new Map(created[0]!.stops.map((stop) => [stop.offset, stop.color]));
    for (const [index, offset] of banded.entries()) {
      // Each band edge must land at its own offset with its own colour: 0.55 and 0.72 sit between
      // cells of the 32-sample grid, so quantised sampling would smear both across a cell. The
      // OKLab round trip wobbles a channel by one 8-bit step, and the bands sit ~42 steps apart,
      // so a small tolerance still tells a stop's own colour from its neighbour's.
      expect(offsets).toContain(offset);
      const channels = colorAt.get(offset)!.match(/\d+/g)!.slice(0, 3).map(Number);
      for (const channel of channels) {
        expect(Math.abs(channel - Math.round((index / 6) * 255))).toBeLessThanOrEqual(2);
      }
    }
  });

  it('renders two stops sharing an offset as a crisp edge', () => {
    const { context, created } = stubContext();
    createPaintStyle(context, gradientPaint({
      stops: [
        { offset: 0, color: rgba(1, 0, 0) },
        { offset: 0.5, color: rgba(1, 0, 0) },
        { offset: 0.5, color: rgba(0, 0, 1) },
        { offset: 1, color: rgba(0, 0, 1) },
      ],
    }), bounds);

    const stops = created[0]!.stops;
    const before = stops.find((stop) => stop.offset === 0.5);
    const after = stops.find((stop) => stop.offset > 0.5 && stop.offset < 0.501);
    expect(before?.color).toBe(rgbaToCss(rgba(1, 0, 0)));
    expect(after?.color).toBe(rgbaToCss(rgba(0, 0, 1)));
  });

  it('mirrors stop offsets into both halves of a reflected gradient', () => {
    const { context, created } = stubContext();
    createPaintStyle(context, gradientPaint({
      type: 'reflected',
      stops: [
        { offset: 0, color: rgba(0, 0, 0) },
        { offset: 0.9, color: rgba(1, 1, 1) },
        { offset: 1, color: rgba(1, 0, 0) },
      ],
    }), bounds);

    const stops = created[0]!.stops;
    // Canvas offsets are arithmetic on stop offsets, so they are only near their nominal values.
    const colorNear = (target: number) =>
      stops.find((stop) => Math.abs(stop.offset - target) < 1e-9)?.color;
    // Gradient offset 0.9 lives at canvas 0.45 and 0.55; the ends carry the first stop and the
    // centre the last, which is what makes the paint a mirror rather than a wash.
    expect(colorNear(0.45)).toBe(rgbaToCss(rgba(1, 1, 1)));
    expect(colorNear(0.55)).toBe(rgbaToCss(rgba(1, 1, 1)));
    expect(colorNear(0)).toBe(rgbaToCss(rgba(0, 0, 0)));
    expect(colorNear(1)).toBe(rgbaToCss(rgba(0, 0, 0)));
    expect(colorNear(0.5)).toBe(rgbaToCss(rgba(1, 0, 0)));
  });
});
