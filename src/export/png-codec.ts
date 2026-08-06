export async function encodePngPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array> {
  if (pixels.length !== width * height * 4) throw new Error('PNG pixel buffer has an invalid length');
  const { encode } = await import('fast-png');
  return encode(
    { width, height, data: pixels, channels: 4, depth: 8 },
    { zlib: { level: 6 } },
  );
}
