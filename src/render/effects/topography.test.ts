import { describe, expect, it } from 'vitest';

import { createEffect } from '../../effects/defaults';
import { textureOverlayReach, topographyCoverage } from './cpu-effects';

const PERIOD = 10;
const LINE = 2;
const coverage = (depth: number) => topographyCoverage(depth, PERIOD, LINE);

describe('topography contour coverage', () => {
  it('puts a line on every multiple of the period and nothing between them', () => {
    for (const ring of [0, 1, 2, 3, 4, 6, 7]) {
      expect(coverage(ring * PERIOD), `ring ${ring}`).toBe(1);
      expect(coverage((ring + 0.5) * PERIOD), `between ${ring} and ${ring + 1}`).toBe(0);
    }
  });

  it('draws rings outside the glyph as well as inside', () => {
    // Negative depth is outside the letterform. The pattern has to keep going out there or an
    // unclipped overlay would just be an inner hatch with a hard stop at the edge.
    expect(coverage(-PERIOD)).toBe(1);
    expect(coverage(-2 * PERIOD)).toBe(1);
    expect(coverage(-1.5 * PERIOD)).toBe(0);
  });

  it('makes every fifth contour an index contour, drawn heavier', () => {
    // 1.5px from the ring centre: inside the 2px-wide index line, outside the 1px ordinary one.
    const ordinary = coverage(3 * PERIOD + 1.5);
    const index = coverage(5 * PERIOD + 1.5);
    expect(index).toBeGreaterThan(ordinary);
    expect(ordinary).toBe(0);
    expect(index).toBe(1);
    expect(coverage(-5 * PERIOD + 1.5), 'index contours continue outside too').toBe(1);
  });

  it('stays within unit coverage and survives a degenerate period', () => {
    for (let depth = -40; depth <= 40; depth += 0.25) {
      expect(coverage(depth)).toBeGreaterThanOrEqual(0);
      expect(coverage(depth)).toBeLessThanOrEqual(1);
    }
    expect(topographyCoverage(5, 0, LINE)).toBe(0);
    expect(topographyCoverage(5, -1, LINE)).toBe(0);
    expect(topographyCoverage(5, Number.NaN, LINE)).toBe(0);
  });
});

describe('texture overlay reach', () => {
  const overlay = (pattern: 'topography' | 'grain', clipToShape: boolean, scale = 1) => {
    const effect = createEffect('textureOverlay');
    effect.source = { type: 'procedural', pattern };
    effect.clipToShape = clipToShape;
    effect.scale = scale;
    return effect;
  };

  it('asks for room only when unclipped contours need to escape the glyph', () => {
    expect(textureOverlayReach(overlay('topography', false))).toBeGreaterThan(0);
    expect(textureOverlayReach(overlay('topography', true))).toBe(0);
    expect(textureOverlayReach(overlay('grain', false))).toBe(0);
  });

  it('grows with the ring spacing, so widening the rings does not clip them', () => {
    const narrow = textureOverlayReach(overlay('topography', false, 1));
    const wide = textureOverlayReach(overlay('topography', false, 3));
    expect(wide).toBeCloseTo(narrow * 3, 6);
  });

  it('still covers the paint once the spacing floor takes over', () => {
    // Below a texture scale of 0.5 the ring spacing is floored so the rings cannot merge into a
    // solid. The reach has to be floored on the same terms: computed from the unfloored spacing it
    // would come out under half what actually gets painted, and the outer rings would be sliced
    // off at the layer edge -- the exact failure this function exists to prevent. 0.2 is the
    // inspector's minimum texture scale, so it is reachable by dragging one slider.
    const floored = textureOverlayReach(overlay('topography', false, 0.2));
    const atFloor = textureOverlayReach(overlay('topography', false, 0.5));
    expect(floored).toBe(atFloor);
    expect(floored).toBeGreaterThan(0);
  });
});
