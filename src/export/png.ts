import { renderPngOnSurface, type RenderedPng } from './render-png';
import { createId } from '../lib/id';
import type { WordWarpDocument } from '../model/types';
import type { ExportWorkerResponse } from '../workers/protocol';

export interface PngExport extends RenderedPng {
  blob: Blob;
  filename: string;
}

export async function exportPng(document: WordWarpDocument, scale = 2): Promise<PngExport> {
  let rendered: RenderedPng;
  try {
    rendered = await exportInWorker(document, scale);
  } catch {
    rendered = await renderPngOnSurface(document, scale, () => documentCanvas());
  }
  const buffer = new Uint8Array(rendered.bytes).buffer;
  return {
    ...rendered,
    blob: new Blob([buffer], { type: 'image/png' }),
    filename: `${safeFilename(document.name)}.png`,
  };
}

export function downloadPng(result: PngExport): void {
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function exportInWorker(document: WordWarpDocument, scale: number): Promise<RenderedPng> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    throw new Error('Worker canvas export is unavailable');
  }
  const worker = new Worker(new URL('../workers/export.worker.ts', import.meta.url), {
    type: 'module',
    name: 'wordwarp-export',
  });
  const id = createId();
  return await new Promise<RenderedPng>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('PNG export timed out'));
    }, 60_000);
    worker.onmessage = (event: MessageEvent<ExportWorkerResponse>) => {
      if (event.data.id !== id) return;
      window.clearTimeout(timeout);
      worker.terminate();
      if (event.data.type === 'export-error') {
        reject(new Error(event.data.message));
      } else {
        resolve({
          bytes: new Uint8Array(event.data.bytes),
          width: event.data.width,
          height: event.data.height,
        });
      }
    };
    worker.onerror = (event) => {
      window.clearTimeout(timeout);
      worker.terminate();
      reject(new Error(event.message || 'PNG export worker failed'));
    };
    worker.postMessage({ type: 'export-png', id, document, scale });
  });
}

function documentCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

function safeFilename(name: string): string {
  const cleaned = name.trim().replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '');
  return cleaned || 'wordwarp';
}
