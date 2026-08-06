import { describe, expect, it } from 'vitest';

import { createDefaultDocument } from '../model/defaults';
import { buildShareUrl, decodeShareFragment, encodeShareFragment } from './url';

const fixture = () => createDefaultDocument({
  documentId: 'share-document',
  elementId: 'share-element',
  fillId: 'share-fill',
  now: '2026-01-02T03:04:05.000Z',
});

describe('share URLs', () => {
  it('round-trips a document and forks its identity', () => {
    const source = fixture();
    const fragment = encodeShareFragment(source);
    const decoded = decodeShareFragment(fragment);

    expect(decoded).not.toBeNull();
    expect(decoded!.id).not.toBe(source.id);
    expect(decoded!.elements).toEqual(source.elements);
  });

  it('builds a path-preserving URL and rejects embedded assets', () => {
    const source = fixture();
    expect(buildShareUrl(source, { origin: 'https://wordwarp.test', pathname: '/studio' })).toContain('/studio#ww=1.');
    source.assets.font = { id: 'font', kind: 'font', name: 'Font', mime: 'font/ttf', sha256: 'abc' };
    expect(() => encodeShareFragment(source)).toThrow('embedded assets');
  });

  it('rejects oversized source documents and fragments before inflation', () => {
    const source = fixture();
    const element = source.elements[0]!;
    if (element.type !== 'text') throw new Error('Expected a text fixture');
    element.text = 'x'.repeat(1_000_000);
    expect(() => encodeShareFragment(source)).toThrow('too large');
    expect(() => decodeShareFragment(`ww=1.${'a'.repeat(8000)}`)).toThrow('URL exceeds');
  });
});
