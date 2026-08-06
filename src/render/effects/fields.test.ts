import { describe, expect, it } from 'vitest';

import { blurAlpha, signedDistanceField } from './fields';

describe('effect fields', () => {
  it('builds a signed field with negative interior values', () => {
    const alpha = new Uint8Array(7 * 7);
    for (let y = 2; y <= 4; y += 1) {
      for (let x = 2; x <= 4; x += 1) alpha[y * 7 + x] = 255;
    }

    const distance = signedDistanceField(alpha, 7, 7);

    expect(distance[3 * 7 + 3]).toBeLessThan(0);
    expect(distance[0]).toBeGreaterThan(0);
    expect(Math.abs(distance[3 * 7 + 1]!)).toBeCloseTo(1);
  });

  it('blurs alpha symmetrically without changing total energy materially', () => {
    const alpha = new Uint8Array(9 * 9);
    alpha[4 * 9 + 4] = 255;

    const blurred = blurAlpha(alpha, 9, 9, 1);
    const sum = [...blurred].reduce((total, value) => total + value, 0);

    expect(blurred[4 * 9 + 3]).toBe(blurred[4 * 9 + 5]);
    expect(blurred[3 * 9 + 4]).toBe(blurred[5 * 9 + 4]);
    expect(sum).toBeGreaterThan(245);
    expect(sum).toBeLessThan(265);
  });
});
