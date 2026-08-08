import { createEffect } from '../effects/defaults';
import { createId } from '../lib/id';
import type {
  AnimationTrack,
  BevelEffect,
  BlendMode,
  DropShadowEffect,
  Effect,
  ExtrudeEffect,
  FillEffect,
  InnerGlowEffect,
  InnerShadowEffect,
  LongShadowEffect,
  OuterGlowEffect,
  Paint,
  PostEffect,
  ReflectionEffect,
  Rgba,
  SatinEffect,
  StrokeEffect,
  TextElement,
  TextureOverlayEffect,
  WarpSpec,
} from '../model/types';
import type { Preset } from './types';

const none = (): WarpSpec => ({
  kind: 'none', adj: [0.5, 0.5], bend: 0, distortH: 0, distortV: 0, keepUpright: false,
});

const warp = (preset: NonNullable<WarpSpec['preset']>, bend = 0.78, adjustment = 0.55): WarpSpec => ({
  kind: 'preset', preset, adj: [adjustment, 0.5], bend, distortH: 0, distortV: 0, keepUpright: false,
});

const solid = (hex: string, alpha = 1): Paint => ({ kind: 'solid', color: hexColor(hex, alpha) });
const ramp = (rampId: string): Paint => ({ kind: 'ramp', rampId, angle: 90, variant: 1 });
const matcap = (matcapId: string): Paint => ({ kind: 'matcap', matcapId, rotation: 0, intensity: 1 });
const gradient = (
  colors: string[],
  angle = 90,
  type: 'linear' | 'radial' | 'angular' | 'reflected' | 'diamond' = 'linear',
): Paint => ({
  kind: 'gradient',
  gradient: {
    type,
    stops: colors.map((color, index) => ({ offset: index / (colors.length - 1), color: hexColor(color) })),
    angle,
    center: [0.5, 0.5],
    scale: 1,
    dither: true,
    interpolation: 'oklab',
  },
});

/**
 * A hard-edged repeating stripe fill.
 *
 * Gradient stops alone cannot produce crisp bands: the Canvas2D paint resamples the gradient onto
 * an evenly spaced colour-stop grid, so any transition between two neighbouring stops is smoothed
 * across a cell of that grid. The trick is to place several identical stops per band (each landing
 * on the resampling grid) so a colour holds flat for most of its band and only ramps across the
 * single cell at the boundary. With `samplesPerBand` of 4, a band is three-quarters solid and the
 * transition is a quarter of a band wide, which reads as a clean stripe rather than a wash.
 */
function stripes(
  colors: [string, string],
  angle: number,
  bands: number,
  samplesPerBand = 4,
  type: 'linear' | 'angular' = 'linear',
): Paint {
  const cells = bands * samplesPerBand;
  const first = colors[0];
  const second = colors[1];
  const stops = Array.from({ length: cells + 1 }, (_, cell) => {
    const band = Math.floor(cell / samplesPerBand) % 2;
    return { offset: cell / cells, color: hexColor(band === 0 ? first : second) };
  });
  return {
    kind: 'gradient',
    gradient: { type, stops, angle, center: [0.5, 0.5], scale: 1, dither: true, interpolation: 'srgb' },
  };
}

function fill(paint: Paint): FillEffect {
  const effect = createEffect('fill');
  effect.paint = paint;
  return effect;
}

function stroke(width: number, color: string, position: StrokeEffect['position'] = 'outside'): StrokeEffect {
  const effect = createEffect('stroke');
  effect.width = width;
  effect.paint = solid(color);
  effect.position = position;
  return effect;
}

function bevel(
  size: number,
  style: BevelEffect['style'] = 'inner',
  depth = 130,
  technique: BevelEffect['technique'] = 'smooth',
): BevelEffect {
  const effect = createEffect('bevel');
  effect.size = size;
  effect.style = style;
  effect.depth = depth;
  effect.technique = technique;
  return effect;
}

function chiselBevel(size: number, depth = 130, style: BevelEffect['style'] = 'inner'): BevelEffect {
  const effect = bevel(size, style, depth);
  effect.technique = 'chiselHard';
  return effect;
}

function shadow(color: string, distance = 14, size = 12, opacity = 0.68): DropShadowEffect {
  const effect = createEffect('dropShadow');
  effect.color = hexColor(color);
  effect.distance = distance;
  effect.size = size;
  effect.opacity = opacity;
  return effect;
}

function vhsShadow(color: string, angle: number): DropShadowEffect {
  const effect = shadow(color, 5, 0, 0.9);
  effect.angle = angle;
  effect.useGlobalLight = false;
  return effect;
}

/**
 * One spot-ink plate, laid down out of register.
 *
 * A riso runs each colour through a separate drum, so no two plates ever land in exactly the same
 * place -- and that drift is the whole aesthetic rather than a defect. A hard-edged, unblurred,
 * un-knocked-out drop shadow is exactly a second plate: same stencil, a few pixels off, and set to
 * multiply so the overlap darkens into a third colour the way wet ink over dry ink does.
 */
function inkPlate(color: string, distance: number, angle: number, opacity = 1): DropShadowEffect {
  const effect = createEffect('dropShadow');
  effect.color = hexColor(color);
  effect.distance = distance;
  effect.size = 0;
  effect.spread = 0;
  effect.angle = angle;
  effect.useGlobalLight = false;
  effect.knockout = false;
  effect.blendMode = 'multiply';
  effect.opacity = opacity;
  return effect;
}

/** Uneven ink lay-down. `scale` sets blotch size and is what the inspector's texture slider edits. */
function mottle(scale: number, blendMode: BlendMode, opacity: number): TextureOverlayEffect {
  const effect = texture('mottle', opacity);
  effect.scale = scale;
  effect.blendMode = blendMode;
  return effect;
}

function innerShadow(color: string, distance = 5, size = 9, opacity = 0.55): InnerShadowEffect {
  const effect = createEffect('innerShadow');
  effect.color = hexColor(color);
  effect.distance = distance;
  effect.size = size;
  effect.opacity = opacity;
  return effect;
}

function glow(color: string, size = 24, opacity = 0.8): OuterGlowEffect {
  const effect = createEffect('outerGlow');
  effect.paint = solid(color);
  effect.size = size;
  effect.opacity = opacity;
  return effect;
}

function innerGlow(color: string, size = 12, opacity = 0.6): InnerGlowEffect {
  const effect = createEffect('innerGlow');
  effect.paint = solid(color);
  effect.size = size;
  effect.opacity = opacity;
  return effect;
}

function extrude(depth: number, color: string, angle = 45): ExtrudeEffect {
  const effect = createEffect('extrude');
  effect.depth = depth;
  effect.angle = angle;
  effect.sidePaint = solid(color);
  return effect;
}

function longShadow(length: number, color: string, angle = 45, fade = false): LongShadowEffect {
  const effect = createEffect('longShadow');
  effect.length = length;
  effect.angle = angle;
  effect.paint = solid(color);
  effect.fade = fade;
  return effect;
}

function texture(
  pattern: Extract<TextureOverlayEffect['source'], { type: 'procedural' }>['pattern'],
  opacity = 0.2,
  scale = 1,
  rotation = 0,
): TextureOverlayEffect {
  const effect = createEffect('textureOverlay');
  effect.source = { type: 'procedural', pattern };
  effect.opacity = opacity;
  effect.scale = scale;
  effect.rotation = rotation;
  return effect;
}

/**
 * Contour-line overlay driven by the glyph's own distance field.
 *
 * The pattern paints white lines and leaves the gaps empty, so the blend mode decides what a ring
 * does to whatever is under it: `screen` and `linear-dodge` light them up, while `difference`
 * inverts the ground, which is how the same pattern draws dark rings on a pale fill. `scale` sets
 * ring spacing and is what the inspector's texture slider already edits. Unclipping lets the rings
 * carry on outside the letterform, which is the difference between a hatched glyph and a contour
 * map of a word.
 *
 * `rotation` is left alone deliberately and has no effect here: contours follow the glyph's own
 * distance field, so there is no grid for an angle to turn.
 */
function topography(
  scale: number,
  blendMode: BlendMode,
  opacity: number,
  clipToShape = true,
): TextureOverlayEffect {
  const effect = texture('topography', opacity);
  effect.scale = scale;
  effect.blendMode = blendMode;
  effect.clipToShape = clipToShape;
  return effect;
}

function reflection(height = 0.45, opacity = 0.32): ReflectionEffect {
  const effect = createEffect('reflection');
  effect.height = height;
  effect.opacity = opacity;
  return effect;
}

function satin(color: string, opacity = 0.45): SatinEffect {
  const effect = createEffect('satin');
  effect.color = hexColor(color);
  effect.opacity = opacity;
  return effect;
}

function post(type: PostEffect['type'], params: PostEffect['params'], opacity = 0.65): PostEffect {
  const effect = createEffect('post');
  effect.type = type;
  effect.params = params;
  effect.opacity = opacity;
  return effect;
}

/**
 * Ordered-dither post pass.
 *
 * `levels` is the palette depth per channel, `matrix` the Bayer tile size, `dot` the pitch of one
 * matrix cell in logical pixels, and `hardEdge` decides whether coverage is thresholded with the
 * same matrix -- which is what removes the anti-aliased fringe a genuine one-bit image never had.
 * `dot` has no default here on purpose: the renderer already defines one, and a second default
 * that disagreed with it would silently give a preset author a different pattern than the same
 * parameters produce anywhere else. Opacity stays at 1: blending a dithered layer back over the
 * smooth one it came from would just reintroduce the tones it exists to remove.
 */
function dither(levels: number, matrix: number, dot: number, hardEdge = true): PostEffect {
  return post('dither', { levels, matrix, dot, hardEdge }, 1);
}

/**
 * Prism dispersion: the channels fan out along the radius, widening toward the rim.
 *
 * The default aberration is a fixed horizontal RGB split, which is a signal fault -- the right
 * model for the VHS presets that use it, and the wrong one for glass. Real optics separate
 * wavelengths *radially*, which is why a lens is sharp on axis and fringed at the edge.
 */
function dispersion(amount: number, opacity: number): PostEffect {
  return post('aberration', { amount, mode: 'radial' }, opacity);
}

function pillowBevel(size: number, depth: number, highlight: string): BevelEffect {
  const effect = bevel(size, 'pillow', depth);
  effect.highlight = { color: hexColor(highlight), blendMode: 'screen', opacity: 0.95 };
  effect.useGlobalLight = false;
  effect.angle = 118;
  effect.altitude = 52;
  return effect;
}

/**
 * Resolution reduction. `size` is the block edge in logical pixels; `crisp` rounds each block's
 * coverage in or out, which is what gives a sprite its hard, unantialiased silhouette.
 */
function pixelate(size: number, crisp = true): PostEffect {
  // Opacity stays at 1: blending a blocky layer back over the smooth one it came from would
  // reintroduce exactly the detail the effect exists to throw away.
  return post('pixelate', { size, crisp }, 1);
}

/**
 * One band of a false-colour ramp keyed to depth inside the glyph.
 *
 * An inner glow's mask is a linear falloff from the outline to `size` pixels in, so a stack of
 * them, largest first, paints a colour ramp along the glyph's own distance field: the last one
 * drawn owns the pixels nearest the edge, and each earlier one shows through further in, with the
 * fill left over at the core. That gives a heat map without a heat-map effect -- the ramp follows
 * the letterform rather than a gradient axis, so a thin stem reads cool all the way through and a
 * thick one lights up in the middle, which is what an instrument actually shows.
 *
 * ## Choosing the sizes
 *
 * Depth inside a letter is bounded by half its stem width -- five to ten pixels for normal-weight
 * text at a typical size -- and that is the whole range the ramp has to fit into.
 *
 * What matters is the *narrowest* band. It has to sit comfortably inside half a stem, because it
 * is the one drawn last and it is what makes the rim a rim rather than the whole letter. The
 * widest band is deliberately larger than half a stem: its falloff is correspondingly shallow, so
 * it is still contributing at the stem's centre, which is what keeps the ramp continuous instead
 * of stopping partway in.
 *
 * The failure mode is not a band failing to reach the middle. It is every band being wide relative
 * to the stem, at which point they all overlap at similar strengths everywhere and the ramp
 * collapses into one muddy blend with no zones in it.
 */
function heatBand(color: string, size: number, opacity = 1): InnerGlowEffect {
  const effect = innerGlow(color, size, opacity);
  // Both of these happen to be the inner-glow defaults, and both are stated anyway because the
  // ramp depends on them: `edge` is the direction the falloff runs, and `normal` is what makes a
  // band replace the one under it instead of mixing into it. Neither is a detail a reader should
  // have to go and look up to know whether the stack is doing what it claims.
  effect.source = 'edge';
  effect.blendMode = 'normal';
  return effect;
}

function sparkleTrack(): AnimationTrack {
  return { id: 'sparkle-track', kind: 'sparkle', enabled: true, duration: 2, params: { amount: 16 }, seed: 971 };
}

function definePreset(
  id: string,
  name: string,
  category: Preset['category'],
  preview: string[],
  effects: Effect[],
  presetWarp: WarpSpec = none(),
  tags: string[] = [],
  animations: AnimationTrack[] = [],
): Preset {
  effects.forEach((effect, index) => { effect.id = `${id}-${effect.kind}-${index}`; });
  return {
    id,
    name,
    category,
    preview,
    tags: [category, ...tags],
    animated: animations.length > 0,
    apply: { effects, warp: presetWarp, animations },
  };
}

export const BUILT_IN_PRESETS: Preset[] = [
  definePreset('chrome-classic', 'Chrome Classic', 'metallic', ['#f5f7f7', '#343634', '#efefef', '#636563'], [
    shadow('#0a0c12', 12, 12, 0.62), fill(ramp('chrome')), bevel(8, 'inner', 140), stroke(2, '#1a1a1a'),
  ], none(), ['chrome', 'office', 'metal']),
  definePreset('liquid-chrome', 'Liquid Chrome', 'metallic', ['#f8ffff', '#b7d0e8', '#4a4a52', '#10131c'], [
    shadow('#172134', 10, 18, 0.5), fill(matcap('liquid-mercury')), bevel(16, 'pillow', 180), satin('#d7f0ff', 0.2), innerGlow('#ffffff', 8, 0.55),
  ], none(), ['mercury', 'gloss']),
  definePreset('gold-bar', 'Gold Bar', 'metallic', ['#f3e0ac', '#b6903e', '#7f6625', '#ecdfb3'], [
    shadow('#3b2808', 14, 12), fill(ramp('gold-ii')), bevel(12, 'inner', 160), innerShadow('#4a2d08', 4, 8), stroke(2, '#6b4f18'),
  ], none(), ['gold', 'luxury']),
  definePreset('brass-plaque', 'Brass Plaque', 'metallic', ['#7e5f1c', '#f2aa3c', '#8d6720', '#dca137'], [
    fill(ramp('brass')), bevel(14, 'emboss', 150), texture('noise', 0.12), innerShadow('#3d2507', 5, 7),
  ], none(), ['brass', 'engraved']),
  definePreset('cold-steel', 'Cold Steel', 'metallic', ['#ffffff', '#afb6bc', '#7d8693', '#d1dfde'], [
    fill(ramp('silver')), texture('grain', 0.16), bevel(9, 'inner', 130), stroke(1.5, '#313844'),
  ], none(), ['silver', 'brushed']),
  definePreset('gunmetal', 'Gunmetal', 'metallic', ['#2b2d33', '#5a5f6b', '#c3c8d2', '#111318'], [
    shadow('#050609', 10, 8), fill(gradient(['#c3c8d2', '#3f434c', '#202229'])), bevel(9, 'inner', 150), stroke(2, '#0b0c0e'),
  ], none(), ['dark', 'steel']),
  definePreset('rose-gold', 'Rose Gold', 'metallic', ['#f7d4c4', '#e8a08d', '#b85c47', '#7d3423'], [
    shadow('#5d281d', 9, 14, 0.45), fill(gradient(['#f7d4c4', '#e8a08d', '#7d3423'])), bevel(11), innerGlow('#ffd7c5', 10, 0.45),
  ], none(), ['pink', 'copper']),
  definePreset('holographic-foil', 'Holographic Foil', 'metallic', ['#ff6ec7', '#6ec7ff', '#6effb8', '#fff36e'], [
    fill(gradient(['#ff6ec7', '#6ec7ff', '#6effb8', '#fff36e', '#ff6ec7'], 35, 'angular')), bevel(10), stroke(2, '#ffffff'),
  ], none(), ['iridescent', 'rainbow']),

  definePreset('outrun-sunset', 'Outrun Sunset', 'synthwave', ['#ff00ff', '#ff1493', '#ff7f50', '#ffd700'], [
    shadow('#00e5ff', 12, 5, 0.8), glow('#ff00d4', 28, 0.75), fill(gradient(['#ffd700', '#ff7f50', '#ff1493', '#6b1ad6'])), bevel(7),
  ], warp('textSlantUp', 0.42), ['sunset', 'retro']),
  definePreset('neon-grid', 'Neon Grid', 'synthwave', ['#00ffff', '#ff00ff', '#191970', '#0d0221'], [
    glow('#ff00ff', 38, 0.65), glow('#00ffff', 17, 0.95), fill(solid('#102037', 0.3)), stroke(4, '#00ffff'),
  ], none(), ['neon', 'cyan']),
  definePreset('miami-vice', 'Miami Vice', 'synthwave', ['#40e0d0', '#ff7f50', '#fc8eac', '#98fb98'], [
    glow('#ff8ac6', 16, 0.45), longShadow(72, '#293078', 45), fill(gradient(['#40e0d0', '#ff7f50', '#fc8eac'], 45)), stroke(2, '#ffffff'),
  ], none(), ['pastel', '80s']),
  definePreset('chrome-magenta', 'Chrome & Magenta', 'synthwave', ['#dedfde', '#2a2c29', '#ff0090', '#00e7ff'], [
    shadow('#00e7ff', 12, 5, 0.75), glow('#ff0090', 30, 0.75), fill(ramp('chrome-ii')), bevel(8),
  ], warp('textSlantUp', 0.32), ['chrome', 'pink']),
  definePreset('laser-beam', 'Laser Beam', 'synthwave', ['#39ff14', '#00ffff', '#ffffff', '#071018'], [
    glow('#00ffff', 34, 0.8), fill(solid('#39ff14', 0.28)), stroke(3, '#ffffff'), post('scanlines', { amount: 0.16, period: 4 }, 0.5),
  ], none(), ['laser', 'green']),
  definePreset('vhs-tracking', 'VHS Tracking', 'synthwave', ['#ff0000', '#00ffff', '#ffffff', '#1a1a1a'], [
    fill(solid('#f4f6ff')), post('aberration', { amount: 4 }, 0.85), post('glitch', { amount: 0.25 }, 0.55), post('grain', { amount: 0.12 }, 0.4),
  ], none(), ['vhs', 'glitch']),

  definePreset('aqua-gel', 'Aqua Gel', 'y2k', ['#ffffff', '#7ec8ff', '#0a84ff', '#00417a'], [
    shadow('#00305c', 10, 14, 0.5), fill(gradient(['#ffffff', '#7ec8ff', '#0a84ff', '#00417a'])), innerGlow('#ffffff', 10, 0.55), innerShadow('#00345f', 4, 8), stroke(1.5, '#004b8d'),
  ], none(), ['aqua', 'gel']),
  definePreset('web20-gloss', 'Web 2.0 Gloss', 'y2k', ['#ffffff', '#d0e8ff', '#5aa9e6', '#1b6ca8'], [
    glow('#7ec8ff', 15, 0.4), fill(gradient(['#ffffff', '#d0e8ff', '#5aa9e6', '#1b6ca8'])), innerGlow('#ffffff', 13, 0.6), reflection(),
  ], none(), ['gloss', 'web']),
  definePreset('bubble-inflate', 'Bubble Inflate', 'y2k', ['#ff9ec7', '#ff5fa2', '#d61f69', '#ffffff'], [
    shadow('#8f174c', 8, 12, 0.45), fill(gradient(['#ffffff', '#ff9ec7', '#d61f69'])), bevel(24, 'pillow', 190), innerGlow('#ffffff', 12, 0.65),
  ], warp('textInflate', 0.88, 0.7), ['bubble', 'pink']),
  definePreset('carbon-fibre', 'Carbon Fibre', 'y2k', ['#1c1c1e', '#3a3a3c', '#777b83', '#09090a'], [
    fill(gradient(['#666970', '#1c1c1e', '#09090a'])), texture('weave', 0.38), bevel(8, 'inner', 170), stroke(1.5, '#050506'),
  ], none(), ['carbon', 'dark']),
  definePreset('glitter-text', 'Glitter Text', 'y2k', ['#ff69b4', '#ffd700', '#ffffff', '#b437ff'], [
    glow('#ff69d4', 18, 0.55), fill(gradient(['#ff69b4', '#ffd700', '#ffffff', '#b437ff'], 25)), texture('grain', 0.45),
  ], none(), ['glitter', 'animated'], [sparkleTrack()]),

  definePreset('wordart-classic', 'WordArt Classic', 'nineties', ['#ff0000', '#ffff00', '#00c853', '#3d3dff'], [
    extrude(28, '#274087', 320), fill(ramp('rainbow')), stroke(2, '#17214f'),
  ], warp('textSlantUp', 0.55), ['office', 'rainbow']),
  definePreset('memphis-party', 'Memphis Party', 'nineties', ['#ffd93d', '#ff6b6b', '#4ecdc4', '#1a1a2e'], [
    shadow('#1a1a2e', 12, 0.5, 0.9), fill(solid('#ffd93d')), stroke(7, '#1a1a2e'),
  ], warp('textWave1', 0.28), ['memphis', 'party']),
  definePreset('nickelodeon-splat', 'Nickelodeon Splat', 'nineties', ['#f57d0d', '#ffffff', '#652600', '#ffb04b'], [
    shadow('#6e2500', 8, 4), fill(solid('#f57d0d')), stroke(5, '#ffffff'),
  ], warp('textArchUp', 0.72), ['orange', 'splat']),
  definePreset('extreme-sports', 'Extreme Sports', 'nineties', ['#000000', '#ff3b00', '#ffffff', '#4b4b4b'], [
    shadow('#000000', 13, 2, 0.9), fill(gradient(['#ffffff', '#ff3b00', '#760d00'])), bevel(8, 'inner', 180), texture('grain', 0.2),
  ], warp('textSlantUp', 0.72), ['sport', 'grunge']),
  definePreset('lisa-frank', 'Lisa Frank', 'nineties', ['#ff6ec7', '#a06eff', '#6ec7ff', '#fff36e'], [
    glow('#ff6ec7', 22, 0.7), fill(gradient(['#ff6ec7', '#a06eff', '#6ec7ff', '#6effb8', '#fff36e'], 40)), stroke(4, '#ffffff'), texture('grain', 0.22),
  ], warp('textWave2', 0.35), ['rainbow', 'sparkle']),
  definePreset('graffiti-wildstyle', 'Graffiti Wildstyle', 'nineties', ['#00d4ff', '#ff00a0', '#ffe600', '#000000'], [
    shadow('#000000', 11, 2, 0.9), fill(gradient(['#ffe600', '#ff00a0', '#00d4ff'], 35)), stroke(8, '#000000'), stroke(2, '#ffffff'),
  ], warp('textWave4', 0.38), ['graffiti', 'wildstyle']),

  definePreset('deep-extrude', 'Deep Extrude', 'dimensional', ['#ff4757', '#992637', '#3c111b', '#ffffff'], [
    shadow('#19070b', 18, 14, 0.55), extrude(72, '#8f2332', 42), fill(gradient(['#ff8a95', '#ff4757', '#a91f31'])), stroke(2, '#6d1724'),
  ], none(), ['3d', 'deep']),
  definePreset('isometric-block', 'Isometric Block', 'dimensional', ['#5352ed', '#3742a0', '#2f3542', '#a4a3ff'], [
    extrude(58, '#3742a0', 30), fill(solid('#5352ed')), stroke(2, '#242861'),
  ], none(), ['isometric', 'block']),
  definePreset('long-shadow-flat', 'Long Shadow Flat', 'dimensional', ['#ff6348', '#c83f31', '#ffe8df', '#25233b'], [
    longShadow(150, '#25233b', 45, true), fill(solid('#ff6348')),
  ], none(), ['flat', 'shadow']),
  definePreset('letterpress', 'Letterpress', 'dimensional', ['#efe7d8', '#3a3226', '#b6aa97', '#ffffff'], [
    fill(solid('#d8cdbc')), innerShadow('#3a3226', 3, 7, 0.58), innerGlow('#ffffff', 5, 0.45),
  ], none(), ['paper', 'emboss']),
  definePreset('inflated-balloon', 'Inflated Balloon', 'dimensional', ['#ff4d6d', '#ffffff', '#a91039', '#ffb1c0'], [
    shadow('#8a0f31', 10, 16, 0.5), fill(gradient(['#ffffff', '#ff9aad', '#ff4d6d', '#a91039'])), bevel(30, 'pillow', 220), innerGlow('#ffffff', 14, 0.7),
  ], warp('textInflate', 0.94, 0.8), ['balloon', 'pillow']),
  definePreset('frosted-glass', 'Frosted Glass', 'dimensional', ['#eafdff', '#bfe9ff', '#9fd4ff', '#ffffff'], [
    shadow('#1b3a55', 12, 18, 0.28), glow('#bfe9ff', 26, 0.4),
    Object.assign(fill(gradient(['#eafdff', '#bfe9ff', '#9fd4ff', '#dff7ff'])), { opacity: 0.5 }),
    innerGlow('#ffffff', 14, 0.55),
    Object.assign(bevel(6, 'inner', 90), {
      highlight: { color: [1, 1, 1, 1], blendMode: 'screen', opacity: 0.5 },
      shadow: { color: [0.5, 0.65, 0.8, 1], blendMode: 'multiply', opacity: 0.35 },
    }),
    texture('grain', 0.08),
    Object.assign(stroke(1.5, '#ffffff'), { opacity: 0.6 }),
    reflection(0.35, 0.2),
  ], none(), ['glass', 'glassmorphism', 'modern']),
  definePreset('clay', 'Clay', 'dimensional', ['#f6cdbd', '#e0a18b', '#b86a52', '#4a1f12'], [
    shadow('#4a1f12', 7, 16, 0.4),
    fill(gradient(['#f6cdbd', '#e0a18b', '#b86a52'])),
    Object.assign(bevel(28, 'pillow', 150), {
      technique: 'smooth',
      highlight: { color: [1, 0.97, 0.93, 1], blendMode: 'screen', opacity: 0.28 },
      shadow: { color: [0.32, 0.2, 0.16, 1], blendMode: 'multiply', opacity: 0.42 },
    }),
    innerShadow('#7a3522', 4, 10, 0.3),
    texture('grain', 0.05),
  ], warp('textInflate', 0.5, 0.55), ['clay', 'plasticine', 'matte']),
  definePreset('stained-glass', 'Stained Glass', 'dimensional', ['#c01a4a', '#1a6cc0', '#1ac089', '#0a0a0a'], [
    shadow('#000000', 9, 6, 0.55),
    fill(gradient(['#c01a4a', '#1a6cc0', '#1ac089', '#e0a312'], 45)),
    bevel(5, 'emboss', 110),
    innerGlow('#ffd97a', 7, 0.3),
    stroke(7, '#0a0a0a'),
  ], warp('textArchUp', 0.5), ['stained-glass', 'lead', 'tiffany']),
  definePreset('topographic-taffy', 'Topographic Taffy', 'dimensional', ['#fff4cf', '#d9ed92', '#65c6a6', '#2d8b8c', '#f2b84b', '#e85d4f'], [
    shadow('#0e1d2d', 10, 8, 0.52),
    extrude(18, '#173d4a', 48),
    fill(solid('#fff4cf')),
    texture('grain', 0.12),
    stroke(15, '#d9ed92', 'inside'),
    stroke(12, '#65c6a6', 'inside'),
    stroke(9, '#2d8b8c', 'inside'),
    stroke(6, '#f2b84b', 'inside'),
    stroke(3, '#e85d4f', 'inside'),
    stroke(2, '#182936'),
  ], warp('textCanUp', 0.36, 0.55), ['topographic', 'contour', 'map', 'strata', 'taffy', 'paper-cut', 'cartography']),

  definePreset('vaporwave-mall', 'Vaporwave Mall', 'synthwave', ['#ff71ce', '#01cdfe', '#fffb96', '#2d1b4e'], [
    glow('#ff71ce', 26, 0.6), fill(gradient(['#ff71ce', '#b967ff', '#01cdfe'], 100)), post('scanlines', { amount: 0.14, period: 4 }, 0.5), post('aberration', { amount: 2 }, 0.4),
  ], warp('textArchUp', 0.5), ['vaporwave', 'aesthetic']),
  definePreset('acid-chrome', 'Acid Chrome', 'synthwave', ['#e8ffe8', '#39ff14', '#0d3b0d', '#00e5ff'], [
    shadow('#071408', 10, 8, 0.6), fill(ramp('chrome-ii')), post('aberration', { amount: 3 }, 0.6), post('glitch', { amount: 0.2 }, 0.4),
  ], warp('textInflate', 0.5, 0.6), ['acid', 'rave']),
  definePreset('vhs-title-card', 'VHS Title Card', 'synthwave', ['#ffffff', '#00e5ff', '#ff00a0', '#1a1a2e'], [
    vhsShadow('#00e5ff', 90), vhsShadow('#ff00a0', 270), fill(solid('#f4f6ff')), stroke(1, '#0b0c12'),
  ], warp('textSlantUp', 0.3), ['vhs', 'title']),
  definePreset('arcade-cabinet', 'Arcade Cabinet', 'synthwave', ['#ff00a0', '#ffffff', '#ffe600', '#14061f'], [
    glow('#ff00a0', 30, 0.75), fill(gradient(['#ffe600', '#ff5e00', '#ff00a0'], 100)), stroke(6, '#ff00a0'), stroke(2, '#ffffff'),
  ], warp('textWave1', 0.22), ['arcade', 'neon']),
  definePreset('aurora-borealis', 'Aurora Borealis', 'synthwave', ['#39ffb8', '#1a9d6e', '#6ec7ff', '#a06eff'], [
    glow('#39ffb8', 32, 0.5), glow('#a06eff', 20, 0.38),
    fill(gradient(['#0d6b4f', '#39ffb8', '#5cf2d8', '#6ec7ff', '#a06eff'], 90)),
    innerGlow('#cfffe8', 9, 0.5), satin('#6ec7ff', 0.35), stroke(1, '#0a3d2e'),
  ], warp('textWave1', 0.32), ['aurora', 'nature', 'northern-lights'],
  [{ id: 'aurora-undulate', kind: 'waveUndulate', enabled: true, duration: 6, params: {}, seed: 2024 }]),

  definePreset('sticker-bomb', 'Sticker Bomb', 'nineties', ['#ffdd00', '#ffffff', '#1a1a2e', '#ff4757'], [
    shadow('#1a1a2e', 9, 0, 1), fill(gradient(['#ffdd00', '#ff4757'], 120)), stroke(9, '#ffffff'), stroke(2, '#1a1a2e'),
  ], warp('textWave2', 0.24), ['sticker', 'bold']),
  definePreset('caution-tape', 'Caution Tape', 'nineties', ['#ffd400', '#111111', '#fff3b0', '#5c4a00'], [
    shadow('#000000', 8, 3, 0.75), fill(gradient(['#ffd400', '#ffd400', '#111111', '#ffd400'], 45)), bevel(6, 'inner', 160), stroke(2, '#111111'),
  ], warp('textSlantUp', 0.45), ['caution', 'hazard']),
  definePreset('pop-art', 'Pop Art', 'nineties', ['#ffd400', '#e0241c', '#000000', '#ffffff'], [
    shadow('#000000', 9, 1, 0.95), fill(solid('#ffd400')), texture('halftone', 0.3), stroke(6, '#000000'),
  ], warp('textArchUp', 0.32), ['comic', 'pop-art', 'halftone']),

  definePreset('jelly', 'Jelly', 'y2k', ['#ff8ac6', '#ffffff', '#c2185b', '#ffd9ec'], [
    shadow('#a1164f', 8, 12, 0.4), fill(solid('#ff8ac6', 0.72)), bevel(22, 'pillow', 200), innerGlow('#ffffff', 16, 0.8),
  ], warp('textInflate', 0.8, 0.65), ['jelly', 'squish']),
  definePreset('disco-fever', 'Disco Fever', 'y2k', ['#ff6ec7', '#6ec7ff', '#fff36e', '#6effb8'], [
    glow('#ffffff', 20, 0.5), fill(gradient(['#ff6ec7', '#6ec7ff', '#6effb8', '#fff36e'], 45)), bevel(10), stroke(2, '#ffffff'),
  ], none(), ['disco', 'animated'], [{ id: 'disco-hue', kind: 'hueCycle', enabled: true, duration: 4, params: {}, seed: 77 }]),

  definePreset('deep-fried', 'Deep Fried', 'texture', ['#ff5e00', '#ffe600', '#ff0000', '#3d0c02'], [
    shadow('#2b0a02', 10, 6, 0.7), fill(gradient(['#ffe600', '#ff5e00', '#ff0000'], 100)), post('grain', { amount: 0.3 }, 0.7), post('halftone', { frequency: 7 }, 0.35),
  ], warp('textWave4', 0.3), ['fried', 'meme']),
  definePreset('blueprint', 'Blueprint', 'texture', ['#123a6d', '#ffffff', '#0a2242', '#3d6fa8'], [
    fill(solid('#123a6d')), stroke(1.5, '#ffffff'), post('scanlines', { amount: 0.1, period: 6 }, 0.35),
  ], none(), ['blueprint', 'technical']),
  definePreset('rusty-sign', 'Rusty Sign', 'texture', ['#8a4b1f', '#d9813a', '#3d1f08', '#c9a227'], [
    fill(ramp('mahogany')), texture('noise', 0.3), bevel(9, 'inner', 150), innerShadow('#2e1504', 6, 10, 0.6),
  ], warp('textDeflate', 0.4), ['rust', 'vintage']),

  definePreset('bitmap-ink', 'Bitmap Ink', 'texture', ['#ffffff', '#b9bec7', '#4c515c', '#0a0c11'], [
    // Everything ahead of the dither exists to hand it a smooth tonal range to chew on: a
    // full-length value ramp, a hard chisel that shades the stems, and an offset shadow. The
    // dither then has to fake all of it out of two levels, which is where the pattern lives. The
    // hard black keyline is what keeps the letterform readable once the interior turns to stipple.
    shadow('#000000', 10, 16, 0.95), fill(gradient(['#ffffff', '#a4aab4', '#1b1f27'], 168)),
    chiselBevel(15, 320), stroke(3, '#05070b'), dither(2, 8, 2),
  ], none(), ['dither', 'one-bit', 'bitmap', 'mono']),
  definePreset('ditherpunk', 'Ditherpunk', 'texture', ['#08f7fe', '#ff2fd0', '#2b1a6b', '#05010f'], [
    glow('#00e5ff', 26, 0.85), fill(gradient(['#ffffff', '#ff2fd0', '#5b1e9e'], 160)),
    bevel(16, 'pillow', 200), stroke(2.5, '#06121f'), dither(2, 4, 2),
  ], warp('textSlantUp', 0.3), ['dither', 'one-bit', 'cyberpunk', 'duotone']),
  definePreset('dot-matrix', 'Dot Matrix', 'texture', ['#cfe36b', '#9bbc0f', '#306230', '#0f380f'], [
    fill(gradient(['#cfe36b', '#9bbc0f', '#306230'], 172)), bevel(12, 'inner', 170),
    stroke(3, '#0f380f'), dither(3, 4, 3), post('scanlines', { amount: 0.4, period: 3 }, 0.6),
  ], none(), ['dither', 'lcd', 'handheld', 'retro']),
  definePreset('topo-survey', 'Topo Survey', 'texture', ['#c8f5b0', '#1d5c46', '#0b241d', '#e9f7cf'], [
    // Unclipped, so the rings keep going past the letters and the word reads as an island. The
    // wide soft shadow is what the outer rings sit on: contours are drawn in white, so without a
    // dark ground behind them the ring field would disappear on a pale page.
    shadow('#04140f', 0, 34, 0.8), fill(gradient(['#1d5c46', '#123a2f', '#0b241d'], 168)),
    topography(1, 'screen', 0.85, false), innerGlow('#9de8a8', 14, 0.28), stroke(2, '#c8f5b0'),
  ], none(), ['topographic', 'map', 'contour', 'cartography']),
  definePreset('sonar-ping', 'Sonar Ping', 'texture', ['#5ffbf1', '#0a3a5c', '#03121f', '#b6fff9'], [
    shadow('#01080f', 0, 30, 0.8), glow('#12d6ff', 16, 0.5),
    fill(gradient(['#0d4a6e', '#062a44', '#03121f'], 168)),
    topography(0.75, 'linear-dodge', 0.8, false), stroke(1.5, '#5ffbf1'),
  ], none(), ['topographic', 'sonar', 'radar', 'depth']),
  definePreset('strata', 'Strata', 'texture', ['#f0b978', '#a8511f', '#5a2410', '#1f0c04'], [
    // Clipped instead, and tight: the rings stop being a map and start reading as cut layers, the
    // way a laser-cut terrain model steps down. Contours are white, so the fill has to stay dark
    // enough for them to register -- a pale sandstone would swallow every line.
    shadow('#150803', 12, 14, 0.65), fill(gradient(['#f0b978', '#a8511f', '#3a1608'], 168)),
    bevel(13, 'inner', 200), topography(0.9, 'screen', 0.7), innerShadow('#251004', 5, 9, 0.55),
    stroke(2, '#1f0c04'),
  ], none(), ['topographic', 'strata', 'layered', 'terrain']),
  definePreset('riso-duotone', 'Riso Duotone', 'texture', ['#ff48b0', '#0f6fd0', '#3a1a6e', '#ffe9f4'], [
    // Fluoro pink over blue is the canonical riso pairing. The face is held just under full
    // opacity so the blue plate reads through it as a cast rather than being covered outright --
    // ink is not paint, it does not hide what is under it.
    inkPlate('#0f6fd0', 7, 205), fill(solid('#ff48b0', 0.86)), mottle(1, 'screen', 0.42),
    texture('grain', 0.16),
  ], none(), ['riso', 'duotone', 'print', 'zine']),
  definePreset('overprint', 'Overprint', 'texture', ['#ffd400', '#ff48b0', '#0f6fd0', '#2a1240'], [
    // Three drums, three registrations, one word. Every pair of plates multiplies into a fourth
    // and fifth colour that appears nowhere in the palette -- which is the trick riso printers
    // use to get six colours out of three inks.
    inkPlate('#0f6fd0', 8, 195), inkPlate('#ffd400', 8, 15), fill(solid('#ff48b0', 0.72)),
    mottle(0.8, 'screen', 0.36), texture('grain', 0.18),
  ], none(), ['riso', 'overprint', 'print', 'cmyk']),
  definePreset('wash-ink', 'Wash Ink', 'texture', ['#f2f7ff', '#4a86c8', '#123a63', '#04101f'], [
    // Same mottle turned up and pushed toward the edges: pigment pooling at the rim of a brush
    // stroke while the middle dries thin.
    shadow('#03101d', 8, 12, 0.5), fill(gradient(['#eaf4ff', '#5f9ad6', '#123a63'], 168)),
    mottle(1.7, 'overlay', 0.9), innerGlow('#0b2a4a', 16, 0.45), texture('grain', 0.12),
  ], none(), ['ink', 'watercolour', 'wash', 'organic']),
  definePreset('liquid-glass', 'Liquid Glass', 'dimensional', ['#ffffff', '#cfe6f7', '#5f7d94', '#101922'], [
    // A glass letter is almost entirely edge. The body is barely tinted, and everything that makes
    // it read as a solid object -- the swollen surface, the rim light, the bright edge -- lives in
    // the first few pixels inside the outline. The dispersion at the end is the only part that
    // says "this is refracting" rather than "this is shiny".
    shadow('#08121c', 16, 26, 0.42), fill(solid('#dbecf8', 0.62)), pillowBevel(26, 300, '#ffffff'),
    innerGlow('#ffffff', 9, 0.85), satin('#9fd4ff', 0.3), stroke(1.5, '#ffffff'),
    dispersion(3, 0.55),
  ], none(), ['glass', 'translucent', 'liquid', 'refraction']),
  definePreset('prism-glass', 'Prism Glass', 'dimensional', ['#ff7ae0', '#7affd8', '#7ab8ff', '#0b0f1c'], [
    // Same construction, dispersion pushed until the fringe becomes the subject. The iridescent
    // rim gives the split something saturated to fan out.
    shadow('#05070f', 12, 24, 0.5),
    glow('#8affe0', 22, 0.4), fill(solid('#e8f4ff', 0.58)), pillowBevel(24, 320, '#ffffff'),
    innerGlow('#ffd7f5', 12, 0.7), stroke(2, '#ffffff'), dispersion(9, 0.9),
  ], none(), ['glass', 'prism', 'iridescent', 'dispersion']),
  definePreset('frosted-ice', 'Frosted Ice', 'dimensional', ['#eaf7ff', '#a7d8f0', '#4d7f9e', '#0d1c26'], [
    // Frost is glass that scatters instead of transmitting, so the body carries more tint and a
    // fine noise, and the dispersion drops to the barest fringe.
    shadow('#061019', 14, 22, 0.45), fill(gradient(['#f4fbff', '#b9e2f5', '#6ba3c4'], 168)),
    pillowBevel(22, 260, '#ffffff'), texture('noise', 0.22), innerGlow('#ffffff', 14, 0.6),
    stroke(1.5, '#e6f6ff'), dispersion(2, 0.35),
  ], none(), ['glass', 'ice', 'frost', 'winter']),
  definePreset('pixel-arcade', 'Pixel Arcade', 'nineties', ['#ffe14d', '#ff5e00', '#d81159', '#1b0f2b'], [
    // The stack ahead of the block pass is deliberately ordinary -- a ramp, an outline, a hard
    // offset shadow. Quantising the whole finished thing at once is what makes it read as a
    // sprite rather than as a smooth letter with a mosaic filter on top.
    shadow('#1b0f2b', 10, 0, 1), fill(gradient(['#ffe14d', '#ff8a00', '#d81159'], 168)),
    stroke(5, '#1b0f2b'), pixelate(6), post('scanlines', { amount: 0.3, period: 3 }, 0.45),
  ], none(), ['pixel', '8-bit', 'sprite', 'arcade']),
  definePreset('bitcrush', 'Bitcrush', 'nineties', ['#00ffc8', '#7a5cff', '#ff2bd6', '#05030f'], [
    glow('#7a5cff', 26, 0.7), fill(gradient(['#00ffc8', '#3ea7ff', '#ff2bd6'], 140)),
    bevel(14, 'inner', 200), stroke(3, '#120a2b'), pixelate(8),
  ], warp('textSlantUp', 0.28), ['pixel', 'lo-fi', 'mosaic', 'glitch']),
  definePreset('pixel-chrome', 'Pixel Chrome', 'nineties', ['#efefef', '#8c8e8c', '#2a2c29', '#0b0d12'], [
    // Chrome is the library's signature look and it is built entirely out of smooth tonal
    // transitions, so putting it through the block pass is the sharpest demonstration of what the
    // effect does: the ramp survives as a stepped palette instead of a gradient.
    shadow('#05070c', 9, 6, 0.8), fill(ramp('chrome')), bevel(9, 'inner', 150),
    stroke(3, '#0b0d12'), pixelate(6),
  ], none(), ['pixel', 'chrome', 'demoscene', 'retro']),
  definePreset('cross-polar-crystal', 'Cross-Polar Crystal', 'texture', ['#ff4f9a', '#ffd76a', '#5ff2cf', '#6a63ff'], [
    shadow('#090713', 12, 8, 0.58),
    glow('#7868ff', 12, 0.24),
    extrude(14, '#17152f', 52),
    fill(gradient(['#171126', '#ff4f9a', '#ffd76a', '#5ff2cf', '#4676ff', '#bd4bff', '#171126'], 28, 'angular')),
    texture('crystal', 0.86, 1.05, 11),
    innerShadow('#090713', 3, 4, 0.48),
    bevel(6, 'inner', 170, 'chiselHard'),
    stroke(2, '#080711'),
    post('grain', { amount: 0.07 }, 0.22),
  ], warp('textStop', 0.32, 0.52), ['crystal', 'mineral', 'petrographic', 'microscope', 'birefringent', 'interference', 'thin-section']),
  definePreset('satin-stitch-sampler', 'Satin Stitch Sampler', 'texture', ['#65132f', '#ed4165', '#ffd2a1', '#173e46'], [
    shadow('#2a1022', 7, 8, 0.48),
    fill(gradient(['#65132f', '#ed4165', '#ffd2a1', '#ed4165', '#65132f'], 108)),
    texture('stitch', 0.72, 0.82, -18),
    satin('#ffd6a3', 0.16),
    bevel(10, 'pillow', 145),
    innerGlow('#ffe4bb', 4, 0.32),
    stroke(8, '#173e46'),
    stroke(3, '#f2c66d'),
  ], warp('textCurveDown', 0.14, 0.42), ['embroidery', 'satin-stitch', 'thread', 'fiber', 'needlework', 'sampler', 'textile', 'handmade']),
  definePreset('candy-cane', 'Candy Cane', 'sweets', ['#ff2e4d', '#ffffff', '#ff9db0', '#b31236'], [
    shadow('#7a1028', 8, 7, 0.45), fill(stripes(['#ff2e4d', '#ffffff'], 45, 9)), bevel(7, 'inner', 150),
    innerGlow('#ffffff', 9, 0.55),
  ], warp('textArchUp', 0.38), ['candy', 'stripes', 'christmas']),
  definePreset('cotton-candy', 'Cotton Candy', 'sweets', ['#ffd1ec', '#ff9ec7', '#b8a8ff', '#ffffff'], [
    glow('#ff9ec7', 18, 0.4), shadow('#d98ab5', 8, 10, 0.35), fill(gradient(['#ffd1ec', '#ff9ec7', '#b8a8ff'])),
    texture('grain', 0.42), innerGlow('#ffffff', 10, 0.5),
  ], warp('textInflate', 0.6, 0.7), ['candy', 'pastel', 'fluffy']),
  definePreset('gumdrop', 'Gumdrop', 'sweets', ['#ff5fa2', '#c2185b', '#ffffff', '#ff9ec7'], [
    shadow('#8f174c', 8, 10, 0.45), fill(gradient(['#ffffff', '#ff9ec7', '#d61f69'], 0, 'radial')),
    bevel(20, 'pillow', 210), innerGlow('#ffffff', 13, 0.75), satin('#ffffff', 0.3),
  ], warp('textInflate', 0.72, 0.7), ['candy', 'jelly', 'gloss']),
  definePreset('bubblegum-blow', 'Bubblegum Blow', 'sweets', ['#ff4fa0', '#ff9ec7', '#ffffff', '#c2185b'], [
    shadow('#8f174c', 6, 8, 0.4), fill(gradient(['#ffffff', '#ff8fc0', '#ff2e88'])), bevel(22, 'pillow', 220),
    innerGlow('#ffffff', 16, 0.85), texture('halftone', 0.18),
  ], warp('textInflate', 0.9, 0.75), ['candy', 'bubble', 'animated'], [
    { id: 'bubblegum-pulse', kind: 'pulse', enabled: true, duration: 1.6, params: { amount: 0.07 }, seed: 11 },
  ]),
  definePreset('lollipop', 'Lollipop', 'sweets', ['#ff2e63', '#ffe600', '#39ff14', '#00e5ff'], [
    shadow('#5c0f2e', 7, 8, 0.45), fill(gradient(['#ff2e63', '#ff9f1c', '#ffe600', '#39ff14', '#00e5ff', '#a84dff'], 0, 'angular')),
    bevel(8, 'inner', 170), innerGlow('#ffffff', 9, 0.65), stroke(2, '#ffffff'),
  ], warp('textCircle', 1.1, 0.6), ['candy', 'rainbow', 'swirl', 'animated'], [
    { id: 'lollipop-hue', kind: 'hueCycle', enabled: true, duration: 4, params: {}, seed: 77 },
  ]),
  definePreset('licorice', 'Licorice Twist', 'sweets', ['#1a1a1c', '#000000', '#8a1538', '#3a0d14'], [
    shadow('#000000', 6, 5, 0.5), fill(gradient(['#2a2a2e', '#000000'])), chiselBevel(8, 160),
    satin('#8a1538', 0.45), stroke(1, '#3a3a40'),
  ], warp('textWave4', 0.5, 0.55), ['candy', 'black', 'twist']),
  definePreset('chocolate-bar', 'Chocolate Bar', 'sweets', ['#7a4a22', '#4a2410', '#c78b4a', '#241004'], [
    shadow('#180a03', 10, 8, 0.55), fill(gradient(['#b06b2e', '#6b3a16', '#3a1d08'])), texture('weave', 0.4),
    bevel(7, 'inner', 180), innerShadow('#241004', 4, 6, 0.5), satin('#ffd9a0', 0.22),
  ], warp('textDeflate', 0.3), ['chocolate', 'dessert', 'squares']),
  definePreset('peppermint', 'Peppermint', 'sweets', ['#ffffff', '#ff2e4d', '#ffb3c0', '#b31236'], [
    shadow('#7a1028', 7, 7, 0.4), fill(stripes(['#ffffff', '#ff2e4d'], 0, 10, 4, 'angular')), bevel(7, 'inner', 150),
    innerGlow('#ffffff', 8, 0.5),
  ], none(), ['candy', 'mint', 'holiday']),
  definePreset('blood-drip', 'Blood Drip', 'spooky', ['#8a0a12', '#d31c2e', '#4a0508', '#5c0508'], [
    shadow('#2b0406', 6, 4, 0.75), fill(gradient(['#d31c2e', '#8a0a12', '#4a0508'])), bevel(8, 'pillow', 170),
    innerGlow('#8a0a12', 10, 0.5), post('aberration', { amount: 2 }, 0.35),
  ], warp('textCanDown', 0.42), ['blood', 'drip', 'halloween']),
  definePreset('ghost', 'Ghost', 'spooky', ['#eaf0ff', '#b9c8ff', '#ffffff', '#5c6aa8'], [
    glow('#aab8ff', 22, 0.55), shadow('#3a4268', 8, 8, 0.3), fill(solid('#eaf0ff', 0.72)), satin('#7d8fd4', 0.5),
    stroke(1.5, '#ffffff'),
  ], warp('textWave1', 0.5, 0.6), ['ghost', 'spectral'], [
    { id: 'ghost-flicker', kind: 'neonFlicker', enabled: true, duration: 1.6, params: {}, seed: 13 },
  ]),
  definePreset('gravestone', 'Gravestone', 'spooky', ['#8f96a3', '#5a606b', '#3a3f47', '#2e7d32'], [
    shadow('#15171b', 10, 6, 0.6), fill(gradient(['#aab0bc', '#6e747e', '#454a52'])), texture('noise', 0.3),
    bevel(9, 'emboss', 150), innerShadow('#1c1f24', 5, 8, 0.6), satin('#3a7d3f', 0.2),
  ], warp('textArchUp', 0.5), ['stone', 'grave', 'moss']),
  definePreset('toxic-slime', 'Toxic Slime', 'spooky', ['#39ff14', '#0d5c0a', '#b6ff9c', '#1a1a1a'], [
    glow('#39ff14', 26, 0.6), shadow('#0a2e08', 6, 6, 0.5), fill(gradient(['#b6ff9c', '#39ff14', '#0d5c0a'])),
    bevel(14, 'pillow', 190), innerGlow('#d6ffc8', 12, 0.7), post('aberration', { amount: 2 }, 0.4),
  ], warp('textInflate', 0.85, 0.7), ['slime', 'toxic', 'glow']),
  definePreset('pumpkin-carve', 'Pumpkin Carve', 'spooky', ['#ff8c1a', '#e05a00', '#ffd9a0', '#5c2400'], [
    glow('#ff9d2e', 20, 0.55), shadow('#3a1700', 8, 8, 0.55), fill(gradient(['#ffb35c', '#ff8c1a', '#d45700'])),
    chiselBevel(8, 170), innerShadow('#4a1c00', 6, 10, 0.6), innerGlow('#ffd9a0', 8, 0.5),
  ], warp('textArchDown', 0.42), ['pumpkin', 'jack', 'carve']),
  definePreset('vampire', 'Vampire', 'spooky', ['#1a0508', '#4a0a12', '#8a1538', '#000000'], [
    glow('#8a1538', 16, 0.4), shadow('#000000', 8, 6, 0.7), fill(gradient(['#3a0d14', '#1a0508', '#000000'])),
    satin('#8a1538', 0.55), chiselBevel(7, 180), innerShadow('#000000', 4, 6, 0.6),
  ], warp('textSlantUp', 0.3), ['vampire', 'dark', 'fang']),
  definePreset('witchcraft', 'Witchcraft', 'spooky', ['#6a2eff', '#a84dff', '#1a0533', '#e5d9ff'], [
    glow('#a84dff', 26, 0.6), shadow('#12021f', 8, 8, 0.6), fill(gradient(['#a84dff', '#5a1fd6', '#1a0533'], 35)),
    satin('#e5d9ff', 0.4), post('glitch', { amount: 0.18 }, 0.4),
  ], warp('textDoubleWave1', 0.5, 0.6), ['witch', 'magic', 'coven'], [
    { id: 'witch-flicker', kind: 'neonFlicker', enabled: true, duration: 1.3, params: {}, seed: 42 },
  ]),
  definePreset('zombie', 'Zombie', 'spooky', ['#7a8f4a', '#4a5c28', '#1e2610', '#2b3a14'], [
    shadow('#0f1408', 8, 6, 0.65), fill(gradient(['#9caf66', '#6b8238', '#39441c'])), texture('grain', 0.35),
    innerShadow('#141a08', 5, 8, 0.6), post('grain', { amount: 0.16 }, 0.4),
  ], warp('textDeflate', 0.5), ['zombie', 'rotten', 'undead']),
  definePreset('aurora', 'Aurora', 'cosmic', ['#39ff88', '#7dffd6', '#6a4dff', '#0d1b2a'], [
    glow('#39ff88', 24, 0.5), shadow('#07130d', 8, 8, 0.5), fill(gradient(['#7dffd6', '#39ff88', '#1b6a4d', '#6a4dff'])),
    satin('#b3ffd6', 0.35), innerGlow('#d6fff0', 10, 0.5),
  ], warp('textWave1', 0.55, 0.6), ['aurora', 'space', 'northern']),
  definePreset('nebula', 'Nebula', 'cosmic', ['#ff6ec7', '#a84dff', '#3d1a6a', '#0a0a1f'], [
    glow('#a84dff', 30, 0.6), shadow('#0a0614', 10, 8, 0.6), fill(gradient(['#ff9ec7', '#c86bff', '#5a1fd6', '#1a0533'], 0, 'radial')),
    texture('grain', 0.35), innerGlow('#ffd6f0', 12, 0.6), satin('#e5d9ff', 0.3),
  ], warp('textInflate', 0.6, 0.7), ['nebula', 'galaxy', 'space'], [
    { id: 'nebula-hue', kind: 'hueCycle', enabled: true, duration: 6, params: {}, seed: 21 },
  ]),
  definePreset('comet', 'Comet Trail', 'cosmic', ['#ffffff', '#ffd166', '#4d6bff', '#0a0a1f'], [
    shadow('#050a1f', 8, 6, 0.6), extrude(46, '#2a3f8a', 200), fill(gradient(['#ffffff', '#ffd166', '#6a8aff'])),
    glow('#ffd166', 18, 0.55), stroke(2, '#ffffff'),
  ], warp('textSlantUp', 0.5), ['comet', 'meteor', 'trail']),
  definePreset('solar-flare', 'Solar Flare', 'cosmic', ['#fff3a0', '#ff9f1c', '#ff3d2e', '#5c0a00'], [
    glow('#ffb84d', 30, 0.7), shadow('#3a0a00', 8, 8, 0.5), fill(gradient(['#fff3a0', '#ffb84d', '#ff6a1a', '#c62800'])),
    bevel(10, 'pillow', 180), innerGlow('#fff3a0', 12, 0.7), post('aberration', { amount: 3 }, 0.5),
  ], warp('textInflate', 0.7, 0.7), ['sun', 'solar', 'flare']),
  definePreset('galaxy-spiral', 'Galaxy Spiral', 'cosmic', ['#ff6ec7', '#6ec7ff', '#6a4dff', '#0d0d2b'], [
    glow('#6ec7ff', 26, 0.55), shadow('#06061a', 9, 7, 0.6), fill(gradient(['#ff6ec7', '#a84dff', '#3a2fd6', '#6ec7ff', '#ff6ec7'], 0, 'angular')),
    satin('#ffffff', 0.4), texture('grain', 0.2), stroke(1.5, '#c9b8ff'),
  ], warp('textCircle', 1.15, 0.6), ['galaxy', 'spiral', 'vortex'], [
    { id: 'galaxy-spin', kind: 'specularSweep', enabled: true, duration: 5, params: {}, seed: 55 },
  ]),
  definePreset('black-hole', 'Black Hole', 'cosmic', ['#ffffff', '#ffd166', '#6a4dff', '#000000'], [
    glow('#ffd166', 22, 0.6), glow('#a84dff', 12, 0.5), fill(solid('#0a0a14', 0.92)), stroke(3, '#ffd166'),
    post('aberration', { amount: 4 }, 0.6), post('scanlines', { amount: 0.12, period: 4 }, 0.4),
  ], warp('textRingInside', 0.9, 0.6), ['black', 'hole', 'event']),
  definePreset('red-giant', 'Red Giant', 'cosmic', ['#ffb36b', '#ff5a3c', '#b3002d', '#3d0014'], [
    glow('#ff5a3c', 28, 0.65), shadow('#2a0008', 9, 8, 0.55), fill(gradient(['#ffc9a0', '#ff7a4d', '#d6153a', '#6a0018'])),
    chiselBevel(9, 180), innerGlow('#ffd9a0', 10, 0.55), post('grain', { amount: 0.12 }, 0.4),
  ], warp('textDeflate', 0.45), ['star', 'giant', 'space']),
  definePreset('starfield', 'Starfield', 'cosmic', ['#ffffff', '#ffd166', '#aab8ff', '#0a0a1f'], [
    glow('#ffd166', 18, 0.5), shadow('#05050f', 8, 8, 0.6), fill(solid('#e8ecff', 0.95)), texture('halftone', 0.5),
    stroke(1.5, '#ffffff'), innerGlow('#ffffff', 8, 0.6), post('grain', { amount: 0.2 }, 0.5),
  ], warp('textWave4', 0.3), ['stars', 'night', 'sky'], [
    { id: 'starfield-sparkle', kind: 'sparkle', enabled: true, duration: 2, params: { amount: 20 }, seed: 99 },
  ]),
  definePreset('magma-fissure', 'Magma Fissure', 'texture', ['#ff6a00', '#3d1505', '#0a0302', '#ff2a00'], [
    // Cooled rock lit from within: a near-black gradient body with the heat arriving entirely
    // through the inner glow, so the light reads as coming up through cracks rather than off the
    // surface. Distinct from `molten-core`, which is the same material seen as depth-keyed bands.
    shadow('#1a0202', 12, 14, 0.6), glow('#ff2a00', 34, 0.55),
    fill(gradient(['#3d1505', '#1a0a05', '#0a0302'])), innerGlow('#ff7a00', 16, 0.9),
    satin('#ff4500', 0.4), texture('grain', 0.22),
  ], warp('textDeflate', 0.42), ['molten', 'lava', 'magma']),
  definePreset('thermal-camera', 'Thermal Camera', 'texture', ['#fb9a06', '#cf4446', '#4a0c6b', '#fcffa4'], [
    glow('#fb9a06', 14, 0.35),
    fill(gradient(['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9a06', '#f7d13d', '#fcffa4'])),
    bevel(4, 'inner', 80),
    post('scanlines', { amount: 0.18, period: 5 }, 0.4),
    post('grain', { amount: 0.1 }, 0.3),
  ], none(), ['thermal', 'heatmap', 'inferno']),
  definePreset('thermal-ironbow', 'Thermal Ironbow', 'texture', ['#fffbe8', '#ff6a00', '#d61a6e', '#2a0a4a'], [
    // Ironbow, the palette every thermal camera ships with: violet at the cold rim through
    // magenta and orange to a white-hot core. Bands run largest to smallest so the narrowest
    // ends up nearest the outline.
    glow('#31106b', 30, 0.6), fill(solid('#fffbe8')),
    heatBand('#ffd400', 20), heatBand('#ff6a00', 13), heatBand('#d61a6e', 8), heatBand('#3d1178', 4),
  ], none(), ['thermal', 'infrared', 'heatmap', 'false-colour']),
  definePreset('molten-core', 'Molten Core', 'texture', ['#fff4c2', '#ff9a1f', '#c1230a', '#1a0a06'], [
    // The same ramp read as material rather than as data: a near-black crust at the rim over a
    // white-hot interior, which is what cooling lava looks like. A wide orange glow does the heat
    // haze and the noise breaks the crust up.
    glow('#ff5a00', 26, 0.8), fill(solid('#fff4c2')),
    heatBand('#ffb02e', 18), heatBand('#e8480d', 11), heatBand('#7d1204', 6), heatBand('#180703', 3),
    texture('noise', 0.24),
  ], warp('textInflate', 0.35, 0.6), ['fire', 'lava', 'burning', 'molten']),
  definePreset('night-vision', 'Night Vision', 'texture', ['#c8ffd0', '#3dff6a', '#0d5c23', '#02120a'], [
    // An image intensifier, not a heat map: one phosphor colour, bloom well past the subject, and
    // the sensor noise and line structure that come with amplifying almost no light at all.
    glow('#2dff6a', 22, 0.85), fill(solid('#b6ffc4')),
    heatBand('#37e46a', 12), heatBand('#0c5c23', 5),
    post('scanlines', { amount: 0.32, period: 3 }, 0.55), post('grain', { amount: 0.5 }, 0.6),
  ], none(), ['thermal', 'phosphor', 'optics', 'green']),
  definePreset('comic-pow', 'Comic Pow!', 'nineties', ['#ffd400', '#111111', '#d00000', '#fff9c4'], [
    shadow('#d00000', 11, 0.5, 0.95), fill(gradient(['#fff36e', '#ffd400', '#f7a500'], 100)), stroke(8, '#111111'), post('halftone', { frequency: 6 }, 0.32),
  ], warp('textArchUp', 0.28), ['comic', 'pop-art', 'halftone']),
  // Lava in motion, off the Office `fire` ramp, with a specular sweep for the crawl. The other two
  // fire styles are both still: this is the one that flows.
  definePreset('lava-flow', 'Lava Flow', 'texture', ['#fcef50', '#ee7d30', '#ad2718', '#52140e'], [
    shadow('#2b0a02', 10, 8, 0.6), glow('#ff5e00', 30, 0.7), fill(ramp('fire')), bevel(8, 'inner', 110), texture('grain', 0.18),
  ], warp('textDeflateInflate', 0.45), ['lava', 'fire', 'animated'], [
    { id: 'molten-flow', kind: 'specularSweep', enabled: true, duration: 6, params: {}, seed: 5 },
  ]),
  // The only aurora that drifts in hue as well as shape; `aurora` in the cosmic set is the still
  // one and `aurora-borealis` is the detailed static build.
  definePreset('aurora-drift', 'Aurora Drift', 'synthwave', ['#07223f', '#12c48a', '#9a6bff', '#7dffb2'], [
    glow('#b967ff', 22, 0.35), glow('#7dffb2', 16, 0.4), fill(gradient(['#07223f', '#0b5a52', '#12c48a', '#9a6bff'], 100)), innerGlow('#c9ffe9', 10, 0.4),
  ], warp('textWave2', 0.4), ['aurora', 'northern-lights', 'animated'], [
    { id: 'aurora-hue', kind: 'hueCycle', enabled: true, duration: 9, params: {}, seed: 21 },
    { id: 'aurora-ripple', kind: 'waveUndulate', enabled: true, duration: 5, params: { amount: 0.12 }, seed: 22 },
  ]),
  definePreset('slime-time', 'Slime Time', 'nineties', ['#c9ff4a', '#12a02e', '#083f16', '#eaffb0'], [
    shadow('#0d3b0d', 8, 10, 0.5), fill(gradient(['#c9ff4a', '#4ddb33', '#12a02e', '#0a5c1a'], 100)), bevel(26, 'pillow', 210), innerGlow('#eaffb0', 12, 0.5), stroke(3, '#083f16'),
  ], warp('textInflateBottom', 0.65, 0.6), ['slime', 'goo', 'nickelodeon']),
  definePreset('terminal', 'Terminal', 'texture', ['#46f97f', '#0b3d1a', '#d6ffe0', '#041b0c'], [
    glow('#33ff66', 10, 0.5), fill(solid('#46f97f')), innerGlow('#d6ffe0', 3, 0.3), post('scanlines', { amount: 0.3, period: 3 }, 0.6),
  ], none(), ['crt', 'phosphor', 'matrix', 'animated'], [
    { id: 'terminal-roll', kind: 'scanlineRoll', enabled: true, duration: 4, params: {}, seed: 41 },
  ]),
  definePreset('night-market', 'Night Market', 'synthwave', ['#ff2d55', '#ff9f1c', '#ffe8c8', '#3d0b12'], [
    glow('#ff9f1c', 30, 0.5), glow('#ff2d55', 14, 1), fill(solid('#ffd9a8', 0.55)), stroke(4.5, '#ff5a36'),
  ], none(), ['neon', 'sign', 'flicker', 'animated'], [
    { id: 'night-market-flicker', kind: 'neonFlicker', enabled: true, duration: 2.4, params: {}, seed: 12 },
  ]),
];

export function applyPresetToElement(element: TextElement, preset: Preset, replaceFont = false): void {
  element.effects = structuredClone(preset.apply.effects).map((effect) => ({ ...effect, id: createId() }));
  element.warp = structuredClone(preset.apply.warp);
  element.animations = structuredClone(preset.apply.animations ?? []).map((track) => ({ ...track, id: createId() }));
  if (replaceFont && preset.apply.font) element.font = { ...element.font, ...preset.apply.font };
}

export function getPreset(id: string): Preset | undefined {
  return BUILT_IN_PRESETS.find((preset) => preset.id === id);
}

function hexColor(hex: string, alpha = 1): Rgba {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha];
}
