import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { holdToast, resumeToast, useUiStore } from './ui-store';

describe('ui-store toasts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    for (const toast of useUiStore.getState().toasts) {
      useUiStore.getState().dismissToast(toast.id);
    }
    vi.useRealTimers();
  });

  it('auto-dismisses info and success toasts after 4 seconds', () => {
    const id = useUiStore.getState().pushToast('Saved', 'success');
    expect(useUiStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(3999);
    expect(useUiStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(useUiStore.getState().toasts.find((toast) => toast.id === id)).toBeUndefined();
  });

  it('keeps warnings for 8 seconds', () => {
    useUiStore.getState().pushToast('Autosave is unavailable', 'warning');
    vi.advanceTimersByTime(7999);
    expect(useUiStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it('never expires an error on its own', () => {
    // A toast is the only surface an error message has, so letting it time out can lose text the
    // reader still needs. Errors wait to be dismissed.
    useUiStore.getState().pushToast('Export failed', 'error');
    vi.advanceTimersByTime(600_000);
    expect(useUiStore.getState().toasts).toHaveLength(1);
  });

  it('holds the countdown while a toast is hovered or focused', () => {
    const id = useUiStore.getState().pushToast('Saved', 'success');
    vi.advanceTimersByTime(3000);

    holdToast(id);
    vi.advanceTimersByTime(60_000);
    expect(useUiStore.getState().toasts).toHaveLength(1);

    // Leaving restarts the countdown rather than resuming a part-spent one, so a reader who has
    // just looked away still gets the full window.
    resumeToast(id, 'success');
    vi.advanceTimersByTime(3999);
    expect(useUiStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it('does not resurrect a timer for a toast that is already gone', () => {
    const id = useUiStore.getState().pushToast('Saved', 'success');
    useUiStore.getState().dismissToast(id);
    resumeToast(id, 'success');
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });

  it('manual dismissal cancels the auto-dismiss timer', () => {
    const id = useUiStore.getState().pushToast('Shared', 'success');
    useUiStore.getState().dismissToast(id);
    expect(useUiStore.getState().toasts).toHaveLength(0);
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    expect(useUiStore.getState().toasts).toHaveLength(0);
  });
});
