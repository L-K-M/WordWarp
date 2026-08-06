import type { Bounds } from '../geometry/bounds';
import type { TextElement } from '../model/types';

export type TextContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface LaidOutLine {
  text: string;
  x: number;
  baseline: number;
  width: number;
}

export interface LaidOutText {
  lines: LaidOutLine[];
  bounds: Bounds;
  font: string;
  direction: CanvasDirection;
  letterSpacing: string;
  wordSpacing: string;
}

export function layoutText(context: TextContext, element: TextElement): LaidOutText {
  const text = applyTextTransform(element.text.replace(/\r\n?/g, '\n'), element.layout.transform);
  const lines = text.split('\n');
  const font = fontShorthand(element);
  const letterSpacing = `${element.layout.letterSpacing * element.layout.size}px`;
  const wordSpacing = `${element.layout.wordSpacing * element.layout.size}px`;
  configureTextContext(context, font, element.layout.direction, letterSpacing, wordSpacing);

  const measured = lines.map((line) => ({ text: line, metrics: context.measureText(line) }));
  const ascent = Math.max(
    element.layout.size * 0.8,
    ...measured.map(({ metrics }) => metrics.actualBoundingBoxAscent || 0),
  );
  const descent = Math.max(
    element.layout.size * 0.2,
    ...measured.map(({ metrics }) => metrics.actualBoundingBoxDescent || 0),
  );
  const lineAdvance = element.layout.size * element.layout.lineHeight;

  const rawLines = measured.map(({ text: line, metrics }, index) => {
    const width = metrics.width;
    const x = element.layout.align === 'center' ? -width / 2 : element.layout.align === 'right' ? -width : 0;
    return { text: line, x, baseline: index * lineAdvance, width };
  });

  const left = Math.min(0, ...rawLines.map((line) => line.x));
  const right = Math.max(0, ...rawLines.map((line) => line.x + line.width));
  const top = -ascent;
  const bottom = (Math.max(1, lines.length) - 1) * lineAdvance + descent;
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  return {
    lines: rawLines,
    bounds: { x: left, y: top, width, height },
    font,
    direction: element.layout.direction,
    letterSpacing,
    wordSpacing,
  };
}

export function configureTextContext(
  context: TextContext,
  font: string,
  direction: CanvasDirection,
  letterSpacing: string,
  wordSpacing: string,
): void {
  context.font = font;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.direction = direction;
  context.fontKerning = 'normal';
  context.letterSpacing = letterSpacing;
  context.wordSpacing = wordSpacing;
}

function fontShorthand(element: TextElement): string {
  const style = element.font.italic ? 'italic' : 'normal';
  const family = element.font.family.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
  return `${style} ${element.font.weight} ${element.layout.size}px "${family}"`;
}

export function applyTextTransform(text: string, transform: TextElement['layout']['transform']): string {
  if (transform === 'upper') return text.toLocaleUpperCase();
  if (transform === 'lower') return text.toLocaleLowerCase();
  if (transform === 'title') {
    return text.replace(/(?<![\p{L}\p{N}])\p{L}/gu, (character) => character.toLocaleUpperCase());
  }
  return text;
}
