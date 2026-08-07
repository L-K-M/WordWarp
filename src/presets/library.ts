import { createEffect } from '../effects/defaults';
import { createId } from '../lib/id';
import type {
  AnimationTrack,
  BevelEffect,
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
const gradient = (colors: string[], angle = 90, type: 'linear' | 'angular' = 'linear'): Paint => ({
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

function bevel(size: number, style: BevelEffect['style'] = 'inner', depth = 130): BevelEffect {
  const effect = createEffect('bevel');
  effect.size = size;
  effect.style = style;
  effect.depth = depth;
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
): TextureOverlayEffect {
  const effect = createEffect('textureOverlay');
  effect.source = { type: 'procedural', pattern };
  effect.opacity = opacity;
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

  definePreset('sticker-bomb', 'Sticker Bomb', 'nineties', ['#ffdd00', '#ffffff', '#1a1a2e', '#ff4757'], [
    shadow('#1a1a2e', 9, 0, 1), fill(gradient(['#ffdd00', '#ff4757'], 120)), stroke(9, '#ffffff'), stroke(2, '#1a1a2e'),
  ], warp('textWave2', 0.24), ['sticker', 'bold']),
  definePreset('caution-tape', 'Caution Tape', 'nineties', ['#ffd400', '#111111', '#fff3b0', '#5c4a00'], [
    shadow('#000000', 8, 3, 0.75), fill(gradient(['#ffd400', '#ffd400', '#111111', '#ffd400'], 45)), bevel(6, 'inner', 160), stroke(2, '#111111'),
  ], warp('textSlantUp', 0.45), ['caution', 'hazard']),

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
