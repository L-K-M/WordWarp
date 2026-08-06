import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import { loadDocument } from '../model/migrations';
import type { WordWarpDocument } from '../model/types';

interface WordWarpDb extends DBSchema {
  documents: {
    key: string;
    value: WordWarpDocument;
    indexes: { 'by-modified': string };
  };
  settings: {
    key: string;
    value: string;
  };
}

let databasePromise: Promise<IDBPDatabase<WordWarpDb>> | null = null;

function database(): Promise<IDBPDatabase<WordWarpDb>> {
  return (databasePromise ??= openDB<WordWarpDb>('wordwarp', 1, {
    upgrade(db) {
      const documents = db.createObjectStore('documents', { keyPath: 'id' });
      documents.createIndex('by-modified', 'meta.modified');
      db.createObjectStore('settings');
    },
  }));
}

export async function saveDocument(document: WordWarpDocument, expectedModified?: string): Promise<void> {
  try {
    const db = await database();
    const transaction = db.transaction(['documents', 'settings'], 'readwrite');
    const documents = transaction.objectStore('documents');
    const existing = await documents.get(document.id);
    if (
      expectedModified !== undefined &&
      existing &&
      existing.meta.modified !== expectedModified
    ) {
      throw new Error('This document was updated in another tab; reload before saving more changes');
    }
    await documents.put(structuredClone(document));
    await transaction.objectStore('settings').put(document.id, 'active-document');
    await transaction.done;
    clearLocalFallback();
  } catch (error) {
    if (!isStorageUnavailable(error)) throw error;
    if (!saveLocalFallback(document, expectedModified)) {
      throw new Error('Browser storage is unavailable and this document cannot use local fallback storage', {
        cause: error,
      });
    }
  }
}

export async function loadActiveDocument(): Promise<WordWarpDocument | null> {
  try {
    const db = await database();
    const activeId = await db.get('settings', 'active-document');
    if (!activeId) return loadLocalFallback();
    const document = await db.get('documents', activeId);
    return document ? loadDocument(document) : loadLocalFallback();
  } catch (error) {
    if (isStorageUnavailable(error)) return loadLocalFallback();
    throw error;
  }
}

export async function resetDatabaseForTests(): Promise<void> {
  const pending = databasePromise;
  databasePromise = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // A failed open has no connection to close.
  }
}

function saveLocalFallback(document: WordWarpDocument, expectedModified?: string): boolean {
  if (typeof localStorage === 'undefined' || Object.keys(document.assets).length > 0) return false;
  const serialized = JSON.stringify(document);
  if (serialized.length >= 2_000_000) return false;
  let existingSerialized: string | null;
  try {
    existingSerialized = localStorage.getItem('wordwarp:document');
  } catch {
    return false;
  }
  if (expectedModified !== undefined && existingSerialized) {
    const existing = loadDocument(JSON.parse(existingSerialized) as unknown);
    if (
      existing.id === document.id &&
      existing.meta.modified !== expectedModified
    ) {
      throw new Error('This document was updated in another tab; reload before saving more changes');
    }
  }
  try {
    localStorage.setItem('wordwarp:document', serialized);
    return true;
  } catch {
    return false;
  }
}

function loadLocalFallback(): WordWarpDocument | null {
  if (typeof localStorage === 'undefined') return null;
  let serialized: string | null;
  try {
    serialized = localStorage.getItem('wordwarp:document');
  } catch (error) {
    if (isStorageUnavailable(error)) return null;
    throw error;
  }
  if (!serialized) return null;
  return loadDocument(JSON.parse(serialized) as unknown);
}

function clearLocalFallback(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem('wordwarp:document');
  } catch {
    // IndexedDB has the current copy, so stale fallback cleanup is best-effort.
  }
}

function isStorageUnavailable(error: unknown): boolean {
  return error instanceof DOMException && ['InvalidStateError', 'NotSupportedError', 'SecurityError'].includes(error.name);
}
