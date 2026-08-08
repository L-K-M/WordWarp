import { describe, expect, it } from 'vitest';

import { createDefaultDocument } from '../model/defaults';
import { documentSchema } from '../model/schema';
import { applyPresetToElement, BUILT_IN_PRESETS } from './library';
import { OFFICE_RAMPS } from './office-ramps';
import { PRESET_CATEGORY_TABS } from './types';

/** Bump deliberately when a style is added or removed, so neither happens by accident. */
const PRESET_COUNT = 82;

describe('preset library', () => {
  it('ships every named style across the core and themed categories', () => {
    // Ids are what share links and autosaved documents carry, so a collision would silently make
    // one preset unreachable. Asserted against the array length rather than a second literal, so
    // adding a style only ever needs the count below touched once.
    expect(new Set(BUILT_IN_PRESETS.map((preset) => preset.id)).size).toBe(BUILT_IN_PRESETS.length);
    expect(BUILT_IN_PRESETS).toHaveLength(PRESET_COUNT);
  it('ships every named style from the six core categories', () => {
    expect(BUILT_IN_PRESETS).toHaveLength(42);
    expect(new Set(BUILT_IN_PRESETS.map((preset) => preset.id)).size).toBe(42);
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
