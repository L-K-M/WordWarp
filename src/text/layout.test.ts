import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyTextTransform } from './layout';

describe('text transforms', () => {
  afterEach(() => vi.restoreAllMocks());

  it('title-cases Unicode words without creating ASCII-only boundaries', () => {
    expect(applyTextTransform('café résumé niño über', 'title')).toBe('Café Résumé Niño Über');
  });

  it('supports Unicode upper and lower transforms', () => {
    expect(applyTextTransform('WordWarp', 'upper')).toBe('WORDWARP');
    expect(applyTextTransform('WordWarp', 'lower')).toBe('wordwarp');
  });

  it('does not use locale-sensitive case transforms', () => {
    vi.spyOn(String.prototype, 'toLocaleUpperCase').mockImplementation(() => {
      throw new Error('locale-sensitive uppercase was used');
    });
    vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(() => {
      throw new Error('locale-sensitive lowercase was used');
    });

    expect(applyTextTransform('i I ı İ straße', 'upper')).toBe('I I I İ STRASSE');
    expect(applyTextTransform('i I ı İ', 'lower')).toBe('i i ı i\u0307');
    expect(applyTextTransform('istanbul ızmir', 'title')).toBe('Istanbul Izmir');
  });
});
