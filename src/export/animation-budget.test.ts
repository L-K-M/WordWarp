import { describe, expect, it, vi } from 'vitest';

import { MAX_RAW_FRAME_BYTES, planAnimationFrames } from './animation-budget';

/** A measurement that ignores the frame count, which is the usual case: bounds barely move. */
const fixed = (width: number, height: number) => () => ({ width, height });

/** Frames of this size the budget holds, rounded down the way the planner does. */
const affordable = (width: number, height: number) => Math.floor(MAX_RAW_FRAME_BYTES / (width * height * 4));

describe('animated export frame budget', () => {
  it('keeps the requested rate when the frames fit', () => {
    const plan = planAnimationFrames(2, 12, fixed(600, 400));
    expect(plan).toMatchObject({ frameCount: 24, fps: 12, requestedFps: 12, reduced: false });
  });

  // The bug this budget caused: an untouched document exports at 1776 x 676 at the app's default
  // 2x resolution, and its 2 s loop at the exporter's default 12 fps is 24 frames of it. Under the
  // old 64 MB ceiling that was 110 MB and every animated export failed before rendering a pixel.
  it('exports the app defaults without reducing anything', () => {
    const plan = planAnimationFrames(2, 12, fixed(1776, 676));
    expect(plan.reduced).toBe(false);
    expect(plan.frameCount).toBe(24);
    expect(1776 * 676 * 4 * plan.frameCount).toBeLessThanOrEqual(MAX_RAW_FRAME_BYTES);
  });

  // A canvas background turns the export opaque and stops it cropping to the artwork, so bounds
  // jump from the auto-fit crop to the whole 1200 x 630 canvas -- 2400 x 1260 at the default 2x,
  // which is 12.1 MB a frame. That is 290 MB over a 2 s loop, just past the ceiling, so it costs
  // one frame per second rather than the export.
  it('degrades an opaque full-canvas export by a frame rather than refusing it', () => {
    const plan = planAnimationFrames(2, 12, fixed(2400, 1260));
    expect(plan).toMatchObject({ frameCount: 22, fps: 11, reduced: true });
  });

  it('lowers the frame rate instead of failing when the requested count does not fit', () => {
    // 4x the default document: 19.2 MB a frame, so 24 frames would want 461 MB.
    const plan = planAnimationFrames(2, 12, fixed(3552, 1352));
    expect(plan.reduced).toBe(true);
    expect(plan.frameCount).toBe(affordable(3552, 1352));
    expect(plan.frameCount).toBeLessThan(24);
    expect(plan.fps).toBeLessThan(plan.requestedFps);
    expect(3552 * 1352 * 4 * plan.frameCount).toBeLessThanOrEqual(MAX_RAW_FRAME_BYTES);
  });

  it('measures again at the count it settles on, and returns that measurement', () => {
    // Bounds are the union of the content over the rendered frames, so a plan that changed the
    // frame count without re-measuring would hand back an envelope for frames nobody renders.
    const measure = vi.fn((frameCount: number) => ({ width: 3552, height: 1352, frameCount }));
    const plan = planAnimationFrames(2, 12, measure);
    expect(measure).toHaveBeenLastCalledWith(plan.frameCount);
    expect(plan.size.frameCount).toBe(plan.frameCount);
  });

  it('leaves a plan that already fits measured exactly once', () => {
    const measure = vi.fn(fixed(600, 400));
    planAnimationFrames(2, 12, measure);
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it('reports the rate the frames actually land at, not the one that was asked for', () => {
    // 2.1 s at 12 fps rounds to 25 frames, which is 11.9 fps -- rounding, not a budget reduction.
    // `reduced` is what callers must key their reporting off: a rate comparison would call this a
    // reduction and warn about an export that gave up nothing.
    const plan = planAnimationFrames(2.1, 12, fixed(600, 400));
    expect(plan).toMatchObject({ frameCount: 25, fps: 11.9, reduced: false });
    expect(plan.fps).toBeLessThan(plan.requestedFps);
  });

  it('renders at least two frames however small the loop or the rate', () => {
    expect(planAnimationFrames(0.05, 1, fixed(600, 400)).frameCount).toBe(2);
    expect(planAnimationFrames(2, 0.1, fixed(600, 400)).frameCount).toBe(2);
  });

  it('stops degrading at a rate that still reads as motion', () => {
    // 8000 x 8000 is 256 MB a frame, so nothing above a single frame is affordable.
    expect(() => planAnimationFrames(2, 12, fixed(8000, 8000)))
      .toThrow(/Animated export at 8000 x 8000 needs \d+ MB of frame memory, over the 256 MB budget/);
    expect(() => planAnimationFrames(2, 12, fixed(8000, 8000)))
      .toThrow(/Lower the export resolution or shorten the loop/);
  });

  it('quotes the floor it gave up at, measured at that count', () => {
    // The loop only throws once `frameCount` has reached the floor -- `next` is never below it, and
    // the throw needs `next >= frameCount` -- so the size behind the message belongs to the count
    // the message is about, and the figure is exact rather than an over-estimate carried down from
    // a wider frame.
    const measure = vi.fn(fixed(8000, 8000));
    const floor = 10; // 2 s at the 5 fps degrade floor.
    expect(() => planAnimationFrames(2, 12, measure)).toThrow(
      `needs ${Math.ceil((8000 * 8000 * 4 * floor) / (1024 * 1024))} MB of frame memory`,
    );
    expect(measure).toHaveBeenLastCalledWith(floor);
  });

  it('never asks for more frames than the caller wanted just to reach the floor', () => {
    // 1 fps over 2 s is below the degrade floor already, so the only question is whether it fits.
    const plan = planAnimationFrames(2, 1, fixed(4000, 4000));
    expect(plan).toMatchObject({ frameCount: 2, reduced: false });
  });

  it('gives up rather than looping when fewer frames measure larger', () => {
    // Pathological but cheap to guard: a measurement that grows as the count drops must still
    // terminate, because each pass either accepts the count or strictly lowers it.
    const measure = vi.fn((frameCount: number) => ({ width: 4096, height: 8192 - frameCount * 4 }));
    expect(() => planAnimationFrames(2, 12, measure)).toThrow(/frame memory/);
    expect(measure.mock.calls.length).toBeLessThan(30);
  });

  it('rejects a loop or a rate that is not a positive number', () => {
    expect(() => planAnimationFrames(0, 12, fixed(600, 400))).toThrow(/positive number of seconds/);
    expect(() => planAnimationFrames(Number.NaN, 12, fixed(600, 400))).toThrow(/positive number of seconds/);
    expect(() => planAnimationFrames(2, 0, fixed(600, 400))).toThrow(/Animation FPS must be a positive number/);
  });
});
