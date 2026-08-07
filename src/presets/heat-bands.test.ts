import { describe, expect, it } from 'vitest';

import type { FillEffect, InnerGlowEffect, Paint } from '../model/types';
import { BUILT_IN_PRESETS } from './library';

/** Rec. 709 relative luminance of a solid paint, in 0..1. */
function luminance(paint: Paint): number {
  if (paint.kind !== 'solid') throw new Error(`Expected a solid paint, got ${paint.kind}`);
  const [red, green, blue] = paint.color;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function coreFill(id: string): FillEffect {
  const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`No preset ${id}`);
  const fills = preset.apply.effects.filter((effect): effect is FillEffect => effect.kind === 'fill');
  expect(fills, `fills in ${id}`).toHaveLength(1);
  return fills[0]!;
}

/** Preset id against the number of heat bands it is built from. */
const BANDED: Array<[string, number]> = [
  ['thermal-ironbow', 4],
  ['molten-core', 4],
  ['night-vision', 2],
];

function bands(id: string, expected: number): InnerGlowEffect[] {
  const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`No preset ${id}`);
  const found = preset.apply.effects.filter(
    (effect): effect is InnerGlowEffect => effect.kind === 'innerGlow',
  );
  // These presets also carry an outer glow, which is a different kind -- but if that ever stopped
  // being true, or a preset picked up an inner glow doing something other than a heat band, the
  // assertions below would quietly be inspecting the wrong effects. Count them first.
  expect(found, `heat bands in ${id}`).toHaveLength(expected);
  return found;
}

describe('depth-mapped colour bands', () => {
  it.each(BANDED)('%s stacks its bands widest first', (id, count) => {
    // The ramp is an ordering, not a set of colours. Effects paint in array order, and an inner
    // glow's mask is strongest at the outline, so the *last* band drawn owns the pixels nearest
    // the edge and the earlier ones survive further in. Sorting these the other way round would
    // put the coolest colour at the core and the hottest at the rim -- the picture inverted, with
    // every colour still present and no other test any the wiser.
    const sizes = bands(id, count).map((band) => band.size);
    for (let index = 1; index < sizes.length; index += 1) {
      expect(sizes[index]!, `band ${index} of ${id}`).toBeLessThan(sizes[index - 1]!);
    }
  });

  it.each(BANDED)('%s gets brighter with every step inward', (id, count) => {
    // The size ordering says the bands are stacked correctly. It says nothing about which colour
    // is on which band -- swap the colour arguments and leave the sizes alone, and every other
    // rule here still passes while the picture is inverted: hot at the rim, cold at the core.
    // That is the failure the ordering comment above warns about, and this is the rule that
    // actually catches it.
    //
    // Luminance rather than hue, because the three presets do not share a hue path: ironbow runs
    // violet through magenta to yellow, night vision stays green throughout. What they have in
    // common is that depth reads as brightness, which is what "hotter" means in all three.
    const byDepth = [...bands(id, count)].sort((first, second) => first.size - second.size);
    const levels = byDepth.map((band) => luminance(band.paint));
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]!, `${id} band ${index}`).toBeGreaterThan(levels[index - 1]!);
    }
    // And the fill, which is whatever is left at the very core, has to out-brighten all of them
    // or the ramp peaks early and falls away again at the centre.
    expect(luminance(coreFill(id).paint), `${id} core`).toBeGreaterThan(levels[levels.length - 1]!);
  });

  it.each(BANDED)('%s measures every band from the outline', (id, count) => {
    // `source: 'center'` inverts an inner glow's falloff, which would break the mapping from
    // depth to colour even with the sizes still in order.
    for (const band of bands(id, count)) expect(band.source).toBe('edge');
  });

  it.each(BANDED)('%s paints its bands opaquely over each other', (id, count) => {
    // A band has to replace what is under it rather than mix with it, or the ramp turns into a
    // pile of accumulated colour. That takes both halves: `normal` decides how the colours
    // combine, and a full alpha decides whether the one underneath shows through at all. Both are
    // defaults rather than overrides, which is exactly why they are worth asserting -- nothing in
    // the preset would show either of them changing.
    for (const band of bands(id, count)) {
      expect(band.blendMode).toBe('normal');
      expect(band.opacity).toBe(1);
    }
  });

  it.each(BANDED)('%s keeps its rim band inside half a stem', (id, count) => {
    // The narrowest band is the one drawn last, so it is what makes the rim a rim. Half a stem is
    // five to ten pixels for normal-weight text at a typical size; a rim band approaching that
    // stops being an edge and starts being the whole letter.
    //
    // Deliberately a bound on the *narrowest* band, not the widest. The widest is meant to exceed
    // half a stem -- a shallow falloff still reaching the centre is what keeps the ramp
    // continuous -- so a ceiling on it would be a number reverse-engineered from today's values
    // rather than one derived from anything.
    const sizes = bands(id, count).map((band) => band.size);
    expect(Math.min(...sizes), `${id} rim band`).toBeLessThanOrEqual(6);
  });

  it.each(BANDED)('%s spreads its bands over a range rather than bunching them', (id, count) => {
    // The real failure mode: bands all of a similar width overlap at similar strengths everywhere,
    // and the ramp collapses into one blend with no zones in it. Requiring the widest to be
    // several times the narrowest is what keeps them reading as separate depths.
    const sizes = bands(id, count).map((band) => band.size);
    expect(Math.max(...sizes) / Math.min(...sizes), `${id} band spread`).toBeGreaterThanOrEqual(2);
  });
});
