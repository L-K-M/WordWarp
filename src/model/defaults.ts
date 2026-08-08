import { createEffect } from '../effects/defaults';
import { stampAspect } from '../geometry/stamps';
import { createId } from '../lib/id';
import { DOC_VERSION } from './types';
import type { FillEffect, Point, ShapeElement, StampId, TextElement, WordWarpDocument } from './types';

interface DefaultOptions {
  documentId?: string;
  elementId?: string;
  fillId?: string;
  now?: string;
}

export function createDefaultFill(id = createId()): FillEffect {
  return {
    id,
    kind: 'fill',
    slot: 'body',
    enabled: true,
    opacity: 1,
    blendMode: 'normal',
    paint: { kind: 'ramp', rampId: 'chrome', angle: 90, variant: 1 },
  };
}

/** Human-readable stamp names, for the layer name and the placement menu. */
export const STAMP_LABELS: Record<StampId, string> = {
  rectangle: 'Bar',
  ellipse: 'Dot',
  triangle: 'Triangle',
  arch: 'Arch',
  chevron: 'Chevron',
  heart: 'Heart',
  speech: 'Speech',
  banner: 'Banner',
  star: 'Star',
  starburst: 'Starburst',
  sparkle: 'Sparkle',
  splat: 'Splat',
  zigzag: 'Zigzag',
  squiggle: 'Squiggle',
  bolt: 'Bolt',
  crown: 'Crown',
  gem: 'Gem',
  diamond: 'Diamond',
  plus: 'Plus',
  ring: 'Ring',
  blob: 'Blob',
  spiral: 'Spiral',
  drips: 'Drips',
  hat: 'Witch Hat',
  bone: 'Bone',
  candy: 'Candy',
  cupcake: 'Cupcake',
  cherry: 'Cherry',
  butterfly: 'Butterfly',
  smiley: 'Smiley',
  shades: 'Shades',
  bottle: 'Bottle',
  cassette: 'Cassette',
  floppy: 'Floppy',
  boombox: 'Boombox',
  pizza: 'Pizza',
  daisy: 'Daisy',
  peace: 'Peace',
  disc: 'Disc',
  pumpkin: 'Pumpkin',
  ghost: 'Ghost',
  bat: 'Bat',
  skull: 'Skull',
  tombstone: 'Tombstone',
  web: 'Web',
  rocket: 'Rocket',
  planet: 'Planet',
  moon: 'Moon',
  comet: 'Comet',
  saucer: 'Saucer',
  cone: 'Ice Cream',
  donut: 'Doughnut',
  lolly: 'Lollipop',
  sun: 'Sun',
  palm: 'Palm',
  cloud: 'Cloud',
  flame: 'Flame',
};

/**
 * The longer side of a freshly placed stamp, in canvas units.
 *
 * The other side follows from the figure's own proportions, so a stamp lands looking like itself
 * rather than squeezed into a square. Resizing is still free in both axes -- a stretched bar is a
 * legitimate Memphis mark -- this only decides where it starts.
 */
const STAMP_PLACED_SIZE = 180;

/**
 * A freshly placed stamp.
 *
 * It arrives with a flat fill and a hard unblurred keyline rather than bare, because a decoration
 * with no effects at all renders as a white silhouette and reads as a bug. This pairing is also
 * the one the 1990s styles are built on, so a stamp looks like it belongs beside them the moment
 * it lands, and every one of those presets can then be applied to it.
 */
export function createStampElement(
  shape: StampId,
  position: Point,
  id = createId(),
  fillId = createId(),
): ShapeElement {
  const fill = createDefaultFill(fillId);
  fill.paint = { kind: 'solid', color: [1, 0.37, 0.24, 1] };
  const keyline = createEffect('stroke');
  keyline.width = 5;
  keyline.paint = { kind: 'solid', color: [0.08, 0.08, 0.14, 1] };
  const aspect = stampAspect(shape);
  return {
    id,
    type: 'shape',
    name: STAMP_LABELS[shape],
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: {
      x: position[0],
      y: position[1],
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      skewX: 0,
      skewY: 0,
      originX: 0.5,
      originY: 0.5,
    },
    effects: [fill, keyline],
    animations: [],
    shape,
    width: aspect >= 1 ? STAMP_PLACED_SIZE : STAMP_PLACED_SIZE * aspect,
    height: aspect >= 1 ? STAMP_PLACED_SIZE / aspect : STAMP_PLACED_SIZE,
    path: null,
  };
}

export function createDefaultTextElement(id = createId(), fillId = createId()): TextElement {
  const dropShadow = createEffect('dropShadow');
  dropShadow.distance = 12;
  dropShadow.size = 12;
  dropShadow.opacity = 0.62;
  const bevel = createEffect('bevel');
  bevel.size = 8;
  bevel.depth = 140;
  const outline = createEffect('stroke');
  outline.width = 2;
  outline.paint = { kind: 'solid', color: [0.1, 0.1, 0.1, 1] };
  return {
    id,
    type: 'text',
    name: 'WordWarp',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    transform: {
      x: 600,
      y: 315,
      rotation: -2,
      scaleX: 1,
      scaleY: 1,
      skewX: -7,
      skewY: 0,
      originX: 0.5,
      originY: 0.5,
    },
    effects: [dropShadow, createDefaultFill(fillId), bevel, outline],
    animations: [],
    text: 'WordWarp',
    font: {
      family: 'Arial Black',
      source: 'local',
      weight: 900,
      italic: false,
      features: { liga: true, kern: true },
    },
    layout: {
      size: 164,
      align: 'center',
      lineHeight: 1,
      letterSpacing: -0.055,
      wordSpacing: 0,
      transform: 'none',
      direction: 'ltr',
      curveSpacing: 'arc-length',
    },
    warp: {
      kind: 'none',
      adj: [0.5, 0.5],
      bend: 0,
      distortH: 0,
      distortV: 0,
      keepUpright: false,
    },
  };
}

export function createDefaultDocument(options: DefaultOptions = {}): WordWarpDocument {
  const now = options.now ?? new Date().toISOString();
  return {
    version: DOC_VERSION,
    id: options.documentId ?? createId(),
    name: 'Untitled warp',
    canvas: {
      width: 1200,
      height: 630,
      background: null,
      autoFit: true,
      exportPadding: 48,
    },
    elements: [createDefaultTextElement(options.elementId, options.fillId)],
    assets: {},
    globalLight: { angle: 120, altitude: 35 },
    meta: { created: now, modified: now, app: `WordWarp/${__APP_VERSION__}` },
  };
}
