import { describe, expect, it } from 'vitest';

import { linearToSrgb, sampleGradient, srgbToLinear } from './color';
import type { Gradient } from '../model/types';

describe('render color', () => {
  it('round-trips reference sRGB values', () => {
    for (const value of [0, 0.003, 0.18, 0.5, 1]) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 8);
    }
  });

  it('honors uneven stop offsets', () => {
    const gradient: Gradient = {
      type: 'linear',
      stops: [
        { offset: 0, color: [0, 0, 0, 1] },
        { offset: 0.25, color: [1, 0, 0, 1] },
        { offset: 1, color: [1, 1, 1, 1] },
      ],
      angle: 0,
      center: [0.5, 0.5],
      scale: 1,
      dither: true,
      interpolation: 'srgb',
    };

    expect(sampleGradient(gradient, 0.125)).toEqual([0.5, 0, 0, 1]);
    expect(sampleGradient(gradient, 0.25)).toEqual([1, 0, 0, 1]);
  });

  it('keeps the OKLab midpoint of magenta and cyan vivid', () => {
    const gradient: Gradient = {
      type: 'linear',
      stops: [
        { offset: 0, color: [1, 0, 1, 1] },
        { offset: 1, color: [0, 1, 1, 1] },
      ],
      angle: 0,
      center: [0.5, 0.5],
      scale: 1,
      dither: true,
      interpolation: 'oklab',
    };

    const midpoint = sampleGradient(gradient, 0.5);
    expect(midpoint[2]).toBeGreaterThan(0.95);
    expect(Math.max(...midpoint.slice(0, 3)) - Math.min(...midpoint.slice(0, 3))).toBeGreaterThan(0.2);
  });
});
