import { describe, expect, it } from 'vitest';

import { applyTextTransform } from './layout';

describe('text transforms', () => {
  it('title-cases Unicode words without creating ASCII-only boundaries', () => {
    expect(applyTextTransform('café résumé niño über', 'title')).toBe('Café Résumé Niño Über');
  });

  it('supports locale-aware upper and lower transforms', () => {
    expect(applyTextTransform('WordWarp', 'upper')).toBe('WORDWARP');
    expect(applyTextTransform('WordWarp', 'lower')).toBe('wordwarp');
  });
});
