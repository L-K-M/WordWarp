import { boundsFromPoints, type Bounds } from '../../geometry/bounds';
import type { Point, WarpSpec } from '../../model/types';
import type { TextContext } from '../../text/layout';
import { mapWarpPoint } from '../../warp';
import type { CanvasSurface } from '../surface';

export function drawWarpedSurface(
  context: TextContext,
  source: CanvasSurface,
  bounds: Bounds,
  warp: WarpSpec,
): void {
  if (warp.kind === 'none' || (warp.kind === 'preset' && Math.abs(warp.bend) < 1e-8)) {
    context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height);
    return;
  }

  const columns = warp.kind === 'mesh' ? Math.max(8, (warp.mesh?.cols ?? 4) * 4) : 24;
  const rows = warp.kind === 'mesh' ? Math.max(6, (warp.mesh?.rows ?? 3) * 4) : 12;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const u0 = column / columns;
      const u1 = (column + 1) / columns;
      const v0 = row / rows;
      const v1 = (row + 1) / rows;
      const sourceTopLeft: Point = [u0 * source.width, v0 * source.height];
      const sourceTopRight: Point = [u1 * source.width, v0 * source.height];
      const sourceBottomRight: Point = [u1 * source.width, v1 * source.height];
      const sourceBottomLeft: Point = [u0 * source.width, v1 * source.height];
      const topLeft = toLocal(mapWarpPoint(u0, v0, warp), bounds);
      const topRight = toLocal(mapWarpPoint(u1, v0, warp), bounds);
      const bottomRight = toLocal(mapWarpPoint(u1, v1, warp), bounds);
      const bottomLeft = toLocal(mapWarpPoint(u0, v1, warp), bounds);
      drawImageTriangle(context, source, [sourceTopLeft, sourceTopRight, sourceBottomRight], [topLeft, topRight, bottomRight]);
      drawImageTriangle(context, source, [sourceTopLeft, sourceBottomRight, sourceBottomLeft], [topLeft, bottomRight, bottomLeft]);
    }
  }
}

export function getWarpedBounds(bounds: Bounds, warp: WarpSpec): Bounds {
  if (warp.kind === 'none') return bounds;
  const points: Point[] = [];
  for (let row = 0; row <= 12; row += 1) {
    for (let column = 0; column <= 24; column += 1) {
      points.push(toLocal(mapWarpPoint(column / 24, row / 12, warp), bounds));
    }
  }
  return boundsFromPoints(points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
}

function drawImageTriangle(
  context: TextContext,
  source: CanvasSurface,
  sourcePoints: [Point, Point, Point],
  destinationPoints: [Point, Point, Point],
): void {
  const matrix = affineFromTriangles(sourcePoints, destinationPoints);
  if (!matrix) return;
  context.save();
  context.beginPath();
  context.moveTo(...destinationPoints[0]);
  context.lineTo(...destinationPoints[1]);
  context.lineTo(...destinationPoints[2]);
  context.closePath();
  context.clip();
  context.transform(...matrix);
  context.drawImage(source, 0, 0);
  context.restore();
}

function affineFromTriangles(
  source: [Point, Point, Point],
  destination: [Point, Point, Point],
): [number, number, number, number, number, number] | null {
  const [[x0, y0], [x1, y1], [x2, y2]] = source;
  const [[u0, v0], [u1, v1], [u2, v2]] = destination;
  const determinant = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(determinant) < 1e-9) return null;
  return [
    (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / determinant,
    (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / determinant,
    (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / determinant,
    (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / determinant,
    (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / determinant,
    (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / determinant,
  ];
}

function toLocal([x, y]: Point, bounds: Bounds): Point {
  return [bounds.x + x * bounds.width, bounds.y + y * bounds.height];
}
