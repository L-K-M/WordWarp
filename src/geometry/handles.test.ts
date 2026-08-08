import { describe, expect, it } from 'vitest';

import type { Bounds } from './bounds';
import {
  dragHandle,
  dragMove,
  frameCorners,
  handleFits,
  handlePosition,
  normalizeDegrees,
  resizeCursor,
  TRANSFORM_HANDLES,
  type ElementFrame,
  type Handle,
} from './handles';
import { applyMatrix, elementMatrix } from './matrix';
import type { Point, Transform } from '../model/types';

const LOCAL: Bounds = { x: 0, y: 0, width: 200, height: 100 };

function transformOf(overrides: Partial<Transform> = {}): Transform {
  return {
    x: 400,
    y: 300,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    skewX: 0,
    skewY: 0,
    originX: 0.5,
    originY: 0.5,
    ...overrides,
  };
}

function frameOf(transform: Transform, local: Bounds = LOCAL): ElementFrame {
  return { local, matrix: elementMatrix(transform, local) };
}

function handleFor(id: string): Handle {
  const handle = TRANSFORM_HANDLES.find((candidate) => candidate.id === id);
  if (!handle) throw new Error(`No handle called ${id}`);
  return handle;
}

/** Where a point of the element box lands on the canvas under a transform. */
function pointAt(transform: Transform, at: Point, local: Bounds = LOCAL): Point {
  return applyMatrix(elementMatrix(transform, local), [
    local.x + at[0] * local.width,
    local.y + at[1] * local.height,
  ]);
}

function drag(handleId: string, transform: Transform, to: Point, constrain = false): Transform {
  const handle = handleFor(handleId);
  const frame = frameOf(transform);
  return dragHandle(handle, {
    frame,
    transform,
    pointerStart: handlePosition(frame, handle, 1),
    constrain,
  }, to);
}

describe('transform handles', () => {
  it('puts the box corners where the matrix does', () => {
    const transform = transformOf({ rotation: 90 });
    const [topLeft] = frameCorners(frameOf(transform));

    // A quarter turn about the centre sends the top-left corner to the top right.
    expect(topLeft[0]).toBeCloseTo(450);
    expect(topLeft[1]).toBeCloseTo(200);
  });

  it('stands a handle off the box by a fixed number of screen pixels', () => {
    const frame = frameOf(transformOf());
    const rotate = handleFor('rotate');

    expect(handlePosition(frame, rotate, 1)).toEqual([400, 250 - rotate.standOff]);
    // At half the zoom a canvas unit is worth twice as much, so the stand-off doubles in document
    // space to stay put on screen.
    expect(handlePosition(frame, rotate, 2)).toEqual([400, 250 - rotate.standOff * 2]);
  });

  it('drops the secondary handles once the box has no room for them', () => {
    const roomy = frameOf(transformOf());
    const cramped = frameOf(transformOf({ scaleX: 0.1, scaleY: 0.1 }));

    expect(TRANSFORM_HANDLES.filter((handle) => handleFits(roomy, handle, 1))).toHaveLength(11);
    // The four corners are never dropped: they are the last usable grip on a tiny element.
    expect(TRANSFORM_HANDLES.filter((handle) => handleFits(cramped, handle, 1)).map((handle) => handle.id))
      .toEqual(['nw', 'ne', 'se', 'sw']);
  });

  it('names a resize cursor that follows the element around', () => {
    expect(resizeCursor(0)).toBe('ew-resize');
    expect(resizeCursor(45)).toBe('nwse-resize');
    expect(resizeCursor(-90)).toBe('ns-resize');
    expect(resizeCursor(135)).toBe('nesw-resize');
    expect(resizeCursor(180)).toBe('ew-resize');
  });

  describe('resizing', () => {
    it('sends the dragged corner to the pointer and leaves the opposite one alone', () => {
      const transform = transformOf();
      const before = pointAt(transform, [0, 0]);
      const next = drag('se', transform, [700, 500]);

      expect(pointAt(next, [1, 1])[0]).toBeCloseTo(700);
      expect(pointAt(next, [1, 1])[1]).toBeCloseTo(500);
      expect(pointAt(next, [0, 0])[0]).toBeCloseTo(before[0]);
      expect(pointAt(next, [0, 0])[1]).toBeCloseTo(before[1]);
    });

    it('holds the opposite corner even when the element is rotated and slanted', () => {
      const transform = transformOf({ rotation: 37, skewX: -14, skewY: 9, scaleX: 1.4, scaleY: 0.8 });
      const before = pointAt(transform, [1, 1]);
      const next = drag('nw', transform, [180, 120]);

      expect(pointAt(next, [0, 0])[0]).toBeCloseTo(180);
      expect(pointAt(next, [0, 0])[1]).toBeCloseTo(120);
      expect(pointAt(next, [1, 1])[0]).toBeCloseTo(before[0]);
      expect(pointAt(next, [1, 1])[1]).toBeCloseTo(before[1]);
      expect(next.rotation).toBe(transform.rotation);
      expect(next.skewX).toBe(transform.skewX);
    });

    it('moves one axis only from an edge handle', () => {
      const transform = transformOf();
      const next = drag('e', transform, [700, 999]);

      expect(next.scaleX).toBeCloseTo(2);
      expect(next.scaleY).toBe(1);
      // The left edge is the anchor, so it has not moved despite the element growing rightwards.
      expect(pointAt(next, [0, 0.5])[0]).toBeCloseTo(300);
    });

    it('holds the aspect ratio when constrained', () => {
      const transform = transformOf({ scaleX: 1, scaleY: 2 });
      const free = drag('se', transform, [700, 350]);
      const locked = drag('se', transform, [700, 350], true);

      expect(free.scaleX / free.scaleY).not.toBeCloseTo(0.5);
      expect(locked.scaleX / locked.scaleY).toBeCloseTo(0.5);
    });

    /**
     * The aspect a constrained drag holds is the aspect of the *sizes*, which is what the lock is
     * for. Crossing the anchor is a separate statement about which side of it the element sits on,
     * and it is made one axis at a time -- so a corner taken past the anchor sideways only comes
     * back mirrored sideways, at the proportions it went in with, rather than flipping both ways.
     */
    it('mirrors one axis under a constrained drag without disturbing the proportions', () => {
      const transform = transformOf({ scaleX: 1, scaleY: 2 });
      // The anchor is the top-left corner, at (300, 200); this lands well to the left of it and
      // below, so the horizontal ratio goes negative while the vertical one stays positive.
      const next = drag('se', transform, [200, 400], true);

      expect(next.scaleX).toBeCloseTo(-1);
      expect(next.scaleY).toBeCloseTo(2);
      expect(Math.abs(next.scaleX / next.scaleY)).toBeCloseTo(0.5);
    });

    it('mirrors rather than collapsing when dragged past the anchor', () => {
      const next = drag('e', transformOf(), [200, 300]);

      expect(next.scaleX).toBeLessThan(0);
      // Still anchored on the left edge, which is now the right-hand side of the drawn box.
      expect(pointAt(next, [0, 0.5])[0]).toBeCloseTo(300);
    });

    it('never scales all the way to nothing', () => {
      const next = drag('e', transformOf(), [300, 300]);

      expect(Math.abs(next.scaleX)).toBeGreaterThan(0);
    });
  });

  describe('rotating', () => {
    it('turns by the angle the pointer swept about the transform origin', () => {
      const transform = transformOf();
      const handle = handleFor('rotate');
      const frame = frameOf(transform);
      const next = dragHandle(handle, {
        frame,
        transform,
        // Due east of the origin, swung to due south: a quarter turn.
        pointerStart: [500, 300],
        constrain: false,
      }, [400, 400]);

      expect(next.rotation).toBeCloseTo(90);
      // Rotation turns about the origin, so the element has not been repositioned.
      expect(next.x).toBe(transform.x);
      expect(next.y).toBe(transform.y);
    });

    it('snaps to fifteen degree steps when constrained', () => {
      const transform = transformOf();
      const frame = frameOf(transform);
      const next = dragHandle(handleFor('rotate'), {
        frame,
        transform,
        pointerStart: [500, 300],
        constrain: true,
      }, [500, 310]);

      expect(next.rotation).toBe(0);
    });
  });

  describe('slanting', () => {
    it('shears sideways by the distance the bottom edge was dragged', () => {
      const transform = transformOf();
      // The slant is measured across the whole box, because the anchor is the opposite edge: the
      // bottom edge slid 100 to the right over the box's 100 of height is a 45 degree slant.
      const next = drag('skew-x', transform, [500, 350]);

      expect(next.skewX).toBeCloseTo(45);
      expect(next.skewY).toBe(0);
      // The top edge is the anchor and stays where it was.
      expect(pointAt(next, [0.5, 0])[0]).toBeCloseTo(400);
      expect(pointAt(next, [0.5, 0])[1]).toBeCloseTo(250);
    });

    it('shears vertically from the right edge', () => {
      // 200 down over the box's 200 of width.
      const next = drag('skew-y', transformOf(), [500, 500]);

      expect(next.skewY).toBeCloseTo(45);
      expect(next.skewX).toBe(0);
      expect(pointAt(next, [0, 0.5])[1]).toBeCloseTo(300);
    });

    it('keeps the shear inside the range the renderer can draw', () => {
      const next = drag('skew-x', transformOf(), [40_000, 350]);

      expect(Math.abs(next.skewX)).toBeLessThan(90);
    });

    it('snaps to five degree steps when constrained', () => {
      // 46 over 100 is a shade under 25 degrees, which is the nearest step.
      const next = drag('skew-x', transformOf(), [446, 350], true);

      expect(next.skewX).toBe(25);
    });
  });

  describe('moving', () => {
    it('follows the pointer', () => {
      const transform = transformOf();
      const next = dragMove({
        frame: frameOf(transform),
        transform,
        pointerStart: [400, 300],
        constrain: false,
      }, [460, 330]);

      expect([next.x, next.y]).toEqual([460, 330]);
    });

    it('locks to the axis the pointer travelled furthest along when constrained', () => {
      const transform = transformOf();
      const next = dragMove({
        frame: frameOf(transform),
        transform,
        pointerStart: [400, 300],
        constrain: true,
      }, [460, 330]);

      expect([next.x, next.y]).toEqual([460, 300]);
    });
  });

  it('folds rotation into the range the inspector control spans', () => {
    expect(normalizeDegrees(370)).toBeCloseTo(10);
    expect(normalizeDegrees(-190)).toBeCloseTo(170);
    expect(normalizeDegrees(180)).toBe(180);
    expect(normalizeDegrees(-180)).toBe(180);
  });
});
