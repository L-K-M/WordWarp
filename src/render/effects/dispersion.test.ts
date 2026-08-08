import { describe, expect, it } from 'vitest';

import { dispersionOffset } from './cpu-effects';

const SHIFT = 8;
const MAX_RADIUS = 100;
const offset = (fromCenter: number) => dispersionOffset(fromCenter, SHIFT, MAX_RADIUS);

describe('radial dispersion offset', () => {
  it('leaves the optical axis in focus', () => {
    // The whole difference from the linear mode: a lens is sharp on axis. A fixed horizontal
    // split fringes the centre of the image just as hard as the edge.
    expect(offset(0)).toBe(0);
  });

  it('widens with distance from the axis, up to the full shift at the rim', () => {
    expect(offset(MAX_RADIUS)).toBe(SHIFT);
    expect(offset(MAX_RADIUS / 2)).toBe(SHIFT / 2);
    let previous = -Infinity;
    for (let distance = 0; distance <= MAX_RADIUS; distance += 5) {
      const current = offset(distance);
      expect(current).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it('fans outward on both sides of the axis', () => {
    // Sign follows the offset, so the red channel always moves away from the centre and the blue
    // toward it -- the fringe order stays consistent right across the image.
    expect(offset(-MAX_RADIUS)).toBe(-SHIFT);
    expect(offset(-MAX_RADIUS / 2)).toBe(-offset(MAX_RADIUS / 2));
  });

  it('returns whole pixels, because the sample it feeds is nearest neighbour', () => {
    for (let distance = 0; distance <= MAX_RADIUS; distance += 1) {
      expect(Number.isInteger(offset(distance))).toBe(true);
    }
    // A third of the way out with an 8px shift is 2.67px; truncation would give 2 and drag the
    // fringe inward, so it has to round.
    expect(offset(MAX_RADIUS / 3)).toBe(3);
  });
});
