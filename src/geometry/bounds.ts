import type { Point } from '../model/types';

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EMPTY_BOUNDS: Bounds = { x: 0, y: 0, width: 0, height: 0 };

export function boundsFromPoints(points: readonly Point[]): Bounds {
  if (points.length === 0) return { ...EMPTY_BOUNDS };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

export function expandBounds(bounds: Bounds, amountX: number, amountY = amountX): Bounds {
  return {
    x: bounds.x - amountX,
    y: bounds.y - amountY,
    width: bounds.width + amountX * 2,
    height: bounds.height + amountY * 2,
  };
}

export function containsPoint(bounds: Bounds, point: Point): boolean {
  return (
    point[0] >= bounds.x &&
    point[0] <= bounds.x + bounds.width &&
    point[1] >= bounds.y &&
    point[1] <= bounds.y + bounds.height
  );
}

export function roundOutBounds(bounds: Bounds): Bounds {
  const x = Math.floor(bounds.x);
  const y = Math.floor(bounds.y);
  const right = Math.ceil(bounds.x + bounds.width);
  const bottom = Math.ceil(bounds.y + bounds.height);
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}
