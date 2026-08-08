export const DOC_VERSION = 3 as const;

export type Point = [number, number];
export type Rgba = [number, number, number, number];

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'linear-dodge';

export interface GradientStop {
  offset: number;
  color: Rgba;
}

export interface Gradient {
  type: 'linear' | 'radial' | 'angular' | 'reflected' | 'diamond';
  stops: GradientStop[];
  angle: number;
  center: Point;
  scale: number;
  dither: boolean;
  interpolation: 'srgb' | 'oklab';
}

export type Paint =
  | { kind: 'solid'; color: Rgba }
  | { kind: 'gradient'; gradient: Gradient }
  | { kind: 'texture'; assetId: string; scale: number; rotation: number; blend: BlendMode }
  | { kind: 'matcap'; matcapId: string; rotation: number; intensity: number }
  | { kind: 'ramp'; rampId: string; angle: number; variant: 1 | 2 | 3 | 4 };

export type EffectSlot = 'back' | 'body' | 'front' | 'post';

export interface EffectBase {
  id: string;
  enabled: boolean;
  opacity: number;
  blendMode: BlendMode;
  slot: EffectSlot;
}

export interface FillEffect extends EffectBase {
  kind: 'fill';
  paint: Paint;
}

export interface StrokeEffect extends EffectBase {
  kind: 'stroke';
  width: number;
  position: 'inside' | 'center' | 'outside';
  paint: Paint;
  join: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  dash: [number, number] | null;
  dashOffset: number;
}

export interface BevelEffect extends EffectBase {
  kind: 'bevel';
  style: 'outer' | 'inner' | 'emboss' | 'pillow' | 'strokeEmboss';
  technique: 'smooth' | 'chiselHard' | 'chiselSoft';
  depth: number;
  direction: 'up' | 'down';
  size: number;
  soften: number;
  angle: number;
  altitude: number;
  useGlobalLight: boolean;
  glossContour: number[];
  highlight: { color: Rgba; blendMode: BlendMode; opacity: number };
  shadow: { color: Rgba; blendMode: BlendMode; opacity: number };
}

export interface ExtrudeEffect extends EffectBase {
  kind: 'extrude';
  depth: number;
  mode: 'parallel' | 'perspective';
  angle: number;
  vanishingPoint: Point;
  strength: number;
  sidePaint: Paint;
  autoShade: boolean;
  shadeAmount: number;
  steps: number | 'auto';
}

export interface ShadowEffectBase extends EffectBase {
  color: Rgba;
  angle: number;
  distance: number;
  size: number;
  contour: number[];
  noise: number;
}

export interface InnerShadowEffect extends ShadowEffectBase {
  kind: 'innerShadow';
  choke: number;
}

export interface DropShadowEffect extends ShadowEffectBase {
  kind: 'dropShadow';
  spread: number;
  useGlobalLight: boolean;
  knockout: boolean;
}

export interface GlowEffectBase extends EffectBase {
  paint: Paint;
  noise: number;
  technique: 'softer' | 'precise';
  size: number;
  contour: number[];
  range: number;
  jitter: number;
}

export interface InnerGlowEffect extends GlowEffectBase {
  kind: 'innerGlow';
  source: 'center' | 'edge';
  choke: number;
}

export interface OuterGlowEffect extends GlowEffectBase {
  kind: 'outerGlow';
  spread: number;
}

export interface SatinEffect extends EffectBase {
  kind: 'satin';
  color: Rgba;
  angle: number;
  distance: number;
  size: number;
  contour: number[];
  invert: boolean;
}

export interface LongShadowEffect extends EffectBase {
  kind: 'longShadow';
  angle: number;
  length: number | 'toEdge';
  paint: Paint;
  fade: boolean;
}

export interface TextureOverlayEffect extends EffectBase {
  kind: 'textureOverlay';
  source:
    | { type: 'asset'; assetId: string }
    | {
        type: 'procedural';
        pattern:
          | 'noise'
          | 'weave'
          | 'halftone'
          | 'grain'
          | 'topography'
          | 'mottle'
          | 'crystal'
          | 'stitch';
      };
  scale: number;
  rotation: number;
  clipToShape: boolean;
}

export interface ReflectionEffect extends EffectBase {
  kind: 'reflection';
  offset: number;
  height: number;
  fade: number[];
  blur: number;
}

export interface PostEffect extends EffectBase {
  kind: 'post';
  type: 'glitch' | 'halftone' | 'scanlines' | 'grain' | 'aberration' | 'dither' | 'pixelate';
  seed: number;
  params: Record<string, number | string | boolean>;
}

export type Effect =
  | FillEffect
  | StrokeEffect
  | BevelEffect
  | ExtrudeEffect
  | InnerShadowEffect
  | InnerGlowEffect
  | SatinEffect
  | OuterGlowEffect
  | DropShadowEffect
  | LongShadowEffect
  | TextureOverlayEffect
  | ReflectionEffect
  | PostEffect;

export interface Transform {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  skewX: number;
  skewY: number;
  originX: number;
  originY: number;
}

export interface AnimationTrack {
  id: string;
  kind:
    | 'specularSweep'
    | 'glossSweep'
    | 'neonFlicker'
    | 'hueCycle'
    | 'rainbowScroll'
    | 'scanlineRoll'
    | 'vhsJitter'
    | 'glitchBlocks'
    | 'sparkle'
    | 'waveUndulate'
    | 'bounce'
    | 'typewriter'
    | 'extrudeSpin'
    | 'pulse';
  enabled: boolean;
  duration: number;
  params: Record<string, number | string>;
  seed: number;
  stagger?: {
    amount: number;
    order: 'forward' | 'backward' | 'center' | 'random';
  };
}

export interface ElementBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  transform: Transform;
  effects: Effect[];
  animations: AnimationTrack[];
}

export interface FontSpec {
  family: string;
  source: 'google' | 'bundled' | 'user' | 'local';
  assetId?: string;
  weight: number;
  italic: boolean;
  variations?: Record<string, number>;
  features?: Record<string, boolean>;
}

export interface TextLayout {
  size: number;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  wordSpacing: number;
  transform: 'none' | 'upper' | 'lower' | 'title';
  direction: 'ltr' | 'rtl';
  curveSpacing: 'uniform' | 'arc-length';
}

export const PRESET_WARP_IDS = [
  'textNoShape',
  'textPlain',
  'textArchDown',
  'textArchDownPour',
  'textArchUp',
  'textArchUpPour',
  'textButton',
  'textButtonPour',
  'textCanDown',
  'textCanUp',
  'textCascadeDown',
  'textCascadeUp',
  'textChevron',
  'textChevronInverted',
  'textCircle',
  'textCirclePour',
  'textCurveDown',
  'textCurveUp',
  'textDeflate',
  'textDeflateBottom',
  'textDeflateInflate',
  'textDeflateInflateDeflate',
  'textDeflateTop',
  'textDoubleWave1',
  'textFadeDown',
  'textFadeLeft',
  'textFadeRight',
  'textFadeUp',
  'textInflate',
  'textInflateBottom',
  'textInflateTop',
  'textRingInside',
  'textRingOutside',
  'textSlantDown',
  'textSlantUp',
  'textStop',
  'textTriangle',
  'textTriangleInverted',
  'textWave1',
  'textWave2',
  'textWave4',
] as const;

export type PresetWarpId = (typeof PRESET_WARP_IDS)[number];

export interface PathData {
  commands: Array<
    | { type: 'M' | 'L'; point: Point }
    | { type: 'Q'; control: Point; point: Point }
    | { type: 'C'; control1: Point; control2: Point; point: Point }
    | { type: 'Z' }
  >;
}

export interface WarpSpec {
  kind: 'none' | 'preset' | 'path' | 'mesh' | 'perspective';
  preset?: PresetWarpId;
  adj: [number, number];
  bend: number;
  distortH: number;
  distortV: number;
  path?: PathData;
  mesh?: { cols: number; rows: number; points: number[] };
  corners?: [Point, Point, Point, Point];
  keepUpright: boolean;
}

export interface TextElement extends ElementBase {
  type: 'text';
  text: string;
  font: FontSpec;
  layout: TextLayout;
  warp: WarpSpec;
}

/**
 * Themed sections of the stamp catalogue, in the order the stamp menu shows them.
 *
 * The catalogue is grouped because it is no longer small enough to scan: a flat run of fifty-two
 * icons is a wall, and someone reaching for a pumpkin should not have to read past a cassette to
 * find it. The sections deliberately echo the style rack's category tabs -- a scene built from the
 * Spooky styles wants the Spooky stamps -- without being tied to them, since a cloud belongs beside
 * a speech bubble whatever style ends up on it.
 */
export const STAMP_GROUPS = [
  { id: 'basics', label: 'Basics' },
  { id: 'marks', label: 'Marks' },
  { id: 'nineties', label: '90s' },
  { id: 'spooky', label: 'Spooky' },
  { id: 'cosmic', label: 'Cosmic' },
  { id: 'sweets', label: 'Sweets' },
  { id: 'scene', label: 'Scene' },
] as const;

export type StampGroupId = (typeof STAMP_GROUPS)[number]['id'];

/**
 * The stamp catalogue: decorations that sit beside the word rather than on it.
 *
 * The first four predate the catalogue and keep their meanings. The rest are the shapes a Memphis
 * sheet, a sticker book, a clipart disc or a Halloween window cling from the decade actually
 * printed, chosen so a scene can be built without ever needing to draw geometry by hand.
 *
 * Listed by section, and the section order here is the menu order. A stamp appears in exactly one
 * section, so this doubles as the catalogue's index -- there is no second list to fall out of step
 * with it.
 */
export const STAMP_IDS_BY_GROUP = {
  basics: ['rectangle', 'ellipse', 'triangle', 'arch', 'chevron', 'heart', 'speech', 'banner'],
  marks: ['star', 'starburst', 'sparkle', 'splat', 'zigzag', 'squiggle', 'bolt', 'crown', 'gem', 'diamond', 'plus', 'ring', 'blob', 'gear', 'crosshair'],
  nineties: ['smiley', 'shades', 'bottle', 'cassette', 'floppy', 'boombox', 'pizza', 'daisy', 'peace', 'disc', 'gamepad', 'music-note', 'spiral', 'drips'],
  spooky: ['pumpkin', 'ghost', 'bat', 'skull', 'tombstone', 'web', 'coffin', 'witch-hat', 'spider', 'bone'],
  cosmic: ['rocket', 'planet', 'moon', 'comet', 'saucer', 'satellite'],
  sweets: ['cone', 'donut', 'lolly', 'candy', 'candy-cane', 'cupcake', 'cherry'],
  scene: ['sun', 'palm', 'cloud', 'flame', 'butterfly'],
} as const satisfies Record<StampGroupId, readonly string[]>;

export type StampId = (typeof STAMP_IDS_BY_GROUP)[StampGroupId][number];

export const STAMP_IDS: StampId[] = STAMP_GROUPS.flatMap((group) => STAMP_IDS_BY_GROUP[group.id]);

export interface ShapeElement extends ElementBase {
  type: 'shape';
  shape: StampId;
  width: number;
  height: number;
  /**
   * Detached geometry, or `null` to generate the outline from `shape`.
   *
   * A stamp is a *named generator*, not stored geometry: the renderer asks `shapeOutline` for a
   * path each time it draws. That is what keeps resizing exact -- the outline is rebuilt at the new
   * size rather than scaled from a rounded copy of the old one -- and it is what keeps the
   * catalogue editable, since improving a generator improves every document that used it.
   *
   * This field is the hinge for a future path editor. Setting it detaches the element from its
   * generator: the renderer then draws these commands verbatim and `shape` survives only as a
   * record of where the geometry came from. Both forms live in the same coordinate space, the
   * element-local box from (0, 0) to (`width`, `height`), so nothing downstream -- bounds, warps,
   * the effect stack, hit testing -- needs to know which of the two it is looking at.
   */
  path: PathData | null;
}

export interface ImageElement extends ElementBase {
  type: 'image';
  assetId: string;
  width: number;
  height: number;
}

export interface GroupElement extends ElementBase {
  type: 'group';
  childIds: string[];
}

export type Element = TextElement | ShapeElement | ImageElement | GroupElement;

export interface AssetMeta {
  id: string;
  kind: 'font' | 'image' | 'texture' | 'matcap';
  name: string;
  mime: string;
  sha256: string;
}

export type AssetTable = Record<string, AssetMeta>;

export interface CanvasSpec {
  width: number;
  height: number;
  background: Paint | null;
  autoFit: boolean;
  exportPadding: number;
}

export interface WordWarpDocument {
  version: typeof DOC_VERSION;
  id: string;
  name: string;
  canvas: CanvasSpec;
  elements: Element[];
  assets: AssetTable;
  globalLight: { angle: number; altitude: number };
  meta: { created: string; modified: string; app: string };
}
