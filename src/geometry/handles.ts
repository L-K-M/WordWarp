import type { Bounds } from './bounds';
import {
  applyMatrix,
  applyMatrixVector,
  elementLinearMatrix,
  invertMatrix,
  multiplyMatrix,
  rotationMatrix,
  scaleMatrix,
  skewMatrix,
  type Matrix,
} from './matrix';
import type { Point, Transform } from '../model/types';

/**
 * Where an element's own box ended up on the canvas.
 *
 * `local` is the box the element draws itself in -- the laid-out word, the stamp's outline -- and
 * `matrix` carries it to canvas coordinates. Both come from the renderer rather than being rebuilt
 * here, because a warp can move the drawn box away from the box the transform origin is measured
 * against, and only the renderer knows that. Everything below therefore works from the matrix and
 * recovers the origin from it, instead of assuming the two boxes agree.
 */
export interface ElementFrame {
  local: Bounds;
  matrix: Matrix;
}

export type HandleKind = 'scale' | 'rotate' | 'skew';

/** Which of the transform's two degrees of freedom a handle drives. */
export type HandleAxis = 'x' | 'y' | 'both';

export interface Handle {
  id: string;
  kind: HandleKind;
  axis: HandleAxis;
  /** Where the handle sits on the element box, in 0..1 box coordinates. */
  at: Point;
  /**
   * The box point that stays still while this handle is dragged, and the point a standing-off
   * handle is pushed away from. A rotation turns about the transform origin rather than about a
   * point on the box, so for the rotate handle this only gives the direction it stands off in.
   */
  anchor: Point;
  /** How far outside the box the handle sits, in CSS pixels. Zero puts it on the box. */
  standOff: number;
  /**
   * The shortest the run from `anchor` to `at` may be on screen, in CSS pixels, before the handle
   * is dropped. A box smaller than its own handles is unusable, so the secondary ones give way and
   * leave the corners -- which are never dropped -- room to work.
   */
  minSpan: number;
  label: string;
}

/** Handles crowd out below roughly two of their own widths of box to sit in. */
const MIN_SPAN = 46;

const CORNER_HANDLES: Handle[] = [
  { id: 'nw', kind: 'scale', axis: 'both', at: [0, 0], anchor: [1, 1], standOff: 0, minSpan: 0, label: 'Resize from the top left' },
  { id: 'ne', kind: 'scale', axis: 'both', at: [1, 0], anchor: [0, 1], standOff: 0, minSpan: 0, label: 'Resize from the top right' },
  { id: 'se', kind: 'scale', axis: 'both', at: [1, 1], anchor: [0, 0], standOff: 0, minSpan: 0, label: 'Resize from the bottom right' },
  { id: 'sw', kind: 'scale', axis: 'both', at: [0, 1], anchor: [1, 0], standOff: 0, minSpan: 0, label: 'Resize from the bottom left' },
];

const EDGE_HANDLES: Handle[] = [
  { id: 'n', kind: 'scale', axis: 'y', at: [0.5, 0], anchor: [0.5, 1], standOff: 0, minSpan: MIN_SPAN, label: 'Resize from the top edge' },
  { id: 'e', kind: 'scale', axis: 'x', at: [1, 0.5], anchor: [0, 0.5], standOff: 0, minSpan: MIN_SPAN, label: 'Resize from the right edge' },
  { id: 's', kind: 'scale', axis: 'y', at: [0.5, 1], anchor: [0.5, 0], standOff: 0, minSpan: MIN_SPAN, label: 'Resize from the bottom edge' },
  { id: 'w', kind: 'scale', axis: 'x', at: [0, 0.5], anchor: [1, 0.5], standOff: 0, minSpan: MIN_SPAN, label: 'Resize from the left edge' },
];

/**
 * The handles that stand off the box, and why each one sits where it does.
 *
 * Skew has exactly two degrees of freedom, so it gets exactly two handles rather than one per
 * edge. Each sits on the edge whose motion it describes: dragging the bottom edge sideways is
 * literally what `skewX` does to the geometry, and dragging the right edge up or down is `skewY`.
 * Rotation takes the remaining free edge, the top, so no two stand-off handles share one.
 */
const STAND_OFF_HANDLES: Handle[] = [
  { id: 'rotate', kind: 'rotate', axis: 'both', at: [0.5, 0], anchor: [0.5, 1], standOff: 30, minSpan: 30, label: 'Rotate' },
  { id: 'skew-x', kind: 'skew', axis: 'x', at: [0.5, 1], anchor: [0.5, 0], standOff: 26, minSpan: MIN_SPAN, label: 'Slant sideways' },
  { id: 'skew-y', kind: 'skew', axis: 'y', at: [1, 0.5], anchor: [0, 0.5], standOff: 26, minSpan: MIN_SPAN, label: 'Slant vertically' },
];

export const TRANSFORM_HANDLES: readonly Handle[] = [
  ...CORNER_HANDLES,
  ...EDGE_HANDLES,
  ...STAND_OFF_HANDLES,
];

const EPSILON = 1e-6;
/** Zero scale is unrecoverable by pointer alone once the box has no width to grab. */
const MIN_SCALE = 0.01;
/** Past this the shear runs away far faster than the pointer moves, and the box leaves the canvas. */
const MAX_SKEW_DEGREES = 80;
const ROTATION_SNAP_DEGREES = 15;
const SKEW_SNAP_DEGREES = 5;

/** A point on the element box, in 0..1 box coordinates, in the element's own space. */
function boxPoint(local: Bounds, [u, v]: Point): Point {
  return [local.x + u * local.width, local.y + v * local.height];
}

/** The same point, carried onto the canvas. */
export function framePoint(frame: ElementFrame, at: Point): Point {
  return applyMatrix(frame.matrix, boxPoint(frame.local, at));
}

/** The element box's four corners on the canvas, clockwise from the top left. */
export function frameCorners(frame: ElementFrame): [Point, Point, Point, Point] {
  return [
    framePoint(frame, [0, 0]),
    framePoint(frame, [1, 0]),
    framePoint(frame, [1, 1]),
    framePoint(frame, [0, 1]),
  ];
}

/**
 * Where a handle is drawn, in canvas coordinates.
 *
 * `unitsPerPixel` converts a CSS pixel into canvas units at the current artboard size and zoom, so
 * a handle stands the same distance off the box on screen whatever the document or zoom is.
 */
export function handlePosition(frame: ElementFrame, handle: Handle, unitsPerPixel: number): Point {
  const at = framePoint(frame, handle.at);
  if (handle.standOff === 0) return at;
  const from = framePoint(frame, handle.anchor);
  const length = Math.hypot(at[0] - from[0], at[1] - from[1]);
  if (length < EPSILON) return at;
  const distance = handle.standOff * unitsPerPixel;
  return [
    at[0] + ((at[0] - from[0]) / length) * distance,
    at[1] + ((at[1] - from[1]) / length) * distance,
  ];
}

/** Whether the box has room on screen for this handle to be worth drawing. */
export function handleFits(frame: ElementFrame, handle: Handle, unitsPerPixel: number): boolean {
  if (handle.minSpan === 0) return true;
  const at = framePoint(frame, handle.at);
  const from = framePoint(frame, handle.anchor);
  return Math.hypot(at[0] - from[0], at[1] - from[1]) >= handle.minSpan * unitsPerPixel;
}

/** The direction a handle points away from the box, in degrees clockwise from canvas east. */
export function handleAngle(frame: ElementFrame, handle: Handle): number {
  const at = framePoint(frame, handle.at);
  const from = framePoint(frame, handle.anchor);
  return degrees(Math.atan2(at[1] - from[1], at[0] - from[0]));
}

/**
 * The resize cursor that points along a direction, once the element has been rotated.
 *
 * A rotated box's top-left corner no longer resizes towards the top left, and a cursor that says
 * it does is worse than none. The four two-headed cursors cover the circle in 45 degree sectors.
 */
export function resizeCursor(angleDegrees: number): string {
  const sector = ((Math.round(normalizeDegrees(angleDegrees) / 45) % 4) + 4) % 4;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][sector]!;
}

export interface DragContext {
  frame: ElementFrame;
  transform: Transform;
  /** Where the pointer was when the drag began, in canvas coordinates. */
  pointerStart: Point;
  /** Shift held: snap angles, and lock a corner resize to the element's aspect. */
  constrain: boolean;
}

/**
 * The transform a handle drag produces, in full.
 *
 * Every gesture is solved the same way: hold one point of the box still on the canvas, ask what
 * the changed parameter has to be for the dragged point to land under the pointer, then move the
 * element back so the held point really did stay put. That last step is why these return a
 * position as well -- resizing from a corner moves the transform origin, and only recomputing it
 * keeps the opposite corner from sliding.
 */
export function dragHandle(handle: Handle, context: DragContext, pointer: Point): Transform {
  const { frame, transform } = context;
  if (handle.kind === 'rotate') return rotateTransform(context, pointer);

  const inverse = invertMatrix(frame.matrix);
  if (!inverse) return transform;
  // Recovered from the matrix rather than from `originX`/`originY`: those are fractions of the box
  // the *transform* was built against, which a warp can leave behind. The origin is the one point
  // the matrix always sends to the element's position, so this holds however the box was derived.
  const originLocal = applyMatrix(inverse, [transform.x, transform.y]);
  const anchorLocal = boxPoint(frame.local, handle.anchor);
  const movingLocal = boxPoint(frame.local, handle.at);
  const anchorPoint = applyMatrix(frame.matrix, anchorLocal);
  const span: Point = [movingLocal[0] - anchorLocal[0], movingLocal[1] - anchorLocal[1]];
  const pull: Point = [pointer[0] - anchorPoint[0], pointer[1] - anchorPoint[1]];

  const changed = handle.kind === 'scale'
    ? scaledTransform(transform, handle, span, pull, context.constrain)
    : skewedTransform(transform, handle, span, pull, context.constrain);
  return holdPoint(changed, anchorPoint, anchorLocal, originLocal);
}

/** A move drag, with Shift locking it to the axis the pointer has travelled furthest along. */
export function dragMove(context: DragContext, pointer: Point): Transform {
  const { transform, pointerStart, constrain } = context;
  let dx = pointer[0] - pointerStart[0];
  let dy = pointer[1] - pointerStart[1];
  if (constrain) {
    if (Math.abs(dx) > Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  return { ...transform, x: transform.x + dx, y: transform.y + dy };
}

function rotateTransform(context: DragContext, pointer: Point): Transform {
  const { transform, pointerStart, constrain } = context;
  // The transform origin is the one point rotation leaves alone, and the matrix sends it to the
  // element's position by construction, so the pivot needs no inversion to find.
  const pivotX = transform.x;
  const pivotY = transform.y;
  const from = Math.atan2(pointerStart[1] - pivotY, pointerStart[0] - pivotX);
  const to = Math.atan2(pointer[1] - pivotY, pointer[0] - pivotX);
  // Measured from where the pointer went down rather than from the handle, so the box does not
  // jump to meet the pointer on the first pixel of the drag.
  const rotation = transform.rotation + degrees(to - from);
  return {
    ...transform,
    rotation: normalizeDegrees(snap(rotation, constrain ? ROTATION_SNAP_DEGREES : 0)),
  };
}

/**
 * Solve for the scale that puts the dragged point under the pointer.
 *
 * In the element's own space the matrix is `rotation · scale · skew`, so undoing the rotation from
 * the pointer's pull and the skew from the box's span leaves the two sides of a plain scale, one
 * component per axis.
 */
function scaledTransform(
  transform: Transform,
  handle: Handle,
  span: Point,
  pull: Point,
  constrain: boolean,
): Transform {
  const wanted = applyMatrixVector(rotationMatrix(-transform.rotation), pull);
  const sheared = applyMatrixVector(skewMatrix(transform.skewX, transform.skewY), span);
  let scaleX = handle.axis !== 'y' && Math.abs(sheared[0]) > EPSILON
    ? wanted[0] / sheared[0]
    : transform.scaleX;
  let scaleY = handle.axis !== 'x' && Math.abs(sheared[1]) > EPSILON
    ? wanted[1] / sheared[1]
    : transform.scaleY;

  if (constrain && handle.axis === 'both'
    && Math.abs(transform.scaleX) > EPSILON && Math.abs(transform.scaleY) > EPSILON) {
    const ratioX = scaleX / transform.scaleX;
    const ratioY = scaleY / transform.scaleY;
    // The axis that moved further leads, so the corner keeps up with the pointer instead of
    // lagging behind whichever direction happens to be shorter.
    const magnitude = Math.max(Math.abs(ratioX), Math.abs(ratioY));
    scaleX = transform.scaleX * magnitude * (ratioX < 0 ? -1 : 1);
    scaleY = transform.scaleY * magnitude * (ratioY < 0 ? -1 : 1);
  }

  return { ...transform, scaleX: clampScale(scaleX), scaleY: clampScale(scaleY) };
}

/**
 * Solve for the shear that puts the dragged edge under the pointer.
 *
 * The skew matrix moves x by `tan(skewX)` per unit of y and y by `tan(skewY)` per unit of x, so
 * once rotation and scale are undone the pointer's pull across the box's span *is* that tangent.
 */
function skewedTransform(
  transform: Transform,
  handle: Handle,
  span: Point,
  pull: Point,
  constrain: boolean,
): Transform {
  const upright = invertMatrix(multiplyMatrix(
    rotationMatrix(transform.rotation),
    scaleMatrix(transform.scaleX, transform.scaleY),
  ));
  if (!upright) return transform;
  const wanted = applyMatrixVector(upright, pull);
  if (handle.axis === 'x') {
    if (Math.abs(span[1]) < EPSILON) return transform;
    const skewX = degrees(Math.atan(wanted[0] / span[1]));
    return { ...transform, skewX: clampSkew(snap(skewX, constrain ? SKEW_SNAP_DEGREES : 0)) };
  }
  if (Math.abs(span[0]) < EPSILON) return transform;
  const skewY = degrees(Math.atan(wanted[1] / span[0]));
  return { ...transform, skewY: clampSkew(snap(skewY, constrain ? SKEW_SNAP_DEGREES : 0)) };
}

/** Reposition an element so a point of its box stays exactly where it was on the canvas. */
function holdPoint(
  transform: Transform,
  anchorPoint: Point,
  anchorLocal: Point,
  originLocal: Point,
): Transform {
  const offset = applyMatrixVector(elementLinearMatrix(transform), [
    anchorLocal[0] - originLocal[0],
    anchorLocal[1] - originLocal[1],
  ]);
  return { ...transform, x: anchorPoint[0] - offset[0], y: anchorPoint[1] - offset[1] };
}

function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_SCALE;
  const magnitude = Math.max(MIN_SCALE, Math.abs(scale));
  return scale < 0 ? -magnitude : magnitude;
}

function clampSkew(degreesValue: number): number {
  if (!Number.isFinite(degreesValue)) return 0;
  return Math.min(MAX_SKEW_DEGREES, Math.max(-MAX_SKEW_DEGREES, degreesValue));
}

function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

function degrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/** Fold an angle into (-180, 180], the range the inspector's rotation control spans. */
export function normalizeDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
  return wrapped === -180 ? 180 : wrapped;
}
