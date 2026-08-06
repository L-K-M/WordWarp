import { describe, expect, it } from 'vitest';

import { PRESET_WARP_IDS, type WarpSpec } from '../model/types';
import { isIdentityWarp } from '../render/fallback2d/warp';
import { mapWarpPoint } from './index';
import { mapPathPoint } from './path';
import { mapPerspectivePoint } from './perspective';

const baseWarp = (preset: (typeof PRESET_WARP_IDS)[number], bend: number): WarpSpec => ({
  kind: 'preset',
  preset,
  adj: [0.5, 0.5],
  bend,
  distortH: 0,
  distortV: 0,
  keepUpright: false,
});

describe('preset warps', () => {
  it('exposes every OOXML preset exactly once', () => {
    expect(PRESET_WARP_IDS).toHaveLength(41);
    expect(new Set(PRESET_WARP_IDS).size).toBe(41);
  });

  it('is an exact identity at zero bend', () => {
    for (const preset of PRESET_WARP_IDS) {
      expect(mapWarpPoint(0.27, 0.81, baseWarp(preset, 0))).toEqual([0.27, 0.81]);
    }
  });

  it('returns finite bounded mappings across every preset', () => {
    for (const preset of PRESET_WARP_IDS) {
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        for (const v of [0, 0.5, 1]) {
          const point = mapWarpPoint(u, v, baseWarp(preset, 0.8));
          expect(Number.isFinite(point[0]), preset).toBe(true);
          expect(Number.isFinite(point[1]), preset).toBe(true);
          expect(Math.abs(point[0]), preset).toBeLessThan(4);
          expect(Math.abs(point[1]), preset).toBeLessThan(4);
        }
      }
    }
  });

  it('inflates the center more than the edges', () => {
    const warp = baseWarp('textInflate', 1);
    const leftHeight = mapWarpPoint(0, 1, warp)[1] - mapWarpPoint(0, 0, warp)[1];
    const centerHeight = mapWarpPoint(0.5, 1, warp)[1] - mapWarpPoint(0.5, 0, warp)[1];
    expect(centerHeight).toBeGreaterThan(leftHeight);
  });

  it('keeps bending past a bend of 1 instead of saturating', () => {
    // The bend used to be clamped to 1 inside the mapping, so the slider's upper half did
    // nothing at all: every value above 1 produced the identical shape.
    const displacement = (bend: number) => Math.abs(mapWarpPoint(0.5, 0, baseWarp('textCurveUp', bend))[1] - 0);

    const atOne = displacement(1);
    const atTwo = displacement(2);
    expect(atTwo).toBeGreaterThan(atOne * 1.5);

    // And it still stops somewhere, rather than running away with an out-of-range document.
    expect(displacement(9)).toBeCloseTo(atTwo, 6);
  });

  it('keeps shaping past an adjustment of 1, without folding the text back on itself', () => {
    const curve = (adjustment: number) => {
      const warp = { ...baseWarp('textCurveUp', 1), adj: [adjustment, 0.5] as [number, number] };
      return Math.abs(mapWarpPoint(0.5, 0.5, warp)[1] - mapWarpPoint(0, 0.5, warp)[1]);
    };
    expect(curve(2)).toBeGreaterThan(curve(1) * 1.5);

    // The arch is the one shape with a geometric ceiling, and it has to hold: past half a turn
    // its horizontal mapping stops being monotonic, glyphs swap places, and the word reads
    // backwards through the middle.
    for (const adjustment of [0, 0.5, 1, 1.5, 2]) {
      const warp = { ...baseWarp('textArchUp', 1), adj: [adjustment, 0.5] as [number, number] };
      let previous = Number.NEGATIVE_INFINITY;
      for (let step = 0; step <= 20; step += 1) {
        const x = mapWarpPoint(step / 20, 0.5, warp)[0];
        expect(x, `adj ${adjustment}`).toBeGreaterThan(previous);
        previous = x;
      }
    }
  });

  it('does not treat zero bend with distortion as identity', () => {
    const warp = { ...baseWarp('textWave1', 0), distortH: 0.5 };
    expect(isIdentityWarp(warp)).toBe(false);
    expect(mapWarpPoint(0.2, 0, warp)).not.toEqual([0.2, 0]);
  });
});

describe('perspective warp', () => {
  it('maps all unit-square corners exactly', () => {
    const corners: [[number, number], [number, number], [number, number], [number, number]] = [
      [0.1, 0.2], [0.9, 0], [1, 0.85], [0, 1],
    ];
    expect(mapPerspectivePoint(0, 0, corners)).toEqual(corners[0]);
    expect(mapPerspectivePoint(1, 0, corners)).toEqual(corners[1]);
    expect(mapPerspectivePoint(1, 1, corners)[0]).toBeCloseTo(corners[2][0]);
    expect(mapPerspectivePoint(1, 1, corners)[1]).toBeCloseTo(corners[2][1]);
    expect(mapPerspectivePoint(0, 1, corners)[0]).toBeCloseTo(corners[3][0]);
    expect(mapPerspectivePoint(0, 1, corners)[1]).toBeCloseTo(corners[3][1]);
  });
});

describe('path warp', () => {
  it('uses one continuous subpath instead of measuring jumps between moves', () => {
    const point = mapPathPoint(0.5, 0.5, {
      commands: [
        { type: 'M', point: [0, 0] },
        { type: 'L', point: [0.1, 0] },
        { type: 'M', point: [0, 1] },
        { type: 'L', point: [1, 1] },
      ],
    });

    expect(point[0]).toBeCloseTo(0.5);
    expect(point[1]).toBeCloseTo(1);
  });
});
