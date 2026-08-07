import type { WordWarpDocument } from '../model/types';
import type { RenderResult } from './contracts';
import { renderDocument2d } from './fallback2d/renderer';
import { WebGlPresenter } from './gl/presenter';
import { get2dContext } from './surface';

export class PreviewRenderer {
  readonly backend: 'webgl2' | 'canvas2d';
  private readonly target: HTMLCanvasElement;
  private readonly staging: OffscreenCanvas | HTMLCanvasElement;
  private readonly stagingContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private readonly presenter: WebGlPresenter | null;
  private readonly fallbackContext: CanvasRenderingContext2D | null;

  constructor(target: HTMLCanvasElement) {
    this.target = target;
    this.staging = createStagingCanvas();
    this.stagingContext = get2dContext(this.staging);

    // Both branches assign, so an initialiser here would only ever be discarded.
    let presenter: WebGlPresenter | null;
    try {
      presenter = new WebGlPresenter(target);
    } catch {
      presenter = null;
    }
    this.presenter = presenter;
    this.fallbackContext = presenter ? null : target.getContext('2d', { alpha: true });
    if (!presenter && !this.fallbackContext) throw new Error('No supported canvas renderer is available');
    this.backend = presenter ? 'webgl2' : 'canvas2d';
  }

  render(document: WordWarpDocument): RenderResult {
    resizeCanvas(this.target, document.canvas.width, document.canvas.height);
    resizeCanvas(this.staging, document.canvas.width, document.canvas.height);
    const result = renderDocument2d(this.stagingContext, document);
    if (this.presenter) {
      this.presenter.present(this.staging);
    } else if (this.fallbackContext) {
      this.fallbackContext.setTransform(1, 0, 0, 1, 0, 0);
      this.fallbackContext.clearRect(0, 0, this.target.width, this.target.height);
      this.fallbackContext.drawImage(this.staging, 0, 0);
    }
    return result;
  }

  dispose(): void {
    this.presenter?.dispose();
  }
}

function createStagingCanvas(): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(1, 1);
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

function resizeCanvas(canvas: OffscreenCanvas | HTMLCanvasElement, width: number, height: number): void {
  if (canvas.width === width && canvas.height === height) return;
  canvas.width = width;
  canvas.height = height;
}
