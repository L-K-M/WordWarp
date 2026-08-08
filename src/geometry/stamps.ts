import { flattenPath, pathBounds } from './path';
import type { PathData, Point, ShapeElement, StampId } from '../model/types';

/**
 * Outline generators for the stamp catalogue.
 *
 * Every generator returns a closed path in the element-local box from (0, 0) to (`width`,
 * `height`), which is the same space a detached `ShapeElement.path` lives in. Keeping both forms
 * in one space is what lets the renderer, the bounds pass and hit testing treat a generated stamp
 * and an edited one identically.
 *
 * Nothing here touches a canvas. Stamps are geometry, so they are testable as geometry -- a
 * generator can be checked for the box it fills and the commands it emits without a DOM.
 */

/** Circular-arc constant: the control-point offset that makes a cubic approximate a quarter turn. */
const KAPPA = 0.5522847498307936;

/**
 * Samples along one edge of a sampled ribbon.
 *
 * Sine ribbons are the one family here without an exact Bezier form, so they are flattened to line
 * segments up front. The count is fixed rather than scaled to the element, because a generator has
 * no idea what zoom or export scale it will eventually be drawn at -- and a stamp large enough for
 * 96 segments to show as facets is already far past the size anything in the catalogue is for.
 */
const RIBBON_SAMPLES = 96;

interface PathBuilder {
  move: (x: number, y: number) => void;
  line: (x: number, y: number) => void;
  cubic: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => void;
  close: () => void;
  build: () => PathData;
}

function pathBuilder(): PathBuilder {
  const commands: PathData['commands'] = [];
  return {
    move: (x, y) => commands.push({ type: 'M', point: [x, y] }),
    line: (x, y) => commands.push({ type: 'L', point: [x, y] }),
    cubic: (c1x, c1y, c2x, c2y, x, y) =>
      commands.push({ type: 'C', control1: [c1x, c1y], control2: [c2x, c2y], point: [x, y] }),
    close: () => commands.push({ type: 'Z' }),
    build: () => ({ commands }),
  };
}

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
  return fitToBox(generate(shape, width, height), width, height);
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
 * Measuring the *flattened* curve is what makes this correct for overshoot, and transforming the
 * control points by the same affine map is what makes it exact: an affine map of a Bezier's
 * controls is the same Bezier mapped.
 */
function fitToBox(path: PathData, width: number, height: number): PathData {
  const bounds = pathBounds(flattenPath(path));
  // A generator that collapsed in one axis has no scale that would fill the box, and dividing by
  // its extent would produce infinities. Leave it be and let the box test say so.
  if (bounds.width <= 0 || bounds.height <= 0) return path;
  const scaleX = width / bounds.width;
  const scaleY = height / bounds.height;
  const map = ([x, y]: Point): Point => [(x - bounds.x) * scaleX, (y - bounds.y) * scaleY];
  return {
    commands: path.commands.map((command) => {
      if (command.type === 'Z') return command;
      if (command.type === 'Q') return { ...command, control: map(command.control), point: map(command.point) };
      if (command.type === 'C') {
        return {
          ...command,
          control1: map(command.control1),
          control2: map(command.control2),
          point: map(command.point),
        };
      }
      return { ...command, point: map(command.point) };
    }),
  };
}

/**
 * Dispatch, written as an exhaustive switch with no default.
 *
 * The catalogue is a closed union, so leaving out the default makes the compiler the thing that
 * notices a new stamp with no generator. An if-chain ending in a bare `return heart(...)` would
 * not: a stamp added to `STAMP_IDS` and forgotten here would quietly draw a heart, and the box and
 * closed-path tests would all pass, because a heart satisfies every one of them.
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
    // Memphis and sticker-book staples: the shapes a 90s sheet actually printed beyond the original
    // thirteen. Each is its own generator so it rebuilds exactly at any size.
    case 'cross': return normalizedPolygon(CROSS, width, height);
    case 'diamond': return normalizedPolygon(GEM, width, height);
    case 'sparkle': return sparkle(width, height);
    case 'cloud': return cloud(width, height);
    case 'flower': return flower(width, height);
    case 'arrow': return normalizedPolygon(ARROW, width, height);
    case 'drop': return drop(width, height);
    // Horror icons. The catalogue was 90s-only; these match the spooky presets that already shipped.
    case 'crescent': return crescent(width, height);
    case 'ghost': return ghost(width, height);
    case 'bat': return normalizedPolygon(BAT, width, height);
    case 'pumpkin': return pumpkin(width, height);
    case 'tombstone': return tombstone(width, height);
    case 'coffin': return normalizedPolygon(COFFIN, width, height);
    // Cosmic accents for the cosmic presets.
    case 'sun': return polygon(radialPoints(width, height, 8, 0.7));
    case 'comet': return comet(width, height);
  }
}

function polygon(points: readonly Point[]): PathData {
  const path = pathBuilder();
  points.forEach(([x, y], index) => (index === 0 ? path.move(x, y) : path.line(x, y)));
  path.close();
  return path.build();
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

/** A symmetric plus: twelve corners traced around the outside. */
const CROSS: readonly Point[] = [
  [1 / 3, 0], [2 / 3, 0], [2 / 3, 1 / 3], [1, 1 / 3], [1, 2 / 3], [2 / 3, 2 / 3],
  [2 / 3, 1], [1 / 3, 1], [1 / 3, 2 / 3], [0, 2 / 3], [0, 1 / 3], [1 / 3, 1 / 3],
];

/** Brilliant-cut gem: a table on top, girdle at the sides, a single point at the culet. */
const GEM: readonly Point[] = [
  [0.3, 0], [0.7, 0], [1, 0.46], [0.5, 1], [0, 0.46],
];

/** Chunky right-pointing arrow: a bar with a triangular head. */
const ARROW: readonly Point[] = [
  [0, 0.34], [0.55, 0.34], [0.55, 0.04], [1, 0.5], [0.55, 0.96], [0.55, 0.66], [0, 0.66],
];

/** Stylised bat, drawn as one symmetric outline. Left half authored, right half mirrored. */
const BAT_LEFT: readonly Point[] = [
  [0.5, 0.12], [0.4, 0.06], [0.25, 0.14], [0.05, 0.05], [0, 0.32], [0.16, 0.3],
  [0.09, 0.52], [0.26, 0.42], [0.21, 0.68], [0.39, 0.5], [0.5, 0.86],
];
const BAT: readonly Point[] = [
  ...BAT_LEFT,
  ...BAT_LEFT.slice(0, -1).reverse().map(([x, y]): Point => [1 - x, y]),
];

/** Toe-pincher coffin: narrow head, shoulders, hips tapering to a foot. */
const COFFIN: readonly Point[] = [
  [0.34, 0], [0.66, 0], [0.84, 0.32], [0.84, 0.66], [0.5, 1], [0.16, 0.66], [0.16, 0.32],
];

/**
 * Lobe radii for the splat, as a fraction of the full radius.
 *
 * Hand-authored rather than sampled from noise, and an odd count so no lobe has a partner directly
 * opposite it. Alternating full-length lobes with much shorter ones is what reads as thrown paint:
 * an even spread of similar radii just gives a slightly dented circle.
 */
const SPLAT_RADII = [1, 0.55, 0.92, 0.48, 1, 0.6, 0.86, 0.5, 0.97, 0.52, 0.9];

function radialPoints(width: number, height: number, points: number, innerRatio: number): Point[] {
  const cx = width / 2;
  const cy = height / 2;
  const vertices: Point[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    // Start at -90 degrees so a star sits on a point rather than an edge.
    const angle = (index / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const radius = index % 2 === 0 ? 1 : innerRatio;
    vertices.push([cx + Math.cos(angle) * cx * radius, cy + Math.sin(angle) * cy * radius]);
  }
  return vertices;
}

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
 * A closed cubic path through every point, via the uniform Catmull-Rom to Bezier conversion.
 *
 * Each segment's control points are placed a sixth of the way along the chord between the
 * neighbours either side of it, which is what makes the curve pass through the points rather than
 * being pulled toward them the way a raw B-spline would be.
 */
function smoothClosedPath(points: readonly Point[]): PathData {
  const path = pathBuilder();
  const count = points.length;
  path.move(points[0]![0], points[0]![1]);
  for (let index = 0; index < count; index += 1) {
    const previous = points[(index - 1 + count) % count]!;
    const start = points[index]!;
    const end = points[(index + 1) % count]!;
    const next = points[(index + 2) % count]!;
    path.cubic(
      start[0] + (end[0] - previous[0]) / 6,
      start[1] + (end[1] - previous[1]) / 6,
      end[0] - (next[0] - start[0]) / 6,
      end[1] - (next[1] - start[1]) / 6,
      end[0],
      end[1],
    );
  }
  path.close();
  return path.build();
}

function ellipse(width: number, height: number): PathData {
  const rx = width / 2;
  const ry = height / 2;
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  const path = pathBuilder();
  path.move(width, ry);
  path.cubic(width, ry + oy, rx + ox, height, rx, height);
  path.cubic(rx - ox, height, 0, ry + oy, 0, ry);
  path.cubic(0, ry - oy, rx - ox, 0, rx, 0);
  path.cubic(rx + ox, 0, width, ry - oy, width, ry);
  path.close();
  return path.build();
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

/**
 * Points along a circular or elliptical arc, for the shapes with no exact Bezier form.
 *
 * Returns `steps + 1` points so two arcs can be concatenated without a doubled point at the seam
 * by dropping the first point of the second arc. Angles are radians; `sweep` may be negative to
 * travel clockwise, and may be more than a full turn.
 */
function arcPoints(
  cx: number, cy: number, rx: number, ry: number, start: number, sweep: number, steps: number,
): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = start + (index / steps) * sweep;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return points;
}

/**
 * Four-point sparkle: each tip joined to the next by a cubic whose controls sit part-way from the
 * tip toward the centre. That is what turns a square of tips into the concave-sided "kirakira"
 * spike rather than a loop — controls at the centre pinch to a near-astroid, controls at the tips
 * collapse to a diamond, and `SPIKE_CONTROL` picks the readable point between them.
 */
const SPIKE_CONTROL = 0.55;

function sparkle(width: number, height: number): PathData {
  const cx = width / 2;
  const cy = height / 2;
  const tips: readonly Point[] = [[cx, 0], [width, cy], [cx, height], [0, cy]];
  const toward = (p: Point): Point => [p[0] + SPIKE_CONTROL * (cx - p[0]), p[1] + SPIKE_CONTROL * (cy - p[1])];
  const path = pathBuilder();
  path.move(cx, 0);
  for (let index = 0; index < tips.length; index += 1) {
    const start = tips[index]!;
    const end = tips[(index + 1) % tips.length]!;
    const c1 = toward(start);
    const c2 = toward(end);
    path.cubic(c1[0], c1[1], c2[0], c2[1], end[0], end[1]);
  }
  path.close();
  return path.build();
}

/**
 * A puffy cloud: a flat floor with five humps across the top, drawn with cubics and built
 * symmetrically so it sits level rather than lopsided.
 */
function cloud(width: number, height: number): PathData {
  const x = (value: number) => value * width;
  const y = (value: number) => value * height;
  const floor = 0.82;
  const path = pathBuilder();
  path.move(x(0.16), y(floor));
  path.line(x(0.84), y(floor));
  // Right flank up into the rightmost hump, then humps across to the left flank. Each hump is a
  // cubic whose control points pull up and out of its centre; the trough between humps stays above
  // the floor so the silhouette keeps a connected top.
  path.cubic(x(0.96), y(floor), x(1.0), y(0.58), x(0.86), y(0.5));
  path.cubic(x(0.78), y(0.3), x(0.66), y(0.3), x(0.62), y(0.5));
  path.cubic(x(0.58), y(0.2), x(0.42), y(0.2), x(0.38), y(0.5));
  path.cubic(x(0.34), y(0.3), x(0.22), y(0.3), x(0.14), y(0.5));
  path.cubic(x(0.0), y(0.58), x(0.04), y(floor), x(0.16), y(floor));
  path.close();
  return path.build();
}

/** A six-petal daisy: a smooth closed path through alternating petal-tips and inner points. */
function flower(width: number, height: number): PathData {
  // 0.36 keeps the petals rounded without closing the gaps between them: smaller and the flower
  // turns into a thin cog, larger and the petals merge into a near-circle.
  return smoothClosedPath(radialPoints(width, height, 6, 0.36));
}

/**
 * A teardrop: pointed at the top, round at the bottom. Built symmetrically so the point sits on
 * the centreline and the bulb is even.
 */
function drop(width: number, height: number): PathData {
  const x = (value: number) => value * width;
  const y = (value: number) => value * height;
  const path = pathBuilder();
  path.move(x(0.5), y(0));
  path.cubic(x(0.18), y(0.34), x(0), y(0.56), x(0), y(0.74));
  path.cubic(x(0), y(0.92), x(0.22), y(1), x(0.5), y(1));
  path.cubic(x(0.78), y(1), x(1), y(0.92), x(1), y(0.74));
  path.cubic(x(1), y(0.56), x(0.82), y(0.34), x(0.5), y(0));
  path.close();
  return path.build();
}

/**
 * A crescent moon, as the difference of two circles: an outer arc bulging left and an inner arc
 * (offset right) carving the bite. Both arcs are sampled, which is the same approach `squiggle`
 * already takes for a curve with no Bezier form.
 */
function crescent(width: number, height: number): PathData {
  const cx = width / 2;
  const cy = height / 2;
  const rx = width / 2;
  const ry = height / 2;
  const biteOffset = width * 0.15;
  // The two ellipses (outer, and bite shifted right by `biteOffset`) cross where x is the midpoint
  // of their centres. The crossing angle around each centre is `halfAngle`, with cos(halfAngle) the
  // ratio of half the offset to the radius.
  const halfAngle = Math.acos((biteOffset / 2) / rx);
  // Outer arc: top crossing (-halfAngle) clockwise all the way around, through the left, to the
  // bottom crossing. The sweep is the long way: a full turn minus the two half-angles.
  const outer = arcPoints(cx, cy, rx, ry, -halfAngle, -(Math.PI * 2 - 2 * halfAngle), 64);
  // Bite arc: bottom crossing (pi - halfAngle) counter-clockwise through the left (pi) to the top
  // crossing. The sweep is the short way across the bite ellipse's left side: two half-angles.
  const bite = arcPoints(cx + biteOffset, cy, rx, ry, Math.PI - halfAngle, 2 * halfAngle, 64).slice(1);
  return polygon([outer[0]!, ...outer.slice(1), ...bite]);
}

/**
 * A cartoon ghost: a rounded dome for the head, straight sides, and four scalloped feet along the
 * hem. Symmetric about the centreline.
 */
function ghost(width: number, height: number): PathData {
  const x = (value: number) => value * width;
  const y = (value: number) => value * height;
  const hem = 0.8;
  const foot = 0.98;
  const path = pathBuilder();
  path.move(x(0), y(hem - 0.25));
  path.cubic(x(0), y(0.22), x(0.22), y(0), x(0.5), y(0));
  path.cubic(x(0.78), y(0), x(1), y(0.22), x(1), y(hem - 0.25));
  path.line(x(1), y(hem));
  // Four feet, each a cubic dipping to `foot` and back to the hem, evenly spaced and mirrored.
  path.cubic(x(0.92), y(foot), x(0.83), y(foot), x(0.75), y(hem));
  path.cubic(x(0.67), y(foot), x(0.58), y(foot), x(0.5), y(hem));
  path.cubic(x(0.42), y(foot), x(0.33), y(foot), x(0.25), y(hem));
  path.cubic(x(0.17), y(foot), x(0.08), y(foot), x(0), y(hem));
  path.close();
  return path.build();
}

/**
 * A pumpkin: a lobed body of six vertical ribs with a stem tabbed on top. The body is a sampled
 * circle whose radius is modulated by a cosine so the ribs are smooth, and the stem is traced as
 * part of the same outline so one fill covers both.
 */
function pumpkin(width: number, height: number): PathData {
  const stemLeft = 0.42;
  const stemRight = 0.58;
  const stemTop = 0.02;
  const stemBase = 0.18;
  const cx = width / 2;
  const cy = height * 0.58;
  const rx = width / 2;
  const ry = height * 0.42;
  // Ribbed body, sampled. The ribs come from a six-lobed cosine on the radius.
  const steps = 120;
  const body: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const angle = Math.PI / 2 - (index / steps) * Math.PI * 2;
    const rib = 1 + 0.05 * Math.cos(6 * (Math.PI / 2 - angle));
    body.push([cx + Math.cos(angle) * rx * rib, cy + Math.sin(angle) * ry * rib]);
  }
  const x = (value: number) => value * width;
  const y = (value: number) => value * height;
  // Two closed contours in one path: the stem rectangle, then the body loop. `nonzero` (the fill
  // rule the renderer and the menu icon both use) fills their union, and the body's shoulders show
  // either side of the stem because the stem only covers the centreline.
  const path = pathBuilder();
  path.move(x(stemLeft), y(stemTop));
  path.line(x(stemRight), y(stemTop));
  path.line(x(stemRight), y(stemBase));
  path.line(x(stemLeft), y(stemBase));
  path.close();
  body.forEach(([bx, by], index) => (index === 0 ? path.move(bx, by) : path.line(bx, by)));
  path.close();
  return path.build();
}

/** A gravestone: a semicircular dome crowning a rectangular shaft. Symmetric about the centreline. */
function tombstone(width: number, height: number): PathData {
  const x = (value: number) => value * width;
  const y = (value: number) => value * height;
  const ox = (width / 2) * KAPPA;
  const oy = (height / 2) * KAPPA;
  const mid = 0.5;
  const path = pathBuilder();
  path.move(x(0), y(mid));
  path.cubic(x(0), y(mid) - oy, x(0.5) - ox, y(0), x(0.5), y(0));
  path.cubic(x(0.5) + ox, y(0), x(1), y(mid) - oy, x(1), y(mid));
  path.line(x(1), y(1));
  path.line(x(0), y(1));
  path.close();
  return path.build();
}

/**
 * A comet: a round head with a tapered tail streaming out to one side. The head is a sampled arc
 * (the major arc that faces away from the tail) and the tail is a triangle whose base meets the
 * head and whose apex is the off-side edge of the box.
 */
function comet(width: number, height: number): PathData {
  const cx = width * 0.32;
  const cy = height / 2;
  const r = width * 0.27;
  // The tail roots are points on the head circle, defined by angle rather than by coordinates, so
  // the head arc starts exactly where the tail meets it rather than a sub-pixel approximation off it.
  const rootAngle = 0.95;
  const topAngle = -rootAngle;
  // Major arc over the left of the head: clockwise (negative) from the top root to the bottom root.
  const head = arcPoints(cx, cy, r, r, topAngle, -(Math.PI * 2 - 2 * rootAngle), 48);
  const path = pathBuilder();
  path.move(width, cy);
  path.line(head[0]![0], head[0]![1]);
  head.forEach(([x, y], index) => {
    if (index > 0) path.line(x, y);
  });
  path.close();
  return path.build();
}
