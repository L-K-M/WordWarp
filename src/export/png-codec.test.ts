import { decode } from 'fast-png';
import { describe, expect, it } from 'vitest';

import { encodePngPixels } from './png-codec';

describe('PNG codec', () => {
  it('preserves straight RGBA including transparent pixels', async () => {
    const pixels = new Uint8ClampedArray([
      255, 40, 80, 255,
      0, 0, 0, 0,
      20, 180, 255, 96,
      255, 255, 255, 255,
    ]);

    const encoded = await encodePngPixels(pixels, 2, 2);
    const decoded = decode(encoded);

    expect(decoded.width).toBe(2);
    expect(decoded.height).toBe(2);
    expect(decoded.channels).toBe(4);
    expect([...decoded.data]).toEqual([...pixels]);
  });
});
