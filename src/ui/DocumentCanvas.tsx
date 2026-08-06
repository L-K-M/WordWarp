import { useEffect, useRef, useState } from 'react';

import { containsPoint, type Bounds } from '../geometry/bounds';
import type { WordWarpDocument } from '../model/types';
import { PreviewRenderer } from '../render/preview';

interface DocumentCanvasProps {
  document: WordWarpDocument;
  selectedElementId: string | null;
  onSelect: (id: string | null) => void;
}

export function DocumentCanvas({ document, selectedElementId, onSelect }: DocumentCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<PreviewRenderer | null>(null);
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
        const result = rendererRef.current?.render(document);
        if (!result) return;
        setBounds(Object.fromEntries(result.elementBounds));
        setError(null);
      } catch (renderError) {
        setError(renderError instanceof Error ? renderError.message : 'Preview render failed');
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [document]);

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
