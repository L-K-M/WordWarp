import { describe, expect, it } from 'vitest';

import type { InnerGlowEffect } from '../model/types';
import { BUILT_IN_PRESETS } from './library';

const BANDED = ['thermal-ironbow', 'molten-core', 'night-vision'];

function bands(id: string): InnerGlowEffect[] {
  const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`No preset ${id}`);
  return preset.apply.effects.filter((effect): effect is InnerGlowEffect => effect.kind === 'innerGlow');
}

describe('depth-mapped colour bands', () => {
  it.each(BANDED)('%s stacks its bands widest first', (id) => {
    // The ramp is an ordering, not a set of colours. Effects paint in array order, and an inner
    // glow's mask is strongest at the outline, so the *last* band drawn owns the pixels nearest
    // the edge and the earlier ones survive further in. Sorting these the other way round would
    // put the coolest colour at the core and the hottest at the rim -- the picture inverted, with
    // every colour still present and no other test any the wiser.
    const sizes = bands(id).map((band) => band.size);
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]!, `band ${index} of ${id}`).toBeLessThan(sizes[index - 1]!);
    }
  });

  it.each(BANDED)('%s measures every band from the outline', (id) => {
    // `source: 'center'` inverts an inner glow's falloff, which would break the mapping from
    // depth to colour even with the sizes still in order.
    for (const band of bands(id)) expect(band.source).toBe('edge');
  });

  it.each(BANDED)('%s paints its bands opaquely over each other', (id) => {
    // A band has to replace what is under it rather than mix with it, or the ramp turns into a
    // pile of accumulated colour. `normal` is not the inner-glow default, so it is set on purpose.
    for (const band of bands(id)) expect(band.blendMode).toBe('normal');
  });

  it('keeps every band narrow enough to reach the middle of ordinary text', () => {
    // Depth inside a glyph is bounded by half the stem width. A band wider than this never
    // reaches the core of normal-weight text, and the style collapses to its outermost colour.
    for (const id of BANDED) {
      for (const band of bands(id)) expect(band.size, `${id} band`).toBeLessThanOrEqual(20);
    }
  });
});
