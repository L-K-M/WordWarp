import { describe, expect, it } from 'vitest';

import { applyMatrix, elementMatrix, multiplyMatrix, rotationMatrix, transformBounds, translationMatrix } from './matrix';

describe('matrix geometry', () => {
  it('composes transforms from right to left', () => {
    const matrix = multiplyMatrix(translationMatrix(10, 20), rotationMatrix(90));

    const [x, y] = applyMatrix(matrix, [5, 0]);
    expect(x).toBeCloseTo(10);
    expect(y).toBeCloseTo(25);
  });

  it('builds the complete element transform', () => {
    const matrix = elementMatrix({
      x: 50,
      y: 70,
      rotation: 0,
      scaleX: 2,
      scaleY: 3,
      skewX: 0,
      skewY: 0,
      originX: 0.5,
      originY: 0.5,
    });

    expect(applyMatrix(matrix, [4, 5])).toEqual([58, 85]);
  });

  it('returns an axis-aligned bound for rotated geometry', () => {
    const result = transformBounds(
      { x: 0, y: 0, width: 10, height: 20 },
      rotationMatrix(90),
    );

    expect(result.x).toBeCloseTo(-20);
    expect(result.y).toBeCloseTo(0);
    expect(result.width).toBeCloseTo(20);
    expect(result.height).toBeCloseTo(10);
  });
});
