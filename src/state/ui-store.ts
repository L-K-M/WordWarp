import { create } from 'zustand';

import { createId } from '../lib/id';

interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'error';
}

interface UiState {
  activeModal: 'export' | 'share' | 'settings' | null;
  toasts: Toast[];
  setModal: (modal: UiState['activeModal']) => void;
  pushToast: (message: string, tone?: Toast['tone']) => string;
  dismissToast: (id: string) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeModal: null,
  toasts: [],
  setModal: (activeModal) => set({ activeModal }),
  pushToast: (message, tone = 'info') => {
    const id = createId();
    set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
    return id;
  },
  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));
