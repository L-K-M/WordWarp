import { describe, expect, it } from 'vitest';

import { createEffect } from '../effects/defaults';
import { createDefaultDocument } from '../model/defaults';
import { documentAnimationDuration, evaluateDocumentAtTime } from './evaluate';

function animatedDocument() {
  const document = createDefaultDocument({
    documentId: 'document-animation',
    elementId: 'element-animation',
    fillId: 'fill-animation',
    now: '2026-01-02T03:04:05.000Z',
  });
  document.elements[0]!.animations = [
    { id: 'pulse', kind: 'pulse', enabled: true, duration: 2, params: { amount: 0.2 }, seed: 1 },
    { id: 'flicker', kind: 'neonFlicker', enabled: true, duration: 2, params: {}, seed: 42 },
  ];
  return document;
}

describe('animation evaluation', () => {
  it('is deterministic and does not mutate the source', () => {
    const source = animatedDocument();
    const before = structuredClone(source);

    expect(evaluateDocumentAtTime(source, 0.37)).toEqual(evaluateDocumentAtTime(source, 0.37));
    expect(source).toEqual(before);
  });

  it('closes the loop exactly at normalized time one', () => {
    const source = animatedDocument();
    expect(evaluateDocumentAtTime(source, 1)).toEqual(evaluateDocumentAtTime(source, 0));
  });

  it('changes animated properties between phases', () => {
    const source = animatedDocument();
    expect(evaluateDocumentAtTime(source, 0.25)).not.toEqual(evaluateDocumentAtTime(source, 0.5));
  });

  it('keeps mixed-duration tracks on whole cycles', () => {
    const source = animatedDocument();
    source.elements[0]!.effects.push(createEffect('extrude'));
    source.elements[0]!.animations = [
      { id: 'spin', kind: 'extrudeSpin', enabled: true, duration: 2, params: {}, seed: 1 },
      { id: 'pulse', kind: 'pulse', enabled: true, duration: 3, params: {}, seed: 2 },
    ];
    expect(documentAnimationDuration(source)).toBe(6);

    const opening = evaluateDocumentAtTime(source, 0.0001).elements[0]!;
    const closing = evaluateDocumentAtTime(source, 0.9999).elements[0]!;
    const openingAngle = opening.effects.find((effect) => effect.kind === 'extrude')!.angle;
    const closingAngle = closing.effects.find((effect) => effect.kind === 'extrude')!.angle;
    const cyclicDifference = Math.abs((((closingAngle - openingAngle + 180) % 360) + 360) % 360 - 180);
    expect(cyclicDifference).toBeLessThan(1);
  });

  it('rejects staggered tracks until per-character rendering is available', () => {
    const source = animatedDocument();
    source.elements[0]!.animations[0]!.stagger = { amount: 0.5, order: 'forward' };
    expect(() => evaluateDocumentAtTime(source, 0.5)).toThrow('staggering is not supported');
  });

  it('reveals complete Unicode graphemes in typewriter tracks', () => {
    const source = animatedDocument();
    const sourceElement = source.elements[0]!;
    if (sourceElement.type !== 'text') throw new Error('Expected a text fixture');
    sourceElement.text = '👨‍👩‍👧‍👦A';
    sourceElement.animations = [
      { id: 'typewriter', kind: 'typewriter', enabled: true, duration: 2, params: {}, seed: 1 },
    ];

    const evaluated = evaluateDocumentAtTime(source, 0.35).elements[0]!;
    if (evaluated.type !== 'text') throw new Error('Expected evaluated text');
    expect(evaluated.text).toBe('👨‍👩‍👧‍👦');
  });
});
