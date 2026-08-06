export interface EncodeAnimationRequest {
  type: 'encode-animation';
  id: string;
  format: 'apng' | 'gif';
  frames: ArrayBuffer[];
  width: number;
  height: number;
  delays: number[];
}

export type EncodeAnimationResponse =
  | { type: 'encode-complete'; id: string; bytes: ArrayBuffer }
  | { type: 'encode-error'; id: string; message: string; stack?: string };
