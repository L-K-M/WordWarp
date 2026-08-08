import { describe, expect, it } from 'vitest';

import { createDefaultDocument, createStampElement } from '../defaults';
import { DOC_VERSION } from '../types';
import { loadDocument } from './index';

/**
 * A v2 shape element, as a hand-authored or third-party document could carry one: the fields the
 * schema required at the time, and no `path`.
 */
function createV2DocumentWithShape(): Record<string, unknown> {
  const document = createDefaultDocument({
    documentId: 'document-1',
    elementId: 'element-1',
    fillId: 'fill-1',
    now: '2026-01-02T03:04:05.000Z',
  });
  const raw = structuredClone(document) as unknown as Record<string, unknown>;
  raw.version = 2;
  const stamp = structuredClone(createStampElement('triangle', [100, 100], 'stamp-1', 'stamp-fill-1'));
  const legacy = stamp as unknown as Record<string, unknown>;
  delete legacy.path;
  (raw.elements as unknown[]).push(legacy);
  return raw;
}

describe('shape path v2 to v3 migration', () => {
  it('gives a v2 shape element the generating form of its geometry', () => {
    const migrated = loadDocument(createV2DocumentWithShape());

    expect(migrated.version).toBe(DOC_VERSION);
    const stamp = migrated.elements[1]!;
    if (stamp.type !== 'shape') throw new Error('Expected a shape element');
    // `null` rather than absent: the schema is strict, so a missing key fails the parse outright
    // rather than defaulting, which is what makes this migration load-bearing.
    expect(stamp.path).toBeNull();
    expect(stamp.shape).toBe('triangle');
  });

  it('leaves geometry alone when a document already carries it', () => {
    const raw = createV2DocumentWithShape();
    const stamp = (raw.elements as Record<string, unknown>[])[1]!;
    const authored = { commands: [{ type: 'M', point: [0, 0] }, { type: 'L', point: [4, 0] }, { type: 'Z' }] };
    stamp.path = authored;

    const migrated = loadDocument(raw);

    const migratedStamp = migrated.elements[1]!;
    if (migratedStamp.type !== 'shape') throw new Error('Expected a shape element');
    expect(migratedStamp.path).toEqual(authored);
  });

  it('carries a text-only document through untouched', () => {
    const raw = createV2DocumentWithShape();
    raw.elements = (raw.elements as unknown[]).slice(0, 1);

    const migrated = loadDocument(raw);

    expect(migrated.version).toBe(DOC_VERSION);
    expect(migrated.elements).toHaveLength(1);
    expect(migrated.elements[0]?.type).toBe('text');
  });
});
