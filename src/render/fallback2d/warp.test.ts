import { describe, expect, it } from 'vitest';

import type { Point, WarpSpec } from '../../model/types';
import { isIdentityWarp, outsetTriangle } from './warp';

const presetWarp = (preset: WarpSpec['preset'], bend: number): WarpSpec => ({
  kind: 'preset',
  preset,
  adj: [0.5, 0.5],
  bend,
  distortH: 0,
  distortV: 0,
  keepUpright: false,
});

/** Signed area doubled; positive when the winding matches the input triangle's. */
function cross([p0, p1, p2]: [Point, Point, Point]): number {
  return (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
}

/** Perpendicular distance from `point` to the line through `a` and `b`, positive outside the edge. */
function outwardDistance(point: Point, a: Point, b: Point, winding: number): number {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const side = ((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) / length;
  return winding > 0 ? -side : side;
}

/** Does `point` fall inside `triangle`, boundary included? */
function contains(triangle: [Point, Point, Point], point: Point): boolean {
  const winding = cross(triangle);
  const [p0, p1, p2] = triangle;
  return ([[p0, p1], [p1, p2], [p2, p0]] as [Point, Point][]).every(
    ([a, b]) => outwardDistance(point, a, b, winding) <= 0,
  );
}

describe('warp clip outset', () => {
  it('moves every edge outward by at least the requested bleed', () => {
    const triangles: [Point, Point, Point][] = [
      [[0, 0], [40, 0], [40, 20]],
      [[0, 0], [40, 20], [0, 20]],
      // Wound the other way, and thoroughly obtuse.
      [[10, 30], [4, 2], [80, 9]],
    ];

    for (const triangle of triangles) {
      const grown = outsetTriangle(triangle, 0.5);
      const winding = cross(triangle);
      const [g0, g1, g2] = grown;
      const [p0, p1, p2] = triangle;

      // Growing about the incentre keeps every edge parallel to the one it came from, so an edge's
      // midpoint moves by exactly the edge's outward offset -- and the incentre is equidistant from
      // all three, so one factor moves all three by the same amount.
      const edges: [Point, Point][] = [[p0, p1], [p1, p2], [p2, p0]];
      const grownEdges: [Point, Point][] = [[g0, g1], [g1, g2], [g2, g0]];
      for (let index = 0; index < 3; index += 1) {
        const [a, b] = grownEdges[index]!;
        const midpoint: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const [edgeStart, edgeEnd] = edges[index]!;
        expect(outwardDistance(midpoint, edgeStart, edgeEnd, winding)).toBeGreaterThanOrEqual(0.5 - 1e-9);
      }

      // Growing outward, never inward: the original triangle stays wholly inside the clip.
      for (const vertex of [p0, p1, p2]) expect(contains(grown, vertex)).toBe(true);
    }
  });

  it('makes the two triangles of a mesh cell overlap along their shared diagonal', () => {
    // The seam that printed a lattice through every warped glyph: an accelerated Canvas2D
    // anti-aliases `clip()`, so triangles that merely abut each cover the shared edge partially and
    // the composite never reaches full opacity. Overlapping clips are what close it.
    const topLeft: Point = [0, 0];
    const topRight: Point = [40, 0];
    const bottomRight: Point = [42, 21];
    const bottomLeft: Point = [1, 20];
    const upper = outsetTriangle([topLeft, topRight, bottomRight], 0.5);
    const lower = outsetTriangle([topLeft, bottomRight, bottomLeft], 0.5);

    for (let step = 1; step < 10; step += 1) {
      const amount = step / 10;
      const onDiagonal: Point = [
        topLeft[0] + (bottomRight[0] - topLeft[0]) * amount,
        topLeft[1] + (bottomRight[1] - topLeft[1]) * amount,
      ];
      expect(contains(upper, onDiagonal)).toBe(true);
      expect(contains(lower, onDiagonal)).toBe(true);
    }
  });

  it('caps the growth of a sliver instead of blowing it across the glyph', () => {
    const sliver: [Point, Point, Point] = [[0, 0], [100, 0], [100, 0.001]];
    const grown = outsetTriangle(sliver, 0.5);

    for (const [x, y] of grown) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
    // Three times the original is the ceiling, so a degenerate cell cannot reach outside its
    // neighbours and repaint them.
    expect(Math.abs(cross(grown))).toBeLessThanOrEqual(Math.abs(cross(sliver)) * 9 + 1e-9);
  });

  it('leaves a triangle alone when there is nothing to bleed', () => {
    const triangle: [Point, Point, Point] = [[0, 0], [10, 0], [10, 10]];
    expect(outsetTriangle(triangle, 0)).toEqual(triangle);
  });
});

describe('identity warps', () => {
  it('treats the shapeless presets as identity whatever the bend', () => {
    // `textPlain` and `textNoShape` map every point to itself, so resampling through the mesh can
    // only soften the glyph and print seams into it for no shape in return.
    expect(isIdentityWarp(presetWarp('textPlain', 0.9))).toBe(true);
    expect(isIdentityWarp(presetWarp('textNoShape', 0.9))).toBe(true);
    expect(isIdentityWarp(presetWarp(undefined, 0.9))).toBe(true);
  });

  it('still resamples a preset that actually bends, and any distortion at all', () => {
    expect(isIdentityWarp(presetWarp('textArchUp', 0.9))).toBe(false);
    expect(isIdentityWarp({ ...presetWarp('textPlain', 0), distortH: 0.4 })).toBe(false);
    expect(isIdentityWarp({ ...presetWarp('textNoShape', 0), distortV: 0.4 })).toBe(false);
  });
});
