import { describe, expect, it } from 'vitest';

import { exactPathBounds, flattenPath, pathBounds } from './path';

describe('path flattening', () => {
  it('measures Bezier extrema between endpoints exactly', () => {
    const bounds = exactPathBounds({ commands: [
      { type: 'M', point: [0, 0] },
      { type: 'C', control1: [100, 100], control2: [-100, 100], point: [0, 0] },
      { type: 'Q', control: [0, -40], point: [20, 0] },
      { type: 'Z' },
    ] });

    expect(bounds.x).toBeCloseTo(-28.8675, 3);
    expect(bounds.x + bounds.width).toBeCloseTo(28.8675, 3);
    expect(bounds.y).toBeCloseTo(-20, 5);
    expect(bounds.y + bounds.height).toBeCloseTo(75, 5);
  });

  it('preserves lines, closure, and contour bounds', () => {
    const contours = flattenPath({
      commands: [
        { type: 'M', point: [2, 3] },
        { type: 'L', point: [12, 3] },
        { type: 'L', point: [12, 8] },
        { type: 'Z' },
      ],
    });

    expect(contours).toEqual([[[2, 3], [12, 3], [12, 8], [2, 3]]]);
    expect(pathBounds(contours)).toEqual({ x: 2, y: 3, width: 10, height: 5 });
  });

  it('adaptively subdivides curved segments while retaining endpoints', () => {
    const contours = flattenPath(
      {
        commands: [
          { type: 'M', point: [0, 0] },
          { type: 'Q', control: [50, 100], point: [100, 0] },
          { type: 'C', control1: [130, -50], control2: [170, 50], point: [200, 0] },
        ],
      },
      { tolerance: 0.25 },
    );

    expect(contours[0]!.length).toBeGreaterThan(20);
    expect(contours[0]![0]).toEqual([0, 0]);
    expect(contours[0]!.at(-1)).toEqual([200, 0]);
  });

  it('rejects drawing commands before an initial move', () => {
    expect(() => flattenPath({ commands: [{ type: 'L', point: [1, 1] }] })).toThrow(
      'requires an initial move',
    );
  });
});
