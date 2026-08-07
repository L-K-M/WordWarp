import { z } from 'zod';

import { DOC_VERSION, PRESET_WARP_IDS } from './types';
import type { WordWarpDocument } from './types';

const finite = z.number().finite();
const unit = finite.min(0).max(1);
const pointSchema = z.tuple([finite, finite]);
const rgbaSchema = z.tuple([unit, unit, unit, unit]);

const blendModeSchema = z.enum([
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
  'linear-dodge',
]);

const gradientSchema = z.object({
  type: z.enum(['linear', 'radial', 'angular', 'reflected', 'diamond']),
  stops: z
    .array(z.object({ offset: unit, color: rgbaSchema }))
    .min(1)
    .refine(
      (stops) => stops.every((stop, index) => index === 0 || stop.offset >= stops[index - 1]!.offset),
      'Gradient stops must be ordered by offset',
    ),
  angle: finite,
  center: pointSchema,
  scale: finite.positive(),
  dither: z.boolean(),
  interpolation: z.enum(['srgb', 'oklab']),
});

export const paintSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: rgbaSchema }),
  z.object({ kind: z.literal('gradient'), gradient: gradientSchema }),
  z.object({
    kind: z.literal('texture'),
    assetId: z.string().min(1),
    scale: finite.positive(),
    rotation: finite,
    blend: blendModeSchema,
  }),
  z.object({
    kind: z.literal('matcap'),
    matcapId: z.string().min(1),
    rotation: finite,
    intensity: finite.nonnegative(),
  }),
  z.object({
    kind: z.literal('ramp'),
    rampId: z.string().min(1),
    angle: finite,
    variant: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  }),
]);

const effectBase = {
  id: z.string().min(1),
  enabled: z.boolean(),
  opacity: unit,
  blendMode: blendModeSchema,
  slot: z.enum(['back', 'body', 'front', 'post']),
};

const contourSchema = z.array(unit).min(2).max(256);
const shadowBase = {
  ...effectBase,
  color: rgbaSchema,
  angle: finite,
  distance: finite.nonnegative(),
  size: finite.nonnegative(),
  contour: contourSchema,
  noise: unit,
};
const glowBase = {
  ...effectBase,
  paint: paintSchema,
  noise: unit,
  technique: z.enum(['softer', 'precise']),
  size: finite.nonnegative(),
  contour: contourSchema,
  range: unit,
  jitter: unit,
};

export const effectSchema = z.discriminatedUnion('kind', [
  z.object({ ...effectBase, kind: z.literal('fill'), paint: paintSchema }),
  z.object({
    ...effectBase,
    kind: z.literal('stroke'),
    width: finite.nonnegative(),
    position: z.enum(['inside', 'center', 'outside']),
    paint: paintSchema,
    join: z.enum(['miter', 'round', 'bevel']),
    miterLimit: finite.min(1),
    dash: z.tuple([finite.nonnegative(), finite.nonnegative()]).nullable(),
    dashOffset: finite,
  }),
  z.object({
    ...effectBase,
    kind: z.literal('bevel'),
    style: z.enum(['outer', 'inner', 'emboss', 'pillow', 'strokeEmboss']),
    technique: z.enum(['smooth', 'chiselHard', 'chiselSoft']),
    depth: finite.min(1).max(1000),
    direction: z.enum(['up', 'down']),
    size: finite.nonnegative().max(250),
    soften: finite.nonnegative().max(16),
    angle: finite,
    altitude: finite.min(0).max(90),
    useGlobalLight: z.boolean(),
    glossContour: contourSchema,
    highlight: z.object({ color: rgbaSchema, blendMode: blendModeSchema, opacity: unit }),
    shadow: z.object({ color: rgbaSchema, blendMode: blendModeSchema, opacity: unit }),
  }),
  z.object({
    ...effectBase,
    kind: z.literal('extrude'),
    depth: finite.nonnegative().max(500),
    mode: z.enum(['parallel', 'perspective']),
    angle: finite,
    vanishingPoint: pointSchema,
    strength: unit,
    sidePaint: paintSchema,
    autoShade: z.boolean(),
    shadeAmount: unit,
    steps: z.union([z.literal('auto'), z.number().int().positive()]),
  }),
  z.object({ ...shadowBase, kind: z.literal('innerShadow'), choke: unit }),
  z.object({
    ...glowBase,
    kind: z.literal('innerGlow'),
    source: z.enum(['center', 'edge']),
    choke: unit,
  }),
  z.object({
    ...effectBase,
    kind: z.literal('satin'),
    color: rgbaSchema,
    angle: finite,
    distance: finite.nonnegative(),
    size: finite.nonnegative(),
    contour: contourSchema,
    invert: z.boolean(),
  }),
  z.object({ ...glowBase, kind: z.literal('outerGlow'), spread: unit }),
  z.object({
    ...shadowBase,
    kind: z.literal('dropShadow'),
    spread: unit,
    useGlobalLight: z.boolean(),
    knockout: z.boolean(),
  }),
  z.object({
    ...effectBase,
    kind: z.literal('longShadow'),
    angle: finite,
    length: z.union([finite.nonnegative(), z.literal('toEdge')]),
    paint: paintSchema,
    fade: z.boolean(),
  }),
  z.object({
    ...effectBase,
    kind: z.literal('textureOverlay'),
    source: z.discriminatedUnion('type', [
      z.object({ type: z.literal('asset'), assetId: z.string().min(1) }),
      z.object({
        type: z.literal('procedural'),
        pattern: z.enum(['noise', 'weave', 'halftone', 'grain']),
      }),
    ]),
    scale: finite.positive(),
    rotation: finite,
    clipToShape: z.boolean(),
  }),
  z.object({
    ...effectBase,
    kind: z.literal('reflection'),
    offset: finite,
    height: unit,
    fade: contourSchema,
    blur: finite.nonnegative(),
  }),
  z.object({
    ...effectBase,
    kind: z.literal('post'),
    type: z.enum(['glitch', 'halftone', 'scanlines', 'grain', 'aberration', 'pixelate']),
    seed: z.number().int(),
    params: z.record(z.string(), z.union([finite, z.string(), z.boolean()])),
  }),
]);

const transformSchema = z.object({
  x: finite,
  y: finite,
  rotation: finite,
  scaleX: finite,
  scaleY: finite,
  skewX: finite,
  skewY: finite,
  originX: unit,
  originY: unit,
});

const animationTrackSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'specularSweep',
    'glossSweep',
    'neonFlicker',
    'hueCycle',
    'rainbowScroll',
    'scanlineRoll',
    'vhsJitter',
    'glitchBlocks',
    'sparkle',
    'waveUndulate',
    'bounce',
    'typewriter',
    'extrudeSpin',
    'pulse',
  ]),
  enabled: z.boolean(),
  duration: finite.positive(),
  params: z.record(z.string(), z.union([finite, z.string()])),
  seed: z.number().int(),
  stagger: z.never().optional(),
});

const elementBase = {
  id: z.string().min(1),
  name: z.string().min(1),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: unit,
  blendMode: blendModeSchema,
  transform: transformSchema,
  effects: z.array(effectSchema),
  animations: z.array(animationTrackSchema),
};

const fontSchema = z.object({
  family: z.string().min(1),
  source: z.enum(['google', 'bundled', 'user', 'local']),
  assetId: z.string().min(1).optional(),
  weight: z.number().int().min(100).max(900),
  italic: z.boolean(),
  variations: z.record(z.string(), finite).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
});

const layoutSchema = z.object({
  size: finite.positive(),
  align: z.enum(['left', 'center', 'right']),
  lineHeight: finite.positive(),
  letterSpacing: finite,
  wordSpacing: finite,
  transform: z.enum(['none', 'upper', 'lower', 'title']),
  direction: z.enum(['ltr', 'rtl']),
  curveSpacing: z.enum(['uniform', 'arc-length']),
});

const presetWarpSchema = z.enum(PRESET_WARP_IDS);

const pathDataSchema = z.object({
  commands: z.array(
    z.union([
      z.object({ type: z.enum(['M', 'L']), point: pointSchema }),
      z.object({ type: z.literal('Q'), control: pointSchema, point: pointSchema }),
      z.object({
        type: z.literal('C'),
        control1: pointSchema,
        control2: pointSchema,
        point: pointSchema,
      }),
      z.object({ type: z.literal('Z') }),
    ]),
  ),
});

const warpSchema = z
  .object({
    kind: z.enum(['none', 'preset', 'path', 'mesh', 'perspective']),
    preset: presetWarpSchema.optional(),
    // Bend and the first adjustment run past 1 so a preset can be pushed beyond its natural
    // shape; the second adjustment is a phase and stays within the unit range. Widening these
    // only admits documents the old range rejected, so nothing saved earlier needs migrating.
    adj: z.tuple([finite.min(0).max(2), unit]),
    bend: finite.min(-2).max(2),
    distortH: finite.min(-1).max(1),
    distortV: finite.min(-1).max(1),
    path: pathDataSchema.optional(),
    mesh: z
      .object({
        cols: z.number().int().min(1).max(16),
        rows: z.number().int().min(1).max(16),
        points: z.array(finite),
      })
      .optional(),
    corners: z.tuple([pointSchema, pointSchema, pointSchema, pointSchema]).optional(),
    keepUpright: z.boolean(),
  })
  .superRefine((warp, context) => {
    if (warp.kind === 'preset' && !warp.preset) {
      context.addIssue({ code: 'custom', path: ['preset'], message: 'Preset warp requires a preset' });
    }
    if (warp.kind === 'path' && !warp.path) {
      context.addIssue({ code: 'custom', path: ['path'], message: 'Path warp requires path data' });
    }
    if (warp.kind === 'perspective' && !warp.corners) {
      context.addIssue({
        code: 'custom',
        path: ['corners'],
        message: 'Perspective warp requires four corners',
      });
    }
    if (warp.kind === 'mesh' && warp.mesh) {
      const expected = (warp.mesh.cols + 1) * (warp.mesh.rows + 1) * 2;
      if (warp.mesh.points.length !== expected) {
        context.addIssue({
          code: 'custom',
          path: ['mesh', 'points'],
          message: `Mesh requires ${expected} coordinate values`,
        });
      }
    }
  });

export const elementSchema = z.discriminatedUnion('type', [
  z.object({
    ...elementBase,
    type: z.literal('text'),
    text: z.string(),
    font: fontSchema,
    layout: layoutSchema,
    warp: warpSchema,
  }),
  z.object({
    ...elementBase,
    type: z.literal('shape'),
    shape: z.enum(['rectangle', 'ellipse', 'star', 'splat']),
    width: finite.positive(),
    height: finite.positive(),
  }),
  z.object({
    ...elementBase,
    type: z.literal('image'),
    assetId: z.string().min(1),
    width: finite.positive(),
    height: finite.positive(),
  }),
  z.object({ ...elementBase, type: z.literal('group'), childIds: z.array(z.string().min(1)) }),
]);

export const documentSchema = z
  .object({
    version: z.literal(DOC_VERSION),
    id: z.string().min(1),
    name: z.string().min(1),
    canvas: z.object({
      width: z.number().int().positive().max(32767),
      height: z.number().int().positive().max(32767),
      background: paintSchema.nullable(),
      autoFit: z.boolean(),
      exportPadding: finite.nonnegative(),
    }),
    elements: z.array(elementSchema),
    assets: z.record(
      z.string(),
      z.object({
        id: z.string().min(1),
        kind: z.enum(['font', 'image', 'texture', 'matcap']),
        name: z.string().min(1),
        mime: z.string().min(1),
        sha256: z.string().min(1),
      }),
    ),
    globalLight: z.object({ angle: finite, altitude: finite.min(0).max(90) }),
    meta: z.object({
      created: z.iso.datetime(),
      modified: z.iso.datetime(),
      app: z.string().min(1),
    }),
  })
  .superRefine((document, context) => {
    const ids = new Set<string>();
    for (const [index, element] of document.elements.entries()) {
      if (ids.has(element.id)) {
        context.addIssue({
          code: 'custom',
          path: ['elements', index, 'id'],
          message: `Duplicate element id: ${element.id}`,
        });
      }
      ids.add(element.id);
    }

    for (const [index, element] of document.elements.entries()) {
      if (element.type !== 'group') continue;
      for (const childId of element.childIds) {
        if (!ids.has(childId)) {
          context.addIssue({
            code: 'custom',
            path: ['elements', index, 'childIds'],
            message: `Unknown group child: ${childId}`,
          });
        }
      }
    }
  });

export function parseDocument(value: unknown): WordWarpDocument {
  return documentSchema.parse(value);
}
