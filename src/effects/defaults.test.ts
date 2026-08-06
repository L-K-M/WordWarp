import { describe, expect, it } from 'vitest';

import { createDefaultDocument } from '../model/defaults';
import { documentSchema } from '../model/schema';
import { createEffect, EFFECT_KINDS } from './defaults';

describe('effect defaults', () => {
  it('creates a schema-valid effect for every renderer kind', () => {
    for (const kind of EFFECT_KINDS) {
      const document = createDefaultDocument({
        documentId: `document-${kind}`,
        elementId: `element-${kind}`,
        fillId: `fill-${kind}`,
        now: '2026-01-02T03:04:05.000Z',
      });
      document.elements[0]!.effects = [createEffect(kind)];

      expect(documentSchema.safeParse(document).success, kind).toBe(true);
    }
  });
});
