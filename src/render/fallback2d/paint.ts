import { rgbaToCss, sampleGradient } from '../color';
import type { Bounds } from '../../geometry/bounds';
import type { Gradient, Paint } from '../../model/types';
import { officeRampColors } from '../../presets/office-ramps';
import type { TextContext } from '../../text/layout';

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
    // The run spans the bounds' projection onto the gradient axis -- a vertical gradient runs
    // exactly the height, a horizontal one exactly the width -- so the first and last stops land
    // on the shape's edges whatever its proportions. The old diagonal span stretched a vertical
    // run on a wide word far past the glyphs, which left the letters sampling only the middle of
    // the profile: a bright-dark-bright metal arrived with both bright ends cropped off.
    const radius = (Math.abs(Math.cos(radians)) * bounds.width + Math.abs(Math.sin(radians)) * bounds.height)
      * 0.5 * gradient.scale;
    const dx = Math.cos(radians) * radius;
    const dy = Math.sin(radians) * radius;
    const canvasGradient = context.createLinearGradient(centerX - dx, centerY - dy, centerX + dx, centerY + dy);
    if (gradient.type === 'reflected') {
      // The mirror runs out from the centre, so each stop offset lands at two canvas positions.
      for (const offset of sampleOffsets(gradient, (stop) => [stop / 2, 1 - stop / 2])) {
        const reflected = 1 - Math.abs(offset * 2 - 1);
        canvasGradient.addColorStop(offset, rgbaToCss(sampleGradient(gradient, reflected)));
      }
    } else {
      addSampledStops(canvasGradient, gradient);
    }
    return canvasGradient;
  }

  if (paint.kind === 'ramp') {
    const colors = officeRampColors(paint.rampId) ?? officeRampColors('chrome')!;
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
    const radians = (paint.rotation * Math.PI) / 180;
    const highlightX = bounds.x + bounds.width * (0.5 + Math.cos(radians) * 0.22);
    const highlightY = bounds.y + bounds.height * (0.5 + Math.sin(radians) * 0.22);
    const gradient = context.createRadialGradient(
      highlightX,
      highlightY,
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

function addSampledStops(canvasGradient: CanvasGradient, gradient: Gradient): void {
  for (const offset of sampleOffsets(gradient)) {
    canvasGradient.addColorStop(offset, rgbaToCss(sampleGradient(gradient, offset)));
  }
}

/**
 * The resampling grid, plus every stop's own position.
 *
 * OKLab interpolation is emulated by sampling the gradient densely onto canvas stops, and the
 * even grid alone rounds a stop that falls between grid points onto the nearest cell -- which
 * flattens the hand-placed bands a metal fill is made of. The stops' exact offsets therefore join
 * the grid instead of being quantised to it. An evenly spaced gradient is unchanged: its stops
 * already sit on the grid.
 *
 * Two stops sharing an offset are the model's hard edge, but a single sample there can only carry
 * one side of it, so the far side is planted a hair after -- close enough to read as a crisp
 * boundary at any export scale.
 *
 * `place` maps a stop offset to its canvas positions, for geometries (the reflected mirror) where
 * the two disagree.
 */
function sampleOffsets(gradient: Gradient, place: (stopOffset: number) => number[] = (stop) => [stop]): number[] {
  const samples = gradient.interpolation === 'oklab' ? 32 : Math.max(2, gradient.stops.length - 1);
  const offsets = new Set<number>();
  for (let index = 0; index <= samples; index += 1) offsets.add(index / samples);
  gradient.stops.forEach((stop, index) => {
    const isHardEdge = index > 0 && gradient.stops[index - 1]!.offset === stop.offset;
    for (const offset of place(isHardEdge ? stop.offset + 1e-4 : stop.offset)) {
      offsets.add(Math.min(1, Math.max(0, offset)));
    }
  });
  return [...offsets].sort((a, b) => a - b);
}
