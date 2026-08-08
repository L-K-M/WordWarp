/**
 * How much raw RGBA an animated export may hold at once.
 *
 * Frames cannot be handed off as they are produced. APNG quantises across the whole sequence, so
 * `UPNG.encode` needs every frame before it can start, and both formats go to the encode worker in
 * one message. Peak memory is therefore `width * height * 4 * frameCount`, and because the export
 * scale multiplies both dimensions it grows with the square of the chosen resolution.
 *
 * 256 MB is set against what the encoders add rather than against a tab's whole headroom: the
 * frames transfer into the worker without a copy, but UPNG and gifenc then build their own buffers
 * from them, so the true peak is close to double this number.
 *
 * The previous 64 MB could not pay for the app's own defaults. An untouched document exports at
 * 1776 x 676 at the default 2x resolution -- 4.6 MB a frame, 110 MB across a 2 s loop at 12 fps --
 * so every animated export failed on the budget until the user found the resolution dropdown.
 */
export const MAX_RAW_FRAME_BYTES = 256 * 1024 * 1024;

/**
 * The slowest sampling rate worth degrading to.
 *
 * Below roughly five frames a second a loop reads as a slideshow rather than as motion, so past
 * this point a coarser export is no longer the kinder answer and the caller is told which control
 * to reach for instead.
 */
export const MIN_ADAPTIVE_FPS = 5;

export interface FrameSize {
  width: number;
  height: number;
}

export interface AnimationFramePlan<Size extends FrameSize> {
  /** Frames to render, always at least two. */
  frameCount: number;
  /** Sampling rate these frames actually achieve over the loop. */
  fps: number;
  /** Rate the caller asked for, so a reduction can be reported instead of passed off silently. */
  requestedFps: number;
  /** True when the budget, not the caller, decided the frame count. */
  reduced: boolean;
  /** The measurement taken at the final frame count. */
  size: Size;
}

/**
 * Decide how many frames an animated export can afford to render.
 *
 * `measure` is called with a candidate frame count and returns the pixel size those frames would
 * occupy. It is a callback rather than a plain size because the two are circular: the export
 * bounds are the union of the content across the frames that get rendered, so changing the frame
 * count changes the sample times and therefore the size. Re-measuring at the count this settles on
 * is what keeps the returned size exact for the frames the caller will render -- reusing a size
 * measured at a different count would sample the animation at times that were never checked, and
 * anything the envelope missed would be clipped.
 *
 * The search only ever lowers the frame count, so it terminates: each pass either accepts the
 * current count, drops to a strictly smaller one, or gives up at the floor. It also drops straight
 * to what the budget affords rather than stepping down one frame at a time, and fewer samples
 * cannot enlarge a union of bounds by much, so a second pass almost always accepts -- one or two
 * calls to `measure` in practice, and more only if bounds somehow grow as frames are removed.
 */
export function planAnimationFrames<Size extends FrameSize>(
  duration: number,
  requestedFps: number,
  measure: (frameCount: number) => Size,
): AnimationFramePlan<Size> {
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Animation duration must be a positive number of seconds');
  }
  if (!Number.isFinite(requestedFps) || requestedFps <= 0) {
    throw new Error('Animation FPS must be a positive number');
  }
  // Two frames is the least that still reads as an animation rather than a still image.
  const requested = Math.max(2, Math.round(duration * requestedFps));
  // Never demand more frames than were asked for: a caller already below the floor has accepted a
  // slideshow, and raising their frame count to satisfy a minimum would be the opposite of a budget.
  const floor = Math.min(requested, Math.max(2, Math.ceil(duration * MIN_ADAPTIVE_FPS)));

  let frameCount = requested;
  for (;;) {
    const size = measure(frameCount);
    const affordable = affordableFrameCount(size);
    if (frameCount <= affordable) {
      return {
        frameCount,
        fps: effectiveFps(frameCount, duration),
        requestedFps,
        reduced: frameCount < requested,
        size,
      };
    }
    const next = Math.max(floor, affordable);
    if (next >= frameCount) throw budgetError(size, floor);
    frameCount = next;
  }
}

/** Frames of this size the budget can hold at once. */
export function affordableFrameCount(size: FrameSize): number {
  const frameBytes = size.width * size.height * 4;
  if (!Number.isFinite(frameBytes) || frameBytes <= 0) return 0;
  return Math.floor(MAX_RAW_FRAME_BYTES / frameBytes);
}

function budgetError(size: FrameSize, frameCount: number): Error {
  const needed = size.width * size.height * 4 * frameCount;
  return new Error(
    `Animated export at ${size.width} x ${size.height} needs ${megabytes(needed)} of frame memory,`
    + ` over the ${megabytes(MAX_RAW_FRAME_BYTES)} budget.`
    + ' Lower the export resolution or shorten the loop.',
  );
}

/**
 * The rate the rendered frames land at, which is not always the requested one: frame counts are
 * whole numbers, so a 2.5 s loop at 12 fps samples 30 frames and hits 12 fps exactly while a 2.1 s
 * loop samples 25 and lands just under. One decimal is enough to show a real reduction without
 * reporting rounding noise as one.
 *
 * It can also land well *above* the request when the two-frame minimum dominates -- 1 fps over a
 * 0.05 s loop is two frames, which really is 40 fps. Either way this is a measurement, not a
 * verdict: `reduced` is the only thing that says whether the budget took something away.
 */
function effectiveFps(frameCount: number, duration: number): number {
  return Math.round((frameCount / duration) * 10) / 10;
}

function megabytes(bytes: number): string {
  return `${Math.ceil(bytes / (1024 * 1024))} MB`;
}
