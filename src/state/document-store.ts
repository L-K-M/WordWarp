import {
  applyPatches,
  enablePatches,
  produceWithPatches,
  type Draft,
  type Patch,
} from 'immer';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import { createDefaultDocument } from '../model/defaults';
import type { WordWarpDocument } from '../model/types';

enablePatches();

const HISTORY_LIMIT = 100;
const MERGE_WINDOW_MS = 500;

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  mergeKey?: string;
  timestamp: number;
}

type Transaction = HistoryEntry;

export type DocumentRecipe = (draft: Draft<WordWarpDocument>) => void;

export interface DocumentState {
  document: WordWarpDocument;
  past: HistoryEntry[];
  future: HistoryEntry[];
  transaction: Transaction | null;
  updateDocument: (label: string, recipe: DocumentRecipe, mergeKey?: string) => void;
  beginTransaction: (label: string, mergeKey?: string) => void;
  commitTransaction: () => void;
  cancelTransaction: () => void;
  undo: () => void;
  redo: () => void;
  replaceDocument: (document: WordWarpDocument) => void;
}

interface StoreOptions {
  clock?: () => number;
  isoClock?: () => string;
}

export type DocumentStore = StoreApi<DocumentState>;

export function createDocumentStore(
  initialDocument = createDefaultDocument(),
  options: StoreOptions = {},
): DocumentStore {
  const clock = options.clock ?? Date.now;
  const isoClock = options.isoClock ?? (() => new Date().toISOString());

  return createStore<DocumentState>()((set) => ({
    document: initialDocument,
    past: [],
    future: [],
    transaction: null,

    updateDocument: (label, recipe, mergeKey) => {
      set((state) => {
        const [changedDocument, patches, inversePatches] = produceWithPatches(state.document, recipe);
        if (patches.length === 0) return state;

        const [document, metaPatches, inverseMetaPatches] = produceWithPatches(
          changedDocument,
          (draft) => {
            draft.meta.modified = isoClock();
          },
        );
        const allPatches = [...patches, ...metaPatches];
        const allInversePatches = [...inverseMetaPatches, ...inversePatches];
        const timestamp = clock();

        if (state.transaction) {
          return {
            ...state,
            document,
            transaction: {
              ...state.transaction,
              patches: [...state.transaction.patches, ...allPatches],
              inversePatches: [...allInversePatches, ...state.transaction.inversePatches],
              timestamp,
            },
          };
        }

        const entry: HistoryEntry = {
          label,
          patches: allPatches,
          inversePatches: allInversePatches,
          mergeKey,
          timestamp,
        };
        return {
          ...state,
          document,
          past: addHistoryEntry(state.past, entry),
          future: [],
        };
      });
    },

    beginTransaction: (label, mergeKey) => {
      set((state) => {
        if (state.transaction) return state;
        return {
          ...state,
          transaction: {
            label,
            patches: [],
            inversePatches: [],
            mergeKey,
            timestamp: clock(),
          },
        };
      });
    },

    commitTransaction: () => {
      set((state) => {
        if (!state.transaction) return state;
        if (state.transaction.patches.length === 0) return { ...state, transaction: null };
        return {
          ...state,
          transaction: null,
          past: addHistoryEntry(state.past, state.transaction),
          future: [],
        };
      });
    },

    cancelTransaction: () => {
      set((state) => {
        if (!state.transaction) return state;
        return {
          ...state,
          document: applyPatches(state.document, state.transaction.inversePatches),
          transaction: null,
        };
      });
    },

    undo: () => {
      set((state) => {
        if (state.transaction || state.past.length === 0) return state;
        const entry = state.past.at(-1)!;
        return {
          ...state,
          document: applyPatches(state.document, entry.inversePatches),
          past: state.past.slice(0, -1),
          future: [...state.future, entry],
        };
      });
    },

    redo: () => {
      set((state) => {
        if (state.transaction || state.future.length === 0) return state;
        const entry = state.future.at(-1)!;
        return {
          ...state,
          document: applyPatches(state.document, entry.patches),
          past: [...state.past, entry].slice(-HISTORY_LIMIT),
          future: state.future.slice(0, -1),
        };
      });
    },

    replaceDocument: (document) => {
      set((state) => ({ ...state, document, past: [], future: [], transaction: null }));
    },
  }));
}

function addHistoryEntry(past: HistoryEntry[], entry: HistoryEntry): HistoryEntry[] {
  const previous = past.at(-1);
  if (
    entry.mergeKey &&
    previous?.mergeKey === entry.mergeKey &&
    entry.timestamp - previous.timestamp <= MERGE_WINDOW_MS
  ) {
    const merged: HistoryEntry = {
      label: entry.label,
      mergeKey: entry.mergeKey,
      timestamp: entry.timestamp,
      patches: [...previous.patches, ...entry.patches],
      inversePatches: [...entry.inversePatches, ...previous.inversePatches],
    };
    return [...past.slice(0, -1), merged];
  }
  return [...past, entry].slice(-HISTORY_LIMIT);
}

export const documentStore = createDocumentStore();

export function useDocumentStore<T>(selector: (state: DocumentState) => T): T {
  return useStore(documentStore, selector);
}
