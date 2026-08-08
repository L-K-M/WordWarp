import { describe, expect, it } from 'vitest';

import { sampleCrystalTexture } from './cpu-effects';

describe('crystal procedural texture', () => {
  it('is deterministic while responding to its seed and rotation', () => {
    const sample = (seed: number, rotation: number) => Array.from({ length: 24 }, (_, index) => (
      sampleCrystalTexture(index * 3.7, index * 2.3, seed, 18, rotation)
    ));

    expect(sample(4815, 11)).toEqual(sample(4815, 11));
    expect(sample(4815, 11)).not.toEqual(sample(9127, 11));
    expect(sample(4815, 11)).not.toEqual(sample(4815, 38));
  });

  it('contains dark boundaries, bright facets, and varied mineral relief', () => {
    const values: number[] = [];
    for (let y = 0; y < 96; y += 2) {
      for (let x = 0; x < 96; x += 2) values.push(sampleCrystalTexture(x, y, 4815, 18, 11));
    }

    expect(Math.min(...values)).toBeLessThan(0.08);
    expect(Math.max(...values)).toBeGreaterThan(0.75);
    expect(values.filter((value) => value < 0.14).length).toBeGreaterThan(60);
    expect(new Set(values.map((value) => Math.round(value * 100))).size).toBeGreaterThan(35);
  });
});
