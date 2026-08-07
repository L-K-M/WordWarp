import { describe, expect, it } from 'vitest';

import { bayerMatrix, ditherQuantise } from './cpu-effects';

describe('bayer threshold matrix', () => {
  it('snaps a requested size to a power of two between 2 and 16', () => {
    expect(bayerMatrix(2).size).toBe(2);
    expect(bayerMatrix(3).size).toBe(4);
    expect(bayerMatrix(8).size).toBe(8);
    expect(bayerMatrix(0).size).toBe(2);
    expect(bayerMatrix(1000).size).toBe(16);
  });

  it('reproduces the canonical 2x2 tile', () => {
    // The classic tile is [[0, 2], [3, 1]] out of four levels, centred on zero here.
    const { values } = bayerMatrix(2);
    expect([...values].map((value) => Math.round((value + 0.5) * 4 - 0.5))).toEqual([0, 2, 3, 1]);
  });

  it('uses every threshold in the tile exactly once', () => {
    // A repeated threshold would leave one band of the palette with no way to break -- the pattern
    // would show as banding rather than as dots.
    for (const size of [2, 4, 8, 16]) {
      const { values } = bayerMatrix(size);
      expect(values).toHaveLength(size * size);
      expect(new Set([...values]).size).toBe(size * size);
    }
  });

  it('stays inside the rounding interval and averages to no bias', () => {
    for (const size of [2, 4, 8, 16]) {
      const { values } = bayerMatrix(size);
      for (const value of values) {
        expect(value).toBeGreaterThan(-0.5);
        expect(value).toBeLessThan(0.5);
      }
      const mean = [...values].reduce((total, value) => total + value, 0) / values.length;
      expect(mean).toBeCloseTo(0, 10);
    }
  });
});

describe('ordered dither quantisation', () => {
  const step = 255; // two levels: pure black and pure white.

  it('collapses to a posterise when the bias is zero', () => {
    expect(ditherQuantise(100, step, 0)).toBe(0);
    expect(ditherQuantise(200, step, 0)).toBe(255);
  });

  it('keeps the mean of a flat tone across a tile', () => {
    // This is the whole point of dithering rather than posterising: a mid grey has no
    // representation in a two-level palette, so the tile has to average back to it instead.
    for (const tone of [40, 128, 200]) {
      const { values } = bayerMatrix(8);
      const mean = [...values].reduce((total, bias) => total + ditherQuantise(tone, step, bias), 0) / values.length;
      expect(Math.abs(mean - tone)).toBeLessThan(step / values.length + 1);
    }
  });

  it('never leaves the byte range', () => {
    for (const tone of [0, 1, 128, 254, 255]) {
      for (const bias of [-0.499, 0, 0.499]) {
        const result = ditherQuantise(tone, step, bias);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(255);
      }
    }
  });
});
