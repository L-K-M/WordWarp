import { useEffect, useEffectEvent } from 'react';

interface ShortcutActions {
  undo: () => void;
  redo: () => void;
  remove: () => void;
  duplicate: () => void;
  deselect: () => void;
  focusSearch: () => void;
  nudge: (dx: number, dy: number) => void;
}

const interactiveControlSelector = [
  'a[href]',
  'area[href]',
  'audio[controls]',
  'button',
  'details',
  'input',
  'select',
  'summary',
  'textarea',
  'video[controls]',
].join(', ');

function isInteractiveControl(target: EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement &&
    (target.isContentEditable || target.matches(interactiveControlSelector));
}

export function useKeyboardShortcuts(actions: ShortcutActions, enabled = true): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    const isEditing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable);
    const isInteractive = isInteractiveControl(target);
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

    if (isInteractive) {
      if (isEditing && event.key === 'Escape' && target instanceof HTMLElement) {
        target.blur();
        actions.deselect();
      }
      return;
    }

    if (command && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      actions.duplicate();
      return;
    }

    if (event.key === '/' ) {
      event.preventDefault();
      actions.focusSearch();
      return;
    }

    if (event.key === 'Escape') {
      actions.deselect();
      return;
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      actions.remove();
      return;
    }

    const step = event.shiftKey ? 10 : 1;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      actions.nudge(-step, 0);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      actions.nudge(step, 0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      actions.nudge(0, -step);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      actions.nudge(0, step);
    }
  });

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
