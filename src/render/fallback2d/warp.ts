import { boundsFromPoints, type Bounds } from '../../geometry/bounds';
import type { Point, WarpSpec } from '../../model/types';
import type { TextContext } from '../../text/layout';
import { mapWarpPoint } from '../../warp';
import type { CanvasSurface } from '../surface';

/**
 * How far past its true edge each triangle's clip reaches, in device pixels.
 *
 * An accelerated Canvas2D anti-aliases `clip()`. Two triangles that merely abut therefore each
 * cover the pixels along their shared edge only partially, and compositing two partial covers
 * cannot reach full opacity: the mesh prints a lattice of alpha holes straight through the glyph.
 * Overlapping the clips by half a pixel lets the second triangle cover the seam outright. The
 * affine mapping stays keyed to the true triangle, so the bleed only ever paints a neighbour's
 * pixels with the neighbour's own -- continuous -- mapping extrapolated a fraction of a pixel.
 */
const CLIP_BLEED_PIXELS = 0.5;

/**
 * Ceiling on how much the bleed may grow a triangle.
 *
 * A sliver has almost no inradius, so the factor that would move its edges out by half a pixel
 * would instead blow it up across the glyph. A triangle that thin has no pixel interior to seam.
 */
const MAX_CLIP_GROWTH = 3;

export function drawWarpedSurface(
  context: TextContext,
  source: CanvasSurface,
  bounds: Bounds,
  warp: WarpSpec,
): void {
  if (isIdentityWarp(warp)) {
    context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height);
    return;
  }

  const bleed = clipBleed(context);
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
      drawImageTriangle(context, source, [sourceTopLeft, sourceTopRight, sourceBottomRight], [topLeft, topRight, bottomRight], bleed);
      drawImageTriangle(context, source, [sourceTopLeft, sourceBottomRight, sourceBottomLeft], [topLeft, bottomRight, bottomLeft], bleed);
    }
  }
}

export function isIdentityWarp(warp: WarpSpec): boolean {
  if (warp.kind === 'none') return true;
  if (warp.kind !== 'preset') return false;
  if (warp.distortH !== 0 || warp.distortV !== 0) return false;
  // `textPlain` and `textNoShape` are the shapeless entries in the preset table and map every
  // point to itself whatever the bend is, as does a preset warp that names no preset at all.
  // Resampling through the mesh for those is pure loss: it costs a full pass and can only make
  // the glyph softer than the source it started from.
  return Math.abs(warp.bend) < 1e-8 || !warp.preset || warp.preset === 'textPlain' || warp.preset === 'textNoShape';
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
  bleed: number,
): void {
  const matrix = affineFromTriangles(sourcePoints, destinationPoints);
  if (!matrix) return;
  const clip = outsetTriangle(destinationPoints, bleed);
  context.save();
  context.beginPath();
  context.moveTo(...clip[0]);
  context.lineTo(...clip[1]);
  context.lineTo(...clip[2]);
  context.closePath();
  context.clip();
  context.transform(...matrix);
  context.drawImage(source, 0, 0);
  context.restore();
}

/** Half a device pixel, expressed in the context's current user space. */
function clipBleed(context: TextContext): number {
  const { a, b, c, d } = context.getTransform();
  // The square root of the determinant is the geometric mean of the transform's singular values:
  // one number for a matrix that may scale, rotate and skew at once, and exact whenever the
  // scaling is uniform, which is the case for every transform this renderer builds.
  const scale = Math.sqrt(Math.abs(a * d - b * c));
  return scale > 1e-6 ? CLIP_BLEED_PIXELS / scale : CLIP_BLEED_PIXELS;
}

/**
 * Grow a triangle so that every edge moves `bleed` outward.
 *
 * Scaling about the incentre is what makes one factor enough: it is the single point equidistant
 * from all three edges, so a uniform scale about it moves each of them by the same amount.
 */
export function outsetTriangle(points: [Point, Point, Point], bleed: number): [Point, Point, Point] {
  const [p0, p1, p2] = points;
  const a = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
  const b = Math.hypot(p2[0] - p0[0], p2[1] - p0[1]);
  const c = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]);
  const perimeter = a + b + c;
  if (!(perimeter > 0) || !(bleed > 0)) return points;
  const centerX = (a * p0[0] + b * p1[0] + c * p2[0]) / perimeter;
  const centerY = (a * p0[1] + b * p1[1] + c * p2[1]) / perimeter;
  const area = Math.abs((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1])) / 2;
  const inradius = (2 * area) / perimeter;
  const factor = inradius > 0 ? Math.min(MAX_CLIP_GROWTH, 1 + bleed / inradius) : MAX_CLIP_GROWTH;
  return [
    [centerX + (p0[0] - centerX) * factor, centerY + (p0[1] - centerY) * factor],
    [centerX + (p1[0] - centerX) * factor, centerY + (p1[1] - centerY) * factor],
    [centerX + (p2[0] - centerX) * factor, centerY + (p2[1] - centerY) * factor],
  ];
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
