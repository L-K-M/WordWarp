import { describe, expect, it } from 'vitest';

import { bevelHeightForTest } from './cpu-effects';

// Sample the profile across an inner bevel band of 10px: distance 0 is the shape edge,
// -10 is the inner end of the bevel.
const sample = (technique: 'smooth' | 'chiselHard' | 'chiselSoft', distance: number) =>
  bevelHeightForTest(distance, 10, 'inner', technique);

describe('bevel height profiles', () => {
  it('gives each technique a distinct profile', () => {
    // Previously the technique was ignored entirely, so all three were identical. Sample at a
    // quarter of the way across rather than the midpoint, where the linear and smoothstep
    // profiles legitimately cross at 0.5.
    const quarter = [sample('smooth', -2.5), sample('chiselHard', -2.5), sample('chiselSoft', -2.5)];
    expect(new Set(quarter.map((value) => value.toFixed(4))).size).toBe(3);
  });

  it('runs from the shape edge up to full height', () => {
    for (const technique of ['smooth', 'chiselHard', 'chiselSoft'] as const) {
      expect(sample(technique, 0)).toBeCloseTo(0, 5);
      expect(sample(technique, -10)).toBeCloseTo(1, 5);
      // Monotonic across the band.
      let previous = -Infinity;
      for (let distance = 0; distance >= -10; distance -= 1) {
        const value = sample(technique, distance);
        expect(value).toBeGreaterThanOrEqual(previous);
        previous = value;
      }
    }
  });

  it('makes a round bevel rise faster than a flat one near the edge', () => {
    expect(sample('smooth', -2)).toBeGreaterThan(sample('chiselHard', -2));
  });

  it('rises and falls again for pillow, which is what puffs it', () => {
    const edge = bevelHeightForTest(0, 10, 'pillow', 'smooth');
    const middle = bevelHeightForTest(-5, 10, 'pillow', 'smooth');
    const inner = bevelHeightForTest(-10, 10, 'pillow', 'smooth');
    expect(middle).toBeGreaterThan(edge);
    expect(middle).toBeGreaterThan(inner);
  });
});
