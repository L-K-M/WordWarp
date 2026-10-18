import {
  documentAnimationDuration,
  hasEnabledAnimationTracks,
} from '../animation/evaluate';
import { createEffect, EFFECT_KINDS } from '../effects/defaults';
import { exportAnimation } from '../export/animation';
import { getExportBounds, validateExportSize } from '../export/bounds';
import { exportErrorMessage } from '../export/errors';
import { renderPngOnSurface } from '../export/render-png';
import { createId } from '../lib/id';
import {
  createDefaultDocument,
  createDefaultTextElement,
  createStampElement,
  STAMP_LABELS,
} from '../model/defaults';
import { parseDocument } from '../model/schema';
import { loadDocument } from '../model/migrations';
import {
  STAMP_GROUPS,
  STAMP_IDS,
  STAMP_IDS_BY_GROUP,
  type AnimationTrack,
  type Element,
  type TextElement,
  type WordWarpDocument,
} from '../model/types';
import {
  applyPresetToElement,
  BUILT_IN_PRESETS,
  getPreset,
} from '../presets/library';
import { get2dContext } from '../render/surface';
import {
  createDocumentStore,
  type DocumentRecipe,
} from '../state/document-store';
import {
  ensureFontsForDocument,
  getFontCatalogEntry,
  missingBundledFonts,
} from '../text/fonts';
import {
  applyInspectorAction,
  applyInspectorValue,
  buildInspector,
  createNativeAnimation,
  resolveInspectorField,
  resolveInspectorAction,
} from './inspector';
import { mountCanvas } from './canvas';
import {
  nativeCommandSchema,
  postToHost,
  type NativeState,
  type NativeView,
} from './protocol';
import './style.css';

function bundledFont(element: TextElement): void {
  if (getFontCatalogEntry(element.font.family)?.source === 'bundled') return;
  element.font = {
    ...element.font,
    family: 'Bungee',
    source: 'bundled',
    weight: 400,
  };
}
function freshDocument(): WordWarpDocument {
  const doc = createDefaultDocument();
  const element = doc.elements[0] as TextElement;
  applyPresetToElement(element, getPreset('chrome-classic')!, true);
  bundledFont(element);
  return doc;
}
const initial = freshDocument();
const store = createDocumentStore(initial);
const presetIds = new Map<string, string>([
  [initial.elements[0]!.effects[0]!.id, 'chrome-classic'],
]);
let selectedElementId: string | null = initial.elements[0]!.id;
let revision = 0;
let exporting = false;
const view: NativeView = {
  tool: 'select',
  zoom: 1,
  playing: false,
  time: 0,
  duration: 2,
};
const animationKinds: AnimationTrack['kind'][] = [
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
];
const label = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (s) => s.toUpperCase());
function selected(doc = store.getState().document): Element {
  const element = doc.elements.find((item) => item.id === selectedElementId);
  if (!element) throw new Error('Select a layer first.');
  return element;
}
function editable(doc: WordWarpDocument): Element {
  const element = selected(doc);
  if (element.locked) throw new Error('Unlock this layer before editing it.');
  return element;
}
function snapshot(): NativeState {
  const current = store.getState();
  if (!current.document.elements.some((e) => e.id === selectedElementId))
    selectedElementId = null;
  const element = current.document.elements.find(
    (e) => e.id === selectedElementId,
  );
  view.duration = documentAnimationDuration(current.document);
  return {
    text: element?.type === 'text' ? element.text : '',
    presetId: presetIds.get(element?.effects[0]?.id ?? '') ?? null,
    canUndo: current.past.length > 0,
    canRedo: current.future.length > 0,
    revision,
    document: current.document,
    selectedElementId,
    layers: current.document.elements.map(
      ({ id, name, type, visible, locked }) => ({
        id,
        name,
        type,
        visible,
        locked,
      }),
    ),
    inspector: buildInspector(current.document, selectedElementId),
    view: { ...view },
  };
}
function publish(): void {
  postToHost({ type: 'state', state: snapshot() });
  draw();
}
function draw(): void {
  canvas.update({
    document: store.getState().document,
    selectedElementId,
    revision,
    view: { ...view },
  });
}
function publishView(): void {
  postToHost({ type: 'view', view: { ...view } });
  draw();
}
function stopPlayback(): void {
  if (view.playing || view.time !== 0) {
    view.playing = false;
    view.time = 0;
    publishView();
  }
}
function edit(title: string, recipe: DocumentRecipe, mergeKey?: string): void {
  stopPlayback();
  store.getState().updateDocument(
    title,
    (doc) => {
      recipe(doc);
      // Validation happens within the Immer transaction: invalid edits never enter history.
      parseDocument(doc);
      documentAnimationDuration(doc);
    },
    mergeKey,
  );
}
const canvas = mountCanvas({
  command: dispatch,
  select: (id) => {
    if (id !== selectedElementId) {
      selectedElementId = id;
      publish();
    }
  },
  begin: (_id, kind) => {
    stopPlayback();
    store.getState().beginTransaction(label(kind) + ' layer');
  },
  transform: (id, transform) =>
    store.getState().updateDocument('Transform layer', (doc) => {
      const element = doc.elements.find((e) => e.id === id);
      if (element && !element.locked) element.transform = transform;
    }),
  end: () => store.getState().commitTransaction(),
  viewport: (zoom) => {
    view.zoom = zoom;
    postToHost({ type: 'view', view: { ...view } });
  },
  time: (time) => {
    view.time = time;
    postToHost({ type: 'view', view: { ...view } });
  },
});
function reorder<T>(list: T[], index: number, target: number): void {
  if (index < 0) throw new Error('That item no longer exists.');
  const [item] = list.splice(index, 1);
  list.splice(Math.max(0, Math.min(list.length, target)), 0, item!);
}
function validateNativeDocument(input: unknown): WordWarpDocument {
  let doc: WordWarpDocument;
  try {
    doc = loadDocument(input);
  } catch {
    throw new Error(
      'The saved document is invalid or uses an unsupported version.',
    );
  }
  if (doc.elements.some((e) => e.type !== 'text' && e.type !== 'shape'))
    throw new Error(
      'This document contains unsupported image or group layers.',
    );
  for (const e of doc.elements) {
    if (e.type === 'text') {
      if (e.text.length > 5000)
        throw new Error('Text layers are limited to 5000 characters.');
      if (getFontCatalogEntry(e.font.family)?.source !== 'bundled')
        throw new Error(
          'This document needs a font that is not bundled. Choose a bundled font in the web editor before opening it here.',
        );
    }
    if (e.animations.some((a) => a.stagger))
      throw new Error(
        'Per-character animation staggering is not supported yet.',
      );
  }
  if (Object.keys(doc.assets).length)
    throw new Error(
      'Embedded asset documents are not supported by the current renderer.',
    );
  documentAnimationDuration(doc);
  return doc;
}
function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16384)
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 16384)));
  return btoa(chunks.join(''));
}
async function exportArtwork(
  id: string,
  format: 'png' | 'apng' | 'gif',
  scale: number,
  fps = 12,
): Promise<void> {
  if (exporting) {
    postToHost({
      type: 'error',
      id,
      message: 'An export is already in progress.',
    });
    return;
  }
  exporting = true;
  const doc = structuredClone(store.getState().document);
  try {
    postToHost({ type: 'exportProgress', id, progress: 0 });
    await ensureFontsForDocument(doc);
    if (missingBundledFonts(doc).length)
      throw new Error('A bundled font could not be loaded.');
    if (format === 'png') {
      const context = get2dContext(document.createElement('canvas'));
      validateExportSize(getExportBounds(doc, context), scale);
      const result = await renderPngOnSurface(doc, scale, () =>
        document.createElement('canvas'),
      );
      const firstText = doc.elements.find((e) => e.type === 'text');
      const name =
        (firstText?.type === 'text' ? firstText.text : doc.name)
          .trim()
          .replace(/[^a-z0-9-_]+/gi, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 60) || 'wordwarp';
      postToHost({
        type: 'export',
        id,
        filename: name + '.png',
        mimeType: 'image/png',
        base64: toBase64(result.bytes),
        width: result.width,
        height: result.height,
      });
    } else {
      const result = await exportAnimation(doc, {
        format,
        scale,
        fps,
        useWorker: false,
        onProgress: (progress) =>
          postToHost({ type: 'exportProgress', id, progress }),
      });
      postToHost({
        type: 'export',
        id,
        filename: result.filename,
        mimeType: result.blob.type,
        base64: toBase64(new Uint8Array(await result.blob.arrayBuffer())),
        width: result.width,
        height: result.height,
        frameCount: result.frameCount,
        fps: result.fps,
        reduced: result.reduced,
      });
    }
  } catch (error) {
    postToHost({ type: 'error', id, message: exportErrorMessage(error) });
  } finally {
    exporting = false;
  }
}
function dispatch(value: unknown): void {
  const requestId =
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
      ? value.id.slice(0, 150)
      : undefined;
  const parsed = nativeCommandSchema.safeParse(value);
  if (!parsed.success) {
    postToHost({
      type: 'error',
      id: requestId,
      message:
        'The requested edit is invalid. Check text length (5000 characters), export size, and field values.',
    });
    return;
  }
  const command = parsed.data;
  try {
    switch (command.type) {
      case 'setText':
        edit(
          'Edit text',
          (doc) => {
            const e = editable(doc);
            if (e.type !== 'text') throw new Error('Select a text layer.');
            e.text = command.text;
          },
          'native-text:' + selectedElementId,
        );
        break;
      case 'setPreset': {
        const preset = getPreset(command.presetId);
        if (!preset) throw new Error('That preset is unavailable.');
        edit('Apply style', (doc) => {
          const e = editable(doc);
          if (e.type !== 'text' && e.type !== 'shape')
            throw new Error('Select a text or stamp layer.');
          applyPresetToElement(e, preset, true);
          if (e.type === 'text') bundledFont(e);
          if (e.effects[0]) presetIds.set(e.effects[0].id, preset.id);
        });
        break;
      }
      case 'select':
        if (
          command.elementId &&
          !store
            .getState()
            .document.elements.some((e) => e.id === command.elementId)
        )
          throw new Error('That layer no longer exists.');
        selectedElementId = command.elementId;
        publish();
        break;
      case 'addText':
      case 'addStamp': {
        const doc = store.getState().document;
        if (
          command.type === 'addStamp' &&
          !STAMP_IDS.includes(command.stampId as (typeof STAMP_IDS)[number])
        )
          throw new Error('That stamp is unavailable.');
        const e =
          command.type === 'addText'
            ? createDefaultTextElement()
            : createStampElement(
                command.stampId as (typeof STAMP_IDS)[number],
                [doc.canvas.width * 0.4, doc.canvas.height * 0.45],
              );
        if (e.type === 'text') {
          bundledFont(e);
          e.text = 'New warp';
          e.name = 'Text ' + (doc.elements.length + 1);
          e.transform.x = doc.canvas.width / 2;
          e.transform.y = doc.canvas.height / 2;
        }
        selectedElementId = e.id;
        edit('Add ' + (e.type === 'text' ? 'text' : e.name), (draft) => {
          draft.elements.push(e);
        });
        break;
      }
      case 'layer': {
        const source = store
          .getState()
          .document.elements.find((e) => e.id === command.elementId);
        if (!source) throw new Error('That layer no longer exists.');
        if (source.locked && !['lock', 'visibility'].includes(command.action))
          throw new Error('Unlock this layer before editing it.');
        const copy =
          command.action === 'duplicate' ? structuredClone(source) : null;
        if (copy) {
          copy.id = createId();
          copy.name += ' copy';
          copy.transform.x += 24;
          copy.transform.y += 24;
          copy.effects.forEach((e) => (e.id = createId()));
          copy.animations.forEach((a) => (a.id = createId()));
          selectedElementId = copy.id;
        }
        if (command.action === 'delete' && selectedElementId === source.id) {
          const layers = store.getState().document.elements;
          const index = layers.indexOf(source);
          selectedElementId =
            layers[index - 1]?.id ?? layers[index + 1]?.id ?? null;
        }
        edit(label(command.action) + ' layer', (doc) => {
          const index = doc.elements.findIndex(
            (e) => e.id === command.elementId,
          );
          const e = doc.elements[index]!;
          if (copy) doc.elements.splice(index + 1, 0, copy);
          else if (command.action === 'delete') doc.elements.splice(index, 1);
          else if (command.action === 'visibility') e.visible = !e.visible;
          else if (command.action === 'lock') e.locked = !e.locked;
          else
            reorder(
              doc.elements,
              index,
              command.action === 'front'
                ? doc.elements.length - 1
                : command.action === 'back'
                  ? 0
                  : index + (command.action === 'up' ? 1 : -1),
            );
        });
        break;
      }
      case 'setField': {
        const field = resolveInspectorField(
          store.getState().document,
          selectedElementId,
          command.fieldId,
        );
        if (
          field.path[0] === 'elements' &&
          !['visible', 'locked'].includes(String(field.path.at(-1)))
        )
          editable(store.getState().document);
        edit(
          'Change ' + field.label,
          (doc) =>
            applyInspectorValue(
              doc,
              selectedElementId,
              command.fieldId,
              command.value,
            ),
          'native-field:' + command.fieldId,
        );
        break;
      }
      case 'inspectorAction':
        if (
          resolveInspectorAction(
            store.getState().document,
            selectedElementId,
            command.actionId,
          ).path[0] === 'elements'
        )
          editable(store.getState().document);
        edit('Edit inspector', (doc) =>
          applyInspectorAction(doc, selectedElementId, command.actionId),
        );
        break;
      case 'effect':
        edit('Edit effects', (doc) => {
          const e = editable(doc);
          if (command.action === 'add') {
            if (
              !EFFECT_KINDS.includes(
                command.kind as (typeof EFFECT_KINDS)[number],
              )
            )
              throw new Error('That effect is unavailable.');
            e.effects.push(
              structuredClone(
                createEffect(command.kind as (typeof EFFECT_KINDS)[number]),
              ),
            );
          } else {
            const i = e.effects.findIndex(
              (effect) => effect.id === command.effectId,
            );
            if (i < 0) throw new Error('That effect no longer exists.');
            if (command.action === 'delete') e.effects.splice(i, 1);
            else if (command.action === 'toggle')
              e.effects[i]!.enabled = !e.effects[i]!.enabled;
            else reorder(e.effects, i, i + (command.action === 'up' ? 1 : -1));
          }
        });
        break;
      case 'animation':
        edit('Edit animation', (doc) => {
          const e = editable(doc);
          if (command.action === 'add') {
            if (
              !animationKinds.includes(command.kind as AnimationTrack['kind'])
            )
              throw new Error('That animation is unavailable.');
            e.animations.push(
              createNativeAnimation(command.kind as AnimationTrack['kind']),
            );
          } else {
            const i = e.animations.findIndex(
              (a) => a.id === command.animationId,
            );
            if (i < 0) throw new Error('That animation no longer exists.');
            if (command.action === 'delete') e.animations.splice(i, 1);
            else e.animations[i]!.enabled = !e.animations[i]!.enabled;
          }
        });
        break;
      case 'nudge':
        edit(
          'Nudge layer',
          (doc) => {
            const e = editable(doc);
            e.transform.x += command.dx;
            e.transform.y += command.dy;
          },
          'nudge:' + selectedElementId,
        );
        break;
      case 'undo':
        stopPlayback();
        store.getState().undo();
        break;
      case 'redo':
        stopPlayback();
        store.getState().redo();
        break;
      case 'getDocument':
        postToHost({
          type: 'document',
          id: command.id,
          document: parseDocument(store.getState().document),
        });
        break;
      case 'newDocument':
      case 'restore': {
        const doc =
          command.type === 'newDocument'
            ? freshDocument()
            : validateNativeDocument(command.document);
        stopPlayback();
        presetIds.clear();
        selectedElementId = doc.elements[0]?.id ?? null;
        const presetId =
          command.type === 'newDocument' ? 'chrome-classic' : command.presetId;
        if (presetId && getPreset(presetId) && doc.elements[0]?.effects[0])
          presetIds.set(doc.elements[0].effects[0].id, presetId);
        store.getState().replaceDocument(doc);
        canvas.fit();
        postToHost({ type: 'restored', id: command.id });
        break;
      }
      case 'setView':
        if (command.tool) view.tool = command.tool;
        if (command.zoom !== undefined) view.zoom = command.zoom;
        publishView();
        if (command.fit) canvas.fit();
        break;
      case 'playback':
        if (command.time !== undefined) view.time = command.time;
        if (command.playing !== undefined)
          view.playing =
            command.playing &&
            hasEnabledAnimationTracks(store.getState().document);
        publishView();
        break;
      case 'exportPng':
        void exportArtwork(command.id, 'png', command.scale);
        break;
      case 'export':
        void exportArtwork(
          command.id,
          command.format,
          command.scale,
          command.fps,
        );
        break;
    }
  } catch (error) {
    postToHost({
      type: 'error',
      id: requestId,
      message:
        error instanceof Error
          ? error.message
          : 'The edit could not be completed.',
    });
  }
}
store.subscribe((current, previous) => {
  if (current.document !== previous.document) revision += 1;
  publish();
});
window.wordwarp = { dispatch };
postToHost({
  type: 'ready',
  version: 2,
  presets: BUILT_IN_PRESETS.map(
    ({ id, name, category, preview, animated }) => ({
      id,
      name,
      category,
      preview,
      animated,
    }),
  ),
  stamps: STAMP_GROUPS.flatMap((group) =>
    STAMP_IDS_BY_GROUP[group.id].map((value) => ({
      value,
      label: STAMP_LABELS[value],
      category: group.label,
    })),
  ),
  effectKinds: EFFECT_KINDS.map((value) => ({ value, label: label(value) })),
  animationKinds: animationKinds.map((value) => ({
    value,
    label: label(value),
  })),
  state: snapshot(),
});
draw();
