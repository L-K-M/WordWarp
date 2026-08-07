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

  it('keeps exact distances when row and column lengths differ', () => {
    const width = 3;
    const height = 7;
    const centerX = 1;
    const centerY = 3;
    const alpha = new Uint8Array(width * height);
    alpha[centerY * width + centerX] = 255;

    const distance = signedDistanceField(alpha, width, height);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const expected = x === centerX && y === centerY ? -1 : Math.hypot(x - centerX, y - centerY);
        expect(distance[y * width + x]).toBeCloseTo(expected);
      }
    }
  });

  it('resolves the edge to sub-pixel accuracy from partial coverage', () => {
    // A vertical edge whose boundary column is 25% covered: the true edge sits a quarter of a
    // pixel into that column, so the field there should read +0.25, not a whole-pixel distance.
    const width = 5;
    const alpha = new Uint8Array(width * 3);
    for (let y = 0; y < 3; y += 1) {
      alpha[y * width + 1] = 64;
      alpha[y * width + 2] = 255;
      alpha[y * width + 3] = 255;
    }

    const distance = signedDistanceField(alpha, width, 3);

    expect(distance[width + 1]).toBeCloseTo(0.5 - 64 / 255, 5);
    // Fully covered and fully empty pixels keep their transform distances.
    expect(distance[width + 2]).toBeLessThan(0);
    expect(distance[width + 0]).toBeGreaterThan(0);
  });

  it('does not read an edge out of a translucent interior', () => {
    // Partial coverage means "the edge runs through here" only for a pixel the edge runs through.
    // A fill at reduced opacity, or the seam where two warp triangles meet, is partly covered
    // everywhere; treating that as an edge stamped a boundary through the middle of the shape and
    // every effect downstream traced it -- a stroke down each mesh seam, a bevel that quilted.
    const width = 9;
    const height = 9;
    const alpha = new Uint8Array(width * height);
    for (let y = 2; y <= 6; y += 1) {
      for (let x = 2; x <= 6; x += 1) alpha[y * width + x] = 184;
    }

    const distance = signedDistanceField(alpha, width, height);

    // The centre is two pixels deep and must say so, not report itself a fifth of a pixel from an
    // edge that is not there.
    expect(distance[4 * width + 4]).toBeCloseTo(-3, 5);
    // The rim of the square is a real edge, and still resolves to sub-pixel accuracy.
    expect(distance[4 * width + 2]).toBeCloseTo(0.5 - 184 / 255, 5);
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
