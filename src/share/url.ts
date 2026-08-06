import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';

import { createId } from '../lib/id';
import { loadDocument } from '../model/migrations';
import type { WordWarpDocument } from '../model/types';

const PREFIX = 'ww=1.';
const MAX_URL_LENGTH = 8000;
const MAX_DOCUMENT_BYTES = 1_000_000;

export function encodeShareFragment(document: WordWarpDocument): string {
  if (Object.keys(document.assets).length > 0) throw new Error('Documents with embedded assets must be shared as files');
  const serialized = strToU8(JSON.stringify(document));
  if (serialized.byteLength > MAX_DOCUMENT_BYTES) throw new Error('This document is too large for a share URL');
  const compressed = deflateSync(serialized, { level: 9 });
  const fragment = `${PREFIX}${base64UrlEncode(compressed)}`;
  if (fragment.length > MAX_URL_LENGTH) throw new Error('This document is too large for a share URL');
  return fragment;
}

export function decodeShareFragment(fragment: string): WordWarpDocument | null {
  const value = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (!value.startsWith(PREFIX)) return null;
  if (value.length > MAX_URL_LENGTH) throw new Error('Shared document URL exceeds the import limit');
  const compressed = base64UrlDecode(value.slice(PREFIX.length));
  const decompressed = inflateSync(compressed, { out: new Uint8Array(MAX_DOCUMENT_BYTES + 1) });
  if (decompressed.byteLength > MAX_DOCUMENT_BYTES) throw new Error('Shared document exceeds the import limit');
  const imported = loadDocument(JSON.parse(strFromU8(decompressed)) as unknown);
  const now = new Date().toISOString();
  return { ...imported, id: createId(), meta: { ...imported.meta, created: now, modified: now } };
}

export function buildShareUrl(document: WordWarpDocument, location: Pick<Location, 'origin' | 'pathname'>): string {
  return `${location.origin}${location.pathname}#${encodeShareFragment(document)}`;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
