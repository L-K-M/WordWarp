import { STAMP_LABELS } from '../model/defaults';
import type { AnimationTrack, Effect, Paint, PathData, Rgba, ShapeElement, TextElement, WarpSpec, WordWarpDocument } from '../model/types';
import { PRESET_WARP_IDS, STAMP_IDS } from '../model/types';
import { OFFICE_RAMPS, officeRampColors } from '../presets/office-ramps';
import { DOCUMENT_FONTS, getFontCatalogEntry } from '../text/fonts';
import { warpDisplayName } from '../warp';
import { mapMeshPoint } from '../warp/mesh';
import { stampAspect } from '../geometry/stamps';
import { createId } from '../lib/id';
import { EFFECT_KINDS } from '../effects/defaults';

export type InspectorPath = (string | number)[];
export type InspectorValue = string | number | boolean | number[];
export type InspectorCategory = 'object' | 'effects' | 'animation' | 'document';
export interface InspectorOption { value: string | number; label: string }
type FieldOperation = 'paintKind' | 'fontFamily' | 'warpKind' | 'meshSize' | 'pathNodeType' | 'shapeKind' | 'automaticSteps' | 'shadowToEdge';

/** IDs follow object identity; paths are resolved afresh after any layer/effect reorder. */
export interface InspectorField {
  id: string;
  path: InspectorPath;
  type: 'number' | 'boolean' | 'text' | 'choice' | 'color' | 'curve';
  label: string;
  value: InspectorValue;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  maxLength?: number;
  multiline?: boolean;
  options?: InspectorOption[];
  operation?: FieldOperation;
}

export interface InspectorAction {
  id: string;
  label: string;
  kind: 'addGradientStop' | 'removeGradientStop' | 'addPathNode' | 'removePathNode';
  path: InspectorPath;
  index?: number;
}

export interface InspectorSection {
  id: string;
  label: string;
  category: InspectorCategory;
  fields: InspectorField[];
  children?: InspectorSection[];
  actions?: InspectorAction[];
  description?: string;
}

export const NATIVE_ANIMATION_KINDS: AnimationTrack['kind'][] = [
  'specularSweep', 'glossSweep', 'neonFlicker', 'hueCycle', 'rainbowScroll', 'scanlineRoll',
  'vhsJitter', 'glitchBlocks', 'sparkle', 'waveUndulate', 'bounce', 'typewriter', 'extrudeSpin', 'pulse',
];

export const nativeEffectKinds: InspectorOption[] = EFFECT_KINDS.map((value) => ({ value, label: inspectorLabel(value) }));
export const nativeAnimationKinds: InspectorOption[] = NATIVE_ANIMATION_KINDS.map((value) => ({ value, label: inspectorLabel(value) }));

export function createNativeAnimation(kind: AnimationTrack['kind']): AnimationTrack {
  if (!NATIVE_ANIMATION_KINDS.includes(kind)) throw new Error('That animation is unavailable.');
  const params: AnimationTrack['params'] = kind === 'pulse' || kind === 'waveUndulate' ? { amount: 0.15 }
    : kind === 'bounce' ? { height: 36 } : kind === 'vhsJitter' ? { distance: 5 } : {};
  return { id: createId(), kind, enabled: true, duration: 2, params, seed: 1337 };
}

const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge',
  'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity', 'linear-dodge'];
const POST_TYPES = ['glitch', 'halftone', 'scanlines', 'grain', 'aberration', 'dither', 'pixelate'];
const FONT_OPTIONS = DOCUMENT_FONTS.filter((font) => font.source === 'bundled').map((font) => ({ value: font.family, label: font.family }));

export function inspectorLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}

function options(values: readonly (string | number)[]): InspectorOption[] {
  return values.map((value) => ({ value, label: typeof value === 'string' ? inspectorLabel(value) : String(value) }));
}

class Fields {
  readonly fields: InspectorField[] = [];
  constructor(readonly id: string, readonly path: InspectorPath) {}

  add(key: string | number | InspectorPath, type: InspectorField['type'], label: string,
    value: InspectorValue, extra: Partial<InspectorField> = {}): InspectorField {
    const suffix = Array.isArray(key) ? key : [key];
    const field: InspectorField = { id: `${this.id}/${suffix.map(String).join('/')}`, path: [...this.path, ...suffix], type, label, value, ...extra };
    this.fields.push(field);
    return field;
  }

  number(key: string | number | InspectorPath, label: string, value: number, min: number, max: number, step = 1): InspectorField {
    return this.add(key, 'number', label, value, { min: Math.min(min, value), max: Math.max(max, value), step });
  }

  unit(key: string | InspectorPath, label: string, value: number): InspectorField { return this.number(key, label, value, 0, 1, 0.01); }
  angle(key: string | InspectorPath, label: string, value: number): InspectorField { return this.number(key, label, value, -360, 360); }
  boolean(key: string | InspectorPath, label: string, value: boolean): InspectorField { return this.add(key, 'boolean', label, value); }
  choice(key: string | InspectorPath, label: string, value: string | number, values: readonly (string | number)[]): InspectorField {
    return this.add(key, 'choice', label, value, { options: options(values) });
  }
  color(key: string | InspectorPath, label: string, value: Rgba): InspectorField { return this.add(key, 'color', label, [...value]); }
  curve(key: string, label: string, value: number[]): InspectorField { return this.add(key, 'curve', label, [...value], { min: 0, max: 1, step: 0.01 }); }
  point(key: string | InspectorPath, label: string, value: number[], min = -2, max = 3): void {
    const path = Array.isArray(key) ? key : [key];
    this.number([...path, 0], `${label} X`, value[0]!, min, max, 0.01);
    this.number([...path, 1], `${label} Y`, value[1]!, min, max, 0.01);
  }
  section(label: string, category: InspectorCategory, children?: InspectorSection[]): InspectorSection {
    return { id: this.id, label, category, fields: this.fields, ...(children?.length ? { children } : {}) };
  }
}

export function buildInspector(document: WordWarpDocument, selectedId: string | null): InspectorSection[] {
  const result: InspectorSection[] = [];
  const index = document.elements.findIndex((element) => element.id === selectedId);
  const element = document.elements[index];
  if (element && (element.type === 'text' || element.type === 'shape')) {
    const path: InspectorPath = ['elements', index];
    const id = `element:${element.id}`;
    const common = new Fields(id, path);
    common.add('name', 'text', 'Layer name', element.name, { maxLength: 256 });
    common.boolean('visible', 'Visible', element.visible);
    common.boolean('locked', 'Lock layer', element.locked);
    common.unit('opacity', 'Opacity', element.opacity);
    common.choice('blendMode', 'Blend mode', element.blendMode, BLEND_MODES);
    const children = element.type === 'text' ? textSections(element, id, path) : shapeSections(element, id, path);
    children.push(transformSection(element, id, path));
    if (element.type === 'text') children.push(warpSection(element.warp, `${id}/warp`, [...path, 'warp']));
    result.push({ ...common.section(element.type === 'text' ? 'Text layer' : 'Stamp layer', 'object', children), id: 'element' });
    result.push({ id: 'effects', label: 'Effects', category: 'effects', fields: [], children: element.effects.map((effect, effectIndex) =>
      effectSection(effect, `${id}/effect:${effect.id}`, [...path, 'effects', effectIndex])) });
    result.push({ id: 'animations', label: 'Animation', category: 'animation', fields: [], children: element.animations.map((track, trackIndex) =>
      animationSection(track, `${id}/animation:${track.id}`, [...path, 'animations', trackIndex])) });
  }
  const canvas = new Fields('canvas', ['canvas']);
  canvas.number('width', 'Width', document.canvas.width, 1, 8192).integer = true;
  canvas.number('height', 'Height', document.canvas.height, 1, 8192).integer = true;
  canvas.boolean('autoFit', 'Crop export to artwork', document.canvas.autoFit);
  canvas.number('exportPadding', 'Export padding', document.canvas.exportPadding, 0, 512);
  const doc = new Fields('document', []);
  doc.add('name', 'text', 'Document name', document.name, { maxLength: 256 });
  const light = new Fields('globalLight', ['globalLight']);
  light.angle('angle', 'Angle', document.globalLight.angle);
  light.number('altitude', 'Altitude', document.globalLight.altitude, 0, 90);
  result.push({ id: 'canvas', label: 'Document & canvas', category: 'document', fields: [...doc.fields, ...canvas.fields], children: [
    paintSection(document.canvas.background, 'canvas/background', ['canvas', 'background'], 'Background', 'document', true),
    light.section('Global light', 'document'),
  ] });
  return result;
}

function textSections(element: TextElement, id: string, path: InspectorPath): InspectorSection[] {
  const text = new Fields(`${id}/text`, path);
  text.add('text', 'text', 'Content', element.text, { multiline: true, maxLength: 5000 });
  const familyOptions = [...FONT_OPTIONS];
  if (!familyOptions.some((font) => font.value === element.font.family)) {
    familyOptions.push({ value: element.font.family, label: `${element.font.family} (document font)` });
  }
  text.add(['font', 'family'], 'choice', 'Font family', element.font.family, { options: familyOptions, operation: 'fontFamily' });
  text.choice(['font', 'weight'], 'Weight', element.font.weight, [100, 200, 300, 400, 500, 600, 700, 800, 900]);
  text.boolean(['font', 'italic'], 'Italic', element.font.italic);
  const layout = new Fields(`${id}/layout`, [...path, 'layout']);
  layout.number('size', 'Font size', element.layout.size, 1, 600);
  layout.choice('align', 'Alignment', element.layout.align, ['left', 'center', 'right']);
  layout.number('lineHeight', 'Line spacing', element.layout.lineHeight, 0.1, 4, 0.05);
  layout.number('letterSpacing', 'Letter spacing', element.layout.letterSpacing, -1, 2, 0.01);
  layout.number('wordSpacing', 'Word spacing', element.layout.wordSpacing, -1, 3, 0.01);
  layout.choice('transform', 'Letter case', element.layout.transform, ['none', 'upper', 'lower', 'title']);
  layout.choice('direction', 'Writing direction', element.layout.direction, ['ltr', 'rtl']);
  return [text.section('Text & font', 'object'), layout.section('Text layout', 'object')];
}

function shapeSections(element: ShapeElement, id: string, path: InspectorPath): InspectorSection[] {
  const shape = new Fields(`${id}/shape`, path);
  shape.add('shape', 'choice', 'Stamp', element.shape, { options: STAMP_IDS.map((value) => ({ value, label: STAMP_LABELS[value] })), operation: 'shapeKind' });
  shape.number('width', 'Width', element.width, 1, 2400);
  shape.number('height', 'Height', element.height, 1, 2400);
  const children = element.path ? [pathSection(element.path, `${id}/shape/path`, [...path, 'path'], false)] : undefined;
  return [shape.section('Stamp', 'object', children)];
}

function transformSection(element: TextElement | ShapeElement, id: string, path: InspectorPath): InspectorSection {
  const fields = new Fields(`${id}/transform`, [...path, 'transform']);
  const transform = element.transform;
  fields.number('x', 'Position X', transform.x, -8192, 8192);
  fields.number('y', 'Position Y', transform.y, -8192, 8192);
  fields.angle('rotation', 'Rotation', transform.rotation);
  fields.number('scaleX', 'Scale X', transform.scaleX, -8, 8, 0.01);
  fields.number('scaleY', 'Scale Y', transform.scaleY, -8, 8, 0.01);
  fields.number('skewX', 'Slant X', transform.skewX, -80, 80);
  fields.number('skewY', 'Slant Y', transform.skewY, -80, 80);
  fields.unit('originX', 'Anchor X', transform.originX);
  fields.unit('originY', 'Anchor Y', transform.originY);
  return fields.section('Position & transform', 'object');
}

function warpSection(warp: WarpSpec, id: string, path: InspectorPath): InspectorSection {
  const fields = new Fields(id, path);
  fields.add([], 'choice', 'Warp type', warp.kind, { options: options(['none', 'preset', 'perspective', 'mesh', 'path']), operation: 'warpKind' });
  const children: InspectorSection[] = [];
  if (warp.kind === 'preset') {
    fields.add('preset', 'choice', 'Envelope', warp.preset ?? 'textArchUp', { options: PRESET_WARP_IDS.map((value) => ({ value, label: warpDisplayName(value) })) });
    fields.number('bend', 'Bend', warp.bend, -2, 2, 0.01);
    fields.number(['adj', 0], 'Shape', warp.adj[0], 0, 2, 0.01);
    fields.unit(['adj', 1], 'Phase', warp.adj[1]);
    fields.number('distortH', 'Horizontal distortion', warp.distortH, -1, 1, 0.01);
    fields.number('distortV', 'Vertical distortion', warp.distortV, -1, 1, 0.01);
  } else if (warp.kind === 'perspective' && warp.corners) {
    for (const [index, name] of ['Top left', 'Top right', 'Bottom right', 'Bottom left'].entries()) fields.point(['corners', index], name, warp.corners[index]!);
  } else if (warp.kind === 'mesh' && warp.mesh) {
    fields.number(['mesh', 'cols'], 'Columns', warp.mesh.cols, 1, 16).operation = 'meshSize';
    fields.fields.at(-1)!.integer = true;
    fields.number(['mesh', 'rows'], 'Rows', warp.mesh.rows, 1, 16).operation = 'meshSize';
    fields.fields.at(-1)!.integer = true;
    for (let row = 0; row <= warp.mesh.rows; row += 1) {
      const rowFields = new Fields(`${id}/mesh/row:${row}`, [...path, 'mesh', 'points']);
      for (let col = 0; col <= warp.mesh.cols; col += 1) {
        const point = (row * (warp.mesh.cols + 1) + col) * 2;
        rowFields.number(point, `Point ${col + 1} X`, warp.mesh.points[point]!, -2, 3, 0.01);
        rowFields.number(point + 1, `Point ${col + 1} Y`, warp.mesh.points[point + 1]!, -2, 3, 0.01);
      }
      children.push(rowFields.section(`Row ${row + 1}`, 'object'));
    }
  } else if (warp.kind === 'path' && warp.path) children.push(pathSection(warp.path, `${id}/path`, [...path, 'path'], true));
  return fields.section('Warp', 'object', children);
}

function pathSection(value: PathData, id: string, path: InspectorPath, normalized: boolean): InspectorSection {
  const bounds = normalized ? [-2, 3] : [-2400, 4800];
  const children = value.commands.map((command, index): InspectorSection => {
    const fields = new Fields(`${id}/node:${index}`, [...path, 'commands', index]);
    fields.add([], 'choice', 'Node type', command.type, { options: options(index === 0 ? ['M'] : ['L', 'Q', 'C', 'Z']), operation: 'pathNodeType' });
    if ('point' in command) fields.point('point', 'End', command.point, bounds[0], bounds[1]);
    if ('control' in command) fields.point('control', 'Control', command.control, bounds[0], bounds[1]);
    if ('control1' in command) fields.point('control1', 'Control 1', command.control1, bounds[0], bounds[1]);
    if ('control2' in command) fields.point('control2', 'Control 2', command.control2, bounds[0], bounds[1]);
    return { ...fields.section(`Node ${index + 1}`, 'object'), ...(index > 0 ? { actions: [{ id: `${id}/remove:${index}`, label: 'Remove node', kind: 'removePathNode' as const, path: [...path, 'commands'], index }] } : {}) };
  });
  return { id, label: 'Path nodes', category: 'object', fields: [], children,
    actions: [{ id: `${id}/add`, label: 'Add path node', kind: 'addPathNode', path: [...path, 'commands'] }] };
}

function paintSection(paint: Paint | null, id: string, path: InspectorPath, label: string,
  category: InspectorCategory, allowTransparent = false): InspectorSection {
  const fields = new Fields(id, path);
  fields.add([], 'choice', 'Paint', paint?.kind ?? 'none', { options: options([
    ...(allowTransparent ? ['none'] : []), 'solid', 'gradient', 'ramp', 'matcap',
  ]), operation: 'paintKind' });
  const children: InspectorSection[] = [];
  if (paint?.kind === 'solid') fields.color('color', 'Color', paint.color);
  else if (paint?.kind === 'gradient') {
    const gradient = paint.gradient;
    fields.choice(['gradient', 'type'], 'Gradient shape', gradient.type, ['linear', 'radial', 'angular', 'reflected', ...(gradient.type === 'diamond' ? ['diamond'] : [])]);
    if (gradient.type !== 'radial') fields.angle(['gradient', 'angle'], 'Angle', gradient.angle);
    if (gradient.type === 'radial' || gradient.type === 'angular') fields.point(['gradient', 'center'], 'Center', gradient.center, 0, 1);
    if (gradient.type !== 'angular') fields.number(['gradient', 'scale'], 'Scale', gradient.scale, 0.01, 5, 0.01);
    fields.choice(['gradient', 'interpolation'], 'Color interpolation', gradient.interpolation, ['srgb', 'oklab']);
    for (const [index, stop] of gradient.stops.entries()) {
      const stopId = `${id}/stop:${index}`;
      const stopFields = new Fields(stopId, [...path, 'gradient', 'stops', index]);
      stopFields.number('offset', 'Position', stop.offset, gradient.stops[index - 1]?.offset ?? 0, gradient.stops[index + 1]?.offset ?? 1, 0.001);
      stopFields.color('color', 'Color', stop.color);
      children.push({ ...stopFields.section(`Stop ${index + 1}`, category), ...(gradient.stops.length > 1 ? { actions: [
        { id: `${stopId}/remove`, label: 'Remove stop', kind: 'removeGradientStop' as const, path: [...path, 'gradient', 'stops'], index },
      ] } : {}) });
    }
  } else if (paint?.kind === 'ramp') {
    fields.choice('rampId', 'Color ramp', paint.rampId, Object.keys(OFFICE_RAMPS));
    fields.angle('angle', 'Angle', paint.angle);
  } else if (paint?.kind === 'matcap') fields.angle('rotation', 'Light direction', paint.rotation);
  return { ...fields.section(label, category, children), ...(paint?.kind === 'gradient' && paint.gradient.stops.length < 64 ? { actions: [
    { id: `${id}/add-stop`, label: 'Add color stop', kind: 'addGradientStop' as const, path: [...path, 'gradient', 'stops'] },
  ] } : {}) };
}

function effectSection(effect: Effect, id: string, path: InspectorPath): InspectorSection {
  const fields = new Fields(id, path);
  fields.boolean('enabled', 'Enabled', effect.enabled);
  fields.unit('opacity', 'Opacity', effect.opacity);
  if (effect.kind !== 'post' && effect.kind !== 'reflection') fields.choice('blendMode', 'Blend mode', effect.blendMode, BLEND_MODES);
  const children: InspectorSection[] = [];
  if ('paint' in effect) children.push(paintSection(effect.paint, `${id}/paint`, [...path, 'paint'], 'Paint', 'effects'));
  if ('color' in effect) fields.color('color', 'Color', effect.color);
  if ('size' in effect) fields.number('size', 'Size', effect.size, 0, effect.kind === 'bevel' ? 250 : 300);
  if ('angle' in effect) fields.angle('angle', 'Angle', effect.angle);
  if ('distance' in effect) fields.number('distance', 'Distance', effect.distance, 0, 500);
  if ('contour' in effect) fields.curve('contour', 'Contour', effect.contour);
  if ('useGlobalLight' in effect) fields.boolean('useGlobalLight', 'Use global light', effect.useGlobalLight);
  switch (effect.kind) {
    case 'fill': break;
    case 'stroke':
      fields.number('width', 'Width', effect.width, 0, 300);
      fields.choice('position', 'Position', effect.position, ['inside', 'center', 'outside']);
      break;
    case 'bevel': {
      fields.choice('style', 'Style', effect.style, ['outer', 'inner', 'emboss', 'pillow', 'strokeEmboss']);
      fields.choice('technique', 'Technique', effect.technique, ['smooth', 'chiselHard', 'chiselSoft']);
      fields.number('depth', 'Depth', effect.depth, 1, 1000);
      fields.choice('direction', 'Direction', effect.direction, ['up', 'down']);
      fields.number('soften', 'Softness', effect.soften, 0, 16, 0.1);
      fields.number('altitude', 'Altitude', effect.altitude, 0, 90);
      fields.curve('glossContour', 'Gloss contour', effect.glossContour);
      for (const key of ['highlight', 'shadow'] as const) {
        const light = new Fields(`${id}/${key}`, [...path, key]);
        light.color('color', 'Color', effect[key].color);
        light.unit('opacity', 'Opacity', effect[key].opacity);
        children.push(light.section(inspectorLabel(key), 'effects'));
      }
      break;
    }
    case 'extrude':
      fields.number('depth', 'Depth', effect.depth, 0, 500);
      fields.choice('mode', 'Projection', effect.mode, ['parallel', 'perspective']);
      fields.point('vanishingPoint', 'Vanishing point', effect.vanishingPoint);
      fields.unit('strength', 'Perspective strength', effect.strength);
      fields.boolean('autoShade', 'Shade sides', effect.autoShade);
      fields.unit('shadeAmount', 'Side shading', effect.shadeAmount);
      fields.add('steps', 'boolean', 'Automatic steps', effect.steps === 'auto', { operation: 'automaticSteps' });
      if (effect.steps !== 'auto') fields.number('steps', 'Steps', effect.steps, 1, 512).integer = true;
      // Distinguish the mode toggle from the numeric value at the same model path.
      fields.fields.find((field) => field.operation === 'automaticSteps')!.id += '/automatic';
      children.push(paintSection(effect.sidePaint, `${id}/sidePaint`, [...path, 'sidePaint'], 'Side paint', 'effects'));
      break;
    case 'innerShadow': break;
    case 'innerGlow': fields.choice('source', 'Glow source', effect.source, ['center', 'edge']); break;
    case 'satin': fields.boolean('invert', 'Invert contour', effect.invert); break;
    case 'outerGlow': fields.unit('spread', 'Spread', effect.spread); break;
    case 'dropShadow':
      fields.unit('spread', 'Spread', effect.spread);
      fields.boolean('knockout', 'Knock out artwork', effect.knockout);
      break;
    case 'longShadow':
      fields.add('length', 'boolean', 'Extend to canvas edge', effect.length === 'toEdge', { operation: 'shadowToEdge' }).id += '/to-edge';
      if (effect.length !== 'toEdge') fields.number('length', 'Length', effect.length, 0, 2000);
      fields.boolean('fade', 'Fade with distance', effect.fade);
      break;
    case 'textureOverlay':
      if (effect.source.type === 'procedural') fields.choice(['source', 'pattern'], 'Pattern', effect.source.pattern, ['noise', 'weave', 'halftone', 'grain', 'topography', 'mottle', 'crystal', 'stitch']);
      fields.number('scale', 'Scale', effect.scale, 0.1, 10, 0.1);
      if (effect.source.type === 'procedural' && ['crystal', 'stitch'].includes(effect.source.pattern)) fields.angle('rotation', 'Rotation', effect.rotation);
      fields.boolean('clipToShape', 'Clip to artwork', effect.clipToShape);
      break;
    case 'reflection':
      fields.number('offset', 'Offset', effect.offset, -500, 500);
      fields.unit('height', 'Height', effect.height);
      break;
    case 'post':
      fields.choice('type', 'Filter', effect.type, POST_TYPES);
      fields.number('seed', 'Random seed', effect.seed, -2_147_483_648, 2_147_483_647).integer = true;
      postFields(effect, fields);
      break;
  }
  return { ...fields.section(inspectorLabel(effect.kind === 'post' ? effect.type : effect.kind), 'effects', children), id: effect.id };
}

function postFields(effect: Extract<Effect, { kind: 'post' }>, fields: Fields): void {
  const number = (key: string, label: string, fallback: number, min: number, max: number, step = 0.01) => {
    const value = effect.params[key];
    return fields.number(['params', key], label, typeof value === 'number' ? value : fallback, min, max, step);
  };
  const bool = (key: string, label: string, fallback: boolean) => fields.boolean(['params', key], label, typeof effect.params[key] === 'boolean' ? effect.params[key] : fallback);
  if (effect.type === 'aberration') {
    number('amount', 'Channel separation', 3, 0, 40, 0.1);
    fields.choice(['params', 'mode'], 'Direction', typeof effect.params.mode === 'string' ? effect.params.mode : 'linear', ['linear', 'radial']);
  } else if (effect.type === 'pixelate') {
    number('size', 'Block size', 8, 1, 80, 1);
    bool('crisp', 'Crisp edges', true);
  } else if (effect.type === 'dither') {
    number('amount', 'Strength', 1, 0, 1);
    number('levels', 'Color levels', 2, 2, 32, 1).integer = true;
    fields.choice(['params', 'matrix'], 'Pattern size', typeof effect.params.matrix === 'number' ? effect.params.matrix : 8, [2, 4, 8, 16]);
    number('dot', 'Dot size', 1, 1, 16, 1);
    bool('hardEdge', 'Solid pixel edges', true);
  } else {
    number('amount', 'Amount', 0.22, 0, 1);
    if (effect.type === 'scanlines') {
      number('period', 'Line spacing', 4, 2, 64, 1);
      number('offset', 'Phase', 0, 0, 1);
    }
    if (effect.type === 'halftone') number('frequency', 'Dot spacing', 8, 3, 64, 1);
  }
}

function animationSection(track: AnimationTrack, id: string, path: InspectorPath): InspectorSection {
  const fields = new Fields(id, path);
  fields.boolean('enabled', 'Enabled', track.enabled);
  fields.choice('kind', 'Animation', track.kind, NATIVE_ANIMATION_KINDS);
  fields.number('duration', 'Loop duration (seconds)', track.duration, 0.1, 30, 0.1);
  fields.number('seed', 'Random seed', track.seed, -2_147_483_648, 2_147_483_647).integer = true;
  if (track.kind === 'pulse' || track.kind === 'waveUndulate') {
    const amount = typeof track.params.amount === 'number' ? track.params.amount : 0.15;
    fields.number(['params', 'amount'], 'Amount', amount, 0, 1, 0.01);
  } else if (track.kind === 'bounce') fields.number(['params', 'height'], 'Height', typeof track.params.height === 'number' ? track.params.height : 36, 0, 500);
  else if (track.kind === 'vhsJitter') fields.number(['params', 'distance'], 'Distance', typeof track.params.distance === 'number' ? track.params.distance : 5, 0, 100);
  return { ...fields.section(inspectorLabel(track.kind), 'animation'), id: track.id };
}

export function flattenInspectorFields(sections: InspectorSection[]): InspectorField[] {
  return sections.flatMap((section) => [...section.fields, ...flattenInspectorFields(section.children ?? [])]);
}

function allActions(sections: InspectorSection[]): InspectorAction[] {
  return sections.flatMap((section) => [...(section.actions ?? []), ...allActions(section.children ?? [])]);
}

export function resolveInspectorField(document: WordWarpDocument, selectedId: string | null, id: string): InspectorField {
  const matches = flattenInspectorFields(buildInspector(document, selectedId)).filter((field) => field.id === id);
  if (matches.length !== 1) throw new Error('That control is no longer available. Select the layer again.');
  return matches[0]!;
}

export function resolveInspectorAction(document: WordWarpDocument, selectedId: string | null, id: string): InspectorAction {
  const matches = allActions(buildInspector(document, selectedId)).filter((action) => action.id === id);
  if (matches.length !== 1) throw new Error('That action is no longer available. Select the layer again.');
  return matches[0]!;
}

function validateValue(field: InspectorField, value: unknown): asserts value is InspectorValue {
  let valid = false;
  if (field.type === 'number') valid = typeof value === 'number' && Number.isFinite(value)
    && (field.min === undefined || value >= field.min) && (field.max === undefined || value <= field.max)
    && (!field.integer || Number.isInteger(value));
  else if (field.type === 'boolean') valid = typeof value === 'boolean';
  else if (field.type === 'text') valid = typeof value === 'string' && value.length <= (field.maxLength ?? 5000);
  else if (field.type === 'choice') valid = field.options?.some((option) => option.value === value) ?? false;
  else if (field.type === 'color' || field.type === 'curve') valid = Array.isArray(value)
    && (field.type === 'color' ? value.length === 4 : value.length >= 2 && value.length <= 256)
    && value.every((channel: unknown) => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1);
  if (!valid) throw new Error(`Enter a valid value for ${field.label.toLowerCase()}.`);
}

/** Applies only an enumerated inspector field. The controller validates the whole draft afterward. */
export function applyInspectorValue(document: WordWarpDocument, selectedId: string | null, id: string, value: unknown): void {
  const field = resolveInspectorField(document, selectedId, id);
  validateValue(field, value);
  const current = readPath(document, field.path);
  if (field.operation === 'paintKind') {
    writePath(document, field.path, makePaint(value as string, current as Paint | null));
  } else if (field.operation === 'fontFamily') {
    const font = readPath(document, field.path.slice(0, -1)) as TextElement['font'];
    const entry = getFontCatalogEntry(value as string);
    if (!entry) throw new Error('This font is unavailable. Choose a bundled font.');
    font.family = entry.family; font.source = entry.source; font.weight = entry.weight; font.italic = false;
    delete font.assetId;
  } else if (field.operation === 'warpKind') {
    const warp = current as WarpSpec;
    warp.kind = value as WarpSpec['kind'];
    if (warp.kind === 'preset') { warp.preset ??= 'textArchUp'; if (Math.abs(warp.bend) < 0.01) warp.bend = 0.78; }
    if (warp.kind === 'perspective') warp.corners ??= [[0, 0], [1, 0], [1, 1], [0, 1]];
    if (warp.kind === 'mesh') warp.mesh ??= { cols: 2, rows: 2, points: [0, 0, 0.5, 0, 1, 0, 0, 0.5, 0.5, 0.5, 1, 0.5, 0, 1, 0.5, 1, 1, 1] };
    if (warp.kind === 'path') warp.path ??= { commands: [{ type: 'M', point: [0, 0.5] }, { type: 'C', control1: [0.3, 0], control2: [0.7, 1], point: [1, 0.5] }] };
  } else if (field.operation === 'meshSize') {
    const mesh = readPath(document, field.path.slice(0, -1)) as NonNullable<WarpSpec['mesh']>;
    const previous = { cols: mesh.cols, rows: mesh.rows, points: [...mesh.points] };
    const key = field.path.at(-1) as 'cols' | 'rows';
    mesh[key] = value as number;
    mesh.points = [];
    for (let row = 0; row <= mesh.rows; row += 1) for (let col = 0; col <= mesh.cols; col += 1) mesh.points.push(...mapMeshPoint(col / mesh.cols, row / mesh.rows, previous));
  } else if (field.operation === 'pathNodeType') {
    const command = current as PathData['commands'][number];
    const point = 'point' in command ? command.point : [1, 0.5];
    const next = value === 'Z' ? { type: 'Z' } : value === 'Q' ? { type: 'Q', point, control: [point[0]! / 2, point[1]] }
      : value === 'C' ? { type: 'C', point, control1: [point[0]! / 3, point[1]], control2: [point[0]! * 2 / 3, point[1]] }
        : { type: value, point };
    writePath(document, field.path, next);
  } else if (field.operation === 'shapeKind') {
    const shape = readPath(document, field.path.slice(0, -1)) as ShapeElement;
    const oldLabel = STAMP_LABELS[shape.shape];
    shape.shape = value as ShapeElement['shape']; shape.path = null;
    if (shape.name === oldLabel) shape.name = STAMP_LABELS[shape.shape];
    const size = Math.max(shape.width, shape.height); const aspect = stampAspect(shape.shape);
    shape.width = aspect >= 1 ? size : size * aspect; shape.height = aspect >= 1 ? size / aspect : size;
  } else if (field.operation === 'automaticSteps') writePath(document, field.path, value ? 'auto' : 64);
  else if (field.operation === 'shadowToEdge') writePath(document, field.path, value ? 'toEdge' : 90);
  else writePath(document, field.path, Array.isArray(value) ? [...value] : value);
}

export function applyInspectorAction(document: WordWarpDocument, selectedId: string | null, id: string): void {
  const action = resolveInspectorAction(document, selectedId, id);
  if (action.kind === 'addGradientStop' || action.kind === 'removeGradientStop') {
    const stops = readPath(document, action.path) as Extract<Paint, { kind: 'gradient' }>['gradient']['stops'];
    if (action.kind === 'removeGradientStop') stops.splice(action.index!, 1);
    else {
      if (stops.length === 1) { stops.push({ offset: 1, color: [...stops[0]!.color] }); return; }
      let insertion = 1;
      for (let index = 2; index < stops.length; index += 1) if (stops[index]!.offset - stops[index - 1]!.offset > stops[insertion]!.offset - stops[insertion - 1]!.offset) insertion = index;
      const first = stops[insertion - 1]!; const second = stops[insertion]!;
      stops.splice(insertion, 0, { offset: (first.offset + second.offset) / 2, color: first.color.map((channel, index) => (channel + second.color[index]!) / 2) as Rgba });
    }
  } else {
    const nodes = readPath(document, action.path) as PathData['commands'];
    if (action.kind === 'removePathNode') nodes.splice(action.index!, 1);
    else {
      const last = [...nodes].reverse().find((node) => 'point' in node);
      const point = last && 'point' in last ? last.point : [0, 0.5];
      nodes.push({ type: 'L', point: [point[0]! + 0.25, point[1]!] });
    }
  }
}

function makePaint(kind: string, source: Paint | null): Paint | null {
  if (kind === 'none') return null;
  if (source?.kind === kind) return source;
  const colors: Rgba[] = source?.kind === 'solid' ? [source.color, [1, 1, 1, 1]]
    : source?.kind === 'gradient' ? source.gradient.stops.map((stop) => stop.color)
      : source?.kind === 'ramp' ? officeRampColors(source.rampId) ?? [[0.2, 0.3, 0.5, 1], [1, 1, 1, 1]]
        : [[0.25, 0.45, 0.95, 1], [1, 0.3, 0.65, 1]];
  if (kind === 'solid') return { kind, color: [...colors[0]!] };
  if (kind === 'gradient') return { kind, gradient: { type: 'linear', angle: 90, center: [0.5, 0.5], scale: 1, dither: true, interpolation: 'srgb',
    stops: colors.map((color, index) => ({ offset: colors.length <= 1 ? 0 : index / (colors.length - 1), color: [...color] })) } };
  if (kind === 'ramp') return { kind, rampId: 'chrome', angle: 90, variant: 1 };
  if (kind === 'matcap') return { kind, matcapId: 'chrome', rotation: 0, intensity: 1 };
  throw new Error('That paint requires imported assets and cannot be edited here.');
}

function record(value: unknown): Record<string | number, unknown> {
  if (value === null || typeof value !== 'object') throw new Error('The selected property is unavailable.');
  return value as Record<string | number, unknown>;
}

function readPath(source: unknown, path: InspectorPath): unknown {
  let current = source;
  for (const key of path) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Invalid property path.');
    current = record(current)[key];
  }
  return current;
}

function writePath(source: unknown, path: InspectorPath, value: unknown): void {
  const key = path.at(-1);
  if (key === undefined || key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error('Invalid property path.');
  record(readPath(source, path.slice(0, -1)))[key] = value;
}
