import { describe, expect, it } from 'vitest';

import { createDefaultDocument } from '../model/defaults';
import { createDocumentStore } from './document-store';

function createFixture() {
  return createDefaultDocument({
    documentId: 'document-1',
    elementId: 'element-1',
    fillId: 'fill-1',
    now: '2026-01-02T03:04:05.000Z',
  });
}

describe('document store history', () => {
  it('coalesces edits to the same target and undoes them together', () => {
    let now = 1000;
    const store = createDocumentStore(createFixture(), {
      clock: () => now,
      isoClock: () => new Date(now).toISOString(),
    });

    store.getState().updateDocument('Edit text', (draft) => {
      const element = draft.elements[0];
      if (element?.type === 'text') element.text = 'Word';
    }, 'text:element-1');
    now += 100;
    store.getState().updateDocument('Edit text', (draft) => {
      const element = draft.elements[0];
      if (element?.type === 'text') element.text = 'WordWarp!';
    }, 'text:element-1');

    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().document.elements[0]).toMatchObject({ text: 'WordWarp!' });

    store.getState().undo();
    expect(store.getState().document.elements[0]).toMatchObject({ text: 'WordWarp' });

    store.getState().redo();
    expect(store.getState().document.elements[0]).toMatchObject({ text: 'WordWarp!' });
  });

  it('records a continuous transaction as one history entry', () => {
    const store = createDocumentStore(createFixture());

    store.getState().beginTransaction('Move element', 'move:element-1');
    store.getState().updateDocument('Move element', (draft) => {
      draft.elements[0]!.transform.x = 650;
    });
    store.getState().updateDocument('Move element', (draft) => {
      draft.elements[0]!.transform.x = 700;
    });
    store.getState().commitTransaction();

    expect(store.getState().past).toHaveLength(1);
    expect(store.getState().document.elements[0]!.transform.x).toBe(700);

    store.getState().undo();
    expect(store.getState().document.elements[0]!.transform.x).toBe(600);
  });

  /**
   * A click on the canvas opens a gesture and closes it again without moving anything, because
   * selecting and dragging are the same pointer press. Nothing may reach the history from that,
   * or every click would cost the user an extra undo to get back past.
   */
  it('keeps a transaction that changed nothing out of the history', () => {
    const store = createDocumentStore(createFixture());

    store.getState().beginTransaction('Move element', 'move:element-1');
    store.getState().commitTransaction();

    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().transaction).toBeNull();
  });

  it('can cancel a transaction without changing history', () => {
    const store = createDocumentStore(createFixture());

    store.getState().beginTransaction('Move element');
    store.getState().updateDocument('Move element', (draft) => {
      draft.elements[0]!.transform.y = 500;
    });
    store.getState().cancelTransaction();

    expect(store.getState().document.elements[0]!.transform.y).toBe(315);
    expect(store.getState().past).toHaveLength(0);
  });
});
