import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import { createDefaultDocument } from '../model/defaults';
import { loadActiveDocument, resetDatabaseForTests, saveDocument } from './database';

afterEach(async () => {
  await resetDatabaseForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('wordwarp');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('Could not delete test database'));
    request.onblocked = () => reject(new Error('Test database deletion was blocked'));
  });
});

describe('document persistence', () => {
  it('round-trips the active validated document', async () => {
    const document = createDefaultDocument({
      documentId: 'saved-document',
      elementId: 'saved-element',
      fillId: 'saved-fill',
      now: '2026-01-02T03:04:05.000Z',
    });
    document.name = 'Saved warp';

    await saveDocument(document);

    expect(await loadActiveDocument()).toEqual(document);
  });

  it('does not let a stale tab overwrite a newer saved revision', async () => {
    const original = createDefaultDocument({
      documentId: 'shared-document',
      elementId: 'shared-element',
      fillId: 'shared-fill',
      now: '2026-01-02T03:04:05.000Z',
    });
    await saveDocument(original);
    const firstTab = structuredClone(original);
    firstTab.name = 'First tab';
    firstTab.meta.modified = '2026-01-02T03:05:00.000Z';
    const staleTab = structuredClone(original);
    staleTab.name = 'Stale tab';
    staleTab.meta.modified = '2026-01-02T03:06:00.000Z';

    await saveDocument(firstTab, original.meta.modified);
    await expect(saveDocument(staleTab, original.meta.modified)).rejects.toThrow('another tab');
    expect(await loadActiveDocument()).toEqual(firstTab);
  });
});
