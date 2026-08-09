import { describe, expect, it } from 'vitest';

import { createDefaultDocument } from '../model/defaults';
import { documentSchema } from '../model/schema';
import type { Gradient } from '../model/types';
import { applyPresetToElement, BUILT_IN_PRESETS } from './library';
import { OFFICE_RAMPS } from './office-ramps';
import { PRESET_CATEGORY_TABS } from './types';

function gradientFillPaint(presetId: string): Gradient | undefined {
  const fill = BUILT_IN_PRESETS.find((preset) => preset.id === presetId)
    ?.apply.effects.find((effect) => effect.kind === 'fill');
  if (fill?.kind !== 'fill' || fill.paint.kind !== 'gradient') return undefined;
  return fill.paint.gradient;
}

/** Bump deliberately when a style is added or removed, so neither happens by accident. */
const PRESET_COUNT = 123;

describe('preset library', () => {
  it('ships every named style across the core and themed categories', () => {
    // Ids are what share links and autosaved documents carry, so a collision would silently make
    // one preset unreachable. Asserted against the array length rather than a second literal, so
    // adding a style only ever needs the count below touched once.
    expect(new Set(BUILT_IN_PRESETS.map((preset) => preset.id)).size).toBe(BUILT_IN_PRESETS.length);
    expect(BUILT_IN_PRESETS).toHaveLength(PRESET_COUNT);
    expect(new Set(BUILT_IN_PRESETS.map((preset) => preset.category))).toEqual(
      new Set([
        'metallic', 'synthwave', 'y2k', 'nineties', 'dimensional', 'texture',
        'sweets', 'spooky', 'cosmic',
      ]),
    );
  });

  it('offers every non-user category a tab in the picker', () => {
    const tabbed = new Set(PRESET_CATEGORY_TABS.map((tab) => tab.id));
    for (const preset of BUILT_IN_PRESETS) expect(tabbed.has(preset.category), preset.category).toBe(true);
    // The unfiltered tab is the panel's initial state, so losing it would leave the picker opening
    // with no tab selected -- which the per-category check above cannot see, since 'all' is not a
    // category any preset carries.
    expect(PRESET_CATEGORY_TABS[0]?.id).toBe('all');
  });

  it('builds Cross-Polar Crystal from interference colour and mineral cells', () => {
    const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === 'cross-polar-crystal');

    expect(preset?.apply.warp).toMatchObject({ kind: 'preset', preset: 'textStop' });
    expect(preset?.tags).toEqual(expect.arrayContaining(['petrographic', 'birefringent', 'thin-section']));
    expect(preset?.apply.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'textureOverlay', source: { type: 'procedural', pattern: 'crystal' } }),
      expect.objectContaining({ kind: 'bevel', technique: 'chiselHard' }),
    ]));
  });

  it('builds Satin Stitch Sampler from directional thread and padded relief', () => {
    const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === 'satin-stitch-sampler');

    expect(preset?.apply.warp).toMatchObject({ kind: 'preset', preset: 'textCurveDown' });
    expect(preset?.tags).toEqual(expect.arrayContaining(['embroidery', 'needlework', 'textile', 'handmade']));
    expect(preset?.apply.effects.map((effect) => effect.kind)).toEqual([
      'dropShadow', 'fill', 'textureOverlay', 'satin', 'bevel', 'innerGlow', 'stroke', 'stroke',
    ]);
    expect(preset?.apply.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'textureOverlay', source: { type: 'procedural', pattern: 'stitch' } }),
      expect.objectContaining({ kind: 'bevel', style: 'pillow' }),
      expect.objectContaining({ kind: 'satin' }),
    ]));
  });

  it('builds Topographic Taffy from nested elevation bands', () => {
    const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === 'topographic-taffy');

    expect(preset?.apply.warp).toMatchObject({ kind: 'preset', preset: 'textCanUp' });
    expect(preset?.preview).toEqual(['#fff4cf', '#d9ed92', '#65c6a6', '#2d8b8c', '#f2b84b', '#e85d4f']);
    expect(preset?.tags).toEqual(expect.arrayContaining(['topographic', 'contour', 'strata', 'cartography']));
    const strokes = preset?.apply.effects.filter((effect) => effect.kind === 'stroke') ?? [];
    expect(strokes.map((effect) => [effect.width, effect.position])).toEqual([
      [15, 'inside'],
      [12, 'inside'],
      [9, 'inside'],
      [6, 'inside'],
      [3, 'inside'],
      [2, 'outside'],
    ]);
  });

  it('files the whole friendly-1990s block under the decade tab', () => {
    // These share a tab with the loud half of the decade rather than getting one of their own, so
    // the thing worth pinning is that none of them drifted into another category and out of it.
    const friendly = [
      'jazz-cup', 'memphis-confetti', 'squiggle-scribble', 'acid-smiley', 'bubble-tag',
      'hi-top-fresh', 'mixtape-label', 'floppy-disk', 'pizza-party', 'zigzag-bolt',
      'grid-lock', 'airbrush-tee', 'trapper-keeper', 'puffy-sticker',
    ];

    for (const id of friendly) {
      expect(BUILT_IN_PRESETS.find((preset) => preset.id === id)?.category, id).toBe('nineties');
    }
    // Cards are keyed by name in the picker, so a duplicate would drop one of them from the grid
    // without the id check above noticing.
    expect(new Set(BUILT_IN_PRESETS.map((preset) => preset.name)).size).toBe(BUILT_IN_PRESETS.length);
  });

  it('builds Jazz Cup from two misregistered brush plates behind an opaque face', () => {
    const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === 'jazz-cup');

    // The plates only ever show as the fringe either side of the letter, which is the whole look:
    // a translucent face would let them wash across it and turn the cup into a duotone.
    expect(preset?.apply.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'fill', paint: { kind: 'solid', color: [expect.any(Number), expect.any(Number), expect.any(Number), 1] } }),
    ]));
    const plates = preset?.apply.effects.filter(
      (effect) => effect.kind === 'dropShadow' && effect.blendMode === 'multiply',
    ) ?? [];
    expect(plates).toHaveLength(2);
    // Unblurred and drifted in two different directions -- a shared angle would stack them into one
    // thicker plate instead of two separate strokes.
    expect(plates.map((effect) => effect.kind === 'dropShadow' && effect.size)).toEqual([0, 0]);
    expect(new Set(plates.map((effect) => effect.kind === 'dropShadow' && effect.angle)).size).toBe(2);
  });

  it('draws Squiggle Scribble as dark contours by inverting the card under them', () => {
    const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === 'squiggle-scribble');

    // Contours paint white. Any blend that lightens would lose them entirely against the pale
    // fill, so `difference` is load-bearing rather than a taste call.
    expect(preset?.apply.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'textureOverlay',
        source: { type: 'procedural', pattern: 'topography' },
        blendMode: 'difference',
        clipToShape: true,
      }),
    ]));
  });

  it('gives the Memphis-descended styles flat offset shadows rather than blurred ones', () => {
    // A soft shadow is the single quickest way to read as 2005 instead of 1995, and every style
    // here is built around a hard block of colour sitting behind the letter.
    for (const id of ['memphis-confetti', 'squiggle-scribble', 'acid-smiley', 'bubble-tag', 'zigzag-bolt', 'grid-lock']) {
      const shadows = BUILT_IN_PRESETS
        .find((preset) => preset.id === id)
        ?.apply.effects.filter((effect) => effect.kind === 'dropShadow') ?? [];

      expect(shadows.length, id).toBeGreaterThan(0);
      for (const shadow of shadows) {
        expect(shadow.kind === 'dropShadow' && shadow.size, id).toBe(0);
        expect(shadow.kind === 'dropShadow' && shadow.distance, id).toBeGreaterThan(0);
      }
    }
  });

  it('builds the gradient metals from hand-placed bands', () => {
    // A metal fill is bands, not a wash: stops must arrive unevenly spaced at their own offsets,
    // or the horizon these styles are built around dissolves into a blend. Uneven spacing is also
    // what exercises the renderer's exact-offset sampling, which even-stop gradients cannot.
    for (const id of ['meltorama', 'airbrush-chrome', 'molten-gold', 'chrome-sunset', 'millennium-chrome']) {
      const paint = gradientFillPaint(id);
      expect(paint, id).toBeDefined();
      const offsets = paint!.stops.map((stop) => stop.offset);
      expect(offsets.length, id).toBeGreaterThanOrEqual(5);
      const gaps = offsets.slice(1).map((offset, index) => offset - offsets[index]!);
      expect(new Set(gaps.map((gap) => gap.toFixed(3))).size, id).toBeGreaterThan(1);
    }
  });

  it('gives every polished metal a bright-dark-bright luminance V', () => {
    // A polished bar reflects sky at both ends and the dark room at its waist, so the profile is
    // a V: a fill that merely slopes from light to dark reads as shading, not as metal.
    for (const id of ['meltorama', 'meltorama-ii', 'molten-gold', 'showroom-chrome']) {
      const stops = gradientFillPaint(id)?.stops ?? [];
      const luma = (index: number) => {
        const [red, green, blue] = stops[index]!.color;
        return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
      };
      const interior = stops.slice(1, -1).map((_, offset) => luma(offset + 1));
      expect(stops.length, id).toBeGreaterThanOrEqual(5);
      expect(luma(0), id).toBeGreaterThan(Math.min(...interior) + 0.3);
      expect(luma(stops.length - 1), id).toBeGreaterThan(Math.min(...interior) + 0.3);
    }
  });

  it('melts Meltorama II smoothly and drops both Meltorama plates below the letter', () => {
    for (const id of ['meltorama', 'meltorama-ii']) {
      const preset = BUILT_IN_PRESETS.find((candidate) => candidate.id === id);
      const plate = preset?.apply.effects.find((effect) => effect.kind === 'dropShadow');
      const depth = preset?.apply.effects.find((effect) => effect.kind === 'extrude');
      // Shadow angles point at the light source (90..270 casts downward or across, never up-left),
      // and extrude angles point where the depth goes (near 90 is straight down). Both presets were
      // once authored with the conventions inverted, which hung the plate and the depth above the
      // word instead of below it.
      expect(plate?.kind === 'dropShadow' && plate.useGlobalLight, id).toBe(false);
      expect(plate?.kind === 'dropShadow' && plate.angle, id).toBeGreaterThanOrEqual(90);
      expect(plate?.kind === 'dropShadow' && plate.angle, id).toBeLessThanOrEqual(270);
      expect(depth?.kind === 'extrude' && depth.angle, id).toBeGreaterThanOrEqual(45);
      expect(depth?.kind === 'extrude' && depth.angle, id).toBeLessThanOrEqual(135);
    }
    expect(BUILT_IN_PRESETS.find((candidate) => candidate.id === 'meltorama-ii')
      ?.apply.effects.some((effect) => effect.kind === 'stroke')).toBe(false);
  });

  it('shows every drawable gradient geometry somewhere on the metal shelf', () => {
    expect(gradientFillPaint('meltorama')?.type).toBe('linear');
    expect(gradientFillPaint('sterling-mirror')?.type).toBe('reflected');
    expect(gradientFillPaint('turbine')?.type).toBe('angular');
    expect(gradientFillPaint('chrome-dome')?.type).toBe('radial');
    // The dome only reads as a dome because its highlight sits off-centre.
    expect(gradientFillPaint('chrome-dome')?.center).not.toEqual([0.5, 0.5]);
  });

  it('ships all 24 Office ramp names with 20 stops each', () => {
    expect(Object.keys(OFFICE_RAMPS)).toHaveLength(24);
    for (const colors of Object.values(OFFICE_RAMPS)) expect(colors).toHaveLength(20);
  });

  it('applies every preset without changing content, placement, or text size', () => {
    for (const preset of BUILT_IN_PRESETS) {
      const document = createDefaultDocument({
        documentId: `document-${preset.id}`,
        elementId: `element-${preset.id}`,
        fillId: `fill-${preset.id}`,
        now: '2026-01-02T03:04:05.000Z',
      });
      const element = document.elements[0]!;
      if (element.type !== 'text') throw new Error('Default element must be text');
      const text = element.text;
      const transform = structuredClone(element.transform);
      const size = element.layout.size;

      applyPresetToElement(element, preset);

      expect(element.text).toBe(text);
      expect(element.transform).toEqual(transform);
      expect(element.layout.size).toBe(size);
      expect(documentSchema.safeParse(document).success, preset.id).toBe(true);
    }
  });
});
