import { boundsFromPoints, EMPTY_BOUNDS, type Bounds } from './bounds';
import type { Point, Transform } from '../model/types';

export type Matrix = [number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix = [1, 0, 0, 1, 0, 0];

export function multiplyMatrix(left: Matrix, right: Matrix): Matrix {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

export function translationMatrix(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function scaleMatrix(x: number, y: number): Matrix {
  return [x, 0, 0, y, 0, 0];
}

export function rotationMatrix(degrees: number): Matrix {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [cosine, sine, -sine, cosine, 0, 0];
}

export function skewMatrix(xDegrees: number, yDegrees: number): Matrix {
  return [1, Math.tan((yDegrees * Math.PI) / 180), Math.tan((xDegrees * Math.PI) / 180), 1, 0, 0];
}

export function elementMatrix(transform: Transform, localBounds: Bounds = EMPTY_BOUNDS): Matrix {
  const originX = localBounds.x + localBounds.width * transform.originX;
  const originY = localBounds.y + localBounds.height * transform.originY;
  return [
    translationMatrix(transform.x, transform.y),
    rotationMatrix(transform.rotation),
    scaleMatrix(transform.scaleX, transform.scaleY),
    skewMatrix(transform.skewX, transform.skewY),
    translationMatrix(-originX, -originY),
  ].reduce(multiplyMatrix, IDENTITY_MATRIX);
}

export function applyMatrix(matrix: Matrix, [x, y]: Point): Point {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
}

/**
 * Carry a *direction* through a matrix, leaving the translation behind.
 *
 * Handle geometry is full of differences between two points -- the span of an edge, how far a
 * pointer travelled -- and a difference has no position to translate. Subtracting two
 * `applyMatrix` results would cancel the translation anyway; this says so directly.
 */
export function applyMatrixVector(matrix: Matrix, [x, y]: Point): Point {
  return [matrix[0] * x + matrix[2] * y, matrix[1] * x + matrix[3] * y];
}

/** The inverse mapping, or `null` for a matrix that has collapsed the plane onto a line. */
export function invertMatrix(matrix: Matrix): Matrix | null {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) return null;
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

/**
 * The element matrix without its translation: rotation, then scale, then skew.
 *
 * `elementMatrix` sandwiches this between the two translations that move the transform origin to
 * the position on the canvas. Direct manipulation needs the middle on its own, because solving for
 * a new scale or skew means undoing the parts of it that are staying put.
 */
export function elementLinearMatrix(transform: Transform): Matrix {
  return multiplyMatrix(
    rotationMatrix(transform.rotation),
    multiplyMatrix(
      scaleMatrix(transform.scaleX, transform.scaleY),
      skewMatrix(transform.skewX, transform.skewY),
    ),
  );
}

export function transformBounds(bounds: Bounds, matrix: Matrix): Bounds {
  return boundsFromPoints([
    applyMatrix(matrix, [bounds.x, bounds.y]),
    applyMatrix(matrix, [bounds.x + bounds.width, bounds.y]),
    applyMatrix(matrix, [bounds.x + bounds.width, bounds.y + bounds.height]),
    applyMatrix(matrix, [bounds.x, bounds.y + bounds.height]),
  ]);
}
