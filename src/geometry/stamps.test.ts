import { describe, expect, it } from 'vitest';

import { flattenPath, pathBounds } from './path';
import { shapeOutline, stampOutline } from './stamps';
import { STAMP_IDS, type Point, type ShapeElement, type StampId } from '../model/types';

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

  it('gives every symmetric stamp a mirror that lands back on itself', () => {
    // A stamp that is supposed to sit straight (ghost, bat, pumpkin, cross, ...) is built symmetric
    // about its centreline. Measuring that as geometry -- reflect the flattened outline and ask how
    // many points still land on the outline -- is what stops a future coordinate edit from making a
    // ghost lopsided or a bat that cannot fly, without ever putting one on a canvas.
    const mirrorSymmetry = (shape: StampId, w: number, h: number, axis: 'x' | 'y'): number => {
      const points = flattenPath(stampOutline(shape, w, h)).flat();
      const reflect = (x: number, y: number): Point => (axis === 'x' ? [w - x, y] : [x, h - y]);
      let matched = 0;
      for (const [x, y] of points) {
        const [rx, ry] = reflect(x, y);
        const near = points.some((point) => Math.hypot(point[0] - rx, point[1] - ry) < 1.5);
        if (near) matched += 1;
      }
      return matched / points.length;
    };
    const w = 220, h = 160;
    // Symmetric about the vertical centreline (mirror left <-> right).
    const verticallySymmetric: StampId[] = [
      'rectangle', 'ellipse', 'star', 'triangle', 'zigzag', 'starburst', 'arch', 'heart',
      'cross', 'diamond', 'sparkle', 'cloud', 'flower', 'drop', 'ghost', 'bat', 'pumpkin',
      'tombstone', 'coffin', 'sun',
    ];
    // Symmetric about the horizontal centreline (mirror top <-> bottom).
    const horizontallySymmetric: StampId[] = [
      'rectangle', 'ellipse', 'starburst', 'cross', 'sparkle', 'flower', 'sun', 'chevron', 'arrow',
    ];
    for (const shape of verticallySymmetric) {
      expect(mirrorSymmetry(shape, w, h, 'x'), `${shape} symmetric left-right`).toBeGreaterThan(0.98);
    }
    for (const shape of horizontallySymmetric) {
      expect(mirrorSymmetry(shape, w, h, 'y'), `${shape} symmetric top-bottom`).toBeGreaterThan(0.98);
    }
  });

  it('points the directional stamps the right way', () => {
    // Orientation is the other half of "looks right": a chevron pointing left, or a comet whose
    // tail led its head, would pass every closed-path and box test. The area centroid and the
    // extreme points fix the direction each one faces.
    const centroid = (shape: StampId): Point => {
      const contour = flattenPath(stampOutline(shape, 200, 120))[0]!;
      let area = 0;
      let cx = 0;
      let cy = 0;
      for (let index = 0; index < contour.length; index += 1) {
        const [x, y] = contour[index]!;
        const [nextX, nextY] = contour[(index + 1) % contour.length]!;
        const cross = x * nextY - nextX * y;
        area += cross;
        cx += (x + nextX) * cross;
        cy += (y + nextY) * cross;
      }
      area /= 2;
      return [cx / (6 * area), cy / (6 * area)];
    };
    const extremes = (shape: StampId) => {
      const contour = flattenPath(stampOutline(shape, 200, 120))[0]!;
      let maxX = -Infinity;
      let maxXy = 0;
      let minY = Infinity;
      let minYx = 0;
      let maxY = -Infinity;
      let maxYx = 0;
      for (const [x, y] of contour) {
        if (x > maxX) { maxX = x; maxXy = y; }
        if (y < minY) { minY = y; minYx = x; }
        if (y > maxY) { maxY = y; maxYx = x; }
      }
      return { maxX, maxXy, minY, minYx, maxY, maxYx };
    };

    // The comet's head is round and its tail streams away to the right, so the bulk of its area
    // sits left of the midline. The crescent's bite opens the same way.
    expect(centroid('comet')[0]).toBeLessThan(100);
    expect(centroid('crescent')[0]).toBeLessThan(100);
    // The chevron and the arrow point right: their rightmost reach is on the vertical centreline.
    expect(Math.abs(extremes('chevron').maxXy - 60)).toBeLessThan(6);
    expect(Math.abs(extremes('arrow').maxXy - 60)).toBeLessThan(6);
    // The triangle points up and the heart points down, each on the centreline.
    expect(Math.abs(extremes('triangle').minYx - 100)).toBeLessThan(6);
    expect(Math.abs(extremes('heart').maxYx - 100)).toBeLessThan(6);
    // The drop's tip is at the top of its box, on the centreline.
    expect(Math.abs(extremes('drop').minYx - 100)).toBeLessThan(6);
  });
});
