import { describe, expect, it } from 'vitest';

import { createDefaultDocument, createStampElement } from '../defaults';
import { DOC_VERSION } from '../types';
import { loadDocument } from './index';

function createV3Document(): Record<string, unknown> {
  const document = createDefaultDocument({
    documentId: 'document-1',
    elementId: 'element-1',
    fillId: 'fill-1',
    now: '2026-01-02T03:04:05.000Z',
  });
  const raw = structuredClone(document) as unknown as Record<string, unknown>;
  raw.version = 3;
  (raw.elements as unknown[]).push(createStampElement('triangle', [100, 100], 'stamp-1', 'stamp-fill-1'));
  return raw;
}

describe('stamp catalogue v3 to v4 migration', () => {
  it('moves an existing stamp document to the widened catalogue without changing its elements', () => {
    const raw = createV3Document();
    const shape = (raw.elements as Record<string, unknown>[])[1]!;
    shape.width = 8;
    shape.height = 1800;
    (shape.transform as Record<string, unknown>).skewX = 25;
    shape.path = {
      commands: [
        { type: 'M', point: [0, 0] },
        { type: 'L', point: [8, 1800] },
        { type: 'Z' },
      ],
    };
    const before = structuredClone(raw.elements);

    const migrated = loadDocument(raw);

    expect(migrated.version).toBe(DOC_VERSION);
    expect(migrated.elements).toEqual(before);
  });

  it('writes newly created themed stamps under the v4 contract', () => {
    const document = createDefaultDocument({ now: '2026-01-02T03:04:05.000Z' });
    document.elements.push(createStampElement('coffin', [100, 100], 'coffin-1', 'coffin-fill-1'));

    const loaded = loadDocument(document);

    expect(document.version).toBe(4);
    expect(loaded.elements.at(-1)).toMatchObject({ type: 'shape', shape: 'coffin' });
  });
});
