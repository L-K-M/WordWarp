import {
  useDeferredValue, useEffect, useLayoutEffect, useRef, useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { containsPoint } from '../geometry/bounds';
import {
  dragHandle,
  dragMove,
  frameCorners,
  framePoint,
  handleAngle,
  handleFits,
  handlePosition,
  resizeCursor,
  TRANSFORM_HANDLES,
  type DragContext,
  type ElementFrame,
  type Handle,
} from '../geometry/handles';
import { applyMatrix, invertMatrix } from '../geometry/matrix';
import type { Element as DocumentElement, Point, Transform, WordWarpDocument } from '../model/types';
import { PreviewRenderer } from '../render/preview';
import { ensureFontsForDocument } from '../text/fonts';

/** What a drag is doing, for the history entry it opens. */
export type GestureKind = 'move' | 'scale' | 'rotate' | 'skew';

interface DocumentCanvasProps {
  document: WordWarpDocument;
  selectedElementId: string | null;
  /** The artboard's CSS scale, so handles keep one size on screen at any zoom. */
  zoom?: number;
  onSelect: (id: string | null) => void;
  onTransformStart?: (id: string, gesture: GestureKind) => void;
  onTransform?: (id: string, transform: Transform) => void;
  onTransformEnd?: () => void;
  interactionEnabled?: boolean;
  onRendered?: (width: number, height: number) => void;
  onRendererError?: (message: string) => void;
}

interface DragState {
  pointerId: number;
  elementId: string;
  /** The handle being dragged, or `null` for a drag on the element body, which moves it. */
  handle: Handle | null;
  frame: ElementFrame;
  transform: Transform;
  pointerStart: Point;
  /**
   * What closes this gesture's history entry, taken when it opened. Held here rather than read
   * from props at the end so an unmount mid-drag can still close it with the right callback.
   */
  finish: (() => void) | undefined;
}

/* Handle sizes, in CSS pixels: what they are drawn at, and the invisible square that catches the
   pointer. The hit square is comfortably larger so a handle stays grabbable on a touch screen
   without a visual that swamps the artwork. */
const SCALE_HANDLE_SIZE = 11;
const ROTATE_HANDLE_SIZE = 13;
const SKEW_HANDLE_SIZE = 11;
const HANDLE_HIT_SIZE = 24;

export function DocumentCanvas({
  document,
  selectedElementId,
  zoom = 1,
  onSelect,
  onTransformStart,
  onTransform,
  onTransformEnd,
  interactionEnabled = true,
  onRendered,
}: DocumentCanvasProps) {
  const deferredDocument = useDeferredValue(document);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const renderedRef = useRef(onRendered);
  const rendererErrorRef = useRef(onRendererError);
  useLayoutEffect(() => { renderedRef.current = onRendered; }, [onRendered]);
  useLayoutEffect(() => { rendererErrorRef.current = onRendererError; }, [onRendererError]);
  const [frames, setFrames] = useState<Record<string, ElementFrame>>({});
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const [backend, setBackend] = useState<'webgl2' | 'canvas2d'>('canvas2d');
  const [error, setError] = useState<string | null>(null);
  // The artboard's laid-out width, which the CSS zoom transform does not affect. Multiplying it
  // back in gives the size on screen without reading a rect mid-zoom-transition.
  const [layoutWidth, setLayoutWidth] = useState(0);
  // Bumped when a bundled font finishes loading, so the swap from fallback face to real face
  // paints without waiting for the next document edit.
  const [fontsReady, setFontsReady] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void ensureFontsForDocument(deferredDocument).then((loadedSomething) => {
      if (!cancelled && loadedSomething) setFontsReady((count) => count + 1);
    }, (fontError: unknown) => {
      // Individual font failures never reach here (loadBundledFont resolves false); this only
      // fires for an unexpected error in the document traversal itself. Purely defensive.
      if (!cancelled) console.warn('WordWarp font loading failed', fontError);
    });
    return () => {
      cancelled = true;
    };
  }, [deferredDocument]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const renderer = new PreviewRenderer(canvas);
      rendererRef.current = renderer;
      setBackend(renderer.backend);
      return () => {
        renderer.dispose();
        rendererRef.current = null;
      };
    } catch (renderError) {
      const message = renderError instanceof Error ? renderError.message : 'Canvas renderer failed';
      setError(message);
      rendererErrorRef.current?.(message);
    }
  }, []);

  // Going away mid-gesture would leave the transaction the drag opened with nothing to close it,
  // and the store refuses to undo while one is open -- so the editor would come back with its
  // history frozen. The capture goes with the removed node on its own.
  useEffect(() => () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    drag.finish?.();
  }, []);

  useEffect(() => {
    if (interactionEnabled || !dragRef.current) return;
    const drag = dragRef.current;
    dragRef.current = null;
    if (canvasRef.current?.hasPointerCapture(drag.pointerId)) canvasRef.current.releasePointerCapture(drag.pointerId);
    drag.finish?.();
  }, [interactionEnabled]);

  // Measured before the first paint rather than waiting for the observer. Both the render pass
  // that fills `frames` and the observer's callback reach React as ordinary updates, and React is
  // free to commit them in separate frames -- so the handles could reach the screen once at the
  // placeholder scale. A layout effect closes that window and covers a browser with no
  // ResizeObserver at all, where the observer below never runs.
  useLayoutEffect(() => {
    const width = canvasRef.current?.clientWidth ?? 0;
    if (width > 0) setLayoutWidth(width);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries.at(-1)?.contentRect.width ?? 0;
      if (width > 0) setLayoutWidth(width);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    // An occluded webview suspends rAF indefinitely (headless CI, backgrounded
    // window), so a timer backs it up -- whichever runs first does the pass.
    let ran = false;
    const run = () => {
      if (ran) return;
      ran = true;
      try {
        const result = rendererRef.current?.render(deferredDocument);
        if (!result) return;
        setFrames(Object.fromEntries(result.elementFrames));
        setError(null);
        renderedRef.current?.(deferredDocument.canvas.width, deferredDocument.canvas.height);
      } catch (renderError) {
        const message = renderError instanceof Error ? renderError.message : 'Preview render failed';
        setError(message);
        rendererErrorRef.current?.(message);
      }
    };
    const frame = requestAnimationFrame(run);
    const fallback = setTimeout(run, 250);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallback);
    };
  }, [deferredDocument, fontsReady]);

  const selectedElement = document.elements.find((element) => element.id === selectedElementId);
  const selectedFrame = selectedElementId ? frames[selectedElementId] : undefined;
  const interactive = interactionEnabled && Boolean(onTransform) && selectedElement !== undefined && !selectedElement.locked;
  const unitsPerPixel = layoutWidth > 0 && zoom > 0
    ? document.canvas.width / (layoutWidth * zoom)
    : 1;

  const canvasPoint = (event: { clientX: number; clientY: number }): Point => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rectangle = canvas.getBoundingClientRect();
    if (rectangle.width === 0 || rectangle.height === 0) return [0, 0];
    return [
      ((event.clientX - rectangle.left) / rectangle.width) * document.canvas.width,
      ((event.clientY - rectangle.top) / rectangle.height) * document.canvas.height,
    ];
  };

  const beginDrag = (
    event: ReactPointerEvent<SVGElement | HTMLCanvasElement>,
    element: DocumentElement,
    handle: Handle | null,
  ) => {
    const frame = frames[element.id];
    const canvas = canvasRef.current;
    // A second finger must not take over a gesture that is already running: replacing the drag
    // would strand the first pointer's transaction open, and an open transaction blocks undo.
    if (!interactionEnabled || !frame || !canvas || !onTransform || element.locked || dragRef.current) return;
    // Captured on the canvas even when the drag started on a handle, because the canvas is the one
    // node in here that cannot go away mid-gesture. A handle can: shrink an element past the width
    // its edge handles need and `handleFits` drops the very handle under the pointer, which would
    // release the capture with the button still down. The rest of the drag would then land on
    // whatever happened to be beneath the pointer -- and a release outside the artboard would
    // never reach `endDrag` at all, leaving the transaction open and every later drag refused by
    // the guard above. Capturing here means the handles' lifetime stops mattering.
    canvas.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      elementId: element.id,
      handle,
      frame,
      transform: element.transform,
      pointerStart: canvasPoint(event),
      finish: onTransformEnd,
    };
    onTransformStart?.(element.id, handle ? gestureOf(handle) : 'move');
  };

  const continueDrag = (event: ReactPointerEvent<SVGElement | HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const context: DragContext = {
      frame: drag.frame,
      transform: drag.transform,
      pointerStart: drag.pointerStart,
      constrain: event.shiftKey,
    };
    const pointer = canvasPoint(event);
    onTransform?.(
      drag.elementId,
      drag.handle ? dragHandle(drag.handle, context, pointer) : dragMove(context, pointer),
    );
  };

  const endDrag = (event: ReactPointerEvent<SVGElement | HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    // No explicit release: this only runs from pointerup and pointercancel, and the spec has the
    // user agent release capture immediately after firing either of them.
    dragRef.current = null;
    drag.finish?.();
  };

  const corners = selectedFrame ? frameCorners(selectedFrame) : null;
  const outline = corners?.map((point) => `${round(point[0])},${round(point[1])}`).join(' ');
  // Handle glyphs are turned to sit square on the box, so a rotated element gets handles that look
  // fixed to it rather than to the canvas.
  const boxAngle = corners
    ? (Math.atan2(corners[1][1] - corners[0][1], corners[1][0] - corners[0][0]) * 180) / Math.PI
    : 0;

  return (
    <div
      className="artboard render-artboard"
      style={{ aspectRatio: `${document.canvas.width} / ${document.canvas.height}` }}
      data-renderer={backend}
    >
      <canvas
        ref={canvasRef}
        width={document.canvas.width}
        height={document.canvas.height}
        aria-label={`Transparent ${document.canvas.width} by ${document.canvas.height} composition with ${document.elements.length} elements`}
        onPointerDown={(event) => {
          // A gesture in flight owns the canvas. Capture only redirects the pointer that opened
          // it, so a second finger still lands here -- and reselecting would unmount the handle
          // holding that capture out from under the drag.
          if (!interactionEnabled || dragRef.current) return;
          const point = canvasPoint(event);
          const selected = [...document.elements].reverse().find((element) => {
            const frame = frames[element.id];
            return element.visible && frame !== undefined && hits(frame, point);
          });
          onSelect(selected?.id ?? null);
          if (selected) beginDrag(event, selected, null);
        }}
        onPointerMove={continueDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      />
      <svg
        className="selection-overlay"
        viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`}
        aria-hidden="true"
      >
        {outline && (
          <>
            <polygon className="selection-underlay" points={outline} />
            <polygon className="selection-outline" points={outline} />
          </>
        )}
        {interactive && selectedElement && selectedFrame && (
          <g className="selection-handles">
            {TRANSFORM_HANDLES
              .filter((handle) => handleFits(selectedFrame, handle, unitsPerPixel))
              .map((handle) => (
                <HandleGlyph
                  key={handle.id}
                  handle={handle}
                  frame={selectedFrame}
                  unitsPerPixel={unitsPerPixel}
                  boxAngle={boxAngle}
                  onGrab={(event) => beginDrag(event, selectedElement, handle)}
                />
              ))}
          </g>
        )}
      </svg>
      <span className="renderer-badge">{backend === 'webgl2' ? 'WEBGL2' : '2D FALLBACK'}</span>
      {error && <span className="render-error">{error}</span>}
      {document.elements.length === 0 && <span className="empty-canvas-label">Add a text layer to begin</span>}
    </div>
  );
}

interface HandleGlyphProps {
  handle: Handle;
  frame: ElementFrame;
  unitsPerPixel: number;
  boxAngle: number;
  onGrab: (event: ReactPointerEvent<SVGGElement>) => void;
}

/**
 * One handle: a stalk out to it where it stands off the box, a glyph, and a square that catches
 * the pointer. Sizes are converted from CSS pixels here so the widget stays the same size on
 * screen whatever the document's dimensions and the zoom happen to be.
 */
function HandleGlyph({ handle, frame, unitsPerPixel, boxAngle, onGrab }: HandleGlyphProps) {
  const position = handlePosition(frame, handle, unitsPerPixel);
  const anchoredAt = framePoint(frame, handle.at);
  const hit = HANDLE_HIT_SIZE * unitsPerPixel;
  const size = handleSize(handle) * unitsPerPixel;

  return (
    <>
      {handle.standOff > 0 && (
        <line
          className="handle-stalk"
          x1={anchoredAt[0]}
          y1={anchoredAt[1]}
          x2={position[0]}
          y2={position[1]}
        />
      )}
      <g
        className={`selection-handle handle-${handle.kind}`}
        data-handle={handle.id}
        transform={`translate(${position[0]} ${position[1]}) rotate(${boxAngle})`}
        style={{ cursor: handleCursor(frame, handle) }}
        onPointerDown={onGrab}
      >
        <title>{handle.label}</title>
        <rect className="handle-hit" x={-hit / 2} y={-hit / 2} width={hit} height={hit} />
        {handle.kind === 'rotate' ? (
          <circle className="handle-glyph" r={size / 2} />
        ) : (
          <rect
            className="handle-glyph"
            x={-size / 2}
            y={-size / 2}
            width={size}
            height={size}
            rx={handle.kind === 'scale' ? size * 0.22 : 0}
            transform={handle.kind === 'skew' ? 'rotate(45)' : undefined}
          />
        )}
      </g>
    </>
  );
}

function handleSize(handle: Handle): number {
  if (handle.kind === 'rotate') return ROTATE_HANDLE_SIZE;
  return handle.kind === 'skew' ? SKEW_HANDLE_SIZE : SCALE_HANDLE_SIZE;
}

/**
 * The cursor that describes what a handle does *after* the element has been turned.
 *
 * Resize handles point away from the box, so their own direction is the one to show. A skew handle
 * moves along the box instead of away from it, so it takes the direction of the axis it shears.
 */
function handleCursor(frame: ElementFrame, handle: Handle): string {
  if (handle.kind === 'rotate') return 'grab';
  if (handle.kind === 'scale') return resizeCursor(handleAngle(frame, handle));
  const from = framePoint(frame, handle.axis === 'x' ? [0, 0.5] : [0.5, 0]);
  const to = framePoint(frame, handle.axis === 'x' ? [1, 0.5] : [0.5, 1]);
  return resizeCursor((Math.atan2(to[1] - from[1], to[0] - from[0]) * 180) / Math.PI);
}

/** Outline coordinates are display only; full float precision just bloats the DOM. */
function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function gestureOf(handle: Handle): GestureKind {
  if (handle.kind === 'rotate') return 'rotate';
  return handle.kind === 'skew' ? 'skew' : 'scale';
}

/**
 * Whether a canvas point lands on an element, tested against the box the element was drawn in.
 *
 * Inverting the matrix rather than testing the bounding rectangle is what keeps a rotated word
 * from claiming the empty corners around it -- and with several elements on the canvas, those
 * corners are exactly where one layer steals clicks meant for another.
 */
function hits(frame: ElementFrame, point: Point): boolean {
  const inverse = invertMatrix(frame.matrix);
  if (!inverse) return false;
  return containsPoint(frame.local, applyMatrix(inverse, point));
}
