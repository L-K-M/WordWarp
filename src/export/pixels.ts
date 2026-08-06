export function unpremultiplyPixels(pixels: Uint8ClampedArray): void {
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3]!;
    if (alpha === 0) {
      pixels[index] = 0;
      pixels[index + 1] = 0;
      pixels[index + 2] = 0;
      continue;
    }
    const scale = 255 / alpha;
    pixels[index] = Math.min(255, Math.round(pixels[index]! * scale));
    pixels[index + 1] = Math.min(255, Math.round(pixels[index + 1]! * scale));
    pixels[index + 2] = Math.min(255, Math.round(pixels[index + 2]! * scale));
  }
}

export function flipPixelRows(pixels: Uint8ClampedArray, width: number, height: number): void {
  const rowLength = width * 4;
  const temporary = new Uint8ClampedArray(rowLength);
  for (let top = 0; top < Math.floor(height / 2); top += 1) {
    const bottom = height - top - 1;
    const topOffset = top * rowLength;
    const bottomOffset = bottom * rowLength;
    temporary.set(pixels.subarray(topOffset, topOffset + rowLength));
    pixels.copyWithin(topOffset, bottomOffset, bottomOffset + rowLength);
    pixels.set(temporary, bottomOffset);
  }
}
