import { exactPathBounds, flattenPath, pathBounds } from './path';
import { STAMP_FIGURES } from './stamp-figures';
import {
  KAPPA, ellipse, ellipseAt, mapPath, polygon, radialPoints, scalePath, smoothClosedPath,
  pathBuilder, strokeRibbon, withHoles,
} from './stamp-toolkit';
import type { PathData, Point, ShapeElement, StampId } from '../model/types';

/**
 * Outline generators for the stamp catalogue.
 *
 * Every generator returns a closed path in the element-local box from (0, 0) to (`width`,
 * `height`), which is the same space a detached `ShapeElement.path` lives in. Keeping both forms
 * in one space is what lets the renderer, the bounds pass and hit testing treat a generated stamp
 * and an edited one identically.
 *
 * The catalogue comes in two halves. The abstract marks below are parametric: a star is however
 * many points at whatever radii, and reads as itself at any proportion. The pictorial figures in
 * `stamp-figures.ts` are drawn, in a unit box, and scaled here -- a pumpkin has one shape and the
 * job is to get it right, not to parameterise it.
 *
 * Nothing here touches a canvas. Stamps are geometry, so they are testable as geometry -- a
 * generator can be checked for the box it fills and the commands it emits without a DOM.
 */

/**
 * Samples along one edge of a sampled ribbon.
 *
 * Sine ribbons are the one family here without an exact Bezier form, so they are flattened to line
 * segments up front. The count is fixed rather than scaled to the element, because a generator has
 * no idea what zoom or export scale it will eventually be drawn at -- and a stamp large enough for
 * 96 segments to show as facets is already far past the size anything in the catalogue is for.
 */
const RIBBON_SAMPLES = 96;

/**
 * The outline a shape element should be drawn from.
 *
 * A detached path wins over the generator: once geometry has been edited, regenerating it would
 * throw the edit away. `shape` is still carried on a detached element, but only as a record of
 * where the geometry started.
 */
export function shapeOutline(element: ShapeElement): PathData {
  return element.path ?? stampOutline(element.shape, element.width, element.height);
}

export function stampOutline(shape: StampId, width: number, height: number): PathData {
  if (
    !Number.isFinite(width) || !Number.isFinite(height) ||
    width <= 0 || height <= 0
  ) {
    throw new RangeError('Stamp dimensions must be finite positive numbers');
  }
  // Generate at the requested aspect ratio but bounded scale. Fitting then costs the same for a
  // picker icon and a large imported stamp, and the final affine map restores its requested size.
  const scale = Math.max(width, height);
  const designWidth = width / scale;
  const designHeight = height / scale;
  const fitted = fitToBox(generate(shape, designWidth, designHeight), designWidth, designHeight);
  return mapPath(fitted, ([x, y]) => [x * scale, y * scale]);
}

/**
 * The proportion a stamp is drawn at when nothing has resized it.
 *
 * Measured from the generator rather than declared beside it, so it cannot drift: a figure that is
 * redrawn wider arrives on the canvas wider, with no table to remember to update. It matters
 * because `fitToBox` stretches every outline to whatever box it is given -- placing a ringed planet
 * or a boombox in a square would not crop it, it would squash it.
 */
export function stampAspect(shape: StampId): number {
  const bounds = pathBounds(flattenPath(generate(shape, 1, 1)));
  return bounds.height > 0 ? bounds.width / bounds.height : 1;
}

/**
 * Scale and shift a generated outline so it exactly spans its box.
 *
 * Without this every generator would have to be hand-tuned to reach all four edges, and most
 * naturally do not: a five-pointed star only touches its circle at the points, a Catmull-Rom lobe
 * overshoots the vertices it was built from, and a hand-authored bolt is quoted in whatever
 * fractions looked right. Left alone, those become user-visible faults rather than trivia -- the
 * selection outline and the hit test both come straight from the box, so a shape that underfills
 * it has dead space around it and one that overshoots draws outside its own selection.
 *
 * Measuring curve extrema rather than sampled points makes the fit independent of output scale,
 * and transforming the control points by the same affine map is exact: an affine map of a Bezier's
 * controls is the same Bezier mapped.
 */
function fitToBox(path: PathData, width: number, height: number): PathData {
  const bounds = exactPathBounds(path);
  // A generator that collapsed in one axis has no scale that would fill the box, and dividing by
  // its extent would produce infinities. Leave it be and let the box test say so.
  if (bounds.width <= 0 || bounds.height <= 0) return path;
  const scaleX = width / bounds.width;
  const scaleY = height / bounds.height;
  return mapPath(path, ([x, y]): Point => [(x - bounds.x) * scaleX, (y - bounds.y) * scaleY]);
}

/**
 * Dispatch: a case per abstract mark, and the pictorial figures looked up by name.
 *
 * The catalogue is a closed union, and this stays the thing that notices a stamp with no generator.
 * In the default branch `shape` has narrowed to whatever the cases above did not take, so indexing
 * `STAMP_FIGURES` with it only compiles while every remaining id has a figure -- adding to
 * `STAMP_IDS` and forgetting to draw it is a type error, not a stamp that quietly renders as
 * something else. A bare `default: return heart(...)` would have caught nothing: the box and
 * closed-path tests all pass for a heart.
 */
function generate(shape: StampId, width: number, height: number): PathData {
  switch (shape) {
    case 'rectangle': return polygon([[0, 0], [width, 0], [width, height], [0, height]]);
    case 'triangle': return polygon([[width / 2, 0], [width, height], [0, height]]);
    case 'ellipse': return ellipse(width, height);
    case 'star': return polygon(radialPoints(width, height, 5, 0.382));
    case 'starburst': return polygon(radialPoints(width, height, 12, 0.46));
    case 'splat': return splat(width, height);
    case 'zigzag': return zigzag(width, height);
    case 'squiggle': return squiggle(width, height);
    case 'bolt': return normalizedPolygon(BOLT, width, height);
    case 'crown': return normalizedPolygon(CROWN, width, height);
    case 'arch': return arch(width, height);
    case 'chevron': return chevron(width, height);
    case 'heart': return heart(width, height);
    case 'diamond': return normalizedPolygon(DIAMOND, width, height);
    case 'plus': return normalizedPolygon(PLUS, width, height);
    case 'ring': return ring(width, height);
    case 'spiral': return spiral(width, height);
    case 'blob': return blob(width, height);
    default: return scalePath(STAMP_FIGURES[shape](), width, height);
  }
}

function normalizedPolygon(points: readonly Point[], width: number, height: number): PathData {
  return polygon(points.map(([x, y]): Point => [x * width, y * height]));
}

/** Lightning bolt, as the fraction of the box each vertex sits at. */
const BOLT: readonly Point[] = [
  [0.55, 0], [0.15, 0.55], [0.42, 0.55], [0.3, 1], [0.85, 0.42], [0.56, 0.42], [0.78, 0],
];

/** Three-point crown on a solid base band. */
const CROWN: readonly Point[] = [
  [0, 1], [0, 0.28], [0.22, 0.6], [0.5, 0.1], [0.78, 0.6], [1, 0.28], [1, 1],
];

/** Memphis rhombus. */
const DIAMOND: readonly Point[] = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];

/** Bold Memphis plus: arms a third of the box wide. */
const PLUS: readonly Point[] = [
  [0.33, 0], [0.67, 0], [0.67, 0.33], [1, 0.33], [1, 0.67], [0.67, 0.67],
  [0.67, 1], [0.33, 1], [0.33, 0.67], [0, 0.67], [0, 0.33], [0.33, 0.33],
];

/**
 * A plain donut ring. The disc figure is a record with grooves and the donut is iced; the sheet
 * also wants the bare outline, and this is it.
 */
function ring(width: number, height: number): PathData {
  return withHoles(ellipse(width, height), ellipseAt(width / 2, height / 2, width * 0.27, height * 0.27));
}

/**
 * A 1990s swirl: an Archimedean spiral ribbon, two turns and a quarter.
 *
 * Drawn with the normal-offset ribbon rather than the vertical one the zigzag and squiggle use: a
 * spiral's tangent sweeps the full circle, and a vertical offset would pinch the band to nothing
 * wherever the curve turns vertical.
 */
function spiral(width: number, height: number): PathData {
  const turns = 2.25;
  const startRadius = 0.1;
  const centres: Point[] = [];
  for (let index = 0; index <= RIBBON_SAMPLES; index += 1) {
    const t = index / RIBBON_SAMPLES;
    const angle = t * turns * Math.PI * 2;
    const radius = startRadius + (1 - startRadius) * t;
    centres.push([
      (width / 2) * (1 + Math.cos(angle) * radius),
      (height / 2) * (1 + Math.sin(angle) * radius),
    ]);
  }
  return strokeRibbon(centres, Math.min(width, height) * 0.13);
}

/**
 * Lobe radii for the blob, as a fraction of the full radius.
 *
 * The same radii-table construction as the splat, but the lobes stay plump instead of spiking:
 * fewer, fatter undulations are what separate a y2k amoeba from a splash of paint.
 */
const BLOB_RADII = [1, 0.8, 0.94, 0.72, 0.96, 0.84, 0.9, 0.78, 0.98, 0.86];

function blob(width: number, height: number): PathData {
  const cx = width / 2;
  const cy = height / 2;
  const points = BLOB_RADII.map((radius, index): Point => {
    const angle = (index / BLOB_RADII.length) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(angle) * cx * radius, cy + Math.sin(angle) * cy * radius];
  });
  return smoothClosedPath(points);
}

/**
 * Lobe radii for the splat, as a fraction of the full radius.
 *
 * Hand-authored rather than sampled from noise, and an odd count so no lobe has a partner directly
 * opposite it. Alternating full-length lobes with much shorter ones is what reads as thrown paint:
 * an even spread of similar radii just gives a slightly dented circle.
 */
const SPLAT_RADII = [1, 0.55, 0.92, 0.48, 1, 0.6, 0.86, 0.5, 0.97, 0.52, 0.9];

function splat(width: number, height: number): PathData {
  const cx = width / 2;
  const cy = height / 2;
  const points = SPLAT_RADII.map((radius, index): Point => {
    const angle = (index / SPLAT_RADII.length) * Math.PI * 2 - Math.PI / 2;
    return [cx + Math.cos(angle) * cx * radius, cy + Math.sin(angle) * cy * radius];
  });
  return smoothClosedPath(points);
}

/**
 * A half-round arch: a semi-ellipse springing from straight legs.
 *
 * The springing line sits at half the width, so the top is a true half-round. A box shorter than
 * it is wide has no room for that, and the legs collapse to nothing rather than the arc being
 * squashed -- an arch that has lost its legs still reads as an arch, one that has lost its
 * curvature does not.
 */
function arch(width: number, height: number): PathData {
  const rx = width / 2;
  const springing = Math.min(height, rx);
  const ox = rx * KAPPA;
  const oy = springing * KAPPA;
  const path = pathBuilder();
  path.move(0, height);
  path.line(0, springing);
  path.cubic(0, springing - oy, rx - ox, 0, rx, 0);
  path.cubic(rx + ox, 0, width, springing - oy, width, springing);
  path.line(width, height);
  path.close();
  return path.build();
}

/** A thick right-pointing chevron: the outer arms out to the point, the inner arms back. */
function chevron(width: number, height: number): PathData {
  const thickness = height * 0.42;
  return polygon([
    [0, 0],
    [width, height / 2],
    [0, height],
    [0, height - thickness],
    [width - thickness, height / 2],
    [0, thickness],
  ]);
}

/**
 * A banded zigzag.
 *
 * Traced as one edge out and the other edge back, offset vertically rather than along the normal.
 * A true normal offset would hold the band's width through the corners, but it also has to miter
 * them, and at the angles a Memphis zigzag uses the difference is a pixel or so of thickening at
 * each peak -- not worth the corner cases where consecutive segments are near-parallel.
 */
function zigzag(width: number, height: number): PathData {
  const peaks = 4;
  const thickness = height * 0.4;
  const centres: Point[] = [];
  for (let index = 0; index <= peaks; index += 1) {
    const high = index % 2 === 0;
    centres.push([
      (index / peaks) * width,
      high ? thickness / 2 : height - thickness / 2,
    ]);
  }
  return ribbon(centres, thickness);
}

/** A sine ribbon: the same construction as the zigzag, with a sampled centreline. */
function squiggle(width: number, height: number): PathData {
  const waves = 1.5;
  const thickness = height * 0.3;
  const amplitude = (height - thickness) / 2;
  const centres: Point[] = [];
  for (let index = 0; index <= RIBBON_SAMPLES; index += 1) {
    const t = index / RIBBON_SAMPLES;
    centres.push([t * width, height / 2 + Math.sin(t * Math.PI * 2 * waves) * amplitude]);
  }
  return ribbon(centres, thickness);
}

function ribbon(centres: readonly Point[], thickness: number): PathData {
  const half = thickness / 2;
  const top = centres.map(([x, y]): Point => [x, y - half]);
  const bottom = [...centres].reverse().map(([x, y]): Point => [x, y + half]);
  return polygon([...top, ...bottom]);
}

function heart(width: number, height: number): PathData {
  const x = (value: number) => value * width;
  const y = (value: number) => value * height;
  const path = pathBuilder();
  path.move(x(0.5), y(0.95));
  path.cubic(x(0.15), y(0.68), x(0), y(0.45), x(0), y(0.3));
  path.cubic(x(0), y(0.12), x(0.14), y(0.02), x(0.3), y(0.02));
  path.cubic(x(0.4), y(0.02), x(0.47), y(0.08), x(0.5), y(0.14));
  path.cubic(x(0.53), y(0.08), x(0.6), y(0.02), x(0.7), y(0.02));
  path.cubic(x(0.86), y(0.02), x(1), y(0.12), x(1), y(0.3));
  path.cubic(x(1), y(0.45), x(0.85), y(0.68), x(0.5), y(0.95));
  path.close();
  return path.build();
}
