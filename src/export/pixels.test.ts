import { describe, expect, it } from 'vitest';

import { flipPixelRows, unpremultiplyPixels } from './pixels';

describe('export pixel conversion', () => {
  it('unpremultiplies visible pixels and zeros hidden color', () => {
    const pixels = new Uint8ClampedArray([
      64, 32, 16, 128,
      99, 88, 77, 0,
    ]);

    unpremultiplyPixels(pixels);

    expect([...pixels]).toEqual([128, 64, 32, 128, 0, 0, 0, 0]);
  });

  it('flips bottom-up rows in place', () => {
    const pixels = new Uint8ClampedArray([
      1, 0, 0, 255,
      2, 0, 0, 255,
      3, 0, 0, 255,
      4, 0, 0, 255,
    ]);

    flipPixelRows(pixels, 2, 2);

    expect([...pixels]).toEqual([
      3, 0, 0, 255,
      4, 0, 0, 255,
      1, 0, 0, 255,
      2, 0, 0, 255,
    ]);
  });
});
