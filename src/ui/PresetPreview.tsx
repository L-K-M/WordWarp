import { useEffect, useRef, useState } from 'react';

import { getCachedPresetPreview, renderPresetPreviewAsync } from '../presets/preview-render';
import type { Preset } from '../presets/types';

const SCRIM = 'rgb(9 11 18 / 62%)';

interface PresetPreviewProps {
  preset: Preset;
  /** Swatch gradient, shown behind the render and on its own until the render arrives. */
  swatch: string;
}

/**
 * A style card's thumbnail, rasterised by the real renderer.
 *
 * Thirty effect stacks is far too much work to do before the panel first paints, so a card only
 * renders once it scrolls near the viewport, and then off the critical path. Until it does, the
 * swatch placeholder stands in, which keeps the grid from reflowing.
 */
export function PresetPreview({ preset, swatch }: PresetPreviewProps) {
  const container = useRef<HTMLSpanElement>(null);
  const [source, setSource] = useState(() => getCachedPresetPreview(preset));

  useEffect(() => {
    if (source) return;
    const node = container.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        schedule(() => {
          void renderPresetPreviewAsync(preset).then((rendered) => {
            if (!cancelled && rendered) setSource(rendered);
          }, (error: unknown) => {
            // The swatch placeholder stays up; a thumbnail is decoration, not a hard failure.
            console.warn(`Preset preview for "${preset.name}" did not render`, error);
          });
        });
      },
      { rootMargin: '240px' },
    );
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
    // Callers key this component by preset, so an instance only ever renders the one preset and
    // never has to discard a render belonging to another.
  }, [preset, source]);

  // The swatch keeps a card recognisable at a glance, but at full strength it competes with the
  // render sitting on it, so drop a scrim over it once there is a render to look at.
  const background = source ? `linear-gradient(${SCRIM}, ${SCRIM}), ${swatch}` : swatch;
  return (
    <span ref={container} className="preset-preview" style={{ background }}>
      {source ? <img src={source} alt="" draggable={false} /> : <span>Ww</span>}
    </span>
  );
}

function schedule(run: () => void): void {
  const idle = (globalThis as {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (idle) idle(run, { timeout: 600 });
  else setTimeout(run, 0);
}
