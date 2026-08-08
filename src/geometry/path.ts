import { boundsFromPoints, type Bounds } from './bounds';
import type { PathData, Point } from '../model/types';

export interface FlattenOptions {
  tolerance?: number;
  maxDepth?: number;
}

export function flattenPath(path: PathData, options: FlattenOptions = {}): Point[][] {
  const tolerance = Math.max(options.tolerance ?? 0.2, Number.EPSILON);
  const maxDepth = options.maxDepth ?? 16;
  const contours: Point[][] = [];
  let contour: Point[] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];

  const finishOpenContour = () => {
    if (contour.length > 0) contours.push(contour);
    contour = [];
  };

  for (const command of path.commands) {
    if (command.type === 'M') {
      finishOpenContour();
      current = [...command.point];
      start = [...command.point];
      contour.push([...current]);
      continue;
    }
    if (command.type === 'L') {
      requireContour(contour, command.type);
      current = [...command.point];
      contour.push([...current]);
      continue;
    }
    if (command.type === 'Q') {
      requireContour(contour, command.type);
      flattenQuadratic(current, command.control, command.point, tolerance, maxDepth, contour);
      current = [...command.point];
      continue;
    }
    if (command.type === 'C') {
      requireContour(contour, command.type);
      flattenCubic(
        current,
        command.control1,
        command.control2,
        command.point,
        tolerance,
        maxDepth,
        contour,
      );
      current = [...command.point];
      continue;
    }
    if (command.type === 'Z') {
      requireContour(contour, command.type);
      if (!pointsEqual(current, start)) contour.push([...start]);
      current = [...start];
      finishOpenContour();
    }
  }
  finishOpenContour();
  return contours;
}

export function pathBounds(contours: readonly (readonly Point[])[]): Bounds {
  return boundsFromPoints(contours.flatMap((contour) => contour));
}

/** Exact axis-aligned bounds, including quadratic and cubic extrema between command endpoints. */
export function exactPathBounds(path: PathData): Bounds {
  const extrema: Point[] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];

  for (const command of path.commands) {
    if (command.type === 'M') {
      current = [...command.point];
      start = [...command.point];
      extrema.push([...current]);
      continue;
    }
    if (command.type === 'L') {
      current = [...command.point];
      extrema.push([...current]);
      continue;
    }
    if (command.type === 'Q') {
      extrema.push([...command.point]);
      for (const axis of [0, 1] as const) {
        const denominator = current[axis] - 2 * command.control[axis] + command.point[axis];
        if (denominator === 0) continue;
        const t = (current[axis] - command.control[axis]) / denominator;
        if (t > 0 && t < 1) extrema.push(quadraticPoint(current, command.control, command.point, t));
      }
      current = [...command.point];
      continue;
    }
    if (command.type === 'C') {
      extrema.push([...command.point]);
      for (const axis of [0, 1] as const) {
        for (const t of cubicDerivativeRoots(
          current[axis], command.control1[axis], command.control2[axis], command.point[axis],
        )) {
          extrema.push(cubicPoint(current, command.control1, command.control2, command.point, t));
        }
      }
      current = [...command.point];
      continue;
    }
    current = [...start];
  }

  return boundsFromPoints(extrema);
}

function flattenQuadratic(
  start: Point,
  control: Point,
  end: Point,
  tolerance: number,
  depth: number,
  output: Point[],
): void {
  if (depth <= 0 || pointLineDistance(control, start, end) <= tolerance) {
    output.push([...end]);
    return;
  }
  const startControl = midpoint(start, control);
  const controlEnd = midpoint(control, end);
  const middle = midpoint(startControl, controlEnd);
  flattenQuadratic(start, startControl, middle, tolerance, depth - 1, output);
  flattenQuadratic(middle, controlEnd, end, tolerance, depth - 1, output);
}

function flattenCubic(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  tolerance: number,
  depth: number,
  output: Point[],
): void {
  const flatness = Math.max(
    pointLineDistance(control1, start, end),
    pointLineDistance(control2, start, end),
  );
  if (depth <= 0 || flatness <= tolerance) {
    output.push([...end]);
    return;
  }
  const p01 = midpoint(start, control1);
  const p12 = midpoint(control1, control2);
  const p23 = midpoint(control2, end);
  const p012 = midpoint(p01, p12);
  const p123 = midpoint(p12, p23);
  const middle = midpoint(p012, p123);
  flattenCubic(start, p01, p012, middle, tolerance, depth - 1, output);
  flattenCubic(middle, p123, p23, end, tolerance, depth - 1, output);
}

function midpoint(a: Point, b: Point): Point {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function quadraticPoint(start: Point, control: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return [
    inverse * inverse * start[0] + 2 * inverse * t * control[0] + t * t * end[0],
    inverse * inverse * start[1] + 2 * inverse * t * control[1] + t * t * end[1],
  ];
}

function cubicPoint(start: Point, control1: Point, control2: Point, end: Point, t: number): Point {
  const inverse = 1 - t;
  return [
    inverse ** 3 * start[0] + 3 * inverse ** 2 * t * control1[0] +
      3 * inverse * t * t * control2[0] + t ** 3 * end[0],
    inverse ** 3 * start[1] + 3 * inverse ** 2 * t * control1[1] +
      3 * inverse * t * t * control2[1] + t ** 3 * end[1],
  ];
}

function cubicDerivativeRoots(start: number, control1: number, control2: number, end: number): number[] {
  // The derivative divided by three is A*t^2 + B*t + C.
  const a = -start + 3 * control1 - 3 * control2 + end;
  const b = 2 * (start - 2 * control1 + control2);
  const c = control1 - start;
  const epsilon = Number.EPSILON * 16 * Math.max(1, Math.abs(a), Math.abs(b), Math.abs(c));
  if (Math.abs(a) <= epsilon) {
    if (Math.abs(b) <= epsilon) return [];
    const root = -c / b;
    return root > 0 && root < 1 ? [root] : [];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return [];
  if (discriminant === 0) {
    const root = -b / (2 * a);
    return root > 0 && root < 1 ? [root] : [];
  }
  const squareRoot = Math.sqrt(discriminant);
  return [(-b + squareRoot) / (2 * a), (-b - squareRoot) / (2 * a)]
    .filter((root) => root > 0 && root < 1);
}

function pointLineDistance(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const areaTwice = Math.abs(dy * point[0] - dx * point[1] + end[0] * start[1] - end[1] * start[0]);
  return areaTwice / Math.sqrt(lengthSquared);
}

function pointsEqual(a: Point, b: Point): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function requireContour(contour: Point[], command: string): void {
  if (contour.length === 0) throw new Error(`Path command ${command} requires an initial move command`);
}
