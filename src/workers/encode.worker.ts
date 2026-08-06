import { encodeApng, encodeGif } from '../export/animation-codec';
import type { EncodeAnimationRequest, EncodeAnimationResponse } from './encode-protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<EncodeAnimationRequest>) => void) | null;
  postMessage: (message: EncodeAnimationResponse, transfer?: Transferable[]) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const request = event.data;
  try {
    const encoded = request.format === 'apng'
      ? encodeApng(request.frames, request.width, request.height, request.delays)
      : encodeGif(request.frames, request.width, request.height, request.delays);
    const bytes = new Uint8Array(encoded).buffer;
    scope.postMessage({ type: 'encode-complete', id: request.id, bytes }, [bytes]);
  } catch (error) {
    scope.postMessage({
      type: 'encode-error',
      id: request.id,
      message: error instanceof Error ? error.message : 'Animation encoding failed',
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
};
