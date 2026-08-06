import { describe, expect, it } from 'vitest';

import { createDefaultDocument } from './defaults';
import { loadDocument } from './migrations';
import { documentSchema, parseDocument } from './schema';

const createFixture = () =>
  createDefaultDocument({
    documentId: 'document-1',
    elementId: 'element-1',
    fillId: 'fill-1',
    now: '2026-01-02T03:04:05.000Z',
  });

describe('document schema', () => {
  it('accepts and clones a valid current document', () => {
    const fixture = createFixture();
    const parsed = parseDocument(fixture);

    expect(parsed).toEqual(fixture);
    expect(parsed).not.toBe(fixture);
  });

  it('rejects duplicate element ids', () => {
    const fixture = createFixture();
    fixture.elements.push({ ...fixture.elements[0]!, name: 'Duplicate' });

    const result = documentSchema.safeParse(fixture);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('Duplicate element id'))).toBe(true);
    }
  });

  it('rejects documents newer than this application', () => {
    const fixture = { ...createFixture(), version: 99 };

    expect(() => loadDocument(fixture)).toThrow('newer than supported');
  });

  it('requires a registered migration for an older document', () => {
    const fixture = { ...createFixture(), version: 0 };

    expect(() => loadDocument(fixture)).toThrow('No migration is registered');
  });
});
