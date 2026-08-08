import { useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';

import { maxRackWidth, RACK_MIN_WIDTH } from '../state/editor-store';

/** Arrow-key step, in CSS pixels. Shift takes the coarse step. */
const KEY_STEP = 24;
const KEY_STEP_COARSE = 96;

interface RackResizerProps {
  width: number;
  onResize: (width: number) => void;
  onReset: () => void;
}

/**
 * The drag handle between the style rack and the canvas.
 *
 * This is the ARIA window-splitter pattern: a focusable `separator` that reports its position, so
 * the rack is resizable from the keyboard as well as the pointer. `useKeyboardShortcuts` leaves
 * arrow keys alone while it holds focus -- see the separator entry in its interactive selector.
 */
export function RackResizer({ width, onResize, onReset }: RackResizerProps) {
  // Read through a subscription rather than at render: nothing else re-renders this component when
  // the window changes, so a plain read would leave both the reported maximum and the End key
  // aiming at the size the window used to be.
  const viewportWidth = useSyncExternalStore(subscribeToViewport, readViewportWidth, () => 1200);
  // The stored preference can outrun what this window has room to draw, and `.workspace` clamps it
  // in CSS. Report the width that is actually on screen rather than the one being remembered.
  const drawnWidth = Math.min(Math.round(width), maxRackWidth(viewportWidth));

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    // Only the primary button drags, and the press must not also begin a text selection that
    // would follow the pointer across the whole workspace.
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const origin = handle.parentElement?.getBoundingClientRect().left ?? 0;
    handle.setPointerCapture(event.pointerId);

    const move = (moveEvent: globalThis.PointerEvent) => onResize(moveEvent.clientX - origin);
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
      // Pointer capture is released with the pointer, but a cancelled gesture can leave it held.
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_COARSE : KEY_STEP;
    // Stepped from the width on screen, not the width being remembered. A preference carried over
    // from a wider display is already clamped by the time it is drawn, so stepping from it spent
    // the first keypress travelling back down to what was on screen -- the handle did not move.
    if (event.key === 'ArrowLeft') onResize(drawnWidth - step);
    else if (event.key === 'ArrowRight') onResize(drawnWidth + step);
    else if (event.key === 'Home') onResize(RACK_MIN_WIDTH);
    else if (event.key === 'End') onResize(maxRackWidth(viewportWidth));
    else if (event.key === 'Enter' || event.key === ' ') onReset();
    else return;
    event.preventDefault();
  };

  return (
    <div
      className="rack-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Style rack width"
      aria-valuenow={drawnWidth}
      aria-valuemin={RACK_MIN_WIDTH}
      aria-valuemax={maxRackWidth(viewportWidth)}
      tabIndex={0}
      title="Drag to resize the style rack, double-click to reset"
      onPointerDown={startDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onReset}
    >
      <span className="rack-resizer-grip" aria-hidden="true" />
    </div>
  );
}

function subscribeToViewport(onChange: () => void): () => void {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function readViewportWidth(): number {
  return window.innerWidth;
}
