import { describe, expect, it } from 'vitest';

import { PRESET_WARP_IDS, type WarpSpec } from '../model/types';
import { mapWarpPoint } from './index';
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
