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
