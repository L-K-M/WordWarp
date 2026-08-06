import { describe, expect, it } from 'vitest';

import { encodeApng, encodeGif } from './animation-codec';

const frame = (red: number, alpha = 255) => new Uint8Array([
  red, 0, 255 - red, alpha,
  0, 255, 0, 255,
  255, 255, 255, 255,
  0, 0, 0, 0,
]).buffer;

describe('animation codecs', () => {
  it('encodes a looping APNG with the PNG signature', () => {
    const bytes = encodeApng([frame(255), frame(0)], 2, 2, [80, 80]);
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(new TextDecoder().decode(bytes).includes('acTL')).toBe(true);
  });

  it('encodes a transparent animated GIF', () => {
    const bytes = encodeGif([frame(255), frame(0, 80)], 2, 2, [80, 80]);
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe('GIF89a');
    expect(bytes.at(-1)).toBe(0x3b);
  });

  it('rejects missing and incorrectly sized frames', () => {
    expect(() => encodeGif([], 1, 1, [])).toThrow('non-empty');
    expect(() => encodeApng([new ArrayBuffer(3)], 1, 1, [80])).toThrow('dimensions');
  });
});
