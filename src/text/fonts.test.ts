import { describe, expect, it } from 'vitest';

import {
  bundledFontUrl,
  DOCUMENT_FONTS,
  FONT_CATALOG,
  FONT_TAG_ORDER,
  getFontCatalogEntry,
  quoteFontFamily,
} from './fonts';

describe('font catalog', () => {
  it('has unique family names', () => {
    const families = FONT_CATALOG.map((entry) => entry.family);
    expect(new Set(families).size).toBe(families.length);
  });

  it('points every bundled font at a file the asset pipeline ships', () => {
    const problems: string[] = [];
    for (const entry of FONT_CATALOG) {
      if (entry.source !== 'bundled') continue;
      if (!entry.file) problems.push(`${entry.family} needs a file`);
      else if (!bundledFontUrl(entry.file)) problems.push(`${entry.family} -> ${entry.file} not shipped`);
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('uses declared tags only', () => {
    for (const entry of FONT_CATALOG) {
      expect(FONT_TAG_ORDER).toContain(entry.tag);
    }
  });

  it('keeps interface chrome fonts out of the document picker list', () => {
    expect(DOCUMENT_FONTS.some((entry) => entry.ui)).toBe(false);
    expect(DOCUMENT_FONTS.some((entry) => entry.family === 'Baloo 2')).toBe(false);
    expect(FONT_CATALOG.some((entry) => entry.ui)).toBe(true);
  });

  it('keeps the classic defaults available for existing documents', () => {
    expect(getFontCatalogEntry('Arial Black')).toMatchObject({ source: 'local', weight: 900 });
    expect(getFontCatalogEntry('Impact')).toBeDefined();
    expect(getFontCatalogEntry('sans-serif')).toBeDefined();
  });

  it('offers a healthy spread of bundled display faces', () => {
    const bundled = DOCUMENT_FONTS.filter((entry) => entry.source === 'bundled');
    expect(bundled.length).toBeGreaterThanOrEqual(10);
    // Current state: every bundled display face ships single-weight 400. Not a design rule --
    // revisit when a variable display face joins the catalogue.
    expect(bundled.every((entry) => entry.weight === 400)).toBe(true);
  });
});

describe('quoteFontFamily', () => {
  it('leaves only true CSS generic families bare', () => {
    expect(quoteFontFamily('sans-serif')).toBe('sans-serif');
    expect(quoteFontFamily('monospace')).toBe('monospace');
    expect(quoteFontFamily('Arial')).toBe('"Arial"');
  });

  it('quotes multi-word families', () => {
    expect(quoteFontFamily('Arial Black')).toBe('"Arial Black"');
    expect(quoteFontFamily('Press Start 2P')).toBe('"Press Start 2P"');
  });

  it('quotes CSS-wide keywords so they cannot reset the property', () => {
    expect(quoteFontFamily('inherit')).toBe('"inherit"');
    expect(quoteFontFamily('revert-layer')).toBe('"revert-layer"');
  });

  it('escapes quotes and backslashes inside quoted names', () => {
    expect(quoteFontFamily('Evil";x')).toBe('"Evil\\";x"');
    expect(quoteFontFamily('back\\slash')).toBe('"back\\\\slash"');
  });
});
