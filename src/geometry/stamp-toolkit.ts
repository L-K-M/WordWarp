import { flattenPath } from './path';
import type { PathData, Point } from '../model/types';

/**
 * The drawing toolkit the stamp catalogue is built from.
 *
 * Every helper here returns a `PathData` in whatever space the caller is working in, and every one
 * of them composes: a figure is written as a handful of primitives merged together, not as one long
 * run of hand-placed control points. That is what keeps a pumpkin readable as "a body, a stem, and
 * five holes for the face" rather than as ninety numbers.
 *
 * Nothing here knows about stamps, elements or canvases. It is geometry, so it is testable as
 * geometry.
 */

/** Circular-arc constant: the control-point offset that makes a cubic approximate a quarter turn. */
export const KAPPA = 0.5522847498307936;

/**
 * The largest sweep a single cubic is asked to approximate.
 *
 * A cubic tracks a circular arc to within about 0.03% of the radius at a quarter turn, and the
 * error grows sharply past that. Splitting on quarter turns is the standard bargain, and it makes
 * `arcPath` agree exactly with `ellipse` when asked for a full turn.
 */
const MAX_ARC_SWEEP = Math.PI / 2;

export interface PathBuilder {
  move: (x: number, y: number) => void;
  line: (x: number, y: number) => void;
  quad: (cx: number, cy: number, x: number, y: number) => void;
  cubic: (c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) => void;
  close: () => void;
  build: () => PathData;
}

export function pathBuilder(): PathBuilder {
  const commands: PathData['commands'] = [];
  return {
    move: (x, y) => commands.push({ type: 'M', point: [x, y] }),
    line: (x, y) => commands.push({ type: 'L', point: [x, y] }),
    quad: (cx, cy, x, y) => commands.push({ type: 'Q', control: [cx, cy], point: [x, y] }),
    cubic: (c1x, c1y, c2x, c2y, x, y) =>
      commands.push({ type: 'C', control1: [c1x, c1y], control2: [c2x, c2y], point: [x, y] }),
    close: () => commands.push({ type: 'Z' }),
    build: () => ({ commands }),
  };
}

/** A closed polygon through the given points. */
export function polygon(points: readonly Point[]): PathData {
  const path = pathBuilder();
  points.forEach(([x, y], index) => (index === 0 ? path.move(x, y) : path.line(x, y)));
  path.close();
  return path.build();
}

/** An axis-aligned rectangle, given as opposite corners. */
export function rect(x0: number, y0: number, x1: number, y1: number): PathData {
  return polygon([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
}

/**
 * A rectangle with per-corner radii, clockwise from the top left.
 *
 * Radii are clamped to half the shorter side rather than rejected, so a caller can ask for "as
 * round as this will go" with a single large number and get a stadium instead of an error.
 */
export function roundedRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radii: number | [number, number, number, number],
): PathData {
  const width = x1 - x0;
  const height = y1 - y0;
  const limit = Math.min(Math.abs(width), Math.abs(height)) / 2;
  const [tl, tr, br, bl] = (typeof radii === 'number' ? [radii, radii, radii, radii] : radii)
    .map((radius) => Math.max(0, Math.min(radius, limit))) as [number, number, number, number];
  const path = pathBuilder();
  path.move(x0 + tl, y0);
  path.line(x1 - tr, y0);
  if (tr > 0) path.cubic(x1 - tr * (1 - KAPPA), y0, x1, y0 + tr * (1 - KAPPA), x1, y0 + tr);
  path.line(x1, y1 - br);
  if (br > 0) path.cubic(x1, y1 - br * (1 - KAPPA), x1 - br * (1 - KAPPA), y1, x1 - br, y1);
  path.line(x0 + bl, y1);
  if (bl > 0) path.cubic(x0 + bl * (1 - KAPPA), y1, x0, y1 - bl * (1 - KAPPA), x0, y1 - bl);
  path.line(x0, y0 + tl);
  if (tl > 0) path.cubic(x0, y0 + tl * (1 - KAPPA), x0 + tl * (1 - KAPPA), y0, x0 + tl, y0);
  path.close();
  return path.build();
}

/** An ellipse spanning the box from (0, 0) to (`width`, `height`). */
export function ellipse(width: number, height: number): PathData {
  return ellipseAt(width / 2, height / 2, width / 2, height / 2);
}

/** An ellipse about a centre, drawn clockwise in screen coordinates. */
export function ellipseAt(cx: number, cy: number, rx: number, ry: number): PathData {
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  const path = pathBuilder();
  path.move(cx + rx, cy);
  path.cubic(cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry);
  path.cubic(cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy);
  path.cubic(cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry);
  path.cubic(cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy);
  path.close();
  return path.build();
}

export function circleAt(cx: number, cy: number, radius: number): PathData {
  return ellipseAt(cx, cy, radius, radius);
}

export interface ArcSpec {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Start and end of the sweep in radians, measured from +x toward +y. */
  from: number;
  to: number;
  /** Rotation of the ellipse's own axes, in radians. */
  rotation?: number;
}

/**
 * The cubic segments of an elliptical arc, as `[control1, control2, end]` triples.
 *
 * Exposed as segments rather than as a path because arcs are almost never a shape on their own:
 * a crescent, a ring sector and a bracket handle are each two arcs joined end to end, and joining
 * them needs the segments, not two closed paths.
 */
export function arcSegments({ cx, cy, rx, ry, from, to, rotation = 0 }: ArcSpec): Array<[Point, Point, Point]> {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const place = (x: number, y: number): Point => [cx + x * cos - y * sin, cy + x * sin + y * cos];
  const sweep = to - from;
  const steps = Math.max(1, Math.ceil(Math.abs(sweep) / MAX_ARC_SWEEP));
  const step = sweep / steps;
  // The control-point offset that makes a cubic track a circular arc of this sweep. At a quarter
  // turn it reduces to KAPPA; the general form is what keeps shorter and longer steps honest.
  const alpha = (4 / 3) * Math.tan(step / 4);
  const segments: Array<[Point, Point, Point]> = [];
  for (let index = 0; index < steps; index += 1) {
    const a0 = from + step * index;
    const a1 = a0 + step;
    const [x0, y0] = [Math.cos(a0) * rx, Math.sin(a0) * ry];
    const [x1, y1] = [Math.cos(a1) * rx, Math.sin(a1) * ry];
    segments.push([
      place(x0 - Math.sin(a0) * rx * alpha, y0 + Math.cos(a0) * ry * alpha),
      place(x1 + Math.sin(a1) * rx * alpha, y1 - Math.cos(a1) * ry * alpha),
      place(x1, y1),
    ]);
  }
  return segments;
}

export function arcStart({ cx, cy, rx, ry, from, rotation = 0 }: ArcSpec): Point {
  const x = Math.cos(from) * rx;
  const y = Math.sin(from) * ry;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [cx + x * cos - y * sin, cy + x * sin + y * cos];
}

/**
 * Continue a path along an elliptical arc.
 *
 * The caller is responsible for already being at the arc's start; nothing here inserts a joining
 * line, because the shapes that need this -- a gravestone's dome springing from its shoulders, a
 * crescent closing on its own bite -- are all built from arcs that meet exactly.
 */
export function appendArc(path: PathBuilder, spec: ArcSpec): void {
  for (const [c1, c2, end] of arcSegments(spec)) path.cubic(c1[0], c1[1], c2[0], c2[1], end[0], end[1]);
}

/**
 * A closed band between two concentric arcs: the outer sweep out, the inner sweep back.
 *
 * This one shape is a smiley's grin, a boombox's carry handle, a planet's ring and the separation
 * between a pizza's crust and its cheese. Ends are square, which is what a cut band wants; a
 * rounded end is `strokePolyline`'s job.
 */
export function arcBand(spec: Omit<ArcSpec, 'rx' | 'ry'> & {
  outerRx: number;
  outerRy: number;
  innerRx: number;
  innerRy: number;
}): PathData {
  const { cx, cy, from, to, rotation = 0, outerRx, outerRy, innerRx, innerRy } = spec;
  const outer: ArcSpec = { cx, cy, rx: outerRx, ry: outerRy, from, to, rotation };
  const inner: ArcSpec = { cx, cy, rx: innerRx, ry: innerRy, from: to, to: from, rotation };
  const path = pathBuilder();
  const start = arcStart(outer);
  path.move(start[0], start[1]);
  appendArc(path, outer);
  const back = arcStart(inner);
  path.line(back[0], back[1]);
  appendArc(path, inner);
  path.close();
  return path.build();
}

/** A closed arc sector: from the centre out along the arc and back. */
export function arcSector(spec: ArcSpec): PathData {
  const path = pathBuilder();
  path.move(spec.cx, spec.cy);
  const start = arcStart(spec);
  path.line(start[0], start[1]);
  appendArc(path, spec);
  path.close();
  return path.build();
}

/**
 * The lune left when one circle is bitten out of another: a crescent, as a single contour.
 *
 * Written this way rather than as a circle with a circular hole because a hole that reaches outside
 * its outer contour would widen the path's bounds, and stamps are normalised to their bounds -- a
 * crescent built by subtraction would be quietly shrunk and shifted by the bite it was cut with.
 * A single contour has no such second bounding box to go wrong.
 *
 * Both circles are given about a shared origin, with the biting circle offset along +x. The caller
 * gets an error rather than a broken shape if the two do not actually cross, because every other
 * arrangement -- disjoint, nested, identical -- is a different shape, not a thinner crescent.
 */
export function crescent(radius: number, biteRadius: number, biteOffset: number): PathData {
  const cosine = (biteOffset * biteOffset + radius * radius - biteRadius * biteRadius) / (2 * biteOffset * radius);
  if (!(Math.abs(cosine) < 1)) throw new Error('Crescent circles must cross at two points');
  // The half-angle each circle subtends at its own centre between the +x axis and the crossings.
  const half = Math.acos(cosine);
  const biteHalf = Math.PI - Math.acos(
    (biteOffset * biteOffset + biteRadius * biteRadius - radius * radius) / (2 * biteOffset * biteRadius),
  );
  const path = pathBuilder();
  const outer: ArcSpec = { cx: 0, cy: 0, rx: radius, ry: radius, from: half, to: Math.PI * 2 - half };
  const start = arcStart(outer);
  path.move(start[0], start[1]);
  appendArc(path, outer);
  // The bite runs back along its far side, which is the part of it lying inside the outer circle;
  // the near side bulges away from the crossings and would cut nothing.
  appendArc(path, {
    cx: biteOffset, cy: 0, rx: biteRadius, ry: biteRadius, from: -biteHalf, to: biteHalf - Math.PI * 2,
  });
  path.close();
  return path.build();
}

/**
 * A closed cubic path through every point, via the uniform Catmull-Rom to Bezier conversion.
 *
 * Each segment's control points are placed a sixth of the way along the chord between the
 * neighbours either side of it, which is what makes the curve pass through the points rather than
 * being pulled toward them the way a raw B-spline would be.
 */
export function smoothClosedPath(points: readonly Point[], tension = 1): PathData {
  const path = pathBuilder();
  const count = points.length;
  const pull = tension / 6;
  path.move(points[0]![0], points[0]![1]);
  for (let index = 0; index < count; index += 1) {
    const previous = points[(index - 1 + count) % count]!;
    const start = points[index]!;
    const end = points[(index + 1) % count]!;
    const next = points[(index + 2) % count]!;
    path.cubic(
      start[0] + (end[0] - previous[0]) * pull,
      start[1] + (end[1] - previous[1]) * pull,
      end[0] - (next[0] - start[0]) * pull,
      end[1] - (next[1] - start[1]) * pull,
      end[0],
      end[1],
    );
  }
  path.close();
  return path.build();
}

/** Points at alternating radii around an ellipse, for stars, cogs and scalloped rings. */
export function radialPoints(
  width: number,
  height: number,
  points: number,
  innerRatio: number,
  phase = -Math.PI / 2,
): Point[] {
  const cx = width / 2;
  const cy = height / 2;
  const vertices: Point[] = [];
  for (let index = 0; index < points * 2; index += 1) {
    const angle = (index / (points * 2)) * Math.PI * 2 + phase;
    const radius = index % 2 === 0 ? 1 : innerRatio;
    vertices.push([cx + Math.cos(angle) * cx * radius, cy + Math.sin(angle) * cy * radius]);
  }
  return vertices;
}

/**
 * An open polyline turned into a filled outline: one edge out, the other edge back, square ends.
 *
 * Deliberately *one contour*, not a pile of overlapping quads and joint discs. A pile is easier to
 * write and looks identical while it is being added to a shape -- under nonzero fill the pieces
 * simply union. It falls apart the moment the same stroke is used as a hole: two overlapping hole
 * contours wind to -1, which is not zero, so the overlaps fill straight back in and the line comes
 * out dashed. One contour has no overlaps to go wrong, and reverses cleanly into a hole.
 *
 * The offset is a true normal offset with no mitre, so the band pinches very slightly on the inside
 * of a corner. Every caller here is a gentle curve -- a spiral, a sagging web strand, a straight
 * facet -- where that is invisible; a hard corner wants two strokes, not a mitre-joint algorithm
 * and its reflex, doubled-back and zero-length cases.
 */
export function strokeRibbon(points: readonly Point[], thickness: number): PathData {
  const half = thickness / 2;
  const kept = points.filter((point, index) => index === 0 || Math.hypot(point[0] - points[index - 1]![0], point[1] - points[index - 1]![1]) > 0);
  const normals = kept.map((_, index) => {
    // Interior points use the mean of the two adjoining segment normals, which keeps the band's
    // edges continuous through a joint instead of stepping across it.
    const before = kept[Math.max(0, index - 1)]!;
    const after = kept[Math.min(kept.length - 1, index + 1)]!;
    const dx = after[0] - before[0];
    const dy = after[1] - before[1];
    const length = Math.hypot(dx, dy) || 1;
    return [(-dy / length) * half, (dx / length) * half] as Point;
  });
  const side = (sign: number) => kept.map(([x, y], index): Point => [x + normals[index]![0] * sign, y + normals[index]![1] * sign]);
  return polygon([...side(1), ...side(-1).reverse()]);
}

/** Every contour of every path, in order: overlapping same-wound contours union under nonzero fill. */
export function mergePaths(...paths: readonly PathData[]): PathData {
  return { commands: paths.flatMap((path) => path.commands) };
}

/**
 * Twice the signed area of a closed contour. Positive means clockwise in screen coordinates, where
 * +y points down.
 */
function signedArea(contour: readonly Point[]): number {
  let total = 0;
  for (let index = 0; index < contour.length; index += 1) {
    const [x0, y0] = contour[index]!;
    const [x1, y1] = contour[(index + 1) % contour.length]!;
    total += x0 * y1 - x1 * y0;
  }
  return total;
}

/** The winding direction of a single-contour path: +1 clockwise, -1 counter-clockwise, 0 degenerate. */
export function windingOf(path: PathData): number {
  return Math.sign(signedArea(flattenPath(path)[0] ?? []));
}

/**
 * The same outline traced backwards, which flips its winding.
 *
 * Reversing a cubic is not just reversing its endpoints: the two control points swap as well, since
 * the one nearest the old start is the one nearest the new end.
 */
export function reversePath(path: PathData): PathData {
  const points: Point[] = [];
  const segments: Array<{ type: 'L' } | { type: 'Q'; control: Point } | { type: 'C'; control1: Point; control2: Point }> = [];
  let closed = false;
  for (const command of path.commands) {
    if (command.type === 'Z') { closed = true; continue; }
    if (command.type === 'Q') segments.push({ type: 'Q', control: command.control });
    else if (command.type === 'C') segments.push({ type: 'C', control1: command.control1, control2: command.control2 });
    else if (command.type === 'L') segments.push({ type: 'L' });
    points.push(command.point);
  }
  const result = pathBuilder();
  const last = points.at(-1)!;
  result.move(last[0], last[1]);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]!;
    const target = points[index]!;
    if (segment.type === 'L') result.line(target[0], target[1]);
    else if (segment.type === 'Q') result.quad(segment.control[0], segment.control[1], target[0], target[1]);
    else result.cubic(segment.control2[0], segment.control2[1], segment.control1[0], segment.control1[1], target[0], target[1]);
  }
  if (closed) result.close();
  return result.build();
}

/**
 * Several shapes as one filled region, every contour wound the same way.
 *
 * Under the nonzero rule two overlapping contours only union if they agree on direction; wound
 * against each other they cancel, and the overlap punches a hole. Which way a contour happens to
 * run is an accident of the order its points were written down -- a triangle listed clockwise on
 * screen and the same triangle listed from its other corner differ by nothing an author would
 * notice, and by everything the fill rule cares about. So direction is settled here rather than
 * trusted: the first contour sets the sense and the rest are turned to match.
 */
export function union(...paths: readonly PathData[]): PathData {
  const contours = paths.flatMap(splitContours);
  const outward = contours.map(windingOf).find((winding) => winding !== 0) ?? 1;
  return mergePaths(...contours.map((contour) => (windingOf(contour) === -outward ? reversePath(contour) : contour)));
}

/**
 * A shape with holes punched through it.
 *
 * The filled part is unioned first, then each hole is re-wound to oppose it, so a figure can be
 * written as "these outlines, minus these outlines" without the author tracking which direction any
 * of them happens to run. Getting that wrong is invisible in the source and obvious on screen -- a
 * hole drawn the same way round as its outer simply does not appear -- so it is worth taking out of
 * the author's hands entirely.
 *
 * What is *not* taken out of the author's hands is where a hole sits. Windings add, so a hole laid
 * across a seam between two overlapping filled shapes still leaves one layer behind and simply
 * fails to cut; two holes over the same place wind to -2 and come back solid. The first of those is
 * geometry the author has to place correctly. The second the stamp tests do catch, by sampling for
 * any region that winds negative.
 */
export function withHoles(outer: PathData, ...holes: readonly PathData[]): PathData {
  const solid = union(outer);
  const outward = windingOf(solid) || 1;
  const punched = holes.flatMap((hole) =>
    splitContours(hole).map((contour) => (windingOf(contour) === -outward ? contour : reversePath(contour))),
  );
  return mergePaths(solid, ...punched);
}

/** One path per `M`-started contour. */
export function splitContours(path: PathData): PathData[] {
  const contours: PathData[] = [];
  let current: PathData['commands'] = [];
  for (const command of path.commands) {
    if (command.type === 'M' && current.length > 0) {
      contours.push({ commands: current });
      current = [];
    }
    current.push(command);
  }
  if (current.length > 0) contours.push({ commands: current });
  return contours;
}

/** Every point of a path through the same map, control points included. */
export function mapPath(path: PathData, map: (point: Point) => Point): PathData {
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

/** A path scaled about the origin -- the step from a unit-box figure to one drawn at size. */
export function scalePath(path: PathData, scaleX: number, scaleY: number): PathData {
  return mapPath(path, ([x, y]) => [x * scaleX, y * scaleY]);
}

export function translatePath(path: PathData, dx: number, dy: number): PathData {
  return mapPath(path, ([x, y]) => [x + dx, y + dy]);
}

export function rotatePath(path: PathData, angle: number, cx = 0, cy = 0): PathData {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return mapPath(path, ([x, y]) => [
    cx + (x - cx) * cos - (y - cy) * sin,
    cy + (x - cx) * sin + (y - cy) * cos,
  ]);
}

/**
 * A path mirrored across a vertical line, contour by contour, with its winding restored.
 *
 * Mirroring is what makes symmetric figures -- a bat, a pair of sunglasses, a rocket's fins -- half
 * the work and exactly symmetric rather than nearly. It also flips winding, so every contour is
 * traced back the other way afterwards; without that, mirroring a hole would fill it in and
 * mirroring an outline would turn it into a hole.
 */
export function mirrorX(path: PathData, axis: number): PathData {
  return mergePaths(
    ...splitContours(path).map((contour) => reversePath(mapPath(contour, ([x, y]) => [axis * 2 - x, y]))),
  );
}
