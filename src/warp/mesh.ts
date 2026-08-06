import type { Point } from '../model/types';

export function mapMeshPoint(
  u: number,
  v: number,
  mesh: { cols: number; rows: number; points: number[] },
): Point {
  const scaledX = clamp01(u) * mesh.cols;
  const scaledY = clamp01(v) * mesh.rows;
  const column = Math.min(mesh.cols - 1, Math.floor(scaledX));
  const row = Math.min(mesh.rows - 1, Math.floor(scaledY));
  const localX = scaledX - column;
  const localY = scaledY - row;
  const topLeft = readPoint(mesh, column, row);
  const topRight = readPoint(mesh, column + 1, row);
  const bottomLeft = readPoint(mesh, column, row + 1);
  const bottomRight = readPoint(mesh, column + 1, row + 1);
  return [
    bilinear(topLeft[0], topRight[0], bottomLeft[0], bottomRight[0], localX, localY),
    bilinear(topLeft[1], topRight[1], bottomLeft[1], bottomRight[1], localX, localY),
  ];
}

function readPoint(mesh: { cols: number; points: number[] }, column: number, row: number): Point {
  const index = (row * (mesh.cols + 1) + column) * 2;
  return [mesh.points[index] ?? 0, mesh.points[index + 1] ?? 0];
}

function bilinear(
  topLeft: number,
  topRight: number,
  bottomLeft: number,
  bottomRight: number,
  x: number,
  y: number,
): number {
  const top = topLeft + (topRight - topLeft) * x;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * x;
  return top + (bottom - top) * y;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
