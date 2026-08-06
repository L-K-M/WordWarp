import { rgbaToCss, sampleGradient } from '../color';
import type { Bounds } from '../../geometry/bounds';
import type { Paint, Rgba } from '../../model/types';
import type { TextContext } from '../../text/layout';

const METAL_RAMPS: Record<string, Rgba[]> = {
  chrome: [
    [0.94, 0.94, 0.94, 1],
    [0.2, 0.21, 0.2, 1],
    [0.94, 0.94, 0.94, 1],
    [0.39, 0.4, 0.39, 1],
    [0.86, 0.87, 0.86, 1],
  ],
  gold: [
    [0.95, 0.88, 0.67, 1],
    [0.5, 0.4, 0.15, 1],
    [0.93, 0.81, 0.49, 1],
    [0.71, 0.56, 0.24, 1],
  ],
};

export function createPaintStyle(context: TextContext, paint: Paint, bounds: Bounds): string | CanvasGradient {
  if (paint.kind === 'solid') return rgbaToCss(paint.color);

  if (paint.kind === 'gradient') {
    const gradient = paint.gradient;
    if (gradient.type === 'radial') {
      const centerX = bounds.x + bounds.width * gradient.center[0];
      const centerY = bounds.y + bounds.height * gradient.center[1];
      const radius = Math.max(bounds.width, bounds.height) * 0.5 * gradient.scale;
      const canvasGradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      addSampledStops(canvasGradient, gradient);
      return canvasGradient;
    }
    if (gradient.type === 'angular' && 'createConicGradient' in context) {
      const centerX = bounds.x + bounds.width * gradient.center[0];
      const centerY = bounds.y + bounds.height * gradient.center[1];
      const canvasGradient = context.createConicGradient((gradient.angle * Math.PI) / 180, centerX, centerY);
      addSampledStops(canvasGradient, gradient);
      return canvasGradient;
    }

    const radians = ((gradient.angle - 90) * Math.PI) / 180;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const radius = Math.hypot(bounds.width, bounds.height) * 0.5 * gradient.scale;
    const dx = Math.cos(radians) * radius;
    const dy = Math.sin(radians) * radius;
    const canvasGradient = context.createLinearGradient(centerX - dx, centerY - dy, centerX + dx, centerY + dy);
    if (gradient.type === 'reflected') {
      for (let index = 0; index <= 32; index += 1) {
        const offset = index / 32;
        const reflected = 1 - Math.abs(offset * 2 - 1);
        canvasGradient.addColorStop(offset, rgbaToCss(sampleGradient(gradient, reflected)));
      }
    } else {
      addSampledStops(canvasGradient, gradient);
    }
    return canvasGradient;
  }

  if (paint.kind === 'ramp') {
    const colors = METAL_RAMPS[paint.rampId.toLowerCase()] ?? METAL_RAMPS.chrome!;
    const radians = ((paint.angle - 90) * Math.PI) / 180;
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;
    const radius = Math.hypot(bounds.width, bounds.height) / 2;
    const dx = Math.cos(radians) * radius;
    const dy = Math.sin(radians) * radius;
    const gradient = context.createLinearGradient(centerX - dx, centerY - dy, centerX + dx, centerY + dy);
    colors.forEach((color, index) => gradient.addColorStop(index / (colors.length - 1), rgbaToCss(color)));
    return gradient;
  }

  if (paint.kind === 'matcap') {
    const gradient = context.createRadialGradient(
      bounds.x + bounds.width * 0.35,
      bounds.y + bounds.height * 0.25,
      0,
      bounds.x + bounds.width * 0.5,
      bounds.y + bounds.height * 0.5,
      Math.max(bounds.width, bounds.height) * 0.7,
    );
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.28, '#b7c9dc');
    gradient.addColorStop(0.55, '#445064');
    gradient.addColorStop(1, '#090c12');
    return gradient;
  }

  return '#727b8c';
}

function addSampledStops(canvasGradient: CanvasGradient, gradient: Extract<Paint, { kind: 'gradient' }>['gradient']): void {
  const samples = gradient.interpolation === 'oklab' ? 32 : Math.max(2, gradient.stops.length - 1);
  for (let index = 0; index <= samples; index += 1) {
    const offset = index / samples;
    canvasGradient.addColorStop(offset, rgbaToCss(sampleGradient(gradient, offset)));
  }
}
