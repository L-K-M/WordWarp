import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import * as UPNG from 'upng-js';

const BAYER_4 = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

export function encodeApng(
  frames: ArrayBuffer[],
  width: number,
  height: number,
  delays: number[],
): Uint8Array {
  validateFrames(frames, width, height, delays);
  return new Uint8Array(UPNG.encode(frames, width, height, 0, delays));
}

export function encodeGif(
  frames: ArrayBuffer[],
  width: number,
  height: number,
  delays: number[],
): Uint8Array {
  validateFrames(frames, width, height, delays);
  const encoder = GIFEncoder();
  frames.forEach((buffer, frameIndex) => {
    const rgba = new Uint8Array(buffer.slice(0));
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      const threshold = ((BAYER_4[(y % 4) * 4 + (x % 4)]! + 0.5) / 16) * 255;
      if (rgba[offset + 3]! <= threshold) {
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
        rgba[offset + 3] = 0;
      } else {
        rgba[offset + 3] = 255;
      }
    }
    const palette = quantize(rgba, 256, {
      format: 'rgba4444',
      oneBitAlpha: 127,
      clearAlpha: true,
      clearAlphaThreshold: 0,
      clearAlphaColor: 0,
    });
    let transparentIndex = palette.findIndex((color) => color[3] === 0);
    if (transparentIndex < 0) {
      if (palette.length === 256) palette.pop();
      palette.unshift([0, 0, 0, 0]);
      transparentIndex = 0;
    } else if (transparentIndex > 0) {
      [palette[0], palette[transparentIndex]] = [palette[transparentIndex]!, palette[0]!];
      transparentIndex = 0;
    }
    const indexed = applyPalette(rgba, palette, 'rgba4444');
    encoder.writeFrame(indexed, width, height, {
      palette,
      delay: delays[frameIndex] ?? 80,
      repeat: 0,
      transparent: true,
      transparentIndex: Math.max(0, transparentIndex),
      dispose: 2,
    });
  });
  encoder.finish();
  return encoder.bytes();
}

function validateFrames(frames: ArrayBuffer[], width: number, height: number, delays: number[]): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Animation dimensions must be positive integers');
  }
  if (frames.length === 0 || delays.length !== frames.length) {
    throw new Error('Animation frames and delays must be non-empty and have equal lengths');
  }
  const expectedBytes = width * height * 4;
  for (const frame of frames) {
    if (frame.byteLength !== expectedBytes) throw new Error('Animation frame dimensions do not match its RGBA buffer');
  }
  if (delays.some((delay) => !Number.isFinite(delay) || delay <= 0)) {
    throw new Error('Animation frame delays must be positive finite numbers');
  }
}
