import { describe, expect, it } from 'vitest';

import { exactPathBounds, flattenPath, pathBounds } from './path';
import { shapeOutline, stampAspect, stampOutline } from './stamps';
import { STAMP_GROUPS, STAMP_IDS, STAMP_IDS_BY_GROUP, type Point, type ShapeElement } from '../model/types';

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

/**
 * The nonzero winding number at a point: how many times the contours wrap around it, signed.
 *
 * This is the renderer's own rule reproduced in a dozen lines, and it is the only way to ask the
 * questions that matter about a figure with holes. Bounds cannot tell a pierced shape from a solid
 * one, and command counts cannot tell a hole that shows from a hole that quietly filled back in.
 */
function windingAt(contours: readonly (readonly Point[])[], [x, y]: Point): number {
  let winding = 0;
  for (const contour of contours) {
    for (let index = 0; index < contour.length; index += 1) {
      const [x0, y0] = contour[index]!;
      const [x1, y1] = contour[(index + 1) % contour.length]!;
      if (y0 <= y) {
        if (y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0) winding += 1;
      } else if (y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) winding -= 1;
    }
  }
  return winding;
}

/** Every stamp's winding, sampled on a grid fine enough to land inside its smallest feature. */
const windingCache = new Map<string, number[]>();

function sampleWindings(shape: (typeof STAMP_IDS)[number], steps = 111): number[] {
  const cacheKey = `${shape}:${steps}`;
  const cached = windingCache.get(cacheKey);
  if (cached) return cached;
  const contours = flattenPath(stampOutline(shape, 240, 240));
  const outward = Math.sign(contours.reduce(
    (total, contour) => total + contour.reduce(
      (sum, [x0, y0], index) => {
        const [x1, y1] = contour[(index + 1) % contour.length]!;
        return sum + x0 * y1 - x1 * y0;
      },
      0,
    ),
    0,
  )) || 1;
  const samples: number[] = [];
  for (let row = 0; row < steps; row += 1) {
    for (let column = 0; column < steps; column += 1) {
      // Offset off the exact grid so a sample never lands on an axis-aligned edge, where the
      // crossing rule is exactly the boundary case it is not meant to be asked about.
      const point: Point = [((column + 0.3137) / steps) * 240, ((row + 0.5731) / steps) * 240];
      samples.push(windingAt(contours, point) * outward);
    }
  }
  windingCache.set(cacheKey, samples);
  return samples;
}

describe('stamp outlines', () => {
  it('draws every stamp in the catalogue as closed contours', () => {
    // A stamp is filled, not stroked, so an unclosed contour would leak fill across the shape --
    // and a stamp missing from the dispatcher would silently fall through to whatever the final
    // branch happens to be rather than failing.
    for (const shape of STAMP_IDS) {
      const path = stampOutline(shape, 200, 120);

      expect(path.commands.length, shape).toBeGreaterThan(2);
      expect(path.commands[0]?.type, shape).toBe('M');
      expect(path.commands.at(-1)?.type, shape).toBe('Z');
      // Every contour has to close, not just the last one: a figure is several contours, and one
      // left open would run its fill into the next.
      const opened = path.commands.filter((command) => command.type === 'M').length;
      const closed = path.commands.filter((command) => command.type === 'Z').length;
      expect(closed, shape).toBe(opened);
    }
  });

  it('fills the box it is given, without escaping it', () => {
    // Stamps are placed and resized by their box, so geometry that overflowed would put the drawn
    // shape somewhere other than the selection outline and the hit test both say it is.
    for (const shape of STAMP_IDS) {
      const bounds = exactPathBounds(stampOutline(shape, 200, 120));

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

  it('never winds a region negative, where a hole would fill itself back in', () => {
    // Nonzero fills anything that is not zero, so a region wound to -1 comes out solid -- and a
    // hole is the only thing that can wind a region negative. Two ways in, both of which this
    // caught while the catalogue was being drawn:
    //
    //   - two holes over the same place, which is -2 under the fill and -1 outside it: a stroked
    //     spiral built as overlapping quads rendered dashed, and a cross laid up from two bars had
    //     a filled square where they met.
    //   - a hole reaching past the fill it was meant to pierce, where there is no +1 to cancel: the
    //     sun's slats were cut to the disc's widest chord and hung filled square ears off its rim.
    //
    // Neither shows up in bounds, command counts or contour counts; only the winding says so. A
    // count above one is fine and common -- that is two filled shapes unioning, which is how most
    // of these figures are built.
    for (const shape of STAMP_IDS) {
      expect(Math.min(...sampleWindings(shape)), shape).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  it('draws the figures that are meant to be pierced with their holes showing', () => {
    // The complement of the test above. A hole can also fail by being drawn the same way round as
    // its outline, or by sitting outside the fill entirely, and in both cases the figure renders as
    // a solid blob -- a smiley with no face, a cassette with no reels.
    const pierced = [
      'smiley', 'shades', 'cassette', 'floppy', 'boombox', 'pizza', 'daisy', 'peace', 'disc',
      'gamepad', 'pumpkin', 'ghost', 'skull', 'tombstone', 'coffin', 'rocket', 'saucer',
      'satellite', 'donut', 'lolly', 'sun', 'gem', 'butterfly',
    ] as const;

    for (const shape of pierced) {
      const windings = sampleWindings(shape);
      const bounds = pathBounds(flattenPath(stampOutline(shape, 240, 240)));
      const filled = windings.filter((winding) => winding > 0).length;

      expect(windings.some((winding) => winding === 0), shape).toBe(true);
      // A hole is only a hole if it is surrounded, so the fill has to be most of the box's own
      // area -- a shape that simply covers half the box would pass an "empty samples exist" check.
      expect(filled / windings.length, shape).toBeGreaterThan(0.3);
      expect(bounds.width * bounds.height, shape).toBeGreaterThan(0);
    }
  }, 120_000);

  it('rebuilds geometry at the requested size rather than scaling a fixed copy', () => {
    const small = pathBounds(flattenPath(stampOutline('star', 100, 100)));
    const large = pathBounds(flattenPath(stampOutline('star', 400, 250)));

    expect(small.width).toBeCloseTo(100, 1);
    expect(large.width).toBeCloseTo(400, 1);
    expect(large.height).toBeCloseTo(250, 1);
  });

  it('fits the most extreme editor aspect ratios without scale-dependent overshoot', () => {
    for (const [width, height] of [[16, 900], [900, 16]] as const) {
      const bounds = exactPathBounds(stampOutline('gamepad', width, height));

      expect(bounds.x).toBeGreaterThanOrEqual(-1e-8);
      expect(bounds.y).toBeGreaterThanOrEqual(-1e-8);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1e-8);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 1e-8);
    }
  });

  it('rejects dimensions that cannot describe finite geometry', () => {
    expect(() => stampOutline('star', 0, 100)).toThrow('finite positive');
    expect(() => stampOutline('star', 100, Number.POSITIVE_INFINITY)).toThrow('finite positive');
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

describe('stamp proportions', () => {
  it('reports the proportion each figure was drawn at', () => {
    // Placement reads this, so a figure that is wider than it is tall has to say so. The named
    // cases are the ones where getting it wrong is most visible: a squashed ringed planet is an
    // egg, and a boombox forced square is a radio.
    expect(stampAspect('rectangle')).toBeCloseTo(1, 2);
    expect(stampAspect('planet')).toBeGreaterThan(1.3);
    expect(stampAspect('shades')).toBeGreaterThan(1.4);
    expect(stampAspect('lolly')).toBeLessThan(0.8);
    expect(stampAspect('gamepad')).toBeGreaterThan(1.2);
    expect(stampAspect('coffin')).toBeLessThan(0.9);
    expect(stampAspect('satellite')).toBeGreaterThan(1.2);
    expect(stampAspect('wrappedCandy')).toBeGreaterThan(1.3);

    for (const shape of STAMP_IDS) {
      expect(stampAspect(shape), shape).toBeGreaterThan(0.2);
      expect(stampAspect(shape), shape).toBeLessThan(5);
    }
  });

  it('places a stamp at its own proportion, not squeezed into the box it is measured in', () => {
    // The figure is normalised to whatever box it is handed, so the box has to carry the aspect
    // instead. Handed a matching box, the outline comes back at the shape it was drawn at.
    const aspect = stampAspect('planet');
    const bounds = pathBounds(flattenPath(stampOutline('planet', 180, 180 / aspect)));

    expect(bounds.width / bounds.height).toBeCloseTo(aspect, 2);
  });
});

describe('the stamp catalogue', () => {
  it('lists every stamp in exactly one group', () => {
    const grouped = STAMP_GROUPS.flatMap((group) => STAMP_IDS_BY_GROUP[group.id]);

    expect(new Set(grouped).size).toBe(grouped.length);
    expect(grouped).toEqual([...STAMP_IDS]);
    expect(grouped).toHaveLength(52);
  });

  it('gives every group at least one stamp', () => {
    // A group with nothing in it renders as a heading over an empty row, which reads as a bug.
    for (const group of STAMP_GROUPS) {
      expect(STAMP_IDS_BY_GROUP[group.id].length, group.id).toBeGreaterThan(0);
    }
  });
});
