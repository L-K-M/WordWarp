import { describe, expect, it } from 'vitest';

import { createEffect } from '../../effects/defaults';
import { effectReach } from '../fallback2d/renderer';
import { averageBlock } from './cpu-effects';

/** Build a `width x height` RGBA buffer from a per-pixel callback. */
function surface(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number, number],
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return data;
}

describe('pixelate block average', () => {
  it('leaves a uniform block exactly as it found it', () => {
    const data = surface(4, 4, () => [30, 120, 210, 255]);
    expect(averageBlock(data, 4, 0, 0, 4, 4)).toEqual([30, 120, 210, 255]);
  });

  it('ignores the colour of transparent pixels', () => {
    // This is the reason for premultiplying. Half the block is opaque red; the other half is
    // fully transparent but carries a leftover white in its colour channels. A straight RGBA
    // average would return a pink block -- the halo you get around a naively downsampled sprite.
    // Weighting by alpha gives back the red that is actually there.
    const data = surface(4, 4, (x) => (x < 2 ? [255, 0, 0, 255] : [255, 255, 255, 0]));
    const mean = averageBlock(data, 4, 0, 0, 4, 4);
    expect(mean?.slice(0, 3)).toEqual([255, 0, 0]);
    expect(mean?.[3]).toBeCloseTo(127.5, 5);
  });

  it('reports coverage as a plain mean over the block', () => {
    const data = surface(4, 4, (_x, y) => [10, 20, 30, y === 0 ? 255 : 0]);
    expect(averageBlock(data, 4, 0, 0, 4, 4)?.[3]).toBeCloseTo(255 / 4, 5);
  });

  it('survives a completely empty block without dividing by zero', () => {
    const data = surface(4, 4, () => [200, 200, 200, 0]);
    expect(averageBlock(data, 4, 0, 0, 4, 4)).toEqual([0, 0, 0, 0]);
  });

  it('returns null for a rectangle with no pixels in it', () => {
    const data = surface(4, 4, () => [0, 0, 0, 255]);
    expect(averageBlock(data, 4, 2, 2, 2, 4)).toBeNull();
  });

  it('averages only the requested rectangle', () => {
    const data = surface(4, 4, (x) => (x < 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    expect(averageBlock(data, 4, 0, 0, 2, 4)).toEqual([0, 0, 0, 255]);
    expect(averageBlock(data, 4, 2, 0, 4, 4)).toEqual([255, 255, 255, 255]);
  });
});

describe('pixelate tiling reach', () => {
  const pixelateEffect = (params: Record<string, number | string | boolean>) => {
    const effect = createEffect('post');
    effect.type = 'pixelate';
    effect.params = params;
    return effect;
  };

  it('reserves a block of halo, so a tiled export completes every core pixel block', () => {
    // A block spans up to its own width of neighbouring pixels. Without this the block averages
    // along a tile boundary would be taken over partial blocks and the seam would be visible.
    expect(effectReach(pixelateEffect({ size: 12 }))).toBe(12);
    expect(effectReach(pixelateEffect({ size: 3 }))).toBe(3);
  });

  it('falls back to the renderer default when the size is missing or unusable', () => {
    expect(effectReach(pixelateEffect({}))).toBe(8);
    expect(effectReach(pixelateEffect({ size: 'chunky' }))).toBe(8);
    expect(effectReach(pixelateEffect({ size: 0 }))).toBe(1);
  });
});
