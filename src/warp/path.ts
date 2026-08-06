import { flattenPath } from '../geometry/path';
import type { PathData, Point } from '../model/types';

export function mapPathPoint(u: number, v: number, path: PathData): Point {
  const points = flattenPath(path, { tolerance: 0.002 }).flat();
  if (points.length < 2) return [u, v];
  const lengths = [0];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index]![0] - points[index - 1]![0], points[index]![1] - points[index - 1]![1]);
    lengths.push(total);
  }
  if (total === 0) return [u, v];
  const target = clamp01(u) * total;
  let segment = 1;
  while (segment < lengths.length - 1 && lengths[segment]! < target) segment += 1;
  const start = points[segment - 1]!;
  const end = points[segment]!;
  const segmentLength = lengths[segment]! - lengths[segment - 1]!;
  const amount = segmentLength === 0 ? 0 : (target - lengths[segment - 1]!) / segmentLength;
  const center: Point = [mix(start[0], end[0], amount), mix(start[1], end[1], amount)];
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const magnitude = Math.hypot(dx, dy) || 1;
  const offset = v - 0.5;
  return [center[0] - (dy / magnitude) * offset, center[1] + (dx / magnitude) * offset];
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
