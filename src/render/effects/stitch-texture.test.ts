import { describe, expect, it } from 'vitest';

import { sampleStitchTexture } from './cpu-effects';

describe('stitch procedural texture', () => {
  it('is deterministic while responding to its seed and direction', () => {
    const sample = (seed: number, rotation: number) => Array.from({ length: 32 }, (_, index) => (
      sampleStitchTexture(index * 1.7, index * 2.1, seed, 3.2, rotation)
    ));

    expect(sample(7391, -18)).toEqual(sample(7391, -18));
    expect(sample(7391, -18)).not.toEqual(sample(2801, -18));
    expect(sample(7391, -18)).not.toEqual(sample(7391, 24));
  });

  it('alternates deep grooves with bright twisted thread ridges', () => {
    const values: number[] = [];
    for (let y = 0; y < 48; y += 1) {
      for (let x = 0; x < 48; x += 1) values.push(sampleStitchTexture(x, y, 7391, 3.2, -18));
    }

    expect(Math.min(...values)).toBeLessThan(0.24);
    expect(Math.max(...values)).toBeGreaterThan(0.9);
    expect(values.filter((value) => value < 0.35).length).toBeGreaterThan(250);
    expect(values.filter((value) => value > 0.8).length).toBeGreaterThan(250);
  });
});
