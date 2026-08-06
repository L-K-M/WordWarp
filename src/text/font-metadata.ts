export interface FontMetadata {
  family: string;
  subfamily: string;
  unitsPerEm: number;
  glyphCount: number;
}

export async function readFontMetadata(bytes: ArrayBuffer): Promise<FontMetadata> {
  const { parse } = await import('opentype.js');
  const font = parse(bytes, { lowMemory: true });
  return {
    family: font.getEnglishName('fontFamily') || 'Unknown family',
    subfamily: font.getEnglishName('fontSubfamily') || 'Regular',
    unitsPerEm: font.unitsPerEm,
    glyphCount: font.numGlyphs,
  };
}
