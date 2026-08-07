import { describe, expect, it } from 'vitest';

import {
  bundledFontUrl,
  DOCUMENT_FONTS,
  FONT_CATALOG,
  FONT_TAG_ORDER,
  getFontCatalogEntry,
} from './fonts';

describe('font catalog', () => {
  it('has unique family names', () => {
    const families = FONT_CATALOG.map((entry) => entry.family);
    expect(new Set(families).size).toBe(families.length);
  });

  it('points every bundled font at a file the asset pipeline ships', () => {
    for (const entry of FONT_CATALOG) {
      if (entry.source !== 'bundled') continue;
      expect(entry.file, `${entry.family} needs a file`).toBeTruthy();
      expect(bundledFontUrl(entry.file!), `${entry.family} -> ${entry.file}`).toBeTruthy();
    }
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
    expect(bundled.every((entry) => entry.weight === 400)).toBe(true);
  });
});
