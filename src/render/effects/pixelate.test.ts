import { describe, expect, it } from 'vitest';

import { createEffect } from '../../effects/defaults';
import { effectReach } from '../fallback2d/renderer';
import { averageBlock, pixelateBlocks } from './cpu-effects';

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

describe('pixelate block pass', () => {
  const run = (
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options: { originX?: number; originY?: number; block: number; crisp?: boolean },
  ) => {
    const out = data.slice();
    pixelateBlocks(data, out, width, height, {
      originX: options.originX ?? 0,
      originY: options.originY ?? 0,
      block: options.block,
      crisp: options.crisp ?? true,
    });
    return out;
  };
  const at = (data: Uint8ClampedArray, width: number, x: number, y: number) =>
    [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];

  it('flattens each block to one colour', () => {
    const data = surface(4, 4, (x, y) => [x * 60, y * 60, 0, 255]);
    const out = run(data, 4, 4, { block: 4 });
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) expect(at(out, 4, x, y)).toEqual(at(out, 4, 0, 0));
    }
  });

  it('rounds a mostly-empty block out and zeroes its colour with it', () => {
    // Left block fully covered, right block only a quarter covered: crisp mode drops it.
    const data = surface(8, 4, (x, y) => {
      if (x < 4) return [255, 0, 0, 255];
      return [0, 255, 0, y === 0 ? 255 : 0];
    });
    const out = run(data, 8, 4, { block: 4 });
    expect(at(out, 8, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(at(out, 8, 5, 1)).toEqual([0, 0, 0, 0]);
  });

  it('keeps partial coverage when crisp is off', () => {
    const data = surface(8, 4, (x, y) => (x < 4 ? [255, 0, 0, 255] : [0, 255, 0, y === 0 ? 255 : 0]));
    const out = run(data, 8, 4, { block: 4, crisp: false });
    expect(at(out, 8, 5, 1)).toEqual([0, 255, 0, 64]);
  });

  it('lands blocks on the same grid whatever offset the tile starts at', () => {
    // The whole point of indexing blocks globally. A 12-wide strip quantised in one pass, then the
    // same strip rendered as two tiles that meet part-way through a block: the second tile has to
    // continue the first tile's grid, not restart at its own left edge.
    const width = 12;
    const data = surface(width, 1, (x) => [x * 20, 0, 0, 255]);
    const whole = run(data, width, 1, { block: 5 });

    const left = data.slice(0, 7 * 4);
    const right = data.slice(5 * 4);
    const leftOut = run(left, 7, 1, { block: 5 });
    const rightOut = run(right, 7, 1, { originX: 5, block: 5 });

    // Compare where each tile's blocks are complete: x 0..4 in the left tile, x 5..11 in the right.
    for (let x = 0; x < 5; x += 1) expect(at(leftOut, 7, x, 0), `left ${x}`).toEqual(at(whole, width, x, 0));
    for (let x = 5; x < width; x += 1) {
      expect(at(rightOut, 7, x - 5, 0), `right ${x}`).toEqual(at(whole, width, x, 0));
    }
  });

  it('keeps a block whose coverage lands exactly on the threshold', () => {
    // Eight pixels at 255 and eight at 1 average to exactly 128, and the rule is `>= 128`, so the
    // block is kept. Flipping it to `>` would drop it. (An exactly half-covered block averages
    // 127.5 and is dropped -- the boundary sits between the two, which is why it takes a
    // contrived alpha to land on it.)
    const data = surface(4, 4, (_x, y) => [70, 140, 210, y < 2 ? 255 : 1]);
    const out = run(data, 4, 4, { block: 4 });
    expect(at(out, 4, 0, 0)).toEqual([70, 140, 210, 255]);
  });

  it('zeroes a block that has nothing in it at all', () => {
    const data = surface(4, 4, () => [90, 90, 90, 0]);
    const out = run(data, 4, 4, { block: 4 });
    expect(at(out, 4, 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('covers every pixel of a surface that is not a whole number of blocks', () => {
    const data = surface(7, 3, () => [10, 20, 30, 200]);
    const out = run(data, 7, 3, { block: 4, crisp: false });
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 7; x += 1) expect(at(out, 7, x, y), `${x},${y}`).toEqual([10, 20, 30, 200]);
    }
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
