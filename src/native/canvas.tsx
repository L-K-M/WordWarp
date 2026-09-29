/* eslint-disable react-refresh/only-export-components -- Native bootstrap mounts an internal component. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { createRoot } from 'react-dom/client';
import { evaluateDocumentAtTime } from '../animation/evaluate';
import type { Transform, WordWarpDocument } from '../model/types';
import { ensureFontsForDocument, missingBundledFonts } from '../text/fonts';
import { DocumentCanvas, type GestureKind } from '../ui/DocumentCanvas';
import { postToHost, type NativeView } from './protocol';

interface CanvasState {
  document: WordWarpDocument;
  selectedElementId: string | null;
  revision: number;
  view: NativeView;
}
interface CanvasActions {
  command: (command: unknown) => void;
  select: (id: string | null) => void;
  begin: (id: string, kind: GestureKind) => void;
  transform: (id: string, transform: Transform) => void;
  end: () => void;
  viewport: (zoom: number) => void;
  time: (time: number) => void;
}
export function mountCanvas(actions: CanvasActions) {
  const root = createRoot(document.getElementById('root')!);
  let current: CanvasState | undefined;
  let fitVersion = 0;
  const render = () => {
    if (current)
      root.render(
        <NativeCanvas
          state={current}
          actions={actions}
          fitVersion={fitVersion}
        />,
      );
  };
  return {
    update: (state: CanvasState) => {
      current = state;
      render();
    },
    fit: () => {
      fitVersion += 1;
      render();
    },
  };
}
function NativeCanvas({
  state,
  actions,
  fitVersion,
}: {
  state: CanvasState;
  actions: CanvasActions;
  fitVersion: number;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [pinching, setPinching] = useState(false);
  const [prepared, setPrepared] = useState<CanvasState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState(state.view.time);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    distance: number;
    zoom: number;
    center: { x: number; y: number };
    pan: { x: number; y: number };
  } | null>(null);
  const panStart = useRef<{
    x: number;
    y: number;
    pan: { x: number; y: number };
  } | null>(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const callbacks = useRef(actions);
  useLayoutEffect(() => {
    zoomRef.current = zoom;
    panRef.current = pan;
    callbacks.current = actions;
  }, [zoom, pan, actions]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries.at(-1)!.contentRect;
      setSize({ width: rect.width, height: rect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const step = event.shiftKey ? 10 : 1;
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = nudge[event.key];
      if (delta && state.selectedElementId) {
        event.preventDefault();
        callbacks.current.command({
          type: 'nudge',
          dx: delta[0],
          dy: delta[1],
        });
      } else if (
        event.key.toLowerCase() === 'v' ||
        event.key.toLowerCase() === 'h'
      ) {
        event.preventDefault();
        callbacks.current.command({
          type: 'setView',
          tool: event.key.toLowerCase() === 'v' ? 'select' : 'pan',
        });
      }
    };
    window.addEventListener('keydown', keyDown);
    return () => window.removeEventListener('keydown', keyDown);
  }, [state.selectedElementId]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setZoom(state.view.zoom));
    return () => cancelAnimationFrame(frame);
  }, [state.view.zoom]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setTime(state.view.time));
    return () => cancelAnimationFrame(frame);
  }, [state.view.time, state.view.playing]);
  useEffect(() => {
    if (size.width <= 1 || size.height <= 1) return;
    const next = Math.max(
      0.05,
      Math.min(
        8,
        (size.width - 72) / state.document.canvas.width,
        (size.height - 72) / state.document.canvas.height,
      ),
    );
    const frame = requestAnimationFrame(() => {
      setZoom(next);
      setPan({ x: 0, y: 0 });
      callbacks.current.viewport(next);
    });
    return () => cancelAnimationFrame(frame);
  }, [
    fitVersion,
    size.width,
    size.height,
    state.document.id,
    state.document.canvas.width,
    state.document.canvas.height,
  ]);
  useEffect(() => {
    let cancelled = false;
    void ensureFontsForDocument(state.document)
      .then(() => {
        if (cancelled) return;
        if (missingBundledFonts(state.document).length)
          throw new Error(
            'A bundled font could not be loaded. Reopen the app.',
          );
        setPrepared(state);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          const message =
            reason instanceof Error ? reason.message : 'Canvas failed to load';
          setError(message);
          postToHost({ type: 'error', message });
        }
      });
    return () => {
      cancelled = true;
    };
    // View changes need not reload fonts or rebuild the source document.
  }, [state.document, state.revision, state.selectedElementId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!state.view.playing) return;
    let frame = 0;
    let lastPost = 0;
    const start =
      performance.now() - state.view.time * state.view.duration * 1000;
    const tick = (now: number) => {
      const next = ((now - start) / (state.view.duration * 1000)) % 1;
      setTime(next);
      if (now - lastPost > 100) {
        callbacks.current.time(next);
        lastPost = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // Host time feedback must not restart the loop.
  }, [state.view.playing, state.view.duration]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey || event.altKey) {
        const next = Math.max(
          0.05,
          Math.min(8, zoomRef.current * Math.exp(-event.deltaY * 0.008)),
        );
        setZoom(next);
        callbacks.current.viewport(next);
      } else
        setPan((old) => ({ x: old.x - event.deltaX, y: old.y - event.deltaY }));
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);
  const stop = (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size >= 2) {
      panStart.current = null;
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        distance: Math.hypot(a!.x - b!.x, a!.y - b!.y),
        zoom: zoomRef.current,
        center: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
        pan: panRef.current,
      };
      setPinching(true);
      stop(event);
      // Transfer the first finger too: disabling layer manipulation releases its canvas
      // capture, and its eventual up/cancel must still arrive if it leaves the artboard.
      for (const pointerId of pointers.current.keys()) event.currentTarget.setPointerCapture(pointerId);
    } else if (
      state.view.tool === 'pan' ||
      event.button === 1 ||
      event.target === event.currentTarget
    ) {
      panStart.current = {
        x: event.clientX,
        y: event.clientY,
        pan: panRef.current,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      stop(event);
    }
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (gesture.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const g = gesture.current;
      const next = Math.max(
        0.05,
        Math.min(
          8,
          (g.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y)) /
            Math.max(1, g.distance),
        ),
      );
      setZoom(next);
      callbacks.current.viewport(next);
      setPan({
        x: g.pan.x + (a!.x + b!.x) / 2 - g.center.x,
        y: g.pan.y + (a!.y + b!.y) / 2 - g.center.y,
      });
      stop(event);
    } else if (panStart.current) {
      const start = panStart.current;
      setPan({
        x: start.pan.x + event.clientX - start.x,
        y: start.pan.y + event.clientY - start.y,
      });
      stop(event);
    }
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    const wasPinching = gesture.current !== null;
    pointers.current.delete(event.pointerId);
    if (gesture.current || panStart.current) stop(event);
    if (pointers.current.size < 2) {
      gesture.current = null;
      setPinching(false);
      const remaining = pointers.current.values().next().value;
      if (wasPinching && remaining)
        panStart.current = { ...remaining, pan: panRef.current };
    }
    if (pointers.current.size === 0) panStart.current = null;
  };
  let evaluated = prepared?.document;
  try {
    if (evaluated && time !== 0)
      evaluated = evaluateDocumentAtTime(evaluated, time);
  } catch (reason) {
    return (
      <p role="alert">
        {reason instanceof Error ? reason.message : 'Animation preview failed'}
      </p>
    );
  }
  return (
    <div
      ref={viewport}
      className={'native-viewport tool-' + state.view.tool}
      onPointerDownCapture={down}
      onPointerMoveCapture={move}
      onPointerUpCapture={up}
      onPointerCancelCapture={up}
      onLostPointerCapture={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) up(event); }}
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) {
          setPan({ x: 0, y: 0 });
        }
      }}
    >
      {prepared && evaluated && (
        <div
          className="native-artboard-position"
          style={{
            width: state.document.canvas.width * zoom,
            left: size.width / 2 + pan.x,
            top: size.height / 2 + pan.y,
          }}
        >
          <DocumentCanvas
            document={evaluated}
            selectedElementId={state.selectedElementId}
            interactionEnabled={
              state.view.tool === 'select' &&
              !pinching &&
              !state.view.playing &&
              time === 0
            }
            onSelect={actions.select}
            onTransformStart={actions.begin}
            onTransform={actions.transform}
            onTransformEnd={actions.end}
            onRendered={(width, height) =>
              postToHost({
                type: 'rendered',
                revision: prepared.revision,
                width,
                height,
              })
            }
          />
        </div>
      )}
      {(!prepared || error) && (
        <p id="status" role="status">
          {error ?? 'Preparing canvas…'}
        </p>
      )}
    </div>
  );
}
