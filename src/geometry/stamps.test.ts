import { describe, expect, it } from 'vitest';

import { flattenPath, pathBounds } from './path';
import { shapeOutline, stampOutline } from './stamps';
import { STAMP_IDS, type ShapeElement } from '../model/types';

function stampElement(overrides: Partial<ShapeElement> = {}): ShapeElement {
  return {
    id: 'stamp-1',
    type: 'shape',
    name: 'Stamp',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: {
      x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0, originX: 0.5, originY: 0.5,
    },
    effects: [],
    animations: [],
    shape: 'triangle',
    width: 200,
    height: 120,
    path: null,
    ...overrides,
  };
}

describe('stamp outlines', () => {
  it('draws every stamp in the catalogue as a closed path', () => {
    // A stamp is filled, not stroked, so an unclosed contour would leak fill across the shape --
    // and a stamp missing from the dispatcher would silently fall through to whatever the final
    // branch happens to be rather than failing.
    for (const shape of STAMP_IDS) {
      const path = stampOutline(shape, 200, 120);

      expect(path.commands.length, shape).toBeGreaterThan(2);
      expect(path.commands[0]?.type, shape).toBe('M');
      expect(path.commands.at(-1)?.type, shape).toBe('Z');
    }
  });

  it('fills the box it is given, without escaping it', () => {
    // Stamps are placed and resized by their box, so geometry that overflowed would put the drawn
    // shape somewhere other than the selection outline and the hit test both say it is.
    for (const shape of STAMP_IDS) {
      const bounds = pathBounds(flattenPath(stampOutline(shape, 200, 120)));

      expect(bounds.x, shape).toBeGreaterThanOrEqual(-0.01);
      expect(bounds.y, shape).toBeGreaterThanOrEqual(-0.01);
      expect(bounds.x + bounds.width, shape).toBeLessThanOrEqual(200.01);
      expect(bounds.y + bounds.height, shape).toBeLessThanOrEqual(120.01);
      // Half the box in each axis is a floor no real stamp comes near, and it is what catches a
      // generator that collapsed to a sliver or a point.
      expect(bounds.width, shape).toBeGreaterThan(100);
      expect(bounds.height, shape).toBeGreaterThan(60);
    }
  });

  it('rebuilds geometry at the requested size rather than scaling a fixed copy', () => {
    const small = pathBounds(flattenPath(stampOutline('star', 100, 100)));
    const large = pathBounds(flattenPath(stampOutline('star', 400, 250)));

    expect(small.width).toBeCloseTo(100, 1);
    expect(large.width).toBeCloseTo(400, 1);
    expect(large.height).toBeCloseTo(250, 1);
  });

  it('prefers detached geometry over the generator', () => {
    // This is the whole forward path to an editor: once a path is stored, the generator stops
    // being consulted, so an edit cannot be silently regenerated away on the next render.
    const detached: ShapeElement = stampElement({
      shape: 'triangle',
      path: { commands: [{ type: 'M', point: [0, 0] }, { type: 'L', point: [10, 0] }, { type: 'Z' }] },
    });

    expect(shapeOutline(detached)).toEqual(detached.path);
    expect(shapeOutline(stampElement())).toEqual(stampOutline('triangle', 200, 120));
  });

  it('keeps the splat lobed rather than round', () => {
    // The splat is the one stamp whose whole identity is an uneven radius. Built from a radii
    // table, it is also the one that would still produce a plausible-looking closed path if that
    // table were dropped -- it would just quietly become a circle.
    const contour = flattenPath(stampOutline('splat', 200, 200))[0]!;
    const radii = contour.map(([x, y]) => Math.hypot(x - 100, y - 100));

    expect(Math.min(...radii)).toBeLessThan(Math.max(...radii) * 0.7);
  });
});
