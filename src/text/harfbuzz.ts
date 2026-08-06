import type { FontSpec, PathData, Point, TextLayout } from '../model/types';

export interface OutlinedGlyph {
  glyphId: number;
  cluster: number;
  origin: Point;
  advance: Point;
  path: PathData;
}

export interface OutlinedText {
  glyphs: OutlinedGlyph[];
  unitsPerEm: number;
}

export async function shapeFontBytes(
  bytes: ArrayBuffer,
  text: string,
  fontSpec: FontSpec,
  layout: Pick<TextLayout, 'size' | 'direction'>,
): Promise<OutlinedText> {
  validateSfnt(bytes);
  const hb = await import('harfbuzzjs');
  // harfbuzzjs 1.5 finalizer-manages wrappers and intentionally exposes no destroy method.
  const blob = new hb.Blob(bytes);
  const face = new hb.Face(blob, 0);
  const font = new hb.Font(face);
  font.setScale(face.upem, face.upem);
  font.setVariations(
    Object.entries(fontSpec.variations ?? {}).map(([tag, value]) => new hb.Variation(tag, value)),
  );

  const buffer = new hb.Buffer();
  buffer.addText(text);
  buffer.setDirection(layout.direction === 'rtl' ? hb.Direction.RTL : hb.Direction.LTR);
  buffer.guessSegmentProperties();
  const features = Object.entries(fontSpec.features ?? {}).map(
    ([tag, enabled]) => new hb.Feature(tag, enabled ? 1 : 0),
  );
  hb.shape(font, buffer, features);

  const scale = layout.size / face.upem;
  let penX = 0;
  let penY = 0;
  const glyphs = buffer.getGlyphInfosAndPositions().map((glyph) => {
    const xOffset = glyph.xOffset ?? 0;
    const yOffset = glyph.yOffset ?? 0;
    const xAdvance = glyph.xAdvance ?? 0;
    const yAdvance = glyph.yAdvance ?? 0;
    const origin: Point = [(penX + xOffset) * scale, -(penY + yOffset) * scale];
    const path = convertGlyphPath(font.glyphToJson(glyph.codepoint), origin, scale);
    const result: OutlinedGlyph = {
      glyphId: glyph.codepoint,
      cluster: glyph.cluster,
      origin,
      advance: [xAdvance * scale, -yAdvance * scale],
      path,
    };
    penX += xAdvance;
    penY += yAdvance;
    return result;
  });

  return { glyphs, unitsPerEm: face.upem };
}

function convertGlyphPath(
  commands: Array<{ type: string; values: number[] }>,
  origin: Point,
  scale: number,
): PathData {
  const point = (x: number, y: number): Point => [origin[0] + x * scale, origin[1] - y * scale];
  const converted: PathData['commands'] = [];
  for (const command of commands) {
    const values = command.values;
    if ((command.type === 'M' || command.type === 'L') && values.length >= 2) {
      converted.push({ type: command.type, point: point(values[0]!, values[1]!) });
    } else if (command.type === 'Q' && values.length >= 4) {
      converted.push({
        type: 'Q',
        control: point(values[0]!, values[1]!),
        point: point(values[2]!, values[3]!),
      });
    } else if (command.type === 'C' && values.length >= 6) {
      converted.push({
        type: 'C',
        control1: point(values[0]!, values[1]!),
        control2: point(values[2]!, values[3]!),
        point: point(values[4]!, values[5]!),
      });
    } else if (command.type === 'Z') {
      converted.push({ type: 'Z' });
    }
  }
  return { commands: converted };
}

function validateSfnt(bytes: ArrayBuffer): void {
  if (bytes.byteLength < 12) throw new Error('Font file is too small');
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('Font file exceeds the 20 MB limit');
  const header = new Uint8Array(bytes, 0, 4);
  const signature = String.fromCharCode(...header);
  const trueType = header[0] === 0 && header[1] === 1 && header[2] === 0 && header[3] === 0;
  if (!trueType && !['OTTO', 'ttcf', 'true'].includes(signature)) {
    throw new Error('Only TTF, OTF, and TTC font data can be shaped');
  }
}
