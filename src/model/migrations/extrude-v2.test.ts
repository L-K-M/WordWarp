import { describe, expect, it } from 'vitest';

import { createDefaultDocument } from '../defaults';
import { DOC_VERSION } from '../types';
import { loadDocument } from './index';

/**
 * v1 documents carry ExtrudeEffect.facePaint and .capBack, which the renderer never read. The
 * migration strips them; without it the schema rejects the document as having unknown keys.
 */
function createV1DocumentWithExtrude(): Record<string, unknown> {
  const document = createDefaultDocument({
    documentId: 'document-1',
    elementId: 'element-1',
    fillId: 'fill-1',
    now: '2026-01-02T03:04:05.000Z',
  }) as unknown as Record<string, unknown>;

  const raw = structuredClone(document);
  raw.version = 1;
  const element = (raw.elements as Array<Record<string, unknown>>)[0]!;
  element.effects = [
    {
      id: 'extrude-1',
      kind: 'extrude',
      slot: 'back',
      enabled: true,
      opacity: 1,
      blendMode: 'normal',
      depth: 36,
      mode: 'parallel',
      angle: 45,
      vanishingPoint: [0.5, 1.4],
      strength: 0.4,
      facePaint: { kind: 'solid', color: [1, 1, 1, 1] },
      sidePaint: { kind: 'solid', color: [0.12, 0.16, 0.3, 1] },
      autoShade: true,
      shadeAmount: 0.45,
      steps: 'auto',
      capBack: true,
    },
  ];
  return raw;
}

describe('extrude v1 to v2 migration', () => {
  it('strips facePaint and capBack and lands on the current version', () => {
    const migrated = loadDocument(createV1DocumentWithExtrude());

    expect(migrated.version).toBe(DOC_VERSION);
    const element = migrated.elements[0]!;
    if (element.type !== 'text') throw new Error('Expected a text element');
    const extrude = element.effects[0]!;
    expect(extrude.kind).toBe('extrude');
    expect(extrude).not.toHaveProperty('facePaint');
    expect(extrude).not.toHaveProperty('capBack');
    // Everything else survives untouched.
    if (extrude.kind !== 'extrude') throw new Error('Expected an extrude effect');
    expect(extrude.depth).toBe(36);
    expect(extrude.strength).toBe(0.4);
    expect(extrude.shadeAmount).toBe(0.45);
  });

  it('leaves documents without extrude effects alone', () => {
    const raw = createV1DocumentWithExtrude();
    const element = (raw.elements as Array<Record<string, unknown>>)[0]!;
    element.effects = [];

    const migrated = loadDocument(raw);

    expect(migrated.version).toBe(DOC_VERSION);
    const migratedElement = migrated.elements[0]!;
    if (migratedElement.type !== 'text') throw new Error('Expected a text element');
    expect(migratedElement.effects).toEqual([]);
  });
});
