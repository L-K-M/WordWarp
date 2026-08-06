import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultDocument } from '../model/defaults';
import { createDocumentStore } from '../state/document-store';
import { startAutosave } from './autosave';
import { saveDocument } from './database';

vi.mock('./database', () => ({ saveDocument: vi.fn() }));

const mockedSaveDocument = vi.mocked(saveDocument);

beforeEach(() => mockedSaveDocument.mockReset());

describe('autosave', () => {
  it('drains edits made while a flush is writing', async () => {
    let releaseFirstSave: (() => void) | undefined;
    const firstSave = new Promise<void>((resolve) => { releaseFirstSave = resolve; });
    mockedSaveDocument.mockImplementationOnce(() => firstSave).mockResolvedValue(undefined);
    let tick = 0;
    const store = createDocumentStore(createDefaultDocument(), {
      isoClock: () => new Date(1_700_000_000_000 + tick++).toISOString(),
    });
    const autosave = startAutosave(store, undefined, 60_000);

    store.getState().updateDocument('First edit', (draft) => { draft.name = 'First edit'; });
    const flushing = autosave.flush();
    await vi.waitFor(() => expect(mockedSaveDocument).toHaveBeenCalledTimes(1));
    store.getState().updateDocument('Second edit', (draft) => { draft.name = 'Second edit'; });
    const concurrentFlush = autosave.flush();
    expect(concurrentFlush).toBe(flushing);
    if (!releaseFirstSave) throw new Error('First autosave did not start');
    releaseFirstSave();
    await Promise.all([flushing, concurrentFlush]);

    expect(mockedSaveDocument).toHaveBeenCalledTimes(2);
    expect(mockedSaveDocument.mock.calls[1]![0].name).toBe('Second edit');
    autosave.stop();
  });
});
