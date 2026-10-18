import { produce } from 'immer';
import { describe, expect, it } from 'vitest';

import { createEffect, EFFECT_KINDS } from '../effects/defaults';
import { createDefaultDocument, createDefaultTextElement, createStampElement } from '../model/defaults';
import { parseDocument } from '../model/schema';
import type { Effect, TextElement, WordWarpDocument } from '../model/types';
import {
  applyInspectorAction, applyInspectorValue, buildInspector, createNativeAnimation,
  flattenInspectorFields, NATIVE_ANIMATION_KINDS, resolveInspectorField,
  type InspectorAction, type InspectorField, type InspectorSection,
} from './inspector';

function fixture(): WordWarpDocument {
  const document = createDefaultDocument({ documentId: 'document', elementId: 'text', fillId: 'fill', now: '2026-01-01T00:00:00.000Z' });
  const text = document.elements[0] as TextElement;
  text.font = { family: 'Bungee', source: 'bundled', weight: 400, italic: false };
  return document;
}

function allFields(document: WordWarpDocument, selectedId = 'text') {
  return flattenInspectorFields(buildInspector(document, selectedId));
}

function field(document: WordWarpDocument, label: string, selectedId = 'text'): InspectorField {
  const result = allFields(document, selectedId).find((item) => item.label === label);
  if (!result) throw new Error(`Missing test field ${label}`);
  return result;
}

function change(document: WordWarpDocument, label: string, value: unknown, selectedId = 'text') {
  applyInspectorValue(document, selectedId, field(document, label, selectedId).id, value);
  parseDocument(document);
}

function allActions(sections: InspectorSection[]): InspectorAction[] {
  return sections.flatMap((section) => [...(section.actions ?? []), ...allActions(section.children ?? [])]);
}

describe('native inspector', () => {
  it('provides native controls for text, layout, transforms, canvas, fonts and global light', () => {
    const document = fixture();
    const sections = buildInspector(document, 'text');
    expect(sections.map(({ id, category }) => ({ id, category }))).toEqual([
      { id: 'element', category: 'object' }, { id: 'effects', category: 'effects' },
      { id: 'animations', category: 'animation' }, { id: 'canvas', category: 'document' },
    ]);
    expect(field(document, 'Content')).toMatchObject({ type: 'text', multiline: true, maxLength: 5000 });
    expect(field(document, 'Font family').options).toContainEqual({ value: 'Titan One', label: 'Titan One' });
    expect(field(document, 'Font family').options).not.toContainEqual({ value: 'Arial', label: 'Arial' });
    change(document, 'Content', 'Two lines\nwith “native” type');
    change(document, 'Font family', 'Titan One');
    change(document, 'Letter spacing', 0.1);
    change(document, 'Position X', 350);
    change(document, 'Slant Y', 12);
    change(document, 'Document name', 'Native study');
    change(document, 'Crop export to artwork', false);
    const text = document.elements[0] as TextElement;
    expect(text.font).toEqual({ family: 'Titan One', source: 'bundled', weight: 400, italic: false });
    expect(text.layout.letterSpacing).toBe(0.1);
    expect(text.transform).toMatchObject({ x: 350, skewY: 12 });
    expect(document.name).toBe('Native study');
    expect(document.canvas.autoFit).toBe(false);
    expect(buildInspector(document, null).map((item) => item.id)).toEqual(['canvas']);
  });

  it('resolves stable effect field IDs after both layer and effect reorder', () => {
    const document = fixture();
    const original = field(document, 'Gloss contour');
    const first = document.elements[0] as TextElement;
    first.effects.reverse();
    document.elements.unshift(createDefaultTextElement('other'));
    const reordered = resolveInspectorField(document, 'text', original.id);
    expect(reordered.path).not.toEqual(original.path);
    applyInspectorValue(document, 'text', original.id, [0, 1, 0]);
    expect(first.effects.find((effect) => effect.kind === 'bevel')).toMatchObject({ glossContour: [0, 1, 0] });
    expect(() => resolveInspectorField(document, 'other', original.id)).toThrow(/no longer available/);
    expect(parseDocument(document)).toBeTruthy();
  });

  it('exposes only safe allowlisted identities and rejects malformed values before mutation', () => {
    const document = fixture();
    const before = structuredClone(document);
    for (const id of ['__proto__/polluted', 'document/version', 'elements/0/id', 'assets', 'constructor/prototype']) {
      expect(() => applyInspectorValue(document, 'text', id, true)).toThrow();
    }
    for (const [label, value] of [['Opacity', 2], ['Position X', Number.NaN], ['Visible', 'yes'],
      ['Content', 'x'.repeat(5001)], ['Font family', 'Untrusted remote font']] as const) {
      expect(() => applyInspectorValue(document, 'text', field(document, label).id, value)).toThrow();
    }
    const canvasWidth = allFields(document).find((item) => item.path.join('/') === 'canvas/width')!;
    expect(() => applyInspectorValue(document, 'text', canvasWidth.id, 0.5)).toThrow();
    const color = allFields(document).find((item) => item.type === 'color')!;
    for (const value of [[1, 1, 1], [1, 0, 0, -1], [1, 'red', 0, 1]]) {
      expect(() => applyInspectorValue(document, 'text', color.id, value)).toThrow();
    }
    expect(document).toEqual(before);
  });

  it('rejects ambiguous IDs from malformed duplicate effect identities', () => {
    const document = fixture();
    const element = document.elements[0] as TextElement;
    const fill = element.effects.find((effect) => effect.kind === 'fill')!;
    element.effects.push(structuredClone(fill));
    expect(() => resolveInspectorField(document, 'text', `element:text/effect:${fill.id}/opacity`)).toThrow(/no longer available/);
  });

  it('builds controls for every supported effect and only implemented post parameters', () => {
    const document = fixture();
    const text = document.elements[0] as TextElement;
    text.effects = EFFECT_KINDS.map((kind) => createEffect(kind));
    const effects = buildInspector(document, 'text').find((section) => section.id === 'effects')!;
    expect(effects.children?.map((section) => section.id)).toEqual(text.effects.map((effect) => effect.id));
    expect(new Set(allFields(document).map((item) => item.id)).size).toBe(allFields(document).length);
    expect(allFields(document).some((item) => item.path.at(-1) === 'dash')).toBe(false);
    expect(allFields(document).some((item) => item.path.at(-1) === 'jitter')).toBe(false);
    change(document, 'Filter', 'dither');
    expect(field(document, 'Color levels')).toMatchObject({ type: 'number', value: 2, min: 2, max: 32 });
    change(document, 'Color levels', 8);
    change(document, 'Pattern size', 4);
    change(document, 'Solid pixel edges', false);
    const stale = field(document, 'Color levels').id;
    change(document, 'Filter', 'aberration');
    expect(() => resolveInspectorField(document, 'text', stale)).toThrow();
    const direction = allFields(document).find((item) => item.path.slice(-2).join('/') === 'params/mode')!;
    applyInspectorValue(document, 'text', direction.id, 'radial');
    expect(text.effects.find((effect) => effect.kind === 'post')).toMatchObject({ params: { mode: 'radial', levels: 8, matrix: 4, hardEdge: false } });
  });

  it('changes paint kinds and edits ordered transparent gradient stops with native actions', () => {
    const document = fixture();
    const text = document.elements[0] as TextElement;
    text.effects = [createEffect('fill')];
    change(document, 'Paint', 'solid');
    change(document, 'Color', [0.2, 0.3, 0.8, 0.4]);
    change(document, 'Paint', 'gradient');
    const fill = text.effects[0];
    if (fill?.kind !== 'fill' || fill.paint.kind !== 'gradient') throw new Error('Expected gradient fill');
    expect(fill.paint.gradient.stops[0]!.color).toEqual([0.2, 0.3, 0.8, 0.4]);
    const add = allActions(buildInspector(document, 'text')).find((item) => item.kind === 'addGradientStop')!;
    applyInspectorAction(document, 'text', add.id);
    expect(fill.paint.gradient.stops.map((stop) => stop.offset)).toEqual([0, 0.5, 1]);
    const middlePosition = allFields(document).find((item) => item.path.slice(-2).join('/') === '1/offset')!;
    applyInspectorValue(document, 'text', middlePosition.id, 0.75);
    const lastPosition = allFields(document).find((item) => item.path.slice(-2).join('/') === '2/offset')!;
    expect(() => applyInspectorValue(document, 'text', lastPosition.id, 0.5)).toThrow();
    const remove = allActions(buildInspector(document, 'text')).find((item) => item.kind === 'removeGradientStop' && item.index === 1)!;
    applyInspectorAction(document, 'text', remove.id);
    expect(fill.paint.gradient.stops.map((stop) => stop.offset)).toEqual([0, 1]);
    expect(parseDocument(document)).toBeTruthy();
  });

  it('provides meaningful radial center controls and preserves imported diamond gradients', () => {
    const document = fixture();
    const text = document.elements[0] as TextElement;
    text.effects = [createEffect('fill')];
    change(document, 'Paint', 'gradient');
    change(document, 'Gradient shape', 'radial');
    change(document, 'Center X', 0.3);
    const fill = text.effects[0] as Extract<Effect, { kind: 'fill' }>;
    if (fill.paint.kind !== 'gradient') throw new Error('Expected gradient');
    fill.paint.gradient.type = 'diamond';
    expect(field(document, 'Gradient shape').options?.map((option) => option.value)).toContain('diamond');
    expect(parseDocument(document)).toBeTruthy();
  });

  it('supports background paint and clears it back to transparency', () => {
    const document = fixture();
    const paint = allFields(document).find((item) => item.path.join('/') === 'canvas/background')!;
    applyInspectorValue(document, 'text', paint.id, 'solid');
    expect(document.canvas.background?.kind).toBe('solid');
    const color = allFields(document).find((item) => item.path.join('/') === 'canvas/background/color')!;
    applyInspectorValue(document, 'text', color.id, [0.1, 0.2, 0.3, 1]);
    expect(document.canvas.background).toEqual({ kind: 'solid', color: [0.1, 0.2, 0.3, 1] });
    applyInspectorValue(document, 'text', paint.id, 'none');
    expect(document.canvas.background).toBeNull();
  });

  it('creates valid preset, perspective, mesh and path warps, including edits inside Immer drafts', () => {
    let document = fixture();
    change(document, 'Warp type', 'preset');
    change(document, 'Envelope', 'textWave1');
    change(document, 'Bend', -1.5);
    change(document, 'Warp type', 'perspective');
    change(document, 'Top right X', 1.2);
    change(document, 'Warp type', 'mesh');
    const columns = field(document, 'Columns').id;
    document = produce(document, (draft) => { applyInspectorValue(draft, 'text', columns, 3); });
    const mesh = (document.elements[0] as TextElement).warp.mesh!;
    expect(mesh.points).toHaveLength(24);
    expect(mesh.points.slice(0, 2)).toEqual([0, 0]);
    expect(mesh.points.slice(-2)).toEqual([1, 1]);
    document = structuredClone(document);
    change(document, 'Warp type', 'path');
    let actions = allActions(buildInspector(document, 'text'));
    applyInspectorAction(document, 'text', actions.find((action) => action.kind === 'addPathNode')!.id);
    expect((document.elements[0] as TextElement).warp.path?.commands).toHaveLength(3);
    actions = allActions(buildInspector(document, 'text'));
    applyInspectorAction(document, 'text', actions.find((action) => action.kind === 'removePathNode' && action.index === 2)!.id);
    expect((document.elements[0] as TextElement).warp.path?.commands).toHaveLength(2);
    expect(parseDocument(document)).toBeTruthy();
  });

  it('handles extrusion steps and shadow lengths without exposing raw union values', () => {
    const document = fixture();
    const text = document.elements[0] as TextElement;
    text.effects = [createEffect('extrude'), createEffect('longShadow')];
    change(document, 'Automatic steps', false);
    change(document, 'Steps', 100);
    change(document, 'Extend to canvas edge', true);
    expect(text.effects[0]).toMatchObject({ steps: 100 });
    expect(text.effects[1]).toMatchObject({ length: 'toEdge' });
    change(document, 'Automatic steps', true);
    change(document, 'Extend to canvas edge', false);
    expect(text.effects[0]).toMatchObject({ steps: 'auto' });
    expect(text.effects[1]).toMatchObject({ length: 90 });
  });

  it('provides every animation kind with supported duration, seed and parameter edits', () => {
    const document = fixture();
    const text = document.elements[0] as TextElement;
    text.animations = NATIVE_ANIMATION_KINDS.map(createNativeAnimation);
    const animations = buildInspector(document, 'text').find((section) => section.id === 'animations')!;
    expect(animations.children?.map((section) => section.id)).toEqual(text.animations.map((track) => track.id));
    const bounce = text.animations.find((track) => track.kind === 'bounce')!;
    const height = allFields(document).find((item) => item.id.includes(bounce.id) && item.label === 'Height')!;
    applyInspectorValue(document, 'text', height.id, 80);
    expect(bounce.params.height).toBe(80);
    expect(allFields(document).some((item) => item.path.includes('stagger'))).toBe(false);
    expect(parseDocument(document)).toBeTruthy();
  });

  it('gives stamps their own geometry and the same effect/animation controls', () => {
    const document = fixture();
    const stamp = createStampElement('heart', [600, 315]);
    document.elements.push(stamp);
    expect(allFields(document, stamp.id).some((item) => item.label === 'Content')).toBe(false);
    const previousSize = Math.max(stamp.width, stamp.height);
    change(document, 'Stamp', 'planet', stamp.id);
    expect(Math.max(stamp.width, stamp.height)).toBe(previousSize);
    expect(stamp.width).toBeGreaterThan(stamp.height);
    expect(stamp.shape).toBe('planet');
    expect(buildInspector(document, stamp.id).map((section) => section.category)).toEqual(['object', 'effects', 'animation', 'document']);
  });
});
