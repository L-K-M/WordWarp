export function alphaChannel(pixels: Uint8ClampedArray): Uint8Array {
  const alpha = new Uint8Array(pixels.length / 4);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = pixels[index * 4 + 3]!;
  return alpha;
}

export function blurAlpha(alpha: Uint8Array, width: number, height: number, sigma: number): Uint8Array {
  if (sigma <= 0.01) return alpha.slice();
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = gaussianKernel(radius, sigma);
  const horizontal = new Float32Array(alpha.length);
  const output = new Uint8Array(alpha.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = x + offset;
        if (sampleX >= 0 && sampleX < width) {
          value += alpha[y * width + sampleX]! * kernel[offset + radius]!;
        }
      }
      horizontal[y * width + x] = value;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = y + offset;
        if (sampleY >= 0 && sampleY < height) {
          value += horizontal[sampleY * width + x]! * kernel[offset + radius]!;
        }
      }
      output[y * width + x] = Math.round(value);
    }
  }
  return output;
}

export function signedDistanceField(alpha: Uint8Array, width: number, height: number): Float32Array {
  const inside = new Uint8Array(alpha.length);
  const outside = new Uint8Array(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    const isInside = alpha[index]! >= 128;
    inside[index] = isInside ? 1 : 0;
    outside[index] = isInside ? 0 : 1;
  }
  const distanceToInside = euclideanDistanceTransform(inside, width, height);
  const distanceToOutside = euclideanDistanceTransform(outside, width, height);
  const result = new Float32Array(alpha.length);
  for (let index = 0; index < result.length; index += 1) {
    result[index] = inside[index] ? -distanceToOutside[index]! : distanceToInside[index]!;
  }
  return result;
}

export function offsetAlpha(alpha: Uint8Array, width: number, height: number, dx: number, dy: number): Uint8Array {
  const output = new Uint8Array(alpha.length);
  const offsetX = Math.round(dx);
  const offsetY = Math.round(dy);
  for (let y = 0; y < height; y += 1) {
    const sourceY = y - offsetY;
    if (sourceY < 0 || sourceY >= height) continue;
    for (let x = 0; x < width; x += 1) {
      const sourceX = x - offsetX;
      if (sourceX >= 0 && sourceX < width) output[y * width + x] = alpha[sourceY * width + sourceX]!;
    }
  }
  return output;
}

function euclideanDistanceTransform(features: Uint8Array, width: number, height: number): Float32Array {
  const maximum = width * width + height * height + 1;
  const temporary = new Float64Array(features.length);
  const output = new Float32Array(features.length);
  const source = new Float64Array(Math.max(width, height));
  const transformed = new Float64Array(Math.max(width, height));
  const locations = new Int32Array(Math.max(width, height));
  const boundaries = new Float64Array(Math.max(width, height) + 1);

  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) source[y] = features[y * width + x] ? 0 : maximum;
    edt1d(source, transformed, height, locations, boundaries);
    for (let y = 0; y < height; y += 1) temporary[y * width + x] = transformed[y]!;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) source[x] = temporary[y * width + x]!;
    edt1d(source, transformed, width, locations, boundaries);
    for (let x = 0; x < width; x += 1) output[y * width + x] = Math.sqrt(transformed[x]!);
  }
  return output;
}

function edt1d(
  source: Float64Array,
  output: Float64Array,
  length: number,
  locations: Int32Array,
  boundaries: Float64Array,
): void {
  let last = 0;
  locations[0] = 0;
  boundaries[0] = Number.NEGATIVE_INFINITY;
  boundaries[1] = Number.POSITIVE_INFINITY;

  for (let position = 1; position < length; position += 1) {
    let boundary = intersection(source, position, locations[last]!);
    while (boundary <= boundaries[last]!) {
      last -= 1;
      boundary = intersection(source, position, locations[last]!);
    }
    last += 1;
    locations[last] = position;
    boundaries[last] = boundary;
    boundaries[last + 1] = Number.POSITIVE_INFINITY;
  }

  last = 0;
  for (let position = 0; position < length; position += 1) {
    while (boundaries[last + 1]! < position) last += 1;
    const delta = position - locations[last]!;
    output[position] = delta * delta + source[locations[last]!]!;
  }
}

function intersection(source: Float64Array, first: number, second: number): number {
  return ((source[first]! + first * first) - (source[second]! + second * second)) / (2 * first - 2 * second);
}

function gaussianKernel(radius: number, sigma: number): Float32Array {
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const value = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel[offset + radius] = value;
    sum += value;
  }
  for (let index = 0; index < kernel.length; index += 1) kernel[index] = kernel[index]! / sum;
  return kernel;
}
