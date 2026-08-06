import { useEffect, useEffectEvent } from 'react';

interface ShortcutActions {
  undo: () => void;
  redo: () => void;
  remove: () => void;
}

export function useKeyboardShortcuts(actions: ShortcutActions): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    const isEditing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLElement && target.isContentEditable);
    const command = event.metaKey || event.ctrlKey;

    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) actions.redo();
      else actions.undo();
      return;
    }

    if (command && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      actions.redo();
      return;
    }

    if (!isEditing && (event.key === 'Backspace' || event.key === 'Delete')) {
      event.preventDefault();
      actions.remove();
    }
  });

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
