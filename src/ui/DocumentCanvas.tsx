import { useDeferredValue, useEffect, useRef, useState } from 'react';

import { containsPoint, type Bounds } from '../geometry/bounds';
import type { WordWarpDocument } from '../model/types';
import { PreviewRenderer } from '../render/preview';

interface DocumentCanvasProps {
  document: WordWarpDocument;
  selectedElementId: string | null;
  onSelect: (id: string | null) => void;
  onMoveStart?: (id: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onMoveEnd?: () => void;
}

interface DragState {
  pointerId: number;
  elementId: string;
  start: [number, number];
  origin: [number, number];
}

export function DocumentCanvas({
  document,
  selectedElementId,
  onSelect,
  onMoveStart,
  onMove,
  onMoveEnd,
}: DocumentCanvasProps) {
  const deferredDocument = useDeferredValue(document);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [bounds, setBounds] = useState<Record<string, Bounds>>({});
  const [backend, setBackend] = useState<'webgl2' | 'canvas2d'>('canvas2d');
  const [error, setError] = useState<string | null>(null);

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
      setError(renderError instanceof Error ? renderError.message : 'Canvas renderer failed');
    }
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const result = rendererRef.current?.render(deferredDocument);
        if (!result) return;
        setBounds(Object.fromEntries(result.elementBounds));
        setError(null);
      } catch (renderError) {
        setError(renderError instanceof Error ? renderError.message : 'Preview render failed');
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [deferredDocument]);

  const selectedBounds = selectedElementId ? bounds[selectedElementId] : undefined;

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
          const rectangle = event.currentTarget.getBoundingClientRect();
          const point: [number, number] = [
            ((event.clientX - rectangle.left) / rectangle.width) * document.canvas.width,
            ((event.clientY - rectangle.top) / rectangle.height) * document.canvas.height,
          ];
          const selected = [...document.elements]
            .reverse()
            .find((element) => element.visible && bounds[element.id] && containsPoint(bounds[element.id]!, point));
          onSelect(selected?.id ?? null);
          if (selected && !selected.locked) {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              pointerId: event.pointerId,
              elementId: selected.id,
              start: point,
              origin: [selected.transform.x, selected.transform.y],
            };
            onMoveStart?.(selected.id);
          }
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          const rectangle = event.currentTarget.getBoundingClientRect();
          const point: [number, number] = [
            ((event.clientX - rectangle.left) / rectangle.width) * document.canvas.width,
            ((event.clientY - rectangle.top) / rectangle.height) * document.canvas.height,
          ];
          onMove?.(
            drag.elementId,
            drag.origin[0] + point[0] - drag.start[0],
            drag.origin[1] + point[1] - drag.start[1],
          );
        }}
        onPointerUp={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          dragRef.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          onMoveEnd?.();
        }}
        onPointerCancel={(event) => {
          if (dragRef.current?.pointerId !== event.pointerId) return;
          dragRef.current = null;
          onMoveEnd?.();
        }}
      />
      <svg
        className="selection-overlay"
        viewBox={`0 0 ${document.canvas.width} ${document.canvas.height}`}
        aria-hidden="true"
      >
        {selectedBounds && (
          <rect
            x={selectedBounds.x}
            y={selectedBounds.y}
            width={selectedBounds.width}
            height={selectedBounds.height}
          />
        )}
      </svg>
      <span className="renderer-badge">{backend === 'webgl2' ? 'WEBGL2' : '2D FALLBACK'}</span>
      {error && <span className="render-error">{error}</span>}
      {document.elements.length === 0 && <span className="empty-canvas-label">Add a text layer to begin</span>}
    </div>
  );
}
