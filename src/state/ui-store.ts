import { create } from 'zustand';

import { createId } from '../lib/id';

interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

// Errors do not expire. A toast is the only surface these messages have, so once one goes the
// text is unrecoverable -- and an error is exactly the kind a reader needs time to parse, re-read
// or copy ("Animated export at 3552 x 1352 needs 1024 MB of frame memory, over the 256 MB budget.
// Lower the export resolution or shorten the loop." is actionable, and eight seconds is not long
// to notice it and decide). Info and success really are transient.
const TOAST_TIMEOUTS: Record<Toast['tone'], number | null> = {
  info: 4000,
  success: 4000,
  warning: 8000,
  error: null,
};

interface UiState {
  activeModal: 'export' | 'share' | 'settings' | null;
  toasts: Toast[];
  setModal: (modal: UiState['activeModal']) => void;
  pushToast: (message: string, tone?: Toast['tone']) => string;
  dismissToast: (id: string) => void;
}

const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

function startToastTimer(id: string, tone: Toast['tone']): void {
  const timeout = TOAST_TIMEOUTS[tone];
  if (timeout === null) return;
  const timer = setTimeout(() => {
    toastTimers.delete(id);
    useUiStore.getState().dismissToast(id);
  }, timeout);
  toastTimers.set(id, timer);
}

/**
 * Hold a toast while it is hovered or focused, and start it again on the way out.
 *
 * Each toast is a button, so it is in the tab order. Without this, tabbing to one to dismiss it
 * races the countdown: the focused element is removed from the DOM, focus falls back to `body`,
 * and the reader loses their place with no warning. It also buys time to actually read a message
 * that arrived while attention was elsewhere.
 */
export function holdToast(id: string): void {
  const timer = toastTimers.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  toastTimers.delete(id);
}

export function resumeToast(id: string, tone: Toast['tone']): void {
  if (toastTimers.has(id)) return;
  if (!useUiStore.getState().toasts.some((toast) => toast.id === id)) return;
  startToastTimer(id, tone);
}

export const useUiStore = create<UiState>((set) => ({
  activeModal: null,
  toasts: [],
  setModal: (activeModal) => set({ activeModal }),
  pushToast: (message, tone = 'info') => {
    const id = createId();
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    startToastTimer(id, tone);
    return id;
  },
  dismissToast: (id) => {
    const timer = toastTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      toastTimers.delete(id);
    }
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },
}));
