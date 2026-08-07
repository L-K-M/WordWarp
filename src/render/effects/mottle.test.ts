import { describe, expect, it } from 'vitest';

import { mottleValue } from './cpu-effects';

const SEED = 4242;
const CELL = 16;

/** Mean absolute difference between pixels `step` apart, sampled over a patch. */
function roughness(step: number, cell: number): number {
  let total = 0;
  let samples = 0;
  for (let y = 0; y < 120; y += 3) {
    for (let x = 0; x < 120; x += 3) {
      total += Math.abs(mottleValue(x, y, SEED, cell) - mottleValue(x + step, y, SEED, cell));
      samples += 1;
    }
  }
  return total / samples;
}

describe('mottle value noise', () => {
  it('is deterministic for the same coordinates and seed', () => {
    expect(mottleValue(17.5, 42.25, SEED, CELL)).toBe(mottleValue(17.5, 42.25, SEED, CELL));
    expect(mottleValue(17.5, 42.25, SEED + 1, CELL)).not.toBe(mottleValue(17.5, 42.25, SEED, CELL));
  });

  it('stays inside the unit range', () => {
    for (let y = 0; y < 200; y += 7) {
      for (let x = 0; x < 200; x += 7) {
        const value = mottleValue(x, y, SEED, CELL);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('varies smoothly rather than per pixel, which is the whole point of it', () => {
    // White noise -- what the existing `noise` and `grain` patterns use -- has no correlation
    // between neighbours, so a one-pixel step would swing about as far as a whole-cell step. Ink
    // blotches are the opposite: adjacent pixels are nearly the same, and the pattern only
    // resolves over the cell.
    expect(roughness(1, CELL)).toBeLessThan(roughness(CELL, CELL) / 4);
  });

  it('makes features grow with the cell, so a coarser scale is genuinely coarser', () => {
    // At a fixed step, a larger cell means less has changed between the two samples.
    expect(roughness(8, 64)).toBeLessThan(roughness(8, 16));
  });

  it('averages near the midpoint, so a symmetric blend leaves the tone alone', () => {
    let total = 0;
    let samples = 0;
    for (let y = 0; y < 512; y += 2) {
      for (let x = 0; x < 512; x += 2) {
        total += mottleValue(x, y, SEED, CELL);
        samples += 1;
      }
    }
    expect(total / samples).toBeCloseTo(0.5, 1);
  });
});
