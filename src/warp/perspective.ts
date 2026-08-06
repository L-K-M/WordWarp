import type { Point } from '../model/types';

export function mapPerspectivePoint(u: number, v: number, [p0, p1, p2, p3]: [Point, Point, Point, Point]): Point {
  const dx1 = p1[0] - p2[0];
  const dx2 = p3[0] - p2[0];
  const dx3 = p0[0] - p1[0] + p2[0] - p3[0];
  const dy1 = p1[1] - p2[1];
  const dy2 = p3[1] - p2[1];
  const dy3 = p0[1] - p1[1] + p2[1] - p3[1];
  const denominator = dx1 * dy2 - dx2 * dy1;

  let g = 0;
  let h = 0;
  if (Math.abs(denominator) > 1e-9) {
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }

  const a = p1[0] - p0[0] + g * p1[0];
  const b = p3[0] - p0[0] + h * p3[0];
  const c = p0[0];
  const d = p1[1] - p0[1] + g * p1[1];
  const e = p3[1] - p0[1] + h * p3[1];
  const f = p0[1];
  const divisor = g * u + h * v + 1;
  if (Math.abs(divisor) < 1e-9) return [Number.NaN, Number.NaN];
  return [(a * u + b * v + c) / divisor, (d * u + e * v + f) / divisor];
}
