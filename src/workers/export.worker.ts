import { renderPngOnSurface } from '../export/render-png';
import type { ExportWorkerRequest, ExportWorkerResponse } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<ExportWorkerRequest>) => void) | null;
  postMessage: (message: ExportWorkerResponse, transfer?: Transferable[]) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  void renderPngOnSurface(request.document, request.scale, () => new OffscreenCanvas(1, 1))
    .then((result) => {
      const bytes = new Uint8Array(result.bytes).buffer;
      scope.postMessage(
        {
          type: 'export-complete',
          id: request.id,
          bytes,
          width: result.width,
          height: result.height,
        },
        [bytes],
      );
    })
    .catch((error: unknown) => {
      scope.postMessage({
        type: 'export-error',
        id: request.id,
        message: error instanceof Error ? error.message : 'Unknown export error',
      });
    });
};
