import { describe, expect, it } from 'vitest';

import { createDefaultTextElement } from '../../model/defaults';
import { unsupportedFontFeatures } from './renderer';

const element = (font: Partial<ReturnType<typeof createDefaultTextElement>['font']>) => {
  const base = createDefaultTextElement();
  base.font = { ...base.font, ...font };
  return base;
};

describe('unsupported font features', () => {
  it('stays quiet for the defaults, which Canvas2D does honour', () => {
    // fontKerning is set explicitly and standard ligatures are on by default.
    expect(unsupportedFontFeatures(element({ features: { liga: true, kern: true } }))).toEqual([]);
  });

  it('reports variable font axes, which need a registered FontFace', () => {
    const messages = unsupportedFontFeatures(element({ variations: { wght: 700, wdth: 75 } }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('wght');
    expect(messages[0]).toContain('wdth');
  });

  it('reports features a context font string cannot express', () => {
    const messages = unsupportedFontFeatures(element({ features: { smcp: true, ss01: true } }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('smcp');
  });

  it('reports ligatures and kerning only when they are switched off', () => {
    const messages = unsupportedFontFeatures(element({ features: { liga: false, kern: true } }));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('liga');
    expect(messages[0]).not.toContain('kern');
  });
});
