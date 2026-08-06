import alea from 'alea';
import { createNoise2D } from 'simplex-noise';

import type { AnimationTrack, Effect, Paint, Rgba, TextElement, WordWarpDocument } from '../model/types';

const noiseCache = new Map<number, ReturnType<typeof createNoise2D>>();
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function documentAnimationDuration(document: WordWarpDocument): number {
  let durationMilliseconds = 0;
  for (const element of document.elements) {
    for (const track of element.animations) {
      if (!track.enabled) continue;
      const trackMilliseconds = Math.max(1, Math.round(track.duration * 1000));
      durationMilliseconds = durationMilliseconds === 0
        ? trackMilliseconds
        : leastCommonMultiple(durationMilliseconds, trackMilliseconds);
      if (!Number.isSafeInteger(durationMilliseconds)) {
        throw new Error('Animation track durations do not form a supported common loop');
      }
    }
  }
  return durationMilliseconds === 0 ? 2 : durationMilliseconds / 1000;
}

export function hasEnabledAnimationTracks(document: WordWarpDocument): boolean {
  return document.elements.some((element) => element.animations.some((track) => track.enabled));
}

export function evaluateDocumentAtTime(document: WordWarpDocument, normalizedTime: number): WordWarpDocument {
  if (!hasEnabledAnimationTracks(document)) return document;
  const evaluated = structuredClone(document);
  const loopDuration = documentAnimationDuration(document);
  const loopTime = modulo(normalizedTime, 1);
  const sourceElements = new Map(document.elements.map((element) => [element.id, element]));
  for (const element of evaluated.elements) {
    if (element.type !== 'text') continue;
    const source = sourceElements.get(element.id);
    if (source?.type !== 'text') continue;
    for (const track of element.animations) {
      if (!track.enabled) continue;
      if (track.stagger) throw new Error('Per-character animation staggering is not supported yet');
      const trackDuration = Math.max(1, Math.round(track.duration * 1000)) / 1000;
      const cycles = loopDuration / trackDuration;
      const phase = modulo(loopTime * cycles, 1);
      applyTrack(element, source, track, phase);
    }
  }
  return evaluated;
}

function applyTrack(element: TextElement, source: TextElement, track: AnimationTrack, phase: number): void {
  const cycle = Math.sin(phase * Math.PI * 2);
  const amount = numberParam(track, 'amount', 0.15);
  if (track.kind === 'pulse') {
    const scale = 1 + cycle * amount;
    element.transform.scaleX = source.transform.scaleX * scale;
    element.transform.scaleY = source.transform.scaleY * scale;
  } else if (track.kind === 'bounce') {
    element.transform.y = source.transform.y - Math.abs(cycle) * numberParam(track, 'height', 36);
    element.transform.scaleY = source.transform.scaleY * (1 - Math.max(0, -cycle) * 0.12);
  } else if (track.kind === 'extrudeSpin') {
    forEachEffect(element, 'extrude', (effect) => { effect.angle += phase * 360; });
  } else if (track.kind === 'waveUndulate') {
    element.warp.adj[1] = phase;
    element.warp.bend = clamp(source.warp.bend + cycle * amount, -2, 2);
  } else if (track.kind === 'neonFlicker') {
    const noise = loopingNoise(track.seed, phase);
    forEachEffect(element, 'outerGlow', (effect) => {
      effect.opacity = clamp(effect.opacity * (0.72 + noise * 0.28), 0, 1);
    });
  } else if (track.kind === 'specularSweep') {
    for (const effect of element.effects) {
      if (effect.kind !== 'fill') continue;
      if (effect.paint.kind === 'matcap') effect.paint.rotation = phase * 360;
      if (effect.paint.kind === 'ramp') effect.paint.angle += phase * 360;
    }
  } else if (track.kind === 'hueCycle') {
    for (const effect of element.effects) {
      if ('paint' in effect) rotatePaintHue(effect.paint, phase * 360);
    }
  } else if (track.kind === 'rainbowScroll') {
    for (const effect of element.effects) {
      if ('paint' in effect && effect.paint.kind === 'gradient') scrollGradient(effect.paint.gradient, phase);
    }
  } else if (track.kind === 'scanlineRoll') {
    forEachPost(element, 'scanlines', (effect) => { effect.params.offset = phase; });
  } else if (track.kind === 'vhsJitter') {
    element.transform.x = source.transform.x + loopingNoise(track.seed, phase) * numberParam(track, 'distance', 5);
    forEachPost(element, 'aberration', (effect) => { effect.params.amount = 2 + Math.abs(cycle) * 4; });
  } else if (track.kind === 'glitchBlocks') {
    forEachPost(element, 'glitch', (effect) => { effect.seed = track.seed + Math.floor(phase * 12); });
  } else if (track.kind === 'sparkle') {
    forEachEffect(element, 'textureOverlay', (effect) => {
      effect.opacity = clamp(effect.opacity * (0.65 + Math.abs(cycle) * 0.7), 0, 1);
    });
  } else if (track.kind === 'glossSweep') {
    forEachEffect(element, 'reflection', (effect) => { effect.offset += (phase * 2 - 1) * 20; });
  } else if (track.kind === 'typewriter') {
    const reveal = phase < 0.7 ? phase / 0.7 : 1 - (phase - 0.7) / 0.3;
    const characters = Array.from(graphemeSegmenter.segment(source.text), ({ segment }) => segment);
    element.text = characters.slice(0, Math.floor(clamp(reveal, 0, 1) * (characters.length + 1))).join('');
  }
}

function forEachEffect<Kind extends Effect['kind']>(
  element: TextElement,
  kind: Kind,
  callback: (effect: Extract<Effect, { kind: Kind }>) => void,
): void {
  for (const effect of element.effects) {
    if (effect.kind === kind) callback(effect as Extract<Effect, { kind: Kind }>);
  }
}

function forEachPost(
  element: TextElement,
  type: Extract<Effect, { kind: 'post' }>['type'],
  callback: (effect: Extract<Effect, { kind: 'post' }>) => void,
): void {
  for (const effect of element.effects) if (effect.kind === 'post' && effect.type === type) callback(effect);
}

function rotatePaintHue(paint: Paint, degrees: number): void {
  if (paint.kind === 'solid') paint.color = rotateHue(paint.color, degrees);
  if (paint.kind === 'gradient') {
    for (const stop of paint.gradient.stops) stop.color = rotateHue(stop.color, degrees);
  }
}

function scrollGradient(gradient: Extract<Paint, { kind: 'gradient' }>['gradient'], phase: number): void {
  const source = structuredClone(gradient);
  gradient.stops = Array.from({ length: 33 }, (_, index) => ({
    offset: index / 32,
    color: sampleWrappedGradient(source, modulo(index / 32 + phase, 1)),
  }));
}

function sampleWrappedGradient(
  gradient: Extract<Paint, { kind: 'gradient' }>['gradient'],
  offset: number,
): Rgba {
  const stops = gradient.stops;
  if (stops.length === 0) return [0, 0, 0, 0];
  const rightIndex = stops.findIndex((stop) => stop.offset >= offset);
  if (rightIndex <= 0) return [...stops[0]!.color];
  if (rightIndex < 0) return [...stops.at(-1)!.color];
  const left = stops[rightIndex - 1]!;
  const right = stops[rightIndex]!;
  const amount = (offset - left.offset) / Math.max(Number.EPSILON, right.offset - left.offset);
  return left.color.map((channel, index) => channel + (right.color[index]! - channel) * amount) as Rgba;
}

function rotateHue([red, green, blue, alpha]: Rgba, degrees: number): Rgba {
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  if (delta > 0) {
    if (maximum === red) hue = 60 * modulo((green - blue) / delta, 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }
  const saturation = maximum === 0 ? 0 : delta / maximum;
  const nextHue = modulo(hue + degrees, 360);
  const chroma = maximum * saturation;
  const x = chroma * (1 - Math.abs(((nextHue / 60) % 2) - 1));
  const match = maximum - chroma;
  const [r, g, b] = nextHue < 60 ? [chroma, x, 0]
    : nextHue < 120 ? [x, chroma, 0]
      : nextHue < 180 ? [0, chroma, x]
        : nextHue < 240 ? [0, x, chroma]
          : nextHue < 300 ? [x, 0, chroma]
            : [chroma, 0, x];
  return [r + match, g + match, b + match, alpha];
}

function loopingNoise(seed: number, phase: number): number {
  let noise = noiseCache.get(seed);
  if (!noise) {
    noise = createNoise2D(alea(String(seed)));
    if (noiseCache.size >= 64) noiseCache.clear();
    noiseCache.set(seed, noise);
  }
  const radians = phase * Math.PI * 2;
  return noise(Math.cos(radians) * 1.7, Math.sin(radians) * 1.7);
}

function numberParam(track: AnimationTrack, name: string, fallback: number): number {
  const value = track.params[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function leastCommonMultiple(left: number, right: number): number {
  return (left / greatestCommonDivisor(left, right)) * right;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}
