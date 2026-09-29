import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { documentAnimationDuration, evaluateDocumentAtTime, hasEnabledAnimationTracks } from '../animation/evaluate';
import { createEffect, EFFECT_KINDS, type EffectKind } from '../effects/defaults';
import {
  MAX_GRADIENT_STOPS, MIN_GRADIENT_STOPS, toGradientPaint, toSolidPaint, withAddedStop, withRemovedStop,
} from '../effects/paint-edit';
import { downloadAnimation, exportAnimation } from '../export/animation';
import { exportErrorMessage } from '../export/errors';
import { downloadPng, exportPng } from '../export/png';
import { createDefaultDocument, createDefaultTextElement, createStampElement, STAMP_LABELS } from '../model/defaults';
import { createId } from '../lib/id';
import {
  STAMP_GROUPS, STAMP_IDS, STAMP_IDS_BY_GROUP,
  type AnimationTrack, type Effect, type Gradient, type Paint, type Point, type Rgba, type ShapeElement, type StampId,
  type TextElement, type Transform,
} from '../model/types';
import { parseDocument } from '../model/schema';
import { applyInspectorAction, applyInspectorValue, buildInspector, createNativeAnimation, nativeAnimationKinds, type InspectorValue } from '../native/inspector';
import { InspectorFields, InspectorSectionControls, InspectorStackCard } from '../ui/InspectorControls';
import { stampAspect, stampOutline } from '../geometry/stamps';
import { rgbaToCss } from '../render/color';
import brandLogo from '../assets/brand/wordwarp-logo.png';
import { startAutosave, type AutosaveController } from '../persistence/autosave';
import { loadActiveDocument, saveDocument } from '../persistence/database';
import { applyPresetToElement, BUILT_IN_PRESETS } from '../presets/library';
import { PRESET_CATEGORY_TABS } from '../presets/types';
import type { Preset, PresetCategory } from '../presets/types';
import { buildShareUrl, decodeShareFragment } from '../share/url';
import { subscribeToServiceWorkerUpdate, type ServiceWorkerUpdate } from '../service-worker-update';
import { documentStore, useDocumentStore } from '../state/document-store';
import { PRESET_SIZE_LABELS, PRESET_SIZES, useEditorStore } from '../state/editor-store';
import { holdToast, resumeToast, useUiStore } from '../state/ui-store';
import { type FontCatalogEntry } from '../text/fonts';
import { DocumentCanvas, type GestureKind } from '../ui/DocumentCanvas';
import { FontPicker } from '../ui/FontPicker';
import { PresetPreview } from '../ui/PresetPreview';
import { RackResizer } from '../ui/RackResizer';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const presetCategories = PRESET_CATEGORY_TABS;

/** The side of the square viewBox a stamp's menu icon is drawn into. */
const STAMP_ICON_BOX = 40;
const stampPreviewPaths = Object.fromEntries(
  STAMP_IDS.map((shape) => [shape, stampPreviewPath(shape)]),
) as Record<StampId, string>;

/* Jellybean flavours come in bean-0 .. bean-6 in styles.css; cycle chips through them. */
const BEAN_COLOR_COUNT = 7;

/**
 * What an on-canvas drag calls itself in the history.
 *
 * Each gesture opens one transaction under its own merge key, so a resize that took forty pointer
 * moves is a single undo step, and undoing a rotation does not also undo the move before it.
 */
const GESTURE_LABELS: Record<GestureKind, string> = {
  move: 'Move element',
  scale: 'Resize element',
  rotate: 'Rotate element',
  skew: 'Slant element',
};

type ExportFormat = 'png' | 'apng' | 'gif';

export function App() {
  const [isExporting, setIsExporting] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'object' | 'effects' | 'motion' | 'canvas'>('object');
  const [newAnimationKind, setNewAnimationKind] = useState<AnimationTrack['kind']>('pulse');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [newEffectKind, setNewEffectKind] = useState<EffectKind>('stroke');
  const [stampMenuOpen, setStampMenuOpen] = useState(false);
  const [presetQuery, setPresetQuery] = useState('');
  const [presetCategory, setPresetCategory] = useState<PresetCategory | 'all'>('all');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportScale, setExportScale] = useState(2);
  const [exportProgress, setExportProgress] = useState(0);
  const [playRequested, setPlayRequested] = useState(false);
  const [animationTime, setAnimationTime] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [serviceWorkerUpdate, setServiceWorkerUpdate] = useState<ServiceWorkerUpdate | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const animationTimeRef = useRef(0);
  const autosaveRef = useRef<AutosaveController | null>(null);
  const pendingSearchFocus = useRef(false);
  const stampButtonRef = useRef<HTMLButtonElement>(null);
  const document = useDocumentStore((state) => state.document);
  const pastCount = useDocumentStore((state) => state.past.length);
  const futureCount = useDocumentStore((state) => state.future.length);
  const updateDocument = useDocumentStore((state) => state.updateDocument);
  const beginTransaction = useDocumentStore((state) => state.beginTransaction);
  const commitTransaction = useDocumentStore((state) => state.commitTransaction);
  const replaceDocument = useDocumentStore((state) => state.replaceDocument);
  const undo = useDocumentStore((state) => state.undo);
  const redo = useDocumentStore((state) => state.redo);
  const selectedElementId = useEditorStore((state) => state.selectedElementId);
  const selectElement = useEditorStore((state) => state.selectElement);
  const zoom = useEditorStore((state) => state.zoom);
  const setZoom = useEditorStore((state) => state.setZoom);
  const leftPanelOpen = useEditorStore((state) => state.leftPanelOpen);
  const rightPanelOpen = useEditorStore((state) => state.rightPanelOpen);
  const toggleLeftPanel = useEditorStore((state) => state.toggleLeftPanel);
  const toggleRightPanel = useEditorStore((state) => state.toggleRightPanel);
  const syncPanelsForViewport = useEditorStore((state) => state.syncPanelsForViewport);
  const viewportMode = useEditorStore((state) => state.viewportMode);
  const rackWidth = useEditorStore((state) => state.rackWidth);
  const setRackWidth = useEditorStore((state) => state.setRackWidth);
  const resetRackWidth = useEditorStore((state) => state.resetRackWidth);
  const presetSizeStep = useEditorStore((state) => state.presetSizeStep);
  const stepPresetSize = useEditorStore((state) => state.stepPresetSize);
  const toasts = useUiStore((state) => state.toasts);
  const pushToast = useUiStore((state) => state.pushToast);
  const dismissToast = useUiStore((state) => state.dismissToast);

  useEffect(() => {
    let stopped = false;
    void (async () => {
      await Promise.resolve();
      if (stopped) return;
      let shared: ReturnType<typeof decodeShareFragment> = null;
      try {
        try {
          shared = decodeShareFragment(window.location.hash);
        } catch (error) {
          clearShareFragment();
          pushToast(error instanceof Error ? error.message : 'Could not read the share link', 'error');
        }
        const restored = shared ?? await loadActiveDocument();
        if (stopped) return;
        if (restored) {
          replaceDocument(restored);
          selectElement(restored.elements[0]?.id ?? null);
        }
        if (shared) {
          await saveDocument(shared);
          if (stopped) return;
          clearShareFragment();
          pushToast('Opened a shared copy', 'success');
        }
      } catch (error) {
        if (!stopped) setRestoreError(error instanceof Error ? error.message : 'Could not restore the document');
        return;
      }
      if (stopped) return;
      autosaveRef.current = startAutosave(documentStore, () => pushToast('Autosave is unavailable', 'warning'));
      setIsHydrated(true);
    })();
    return () => {
      stopped = true;
      autosaveRef.current?.stop();
      autosaveRef.current = null;
    };
  }, [pushToast, replaceDocument, selectElement]);

  useEffect(() => {
    if (!isHydrated) return;
    let stopped = false;
    const importSharedDocument = () => {
      void (async () => {
        let shared: ReturnType<typeof decodeShareFragment>;
        try {
          shared = decodeShareFragment(window.location.hash);
        } catch (error) {
          clearShareFragment();
          if (!stopped) pushToast(error instanceof Error ? error.message : 'Could not read the share link', 'error');
          return;
        }
        if (!shared) return;
        setIsImporting(true);
        try {
          await autosaveRef.current?.flush();
          if (stopped) return;
          replaceDocument(shared);
          selectElement(shared.elements[0]?.id ?? null);
          await saveDocument(shared);
          if (stopped) return;
          clearShareFragment();
          pushToast('Opened a shared copy', 'success');
        } catch (error) {
          if (!stopped) pushToast(error instanceof Error ? error.message : 'Could not open the share link', 'error');
        } finally {
          if (!stopped) setIsImporting(false);
        }
      })();
    };
    window.addEventListener('hashchange', importSharedDocument);
    return () => {
      stopped = true;
      window.removeEventListener('hashchange', importSharedDocument);
    };
  }, [isHydrated, pushToast, replaceDocument, selectElement]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1051px)');
    const mobile = window.matchMedia('(max-width: 740px)');
    const sync = () => syncPanelsForViewport(window.innerWidth);
    sync();
    desktop.addEventListener('change', sync);
    mobile.addEventListener('change', sync);
    return () => {
      desktop.removeEventListener('change', sync);
      mobile.removeEventListener('change', sync);
    };
  }, [syncPanelsForViewport]);

  useEffect(() => subscribeToServiceWorkerUpdate((update) => setServiceWorkerUpdate(() => update)), []);

  const hasAnimations = hasEnabledAnimationTracks(document);
  // Derived rather than synchronised: when the last enabled track goes, playback stops on its own.
  // An effect writing the flag back instead would leave a window where the loop is still
  // running behind a disabled button, and `react-hooks/set-state-in-effect` objects to the shape.
  const isPlaying = playRequested && hasAnimations;
  const animationDuration = documentAnimationDuration(document);
  useEffect(() => {
    if (!isPlaying) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pauseForReducedMotion = () => {
      if (!reducedMotion.matches) return false;
      setPlayRequested(false);
      pushToast('Animation preview is paused by reduced-motion preferences', 'info');
      return true;
    };
    if (pauseForReducedMotion()) return;
    reducedMotion.addEventListener('change', pauseForReducedMotion);
    const started = performance.now() - animationTimeRef.current * animationDuration * 1000;
    let frame = 0;
    const tick = (now: number) => {
      const nextTime = ((now - started) / (animationDuration * 1000)) % 1;
      animationTimeRef.current = nextTime;
      setAnimationTime(nextTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      reducedMotion.removeEventListener('change', pauseForReducedMotion);
    };
  }, [animationDuration, isPlaying, pushToast]);

  useEffect(() => {
    if (!leftPanelOpen || !pendingSearchFocus.current) return;
    pendingSearchFocus.current = false;
    window.document.getElementById('preset-search')?.focus();
  }, [leftPanelOpen]);

  useEffect(() => {
    if (!stampMenuOpen) return;
    const dismissStampMenu = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setStampMenuOpen(false);
      stampButtonRef.current?.focus();
    };
    window.addEventListener('keydown', dismissStampMenu, { capture: true });
    return () => window.removeEventListener('keydown', dismissStampMenu, { capture: true });
  }, [stampMenuOpen]);

  const selectedElement = document.elements.find((element) => element.id === selectedElementId);
  const selectedText = selectedElement?.type === 'text' ? selectedElement : null;
  const selectedShape = selectedElement?.type === 'shape' ? selectedElement : null;

  const inspectorSections = useMemo(() => buildInspector(document, selectedElementId), [document, selectedElementId]);
  const objectInspector = inspectorSections.find((section) => section.category === 'object');
  const effectInspector = inspectorSections.find((section) => section.category === 'effects');
  const motionInspector = inspectorSections.find((section) => section.category === 'animation');
  const canvasInspector = inspectorSections.find((section) => section.category === 'document')!;

  const changeInspectorField = (id: string, value: InspectorValue) => {
    try {
      updateDocument('Adjust property', (draft) => {
        applyInspectorValue(draft, selectedElementId, id, value);
        parseDocument(draft);
        documentAnimationDuration(draft);
      }, `inspector:${id}`);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'This property could not be changed.', 'error');
    }
  };
  const performInspectorAction = (id: string) => {
    try {
      updateDocument('Edit property', (draft) => {
        applyInspectorAction(draft, selectedElementId, id);
        parseDocument(draft);
      });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'This property could not be changed.', 'error');
    }
  };
  const inspectorControls = { onChange: changeInspectorField, onAction: performInspectorAction };

  const changeAnimation = (id: string, action: 'toggle' | 'remove') => {
    updateDocument(action === 'toggle' ? 'Toggle animation' : 'Remove animation', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElementId);
      const index = element?.animations.findIndex((track) => track.id === id) ?? -1;
      if (!element || index < 0) return;
      if (action === 'remove') element.animations.splice(index, 1);
      else element.animations[index]!.enabled = !element.animations[index]!.enabled;
    });
  };
  const addAnimation = () => {
    if (!selectedElement) return;
    const track = createNativeAnimation(newAnimationKind);
    try {
      updateDocument('Add animation', (draft) => {
        draft.elements.find((element) => element.id === selectedElement.id)!.animations.push(track);
        documentAnimationDuration(draft);
      });
      setExpandedItem(track.id);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'This animation could not be added.', 'error');
    }
  };

  const removeSelected = () => {
    if (!selectedElementId) return;
    const selectedIndex = document.elements.findIndex((element) => element.id === selectedElementId);
    if (selectedIndex < 0) {
      selectElement(null);
      return;
    }
    if (document.elements[selectedIndex]?.locked) return;
    updateDocument('Delete element', (draft) => {
      const index = draft.elements.findIndex((element) => element.id === selectedElementId);
      if (index >= 0) draft.elements.splice(index, 1);
    });
    const next = document.elements[selectedIndex + 1] ?? document.elements[selectedIndex - 1];
    selectElement(next?.id ?? null);
  };

  const duplicateSelected = () => {
    const source = document.elements.find((element) => element.id === selectedElementId);
    if (!source || source.locked) return;
    const copy = structuredClone(source);
    copy.id = createId();
    copy.name = `${source.name} copy`;
    copy.transform.x += 24;
    copy.transform.y += 24;
    copy.effects = copy.effects.map((effect) => ({ ...effect, id: createId() }));
    copy.animations = copy.animations.map((track) => ({ ...track, id: createId() }));
    updateDocument('Duplicate element', (draft) => {
      const index = draft.elements.findIndex((element) => element.id === source.id);
      draft.elements.splice(index < 0 ? draft.elements.length : index + 1, 0, copy);
    });
    selectElement(copy.id);
  };

  const nudgeSelected = (dx: number, dy: number) => {
    if (!selectedElementId) return;
    updateDocument('Nudge element', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElementId);
      if (element && !element.locked) {
        element.transform.x += dx;
        element.transform.y += dy;
      }
    }, `nudge:${selectedElementId}`);
  };

  const focusPresetSearch = () => {
    if (leftPanelOpen) {
      window.document.getElementById('preset-search')?.focus();
      return;
    }
    // A closed panel is `visibility: hidden` rather than unmounted, and hidden elements cannot
    // take focus. `toggleLeftPanel` only schedules the state change, so focusing in the same tick
    // is a silent no-op -- the panel opens and focus stays on the body. Defer to after the commit.
    pendingSearchFocus.current = true;
    toggleLeftPanel();
  };

  const moveSelectedLayer = (direction: -1 | 1) => {
    if (!selectedElementId) return;
    updateDocument('Reorder layer', (draft) => {
      const index = draft.elements.findIndex((element) => element.id === selectedElementId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= draft.elements.length) return;
      const [element] = draft.elements.splice(index, 1);
      draft.elements.splice(nextIndex, 0, element!);
    });
  };

  useKeyboardShortcuts({
    undo,
    redo,
    remove: removeSelected,
    duplicate: duplicateSelected,
    deselect: () => selectElement(null),
    focusSearch: focusPresetSearch,
    nudge: nudgeSelected,
  }, isHydrated && !isImporting && !isUpdating);

  const addText = () => {
    const element = createDefaultTextElement();
    element.name = `Text ${document.elements.length + 1}`;
    element.text = 'New warp';
    element.transform.x += document.elements.length * 24;
    element.transform.y += document.elements.length * 24;
    updateDocument('Add text', (draft) => {
      draft.elements.push(element);
    });
    selectElement(element.id);
  };

  const addStamp = (shape: StampId) => {
    // Cascaded rather than centred: a scene is several stamps, and dropping each one on the
    // canvas midpoint would bury it under both the word and the stamp before it. The run wraps so
    // a long session cannot walk them off the bottom-right corner.
    const placed = document.elements.reduce((count, element) => count + (element.type === 'shape' ? 1 : 0), 0);
    const offset = (placed % 8) * 56;
    const element = createStampElement(shape, [
      document.canvas.width * 0.26 + offset,
      document.canvas.height * 0.26 + offset,
    ]);
    updateDocument(`Add ${STAMP_LABELS[shape].toLocaleLowerCase()}`, (draft) => {
      draft.elements.push(element);
    });
    selectElement(element.id);
    setStampMenuOpen(false);
    stampButtonRef.current?.focus();
  };

  const updateStamp = (change: (element: ShapeElement) => void) => {
    if (!selectedShape) return;
    updateDocument('Edit stamp', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedShape.id);
      if (element?.type === 'shape') change(element);
    });
  };

  /**
   * `mergeKey` is for controls that emit a stream: a slider dragged across its track is one edit,
   * not forty. A button press is already one edit, so it passes `undefined` -- sharing a key would
   * fold two deliberate presses inside the merge window into a single history entry.
   */
  const updateSelectedTransform = (
    label: string,
    mergeKey: string | undefined,
    change: (transform: Transform) => void,
  ) => {
    if (!selectedElement) return;
    updateDocument(label, (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElement.id);
      if (element && !element.locked) change(element.transform);
    }, mergeKey === undefined ? undefined : `${mergeKey}:${selectedElement.id}`);
  };

  /**
   * Numeric twins for the on-canvas handles, shared by every element that has a transform.
   *
   * The handles are the fast way to do this and the reason the section exists at all, but they are
   * pointer-only and inexact. These controls are what a keyboard reaches, and what someone typing
   * an exact angle uses; both write the same five numbers, so neither can drift from the canvas.
   */
  const renderTransformSection = (element: TextElement | ShapeElement) => (
    <section className="inspector-section transform-section">
      <h2>Transform <span>{Math.round(element.transform.rotation)} DEG</span></h2>
      <p className="foundation-note">
        Drag the shape itself to move it, the square handles to resize, the round handle to rotate
        and the diamonds to slant. Hold Shift to snap angles and hold a corner's proportions.
      </p>
      <label className="range-field">
        <span>Rotation <output>{Math.round(element.transform.rotation)}</output></span>
        <input
          className="goo-range"
          type="range"
          min="-180"
          max="180"
          value={element.transform.rotation}
          onChange={(event) => {
            const rotation = Number(event.target.value);
            updateSelectedTransform('Rotate element', 'rotation', (transform) => {
              transform.rotation = rotation;
            });
          }}
        />
      </label>
      <div className="field-row">
        {(['scaleX', 'scaleY'] as const).map((axis) => (
          <label className="range-field" key={axis}>
            <span>
              {axis === 'scaleX' ? 'Scale X' : 'Scale Y'} <output>{element.transform[axis].toFixed(2)}</output>
            </span>
            <input
              className="goo-range"
              type="range"
              // Magnitude only, from the floor the canvas clamps a resize to. A handle dragged
              // past its anchor mirrors the element, and running the track through the negatives
              // to reach that would spend half of it on mirrored sizes and leave a dead zero in
              // the middle -- so the sign stays where the drag left it, and Flip below is what
              // changes it. The readout keeps showing the signed value either way.
              min="0.01"
              max="4"
              step="0.01"
              value={Math.abs(element.transform[axis])}
              onChange={(event) => {
                const magnitude = Number(event.target.value);
                updateSelectedTransform('Resize element', axis, (transform) => {
                  transform[axis] = transform[axis] < 0 ? -magnitude : magnitude;
                });
              }}
            />
          </label>
        ))}
      </div>
      <div className="field-row">
        {(['scaleX', 'scaleY'] as const).map((axis) => (
          <button
            key={axis}
            className="orb orb-xs orb-berry"
            type="button"
            aria-pressed={element.transform[axis] < 0}
            onClick={() => updateSelectedTransform('Mirror element', undefined, (transform) => {
              transform[axis] = -transform[axis];
            })}
          >
            Flip {axis === 'scaleX' ? 'X' : 'Y'}
          </button>
        ))}
      </div>
      <div className="field-row">
        {(['skewX', 'skewY'] as const).map((axis) => (
          <label className="range-field" key={axis}>
            <span>
              {axis === 'skewX' ? 'Slant X' : 'Slant Y'} <output>{Math.round(element.transform[axis])}</output>
            </span>
            <input
              className="goo-range"
              type="range"
              min="-80"
              max="80"
              value={element.transform[axis]}
              onChange={(event) => {
                const angle = Number(event.target.value);
                updateSelectedTransform('Slant element', axis, (transform) => {
                  transform[axis] = angle;
                });
              }}
            />
          </label>
        ))}
      </div>
      <button
        className="orb orb-xs orb-grape"
        type="button"
        onClick={() => updateSelectedTransform('Reset transform', undefined, (transform) => {
          // Position is deliberately left alone: this undoes the shaping, not the placement.
          transform.rotation = 0;
          transform.scaleX = 1;
          transform.scaleY = 1;
          transform.skewX = 0;
          transform.skewY = 0;
        })}
      >
        Reset shape
      </button>
    </section>
  );

  const setBackground = (paint: Paint | null) => {
    updateDocument(paint ? 'Set background' : 'Clear background', (draft) => {
      draft.canvas.background = paint;
    });
  };

  const updateText = (text: string) => {
    if (!selectedText) return;
    updateDocument(
      'Edit text',
      (draft) => {
        const element = draft.elements.find((candidate) => candidate.id === selectedText.id);
        if (element?.type !== 'text') return;
        element.text = text;
        element.name = text.trim().slice(0, 24) || 'Text';
      },
      `text:${selectedText.id}`,
    );
  };

  const applyPreset = (preset: Preset) => {
    if (!selectedElement) return;
    updateDocument(`Apply ${preset.name}`, (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElement.id);
      if (element?.type !== 'text' && element?.type !== 'shape') return;
      applyPresetToElement(element, preset);
    });
  };

  /**
   * The effect stack editor, shared by every element that has one.
   *
   * A stamp's stack is the same list of the same effects in the same order as a word's -- the
   * renderer works from a face's alpha either way -- so it gets the same editor rather than a
   * parallel one that would drift out of step with it.
   */
  const renderEffectsSection = (effects: Effect[]) => (
    <section className="effects-section">
        <div className="section-title-row">
          <h2>Effect stack</h2>
          <span>{effects.length}</span>
        </div>
        <ol className="effect-list">
          {effects.map((effect, index) => {
            const section = effectInspector?.children?.find((item) => item.id === effect.id);
            return <InspectorStackCard key={effect.id} title={effectLabel(effect.kind)} enabled={effect.enabled}
              initiallyExpanded={expandedItem === effect.id} onToggle={() => toggleEffect(effect.id)} actions={<>
                <button type="button" disabled={index === 0} onClick={() => moveEffect(effect.id, -1)} aria-label="Move effect up" title="Move up">↑</button>
                <button type="button" disabled={index === effects.length - 1} onClick={() => moveEffect(effect.id, 1)} aria-label="Move effect down" title="Move down">↓</button>
                <button type="button" onClick={() => removeEffect(effect.id)} aria-label={`Remove ${effectLabel(effect.kind)}`} title="Remove effect">×</button>
              </>}>
              {section && <InspectorFields fields={section.fields.filter((field) => field.path.at(-1) !== 'enabled')} {...inspectorControls} />}
              <EffectPaintControls
                effect={effect}
                onKindChange={(kind) => setEffectPaintKind(effect.id, kind)}
                onSolidChange={(hex) => updateEffectColor(effect.id, 'paint', hex)}
                onStopChange={(stopIndex, hex) => updateGradientStopColor(effect.id, stopIndex, hex)}
                onStopOffsetChange={(stopIndex, offset) => updateGradientStopOffset(effect.id, stopIndex, offset)}
                onAddStop={() => addGradientStop(effect.id)}
                onRemoveStop={() => removeGradientStop(effect.id)}
                onTypeChange={(type) => updateGradientType(effect.id, type)}
                onAngleChange={(angle) => updateGradientAngle(effect.id, angle)}
              />
              {section?.children?.map((child) => <details className="metadata-section" key={child.id}>
                <summary>{child.label === 'Paint' ? 'More paint controls' : child.label}</summary>
                <InspectorSectionControls section={child} {...inspectorControls} />
              </details>)}
            </InspectorStackCard>;
          })}
        </ol>
        <div className="effect-adder">
          <select className="jelly-select" aria-label="New effect" value={newEffectKind} onChange={(event) => setNewEffectKind(event.target.value as EffectKind)}>
            {EFFECT_KINDS.map((kind) => <option key={kind} value={kind}>{effectLabel(kind)}</option>)}
          </select>
          <button className="add-effect orb orb-xs orb-lime" type="button" onClick={addEffect}>+ Add</button>
        </div>
      </section>
  );

  const visiblePresets = BUILT_IN_PRESETS.filter((preset) => {
    const categoryMatches = presetCategory === 'all' || preset.category === presetCategory;
    const query = presetQuery.trim().toLocaleLowerCase();
    const queryMatches = !query || `${preset.name} ${preset.tags.join(' ')}`.toLocaleLowerCase().includes(query);
    return categoryMatches && queryMatches;
  });

  const toggleEffect = (effectId: string) => {
    if (!selectedElement) return;
    updateDocument('Toggle effect', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElement.id);
      const effect = element?.effects.find((candidate) => candidate.id === effectId);
      if (effect) effect.enabled = !effect.enabled;
    });
  };

  const addEffect = () => {
    if (!selectedElement) return;
    const effect = createEffect(newEffectKind);
    setExpandedItem(effect.id);
    updateDocument('Add effect', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElement.id);
      element?.effects.push(effect);
    });
  };

  const removeEffect = (effectId: string) => {
    if (!selectedElement) return;
    updateDocument('Remove effect', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElement.id);
      if (!element) return;
      const index = element.effects.findIndex((effect) => effect.id === effectId);
      if (index >= 0) element.effects.splice(index, 1);
    });
  };

  const moveEffect = (effectId: string, direction: -1 | 1) => {
    if (!selectedElement) return;
    updateDocument('Reorder effect', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElement.id);
      if (!element) return;
      const index = element.effects.findIndex((effect) => effect.id === effectId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= element.effects.length) return;
      const [effect] = element.effects.splice(index, 1);
      element.effects.splice(nextIndex, 0, effect!);
    });
  };

  const updateEffectColor = (effectId: string, target: 'paint' | 'color' | 'highlight' | 'shadow', hex: string) => {
    if (!selectedElement) return;
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    updateDocument('Change effect color', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElement.id);
      const effect = element?.effects.find((candidate) => candidate.id === effectId);
      if (!effect) return;
      if (target === 'paint' && 'paint' in effect && effect.paint.kind === 'solid') {
        effect.paint.color = [rgb[0], rgb[1], rgb[2], effect.paint.color[3]];
      } else if (target === 'color' && 'color' in effect) {
        effect.color = [rgb[0], rgb[1], rgb[2], effect.color[3]];
      } else if (effect.kind === 'bevel' && (target === 'highlight' || target === 'shadow')) {
        const slot = target === 'highlight' ? effect.highlight : effect.shadow;
        slot.color = [rgb[0], rgb[1], rgb[2], slot.color[3]];
      }
    }, `effect-color:${effectId}:${target}`);
  };

  const setEffectPaintKind = (effectId: string, kind: 'solid' | 'gradient') => {
    if (!selectedElement) return;
    updateDocument(kind === 'gradient' ? 'Make paint a gradient' : 'Make paint solid', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElement.id);
      const effect = element?.effects.find((candidate) => candidate.id === effectId);
      if (!effect || !('paint' in effect) || effect.paint.kind === kind) return;
      effect.paint = kind === 'gradient' ? toGradientPaint(effect.paint) : toSolidPaint(effect.paint);
    });
  };

  const updateEffectGradient = (
    effectId: string,
    label: string,
    change: (gradient: Gradient) => Gradient | void,
    mergeKey?: string,
  ) => {
    if (!selectedElement) return;
    updateDocument(label, (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedElement.id);
      const effect = element?.effects.find((candidate) => candidate.id === effectId);
      if (!effect || !('paint' in effect) || effect.paint.kind !== 'gradient') return;
      effect.paint.gradient = change(effect.paint.gradient) ?? effect.paint.gradient;
    }, mergeKey);
  };

  const updateGradientStopColor = (effectId: string, stopIndex: number, hex: string) => {
    const rgb = hexToRgb(hex);
    if (!rgb) return;
    updateEffectGradient(effectId, 'Change gradient stop', (gradient) => {
      const stop = gradient.stops[stopIndex];
      if (stop) stop.color = [rgb[0], rgb[1], rgb[2], stop.color[3]];
    }, `gradient-stop:${effectId}:${stopIndex}`);
  };

  const updateGradientStopOffset = (effectId: string, stopIndex: number, offset: number) => {
    updateEffectGradient(effectId, 'Move gradient stop', (gradient) => {
      const stop = gradient.stops[stopIndex];
      if (!stop) return;
      // Neighbours bound the move, inclusively: stops may meet -- two stops sharing an offset are
      // the model's hard edge -- but never pass each other, since the schema requires order.
      const low = gradient.stops[stopIndex - 1]?.offset ?? 0;
      const high = gradient.stops[stopIndex + 1]?.offset ?? 1;
      stop.offset = Math.min(high, Math.max(low, offset));
    }, `gradient-offset:${effectId}:${stopIndex}`);
  };

  const updateGradientAngle = (effectId: string, angle: number) => {
    updateEffectGradient(effectId, 'Turn gradient', (gradient) => { gradient.angle = angle; },
      `gradient-angle:${effectId}`);
  };

  const updateGradientType = (effectId: string, type: Gradient['type']) => {
    updateEffectGradient(effectId, 'Change gradient shape', (gradient) => { gradient.type = type; });
  };

  const addGradientStop = (effectId: string) => {
    updateEffectGradient(effectId, 'Add gradient stop', withAddedStop);
  };

  const removeGradientStop = (effectId: string) => {
    updateEffectGradient(effectId, 'Remove gradient stop', withRemovedStop);
  };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportProgress(0);
    try {
      if (exportFormat === 'png') {
        const result = await exportPng(document, exportScale);
        downloadPng(result);
        pushToast(`Exported ${result.width} x ${result.height} transparent PNG`, 'success');
      } else {
        const result = await exportAnimation(document, {
          format: exportFormat,
          scale: exportScale,
          onProgress: setExportProgress,
        });
        downloadAnimation(result);
        // A frame rate the budget lowered is still a successful export, but it is not the export
        // that was asked for, so it says so rather than reporting plain success. `reduced` rather
        // than a rate comparison: rounding a whole number of frames back into a rate can land
        // under the requested one without anything having been given up.
        if (result.reduced) {
          pushToast(
            `Exported ${result.frameCount}-frame ${exportFormat.toUpperCase()} at ${result.fps} fps,`
            + ` down from ${result.requestedFps} fps to fit this resolution in memory`,
            'warning',
          );
        } else {
          pushToast(`Exported ${result.frameCount}-frame ${exportFormat.toUpperCase()}`, 'success');
        }
      }
    } catch (error) {
      pushToast(exportErrorMessage(error), 'error');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleShare = async () => {
    try {
      const url = buildShareUrl(document, window.location);
      if (navigator.share) await navigator.share({ title: document.name, url });
      else await navigator.clipboard.writeText(url);
      pushToast('Share link ready', 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Could not share this document', 'error');
    }
  };

  const applyServiceWorkerUpdate = async () => {
    if (!serviceWorkerUpdate || isUpdating) return;
    setIsUpdating(true);
    try {
      await autosaveRef.current?.flush();
      await serviceWorkerUpdate();
    } catch (error) {
      setIsUpdating(false);
      pushToast(error instanceof Error ? error.message : 'Could not apply the update', 'error');
    }
  };

  // Paused means frame zero, not wherever the loop happened to stop. The canvas is what a drag
  // reads an element's starting transform from, and every track evaluates to the document's own
  // values at zero -- so this is what stops a gesture on a paused bounce from writing the bounce's
  // own offset back into the document as if the user had put it there.
  const previewDocument = evaluateDocumentAtTime(document, isPlaying ? animationTime : 0);
  const fitZoomToViewport = () => {
    const viewport = window.document.querySelector('.canvas-viewport');
    const wrap = window.document.querySelector<HTMLElement>('.artboard-wrap');
    if (!(viewport instanceof HTMLElement) || !wrap) return;
    // `offsetWidth` is a layout measurement and ignores the `transform: scale(zoom)` on the wrap,
    // so it is the unzoomed size directly. Measuring the transformed rect and dividing by `zoom`
    // instead would make this depend on the zoom being applied already -- and the wrap animates
    // over 120ms, so a rect read mid-transition belongs to a zoom the element has not reached.
    if (wrap.offsetWidth === 0 || wrap.offsetHeight === 0) return;
    // `clientWidth` includes the viewport's own padding, which is not usable space.
    const styles = window.getComputedStyle(viewport);
    const availableWidth = viewport.clientWidth
      - Number.parseFloat(styles.paddingLeft) - Number.parseFloat(styles.paddingRight);
    const availableHeight = viewport.clientHeight
      - Number.parseFloat(styles.paddingTop) - Number.parseFloat(styles.paddingBottom);
    // The result is the absolute zoom that fits, not a factor to apply to the current one.
    const scale = Math.min(availableWidth / wrap.offsetWidth, availableHeight / wrap.offsetHeight);
    if (!Number.isFinite(scale) || scale <= 0) return;
    setZoom(scale);
  };

  if (restoreError) {
    return (
      <div className="loading-screen recovery-screen" role="alert">
        <strong>Could not restore your saved document</strong>
        <p>{restoreError}</p>
        <div>
          <button className="orb orb-sm orb-aqua" type="button" onClick={() => window.location.reload()}>Retry</button>
          <button className="orb orb-sm orb-lime" type="button" onClick={() => {
            const freshDocument = createDefaultDocument();
            replaceDocument(freshDocument);
            selectElement(freshDocument.elements[0]?.id ?? null);
            clearShareFragment();
            autosaveRef.current = startAutosave(documentStore, () => pushToast('Autosave is unavailable', 'warning'));
            setRestoreError(null);
            setIsHydrated(true);
          }}>Start a new document</button>
        </div>
      </div>
    );
  }

  if (!isHydrated) {
    return <div className="loading-screen" role="status">Warming up the goo…</div>;
  }

  return (
    <div
      className="app-shell"
      inert={isImporting || isUpdating}
      aria-busy={isImporting || isUpdating}
      style={{
        '--rack-user-width': `${rackWidth}px`,
        '--preset-size': `${PRESET_SIZES[presetSizeStep] ?? PRESET_SIZES[2]}px`,
      } as CSSProperties}
    >
      <header className="topbar">
        <button
          className="brand"
          type="button"
          aria-label="WordWarp Your Gooey Type Lab"
          onClick={() => pushToast('WordWarp goo is fresh and wobbly')}
        >
          {/* The official lockup, byte-identical to media-sources/logo.png. The words live in the
              button's label; at header size the baked-in claim is decorative. */}
          <img className="brand-logo" src={brandLogo} alt="" />
        </button>

        <div className="history-actions" aria-label="History controls">
          <button className="orb orb-sm orb-grape" type="button" onClick={undo} disabled={pastCount === 0} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="orb orb-sm orb-lime" type="button" onClick={redo} disabled={futureCount === 0} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
        </div>

        <div className="topbar-actions">
          <button
            className="panel-toggle orb orb-sm orb-berry"
            type="button"
            onClick={toggleLeftPanel}
            aria-expanded={leftPanelOpen}
            aria-controls="preset-panel"
          >Presets</button>
          <button
            className="panel-toggle orb orb-sm orb-tangerine"
            type="button"
            onClick={toggleRightPanel}
            aria-expanded={rightPanelOpen}
            aria-controls="inspector-panel"
          >Inspect</button>
          <button className="orb orb-sm orb-aqua" type="button" onClick={() => void handleShare()}>Share</button>
          <select
            className="export-format jelly-select"
            aria-label="Export format"
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
          >
            <option value="png">PNG</option>
            <option value="apng">APNG</option>
            <option value="gif">GIF</option>
          </select>
          <select
            className="export-format jelly-select"
            aria-label="Export resolution"
            value={exportScale}
            onChange={(event) => setExportScale(Number(event.target.value))}
          >
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={3}>3x</option>
            <option value={4}>4x</option>
          </select>
          <button className="export-button orb orb-lg orb-sun" type="button" onClick={() => void handleExport()} disabled={isExporting}>
            {isExporting ? `${Math.round(exportProgress * 100)}%` : `Export ${exportFormat.toUpperCase()}`} <span aria-hidden="true">✦</span>
          </button>
          <a className="licenses-link" href={`${import.meta.env.BASE_URL}licenses/index.html`} target="_blank" rel="noopener">Licenses</a>
        </div>
      </header>

      <div className={`workspace ${leftPanelOpen ? '' : 'left-closed'} ${rightPanelOpen ? '' : 'right-closed'}`}>
        <aside id="preset-panel" className="preset-panel" aria-label="Preset library">
          <div className="panel-heading">
            <span>STYLE RACK</span>
            <span className="count">{String(visiblePresets.length).padStart(2, '0')}</span>
          </div>
          <label className="search-field jelly-field-wrap">
            <span className="sr-only">Search presets</span>
            <input
              id="preset-search"
              type="search"
              placeholder="Find a look..."
              value={presetQuery}
              onChange={(event) => setPresetQuery(event.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <div className="preset-categories" aria-label="Preset categories">
            {presetCategories.map((category, index) => (
              <button
                key={category.id}
                type="button"
                className={`bean bean-${index % BEAN_COLOR_COUNT} ${presetCategory === category.id ? 'active' : ''}`}
                onClick={() => setPresetCategory(category.id)}
              >
                {category.label}
              </button>
            ))}
          </div>
          <div className="preset-size-row">
            <span>Preview size</span>
            <span className="preset-size-controls" role="group" aria-label="Preview size">
              <button
                className="orb orb-xs orb-aqua"
                type="button"
                aria-label="Smaller previews"
                disabled={presetSizeStep === 0}
                onClick={() => stepPresetSize(-1)}
              >−</button>
              <output className="jelly-pill">{PRESET_SIZE_LABELS[presetSizeStep]}</output>
              <button
                className="orb orb-xs orb-aqua"
                type="button"
                aria-label="Larger previews"
                disabled={presetSizeStep === PRESET_SIZES.length - 1}
                onClick={() => stepPresetSize(1)}
              >+</button>
            </span>
          </div>
          <div className="preset-grid">
            {visiblePresets.map((preset) => (
              <button
                className="preset-card"
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset)}
              >
                <PresetPreview key={preset.id} preset={preset} swatch={swatchGradient(preset.preview)} />
                <span className="preset-meta">
                  <strong>{preset.name}</strong>
                  <small>{preset.category.toUpperCase()}{preset.animated ? ' / MOTION' : ''}</small>
                </span>
              </button>
            ))}
          </div>
          {visiblePresets.length === 0 && <p className="foundation-note">No styles match this search.</p>}
        </aside>

        {/* Only the three-column desktop layout has a rack edge to drag: below 1051px the rack is
            an overlay sitting on top of the canvas, and its width is not the canvas's loss. */}
        {viewportMode === 'desktop' && leftPanelOpen && (
          <RackResizer width={rackWidth} onResize={setRackWidth} onReset={resetRackWidth} />
        )}

        <main className="canvas-panel">
          <div className="canvas-toolbar">
            <div className="tool-group" aria-label="Canvas tools">
              <button className="orb orb-xs orb-lime" type="button" onClick={addText}>Add Text</button>
              <button
                ref={stampButtonRef}
                className="orb orb-xs orb-aqua"
                type="button"
                aria-expanded={stampMenuOpen}
                aria-controls="stamp-menu"
                onClick={() => setStampMenuOpen((open) => !open)}
              >
                Add Stamp
              </button>
            </div>
            {stampMenuOpen && (
              <div className="stamp-menu" id="stamp-menu" role="group" aria-label="Place a stamp">
                {STAMP_GROUPS.map((group) => (
                  <section className="stamp-group" key={group.id} aria-label={group.label}>
                    <h3>{group.label}</h3>
                    <div className="stamp-grid">
                      {STAMP_IDS_BY_GROUP[group.id].map((shape) => (
                        <button key={shape} className="stamp-choice" type="button" onClick={() => addStamp(shape)}>
                          <svg viewBox="0 0 40 40" aria-hidden="true"><path d={stampPreviewPaths[shape]} /></svg>
                          <span>{STAMP_LABELS[shape]}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
            <span className="canvas-status">
              {document.canvas.width} × {document.canvas.height} · {backgroundLabel(document.canvas.background)}
            </span>
          </div>

          <div className="canvas-viewport">
            <div className="canvas-rulers" aria-hidden="true">
              <span>0</span><span>300</span><span>600</span><span>900</span><span>1200</span>
            </div>
            <div
              className="artboard-wrap"
              style={{ transform: `scale(${zoom})` }}
            >
              <DocumentCanvas
                document={previewDocument}
                selectedElementId={selectedElementId}
                zoom={zoom}
                onSelect={selectElement}
                onTransformStart={isPlaying ? undefined : (id, gesture) => {
                  beginTransaction(GESTURE_LABELS[gesture], `${gesture}:${id}`);
                }}
                onTransform={isPlaying ? undefined : (id, transform) => {
                  updateDocument('Transform element', (draft) => {
                    const element = draft.elements.find((candidate) => candidate.id === id);
                    if (element && !element.locked) element.transform = transform;
                  });
                }}
                onTransformEnd={isPlaying ? undefined : commitTransaction}
              />
            </div>
          </div>

          <div className="zoom-strip">
            <button className="orb orb-xs orb-aqua" type="button" onClick={fitZoomToViewport}>Fit</button>
            <button className="orb orb-xs orb-grape" type="button" onClick={() => setZoom(1)}>100%</button>
            <button className="orb orb-xs orb-berry" type="button" onClick={() => setZoom(zoom - 0.1)} aria-label="Zoom out">−</button>
            <output className="jelly-pill">{Math.round(zoom * 100)}%</output>
            <button className="orb orb-xs orb-berry" type="button" onClick={() => setZoom(zoom + 0.1)} aria-label="Zoom in">+</button>
            <button
              type="button"
              className={`orb orb-xs orb-lime ${isPlaying ? 'playing' : ''}`}
              disabled={!hasAnimations}
              title={hasAnimations ? undefined : 'Add an animated preset to preview motion'}
              onClick={() => {
                // Pausing shows frame zero rather than freezing where the loop stopped, so that
                // a drag always reads the document's own transform. Rewinding here keeps the
                // resume honest too: playback restarts from the frame that is on screen.
                if (isPlaying) animationTimeRef.current = 0;
                setPlayRequested(!isPlaying);
              }}
              aria-pressed={isPlaying}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
          </div>
        </main>

        <aside id="inspector-panel" className="inspector-panel" aria-label="Inspector">
          <div className="panel-heading">
            <span>GOO CONTROLS</span>
            <span className="selection-dot" aria-hidden="true" />
          </div>
          <div className="inspector-tabs" role="tablist" aria-label="Editor sections">
            {(['object', 'effects', 'motion', 'canvas'] as const).map((tab, index, tabs) => (
              <button key={tab} id={`inspector-tab-${tab}`} type="button" role="tab"
                aria-selected={inspectorTab === tab} aria-controls={`inspector-${tab}`} tabIndex={inspectorTab === tab ? 0 : -1}
                onClick={() => setInspectorTab(tab)} onKeyDown={(event) => {
                  const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
                    : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length]
                      : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : undefined;
                  if (!next) return;
                  event.preventDefault(); setInspectorTab(next);
                  event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#inspector-tab-${next}`)?.focus();
                }}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>
            ))}
          </div>
          <div id="inspector-object" role="tabpanel" aria-labelledby="inspector-tab-object" hidden={inspectorTab !== 'object'}>
          {selectedText ? (
            <>
              <section className="inspector-section open">
                <h2>Text</h2>
                <label>
                  <span>Content</span>
                  <textarea
                    className="jelly-field"
                    value={selectedText.text}
                    onChange={(event) => updateText(event.target.value)}
                    rows={3}
                  />
                </label>
                <div className="font-family-field">
                  <FontPicker
                    value={selectedText.font.family}
                    onPick={(entry: FontCatalogEntry) => {
                      updateDocument('Change font family', (draft) => {
                        const element = draft.elements.find((item) => item.id === selectedText.id);
                        if (element?.type !== 'text') return;
                        element.font.family = entry.family;
                        element.font.source = entry.source;
                        element.font.weight = entry.weight;
                        // The catalogue's bundled display faces ship upright-only, and global
                        // font-synthesis is off, so an inherited italic flag would render
                        // nothing. Resetting it keeps the pick honest.
                        element.font.italic = false;
                      }, `font:${selectedText.id}`);
                    }}
                  />
                </div>
                <div className="field-row">
                  <label>
                    <span>Size</span>
                    <input
                      className="jelly-field"
                      type="number"
                      min="8"
                      max="600"
                      value={selectedText.layout.size}
                      onChange={(event) => {
                        const size = Number(event.target.value);
                        updateDocument('Change text size', (draft) => {
                          const element = draft.elements.find((item) => item.id === selectedText.id);
                          if (element?.type === 'text' && Number.isFinite(size)) element.layout.size = size;
                        }, `size:${selectedText.id}`);
                      }}
                    />
                  </label>
                  <label>
                    <span>Weight</span>
                    <select
                      className="jelly-select"
                      value={selectedText.font.weight}
                      onChange={(event) => {
                        const weight = Number(event.target.value);
                        updateDocument('Change font weight', (draft) => {
                          const element = draft.elements.find((item) => item.id === selectedText.id);
                          if (element?.type === 'text') element.font.weight = weight;
                        });
                      }}
                    >
                      <option value="400">Regular</option>
                      <option value="600">Semibold</option>
                      <option value="700">Bold</option>
                      <option value="900">Black</option>
                    </select>
                  </label>
                </div>
              </section>

              <section className="inspector-section warp-section">
                <h2>Warp <span>{selectedText.warp.kind.toUpperCase()}</span></h2>
                <InspectorSectionControls section={objectInspector!.children!.find((section) => section.label === 'Warp')!} {...inspectorControls} />
              </section>

              {renderTransformSection(selectedText)}


            </>
          ) : selectedShape ? (
            <>
              <section className="inspector-section open">
                <h2>Stamp</h2>
                <label>
                  <span>Shape</span>
                  <select
                    className="jelly-select"
                    value={selectedShape.shape}
                    onChange={(event) => {
                      const shape = event.target.value as StampId;
                      updateStamp((element) => {
                        element.shape = shape;
                        // Switching stamp regenerates geometry, so any detached path has to go with
                        // it -- keeping it would silently ignore the choice the user just made.
                        element.path = null;
                        if (element.name === STAMP_LABELS[selectedShape.shape]) element.name = STAMP_LABELS[shape];
                      });
                    }}
                  >
                    {STAMP_GROUPS.map((group) => (
                      <optgroup key={group.id} label={group.label}>
                        {STAMP_IDS_BY_GROUP[group.id].map((shape) => (
                          <option key={shape} value={shape}>{STAMP_LABELS[shape]}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {selectedShape.path && (
                  <p className="foundation-note">
                    This stamp has edited geometry, so the shape above is a record of where it came
                    from rather than what gets drawn.
                  </p>
                )}
                <label className="range-field">
                  <span>Width <output>{Math.round(selectedShape.width)}</output></span>
                  <input
                    className="goo-range"
                    type="range"
                    min="16"
                    max="900"
                    value={selectedShape.width}
                    onChange={(event) => {
                      const width = Number(event.target.value);
                      updateStamp((element) => { element.width = width; });
                    }}
                  />
                </label>
                <label className="range-field">
                  <span>Height <output>{Math.round(selectedShape.height)}</output></span>
                  <input
                    className="goo-range"
                    type="range"
                    min="16"
                    max="900"
                    value={selectedShape.height}
                    onChange={(event) => {
                      const height = Number(event.target.value);
                      updateStamp((element) => { element.height = height; });
                    }}
                  />
                </label>
                <p className="foundation-note">
                  Stamps take the whole effect stack and every style in the rack, so a decoration
                  can be chromed, bevelled or sprayed exactly like a word.
                </p>
              </section>
              {renderTransformSection(selectedShape)}
            </>
          ) : (
            <div className="no-selection">
              <span>NO GOO SELECTED</span>
              <p>Pick a text blob or a stamp on the canvas or in the layer strip to start squishing it.</p>
            </div>
          )}

          {objectInspector && <section className="inspector-section object-details">
            <h2>Layer properties</h2>
            <InspectorFields fields={objectInspector.fields} {...inspectorControls} />
            {objectInspector.children?.filter((section) => section.label !== 'Warp').map((section) => {
              const filtered = { ...section, fields: section.fields.filter((field) => !['Content', 'Font family', 'Weight', 'Font size', 'Stamp'].includes(field.label)) };
              if (!filtered.fields.length && !filtered.children?.length) return null;
              return <details className="metadata-section" key={section.id}>
                <summary>{section.label === 'Text & font' ? 'Typography' : section.label === 'Position & transform' ? 'Exact position & transform' : section.label}</summary>
                <InspectorSectionControls section={filtered} {...inspectorControls} />
              </details>;
            })}
          </section>}
          </div>
          <div id="inspector-effects" role="tabpanel" aria-labelledby="inspector-tab-effects" hidden={inspectorTab !== 'effects'}>
            {selectedText || selectedShape ? renderEffectsSection(selectedElement!.effects) : <p className="inspector-empty">Select a layer to edit its effects.</p>}
          </div>
          <div id="inspector-motion" role="tabpanel" aria-labelledby="inspector-tab-motion" hidden={inspectorTab !== 'motion'}>
            {selectedText || selectedShape ? <section className="effects-section">
              <div className="section-title-row"><h2>Animation tracks</h2><span>{selectedElement!.animations.length}</span></div>
              <p className="inspector-hint">Combine tracks, then use Play below the canvas to preview the loop.</p>
              <ol className="effect-list motion-list">
                {selectedElement!.animations.map((track) => {
                  const section = motionInspector?.children?.find((item) => item.id === track.id);
                  return <InspectorStackCard key={track.id} title={section?.label ?? track.kind} enabled={track.enabled}
                    initiallyExpanded={expandedItem === track.id} onToggle={() => changeAnimation(track.id, 'toggle')}
                    actions={<button type="button" onClick={() => changeAnimation(track.id, 'remove')} aria-label={`Remove ${section?.label ?? track.kind}`} title="Remove animation">×</button>}>
                    {section && <InspectorFields fields={section.fields.filter((field) => field.path.at(-1) !== 'enabled')} {...inspectorControls} />}
                  </InspectorStackCard>;
                })}
              </ol>
              {!selectedElement!.animations.length && <p className="inspector-empty">Add motion to this layer.</p>}
              <div className="effect-adder">
                <select className="jelly-select" aria-label="New animation" value={newAnimationKind}
                  onChange={(event) => setNewAnimationKind(event.target.value as AnimationTrack['kind'])}>
                  {nativeAnimationKinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                </select>
                <button className="add-effect orb orb-xs orb-lime" type="button" onClick={addAnimation}>+ Add</button>
              </div>
            </section> : <p className="inspector-empty">Select a layer to edit its motion.</p>}
          </div>
          <div id="inspector-canvas" role="tabpanel" aria-labelledby="inspector-tab-canvas" hidden={inspectorTab !== 'canvas'}>
          <section className="inspector-section">
            <h2>Document & canvas</h2>
            <InspectorSectionControls section={{ ...canvasInspector, children: canvasInspector.children?.filter((section) => section.label !== 'Background') }} {...inspectorControls} />
          </section>
          <section className="inspector-section background-section">
            <h2>Background <span>{backgroundLabel(document.canvas.background)}</span></h2>
            <div className="background-swatches">
              <button
                className={`background-swatch${document.canvas.background ? '' : ' active'}`}
                type="button"
                onClick={() => setBackground(null)}
                aria-pressed={!document.canvas.background}
              >
                <span className="background-none" aria-hidden="true" />
                <span>None</span>
              </button>
              {BACKGROUND_SWATCHES.map((swatch) => (
                <button
                  key={swatch.label}
                  className={`background-swatch${isActiveBackground(document.canvas.background, swatch.hex) ? ' active' : ''}`}
                  type="button"
                  onClick={() => setBackground({ kind: 'solid', color: hexToRgba(swatch.hex) })}
                  aria-pressed={isActiveBackground(document.canvas.background, swatch.hex)}
                >
                  <span style={{ background: swatch.hex }} aria-hidden="true" />
                  <span>{swatch.label}</span>
                </button>
              ))}
            </div>
            <label>
              <span>Custom</span>
              <input
                className="jelly-field"
                type="color"
                aria-label="Custom background colour"
                value={backgroundHex(document.canvas.background)}
                onChange={(event) => setBackground({ kind: 'solid', color: hexToRgba(event.target.value) })}
              />
            </label>
            {/* Transparent export is the product's core promise, so the one thing a background
                changes beyond colour gets said out loud rather than discovered at export time. */}
            <p className="foundation-note">
              A background fills the frame, so exports stop being transparent and stop cropping to
              the artwork. Set it back to None to get both behaviours back.
            </p>
            <details className="metadata-section">
              <summary>Background paint</summary>
              <InspectorSectionControls section={canvasInspector.children!.find((section) => section.label === 'Background')!} {...inspectorControls} />
            </details>
          </section>
          </div>
        </aside>
      </div>

      <footer className="layers-strip">
        <div className="layers-title">
          <span>FILM</span>
          <strong>{String(document.elements.length).padStart(2, '0')}</strong>
        </div>
        <div className="layer-list">
          {[...document.elements].reverse().map((element) => (
            <div
              className={`layer-item ${element.id === selectedElementId ? 'selected' : ''}`}
              key={element.id}
            >
              <button
                className="layer-main"
                type="button"
                onClick={() => selectElement(element.id)}
              >
                <span className="layer-kind">{element.type === 'text' ? 'T' : 'S'}</span>
                <span>{element.name}</span>
              </button>
              <button
                className={`layer-visibility ${element.visible ? 'visible' : ''}`}
                type="button"
                aria-label={`${element.visible ? 'Hide' : 'Show'} ${element.name}`}
                aria-pressed={element.visible}
                title={element.visible ? 'Hide layer' : 'Show layer'}
                onClick={() => {
                  updateDocument('Toggle layer visibility', (draft) => {
                    const candidate = draft.elements.find((item) => item.id === element.id);
                    if (candidate) candidate.visible = !candidate.visible;
                  });
                }}
              >
                {element.visible ? 'ON' : 'OFF'}
              </button>
            </div>
          ))}
        </div>
        <div className="layer-actions">
          <button className="orb orb-xs orb-grape" type="button" onClick={() => moveSelectedLayer(-1)} disabled={!selectedElementId} aria-label="Move layer backward">BACK</button>
          <button className="orb orb-xs orb-grape" type="button" onClick={() => moveSelectedLayer(1)} disabled={!selectedElementId} aria-label="Move layer forward">FWD</button>
          <button className="orb orb-xs orb-aqua" type="button" onClick={duplicateSelected} disabled={!selectedElementId} aria-label="Duplicate selected layer" title="Duplicate (Ctrl+D)">DUP</button>
          <button className="orb orb-xs orb-lime" type="button" onClick={addText} aria-label="Add text layer">+</button>
          <button className="orb orb-xs orb-cherry" type="button" onClick={removeSelected} disabled={!selectedElementId} aria-label="Delete selected layer">DEL</button>
        </div>
      </footer>

      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button
            key={toast.id}
            type="button"
            className={`toast toast-${toast.tone}`}
            onClick={() => dismissToast(toast.id)}
            onMouseEnter={() => holdToast(toast.id)}
            onMouseLeave={() => resumeToast(toast.id, toast.tone)}
            onFocus={() => holdToast(toast.id)}
            onBlur={() => resumeToast(toast.id, toast.tone)}
          >
            {toast.message}
          </button>
        ))}
      </div>
      {serviceWorkerUpdate && (
        <div className="update-banner" role="status">
          <span>An update is ready.</span>
          <button className="orb orb-sm orb-sun" type="button" disabled={isUpdating} onClick={() => void applyServiceWorkerUpdate()}>
            {isUpdating ? 'Saving...' : 'Save and reload'}
          </button>
        </div>
      )}
    </div>
  );
}

function swatchGradient(colors: readonly string[]): string {
  return `linear-gradient(145deg, ${colors.join(', ')})`;
}

/**
 * The paint block of an effect row: what the effect draws with, as opposed to what colour a
 * single-colour effect is.
 *
 * Any paint-bearing effect can switch between a solid and a gradient here, which is what makes a
 * gradient authorable at all -- before this, gradients only ever arrived via presets. The other
 * paint kinds (ramp, matcap, texture) have no authoring UI, so the switch shows them truthfully
 * and converts away from them on the first pick.
 */
function EffectPaintControls({ effect, onKindChange, onSolidChange, onStopChange, onStopOffsetChange, onAddStop, onRemoveStop, onTypeChange, onAngleChange }: {
  effect: Effect;
  onKindChange: (kind: 'solid' | 'gradient') => void;
  onSolidChange: (hex: string) => void;
  onStopChange: (stopIndex: number, hex: string) => void;
  onStopOffsetChange: (stopIndex: number, offset: number) => void;
  onAddStop: () => void;
  onRemoveStop: () => void;
  onTypeChange: (type: Gradient['type']) => void;
  onAngleChange: (angle: number) => void;
}) {
  if (!('paint' in effect)) return null;
  const paint = effect.paint;
  const name = effectLabel(effect.kind);
  return (
    <div className="effect-paint-controls">
      <span className="effect-color-controls">
        <label title={`${name} paint style`}>
          <span>Paint</span>
          <select
            className="jelly-select paint-kind-select"
            value={paint.kind}
            aria-label={`${name} paint style`}
            onChange={(event) => {
              const kind = event.target.value;
              if (kind === 'solid' || kind === 'gradient') onKindChange(kind);
            }}
          >
            <option value="solid">Solid</option>
            <option value="gradient">Gradient</option>
            {paint.kind !== 'solid' && paint.kind !== 'gradient' && (
              <option value={paint.kind}>{paint.kind.replace(/^./, (character) => character.toUpperCase())}</option>
            )}
          </select>
        </label>
        {paint.kind === 'solid' && (
          <label title={`${name} color`}>
            <span>Color</span>
            <input
              type="color"
              value={rgbaToHex(paint.color)}
              aria-label={`${name} color`}
              onInput={(event) => onSolidChange(event.currentTarget.value)}
            />
          </label>
        )}
      </span>
      {paint.kind === 'gradient' && (
        <>
          <GradientStopBar name={name} gradient={paint.gradient} onStopOffsetChange={onStopOffsetChange} />
          <span className="effect-color-controls gradient-stops">
            <span className="paint-row-name">Stops</span>
            {paint.gradient.stops.map((stop, stopIndex) => (
              <input
                key={stopIndex}
                type="color"
                value={rgbaToHex(stop.color)}
                aria-label={`${name} gradient stop ${stopIndex + 1}`}
                title={`Stop ${stopIndex + 1}`}
                onInput={(event) => onStopChange(stopIndex, event.currentTarget.value)}
              />
            ))}
            <button
              type="button"
              onClick={onRemoveStop}
              disabled={paint.gradient.stops.length <= MIN_GRADIENT_STOPS}
              aria-label={`Remove ${name.toLowerCase()} gradient stop`}
            >−</button>
            <button
              type="button"
              onClick={onAddStop}
              disabled={paint.gradient.stops.length >= MAX_GRADIENT_STOPS}
              aria-label={`Add ${name.toLowerCase()} gradient stop`}
            >+</button>
          </span>
          <span className="effect-color-controls">
            <label title="Gradient shape">
              <span>Shape</span>
              <select
                className="jelly-select paint-kind-select"
                value={paint.gradient.type}
                aria-label={`${name} gradient shape`}
                onChange={(event) => onTypeChange(event.target.value as Gradient['type'])}
              >
                <option value="linear">Linear</option>
                <option value="reflected">Mirror</option>
                <option value="radial">Radial</option>
                <option value="angular">Sweep</option>
                {/* Diamond can arrive in a shared document but currently draws as linear, so it
                    is shown when present rather than offered. */}
                {paint.gradient.type === 'diamond' && <option value="diamond">Diamond</option>}
              </select>
            </label>
          </span>
          {/* A radial gradient has no axis to turn, so no angle is advertised for it. */}
          {paint.gradient.type !== 'radial' && (
            <label className="effect-quick-control">
              <span>Angle</span>
              <input
                className="goo-range"
                type="range"
                min="0"
                max="360"
                step="1"
                value={paint.gradient.angle}
                onChange={(event) => onAngleChange(Number(event.target.value))}
              />
              <output>{Math.round(paint.gradient.angle)}</output>
            </label>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The gradient run with a draggable handle per stop.
 *
 * Colour alone cannot author a metal: the polished-bar profile is bright-dark-bright with the
 * waist placed, and *where* a stop sits is as much of the design as what colour it is. Handles
 * drag along the bar and answer arrow keys, and neighbours bound every move inclusively -- stops
 * may meet, which is the model's hard edge, but never pass each other.
 */
function GradientStopBar({ name, gradient, onStopOffsetChange }: {
  name: string;
  gradient: Gradient;
  onStopOffsetChange: (stopIndex: number, offset: number) => void;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const run = gradient.stops
    .map((stop) => `${rgbaToCss(stop.color)} ${(stop.offset * 100).toFixed(1)}%`)
    .join(', ');
  const moveTo = (stopIndex: number, clientX: number) => {
    const bar = barRef.current;
    if (!bar) return;
    const bounds = bar.getBoundingClientRect();
    if (bounds.width === 0) return;
    onStopOffsetChange(stopIndex, (clientX - bounds.left) / bounds.width);
  };
  return (
    <div ref={barRef} className="gradient-stop-bar" style={{ background: `linear-gradient(90deg, ${run})` }}>
      {gradient.stops.map((stop, stopIndex) => (
        <button
          key={stopIndex}
          type="button"
          className="gradient-stop-handle"
          style={{ left: `${stop.offset * 100}%` }}
          role="slider"
          aria-label={`${name} gradient stop ${stopIndex + 1} position`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(stop.offset * 100)}
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) moveTo(stopIndex, event.clientX);
          }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 0.05 : 0.01;
            if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
              event.preventDefault();
              onStopOffsetChange(stopIndex, stop.offset - step);
            } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
              event.preventDefault();
              onStopOffsetChange(stopIndex, stop.offset + step);
            }
          }}
        />
      ))}
    </div>
  );
}

function rgbaToHex([red, green, blue]: readonly [number, number, number, number]): string {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/**
 * Ready-made grounds, picked so the 1990s styles have something period to sit on.
 *
 * A Memphis graphic was never printed on white -- the flat saturated ground is half of what makes
 * it read as Memphis at all -- so the swatches lead with the colours those sheets actually used.
 */
const BACKGROUND_SWATCHES = [
  { label: 'Cream', hex: '#f7f4ea' },
  { label: 'Violet', hex: '#5b5bd6' },
  { label: 'Teal', hex: '#00cfc1' },
  { label: 'Pink', hex: '#ff5fa2' },
  { label: 'Sun', hex: '#ffd93d' },
  { label: 'Ink', hex: '#141433' },
];

function hexToRgba(hex: string): Rgba {
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  return [rgb[0], rgb[1], rgb[2], 1];
}

function backgroundHex(paint: Paint | null): string {
  if (paint?.kind !== 'solid') return '#ffffff';
  return rgbaToHex(paint.color);
}

function isActiveBackground(paint: Paint | null, hex: string): boolean {
  return paint?.kind === 'solid' && backgroundHex(paint).toLowerCase() === hex.toLowerCase();
}

function backgroundLabel(paint: Paint | null): string {
  if (!paint) return 'TRANSPARENT GOO';
  if (paint.kind === 'solid') return `${backgroundHex(paint).toUpperCase()} GROUND`;
  return `${paint.kind.toUpperCase()} GROUND`;
}

/**
 * A stamp's menu icon, drawn from the same generator that draws the stamp itself.
 *
 * Hand-drawn icons would be a second definition of every shape, free to drift from the first. This
 * way a menu entry cannot misrepresent what placing it produces, and a new stamp needs no icon.
 *
 * Drawn at the stamp's own proportion inside the square and centred, rather than filling it: a
 * ringed planet stretched to a square is an egg, and an icon that lies about the shape is worse
 * than no icon.
 */
function stampPreviewPath(shape: StampId): string {
  const aspect = stampAspect(shape);
  const width = aspect >= 1 ? STAMP_ICON_BOX : STAMP_ICON_BOX * aspect;
  const height = aspect >= 1 ? STAMP_ICON_BOX / aspect : STAMP_ICON_BOX;
  const offsetX = (STAMP_ICON_BOX - width) / 2;
  const offsetY = (STAMP_ICON_BOX - height) / 2;
  const place = (point: Point): string => round([point[0] + offsetX, point[1] + offsetY]);
  return stampOutline(shape, width, height).commands
    .map((command) => {
      if (command.type === 'M') return `M${place(command.point)}`;
      if (command.type === 'L') return `L${place(command.point)}`;
      if (command.type === 'Q') return `Q${place(command.control)} ${place(command.point)}`;
      if (command.type === 'C') {
        return `C${place(command.control1)} ${place(command.control2)} ${place(command.point)}`;
      }
      return 'Z';
    })
    .join(' ');
}

function round(point: Point): string {
  return `${point[0].toFixed(1)},${point[1].toFixed(1)}`;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const value = Number.parseInt(match[1]!, 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function effectLabel(kind: TextElement['effects'][number]['kind']): string {
  return kind.replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase());
}

function clearShareFragment(): void {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}
