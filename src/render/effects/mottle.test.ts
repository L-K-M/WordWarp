import { describe, expect, it } from 'vitest';

import { createMottleSampler, mottleValue } from './cpu-effects';

const SEED = 4242;
const CELL = 16;

/**
 * Mean absolute difference between pixels `step` apart along `axis`, sampled over a patch.
 *
 * Sampled through the sampler rather than the one-shot wrapper: it is the path the renderer uses,
 * and a separate test pins the two as identical. Both axes are measured because the interpolation
 * runs independently in each -- a mistake in the vertical half would leave the horizontal one
 * looking perfectly smooth.
 */
function roughness(step: number, cell: number, axis: 'x' | 'y' = 'x'): number {
  const sample = createMottleSampler(SEED, cell);
  let total = 0;
  let samples = 0;
  for (let y = 0; y < 120; y += 3) {
    for (let x = 0; x < 120; x += 3) {
      const shifted = axis === 'x' ? sample(x + step, y) : sample(x, y + step);
      total += Math.abs(sample(x, y) - shifted);
      samples += 1;
    }
  }
  return total / samples;
}

describe('mottle value noise', () => {
  it('is deterministic for the same coordinates and seed, whatever came before', () => {
    const first = mottleValue(17.5, 42.25, SEED, CELL);
    // Sample elsewhere in between. A repeat call on its own only proves the function is not
    // random; interleaving other coordinates, seeds and cells also rules out any state that
    // carries between calls -- a wrongly keyed cache would fail here and pass a bare repeat.
    for (const other of [[0, 0], [17.5, 42.5], [900, -30]] as const) {
      mottleValue(other[0], other[1], SEED + 5, CELL * 2);
    }
    expect(mottleValue(17.5, 42.25, SEED, CELL)).toBe(first);
    expect(mottleValue(17.5, 42.25, SEED + 1, CELL)).not.toBe(first);
  });

  it('stays inside the unit range', () => {
    const sample = createMottleSampler(SEED, CELL);
    for (let y = 0; y < 200; y += 7) {
      for (let x = 0; x < 200; x += 7) {
        const value = sample(x, y);
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
    //
    // The ratio is what is being asserted, not the number: white noise sits at about 1, and
    // interpolated noise is far below it. A quarter is a loose bound chosen to stay clear of the
    // octave weights and the contrast curve -- if retuning those ever pushes it over, the pattern
    // really has stopped being smooth and the test is right to say so.
    expect(roughness(1, CELL)).toBeLessThan(roughness(CELL, CELL) / 4);
    expect(roughness(1, CELL, 'y')).toBeLessThan(roughness(CELL, CELL, 'y') / 4);
  });

  it('makes features grow with the cell, so a coarser scale is genuinely coarser', () => {
    // At a fixed step, a larger cell means less has changed between the two samples.
    expect(roughness(8, 64)).toBeLessThan(roughness(8, 16));
    expect(roughness(8, 64, 'y')).toBeLessThan(roughness(8, 16, 'y'));
  });

  it('gives a scanning sampler exactly what a one-off sample would give', () => {
    // The sampler holds the lattice corners between calls so a row scan does not re-hash them.
    // That cache is the only reason the pattern is affordable, and it is also the only place this
    // could silently diverge -- so pin it against the uncached path, in scan order.
    const sampler = createMottleSampler(SEED, CELL);
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 40; x += 1) {
        expect(sampler(x, y), `${x},${y}`).toBe(mottleValue(x, y, SEED, CELL));
      }
    }
  });

  it('does not depend on the order it is sampled in', () => {
    // A cache keyed on anything but position would show up here: same sampler, jumbled order.
    const points = [[3, 3], [140, 9], [4, 3], [-20, 55], [3, 4], [140, 9]] as const;
    const scanning = createMottleSampler(SEED, CELL);
    const jumbled = createMottleSampler(SEED, CELL);
    const expected = points.map(([x, y]) => mottleValue(x, y, SEED, CELL));
    expect(points.map(([x, y]) => scanning(x, y))).toEqual(expected);
    expect([...points].reverse().map(([x, y]) => jumbled(x, y))).toEqual([...expected].reverse());
  });

  it('averages near the midpoint, so a symmetric blend leaves the tone alone', () => {
    const sample = createMottleSampler(SEED, CELL);
    let total = 0;
    let samples = 0;
    for (let y = 0; y < 512; y += 2) {
      for (let x = 0; x < 512; x += 2) {
        total += sample(x, y);
        samples += 1;
      }
    }
    expect(total / samples).toBeCloseTo(0.5, 1);
  });
});
