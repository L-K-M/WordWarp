import type { DocumentStore } from '../state/document-store';
import { saveDocument } from './database';

export interface AutosaveController {
  flush: () => Promise<void>;
  stop: () => void;
}

export function startAutosave(
  store: DocumentStore,
  onError?: (error: unknown) => void,
  delay = 2000,
): AutosaveController {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let latest = store.getState().document;
  const savedRevisions = new Map([[latest.id, latest.meta.modified]]);
  let saving = Promise.resolve();
  let activeFlush: Promise<void> | null = null;
  let dirty = false;
  const drain = async () => {
    while (true) {
      if (timeout) clearTimeout(timeout);
      timeout = null;
      if (!dirty) {
        await saving;
        if (!dirty) return;
        continue;
      }
      const snapshot = latest;
      dirty = false;
      const operation = saving.then(async () => {
        await saveDocument(snapshot, savedRevisions.get(snapshot.id) ?? snapshot.meta.modified);
        savedRevisions.set(snapshot.id, snapshot.meta.modified);
      });
      saving = operation.catch(() => undefined);
      try {
        await operation;
      } catch (error) {
        dirty = true;
        throw error;
      }
    }
  };
  const flush = (): Promise<void> => {
    if (activeFlush) return activeFlush;
    const operation = drain();
    activeFlush = operation;
    const clear = () => {
      if (activeFlush === operation) activeFlush = null;
    };
    void operation.then(clear, clear);
    return operation;
  };
  const flushSafely = () => {
    void flush().catch((error) => onError?.(error));
  };
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.document === previous.document) return;
    if (state.document.id !== previous.document.id && !savedRevisions.has(state.document.id)) {
      savedRevisions.set(state.document.id, state.document.meta.modified);
    }
    latest = state.document;
    dirty = true;
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(flushSafely, delay);
  });
  const onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushSafely();
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibilityChange);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', flushSafely);
  return {
    flush,
    stop: () => {
      unsubscribe();
      flushSafely();
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibilityChange);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', flushSafely);
    },
  };
}
