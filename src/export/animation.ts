import { documentAnimationDuration, evaluateDocumentAtTime } from '../animation/evaluate';
import { roundOutBounds, unionBounds, type Bounds } from '../geometry/bounds';
import { createId } from '../lib/id';
import type { WordWarpDocument } from '../model/types';
import { createCanvasSurface, get2dContext } from '../render/surface';
import type { EncodeAnimationResponse } from '../workers/encode-protocol';
import { encodeApng, encodeGif } from './animation-codec';
import { planAnimationFrames } from './animation-budget';
import { getExportBounds, validateExportSize } from './bounds';
import { renderRgbaOnSurface } from './render-png';
import { ensureFontsForDocument } from '../text/fonts';

export interface AnimationExportOptions {
  format: 'apng' | 'gif';
  fps?: number;
  scale?: number;
  onProgress?: (progress: number) => void;
}

export interface AnimationExport {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  frameCount: number;
  /** Rate the frames were sampled at, which the frame budget may have lowered. */
  fps: number;
  /** Rate that was asked for, so a reduction can be reported against it. */
  requestedFps: number;
  /**
   * Whether the frame budget, rather than the caller, decided the rate.
   *
   * This is the signal to report a reduction on -- not `fps < requestedFps`. Frame counts are
   * whole numbers, so a loop whose length does not divide evenly lands just under the requested
   * rate on rounding alone: 2.1 s at 12 fps is 25 frames at 11.9 fps with nothing reduced.
   */
  reduced: boolean;
}

export async function exportAnimation(
  document: WordWarpDocument,
  options: AnimationExportOptions,
): Promise<AnimationExport> {
  const requestedFps = options.fps ?? 12;
  if (!Number.isFinite(requestedFps)) throw new Error('Animation FPS must be a finite number');
  const fps = Math.min(30, Math.max(1, Math.round(requestedFps)));
  const scale = options.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Animation scale must be positive');
  const duration = documentAnimationDuration(document);
  if (duration > 30) throw new Error('Animation loops longer than 30 seconds cannot be exported yet');
  // Frames render on the main thread, so the window's font set needs every bundled family before
  // the first measurement.
  await ensureFontsForDocument(document);
  // Bounds and frame count settle together: the export bounds are the union of the content over
  // the frames that get rendered, so the planner measures again whenever it lowers the count.
  const plan = planAnimationFrames(duration, fps, (candidate) => {
    const measured = measureAnimationBounds(document, candidate);
    return { ...validateExportSize(measured, scale), bounds: measured };
  });
  const { frameCount } = plan;
  const { width, height, bounds } = plan.size;
  const frames: ArrayBuffer[] = [];

  for (let frame = 0; frame < frameCount; frame += 1) {
    const evaluated = evaluateDocumentAtTime(document, frame / frameCount);
    const rendered = renderRgbaOnSurface(evaluated, scale, () => createCanvasSurface(1, 1), bounds);
    // `renderRgbaOnSurface` allocates each frame's buffer at exactly this size and keeps no
    // reference to it, so it can be transferred to the worker as-is. Copying it first would put a
    // second full frame on the heap at the one moment the budget is already at its tightest.
    frames.push(rendered.pixels.buffer);
    options.onProgress?.((frame + 1) / (frameCount + 1));
    await yieldToBrowser();
  }

  const delays = frameDelays(options.format, duration, frameCount);
  const bytes = await encodeInWorker(options.format, frames, width, height, delays);
  options.onProgress?.(1);
  const mime = options.format === 'apng' ? 'image/apng' : 'image/gif';
  const extension = options.format;
  return {
    blob: new Blob([new Uint8Array(bytes).buffer], { type: mime }),
    filename: `${safeFilename(document.name)}.${extension}`,
    width,
    height,
    frameCount,
    fps: plan.fps,
    requestedFps: plan.requestedFps,
    reduced: plan.reduced,
  };
}

export function downloadAnimation(result: AnimationExport): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function encodeInWorker(
  format: 'apng' | 'gif',
  frames: ArrayBuffer[],
  width: number,
  height: number,
  delays: number[],
): Promise<ArrayBuffer> {
  if (typeof Worker === 'undefined') {
    const encoded = format === 'apng'
      ? encodeApng(frames, width, height, delays)
      : encodeGif(frames, width, height, delays);
    return new Uint8Array(encoded).buffer;
  }
  const worker = new Worker(new URL('../workers/encode.worker.ts', import.meta.url), {
    type: 'module',
    name: 'wordwarp-encoder',
  });
  const id = createId();
  return await new Promise<ArrayBuffer>((resolve, reject) => {
    let settled = false;
    const timeout = globalThis.setTimeout(() => {
      finish(() => reject(new Error('Animation encoding timed out')));
    }, 120_000);
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      worker.terminate();
      complete();
    };
    worker.onmessage = (event: MessageEvent<EncodeAnimationResponse>) => {
      if (event.data.id !== id) return;
      finish(() => {
        if (event.data.type === 'encode-error') reject(new Error(event.data.message));
        else resolve(event.data.bytes);
      });
    };
    worker.onerror = (event) => {
      finish(() => reject(new Error(event.message || 'Animation worker failed')));
    };
    worker.onmessageerror = () => finish(() => reject(new Error('Animation worker returned an unreadable response')));
    try {
      worker.postMessage(
        { type: 'encode-animation', id, format, frames, width, height, delays },
        frames,
      );
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error('Could not start animation encoding', { cause: error })));
    }
  });
}

function measureAnimationBounds(document: WordWarpDocument, frameCount: number): Bounds {
  const surface = createCanvasSurface(1, 1);
  const context = get2dContext(surface, true);
  let bounds: Bounds | null = null;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const evaluated = evaluateDocumentAtTime(document, frame / frameCount);
    bounds = unionBounds(bounds, getExportBounds(evaluated, context));
  }
  return roundOutBounds(bounds ?? getExportBounds(document, context));
}

function frameDelays(format: 'apng' | 'gif', duration: number, frameCount: number): number[] {
  const unitsPerSecond = format === 'gif' ? 100 : 1000;
  const unitMilliseconds = 1000 / unitsPerSecond;
  const totalUnits = Math.max(frameCount, Math.round(duration * unitsPerSecond));
  return Array.from({ length: frameCount }, (_, frame) => {
    const start = Math.round((frame * totalUnits) / frameCount);
    const end = Math.round(((frame + 1) * totalUnits) / frameCount);
    return Math.max(unitMilliseconds, (end - start) * unitMilliseconds);
  });
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function safeFilename(name: string): string {
  const cleaned = name.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'wordwarp';
}
