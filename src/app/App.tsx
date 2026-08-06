import { useEffect, useRef, useState } from 'react';

import { documentAnimationDuration, evaluateDocumentAtTime } from '../animation/evaluate';
import { createEffect, EFFECT_KINDS, type EffectKind } from '../effects/defaults';
import { downloadAnimation, exportAnimation } from '../export/animation';
import { downloadPng, exportPng } from '../export/png';
import { createDefaultDocument, createDefaultTextElement } from '../model/defaults';
import { PRESET_WARP_IDS, type Effect, type TextElement } from '../model/types';
import { startAutosave, type AutosaveController } from '../persistence/autosave';
import { loadActiveDocument, saveDocument } from '../persistence/database';
import { applyPresetToElement, BUILT_IN_PRESETS } from '../presets/library';
import type { Preset, PresetCategory } from '../presets/types';
import { buildShareUrl, decodeShareFragment } from '../share/url';
import { subscribeToServiceWorkerUpdate, type ServiceWorkerUpdate } from '../service-worker-update';
import { documentStore, useDocumentStore } from '../state/document-store';
import { useEditorStore } from '../state/editor-store';
import { useUiStore } from '../state/ui-store';
import { DocumentCanvas } from '../ui/DocumentCanvas';
import { PresetPreview } from '../ui/PresetPreview';
import { warpDisplayName } from '../warp';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const presetCategories: Array<{ id: PresetCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'metallic', label: 'Metal' },
  { id: 'synthwave', label: 'Synth' },
  { id: 'y2k', label: 'Y2K' },
  { id: 'nineties', label: '90s' },
  { id: 'dimensional', label: '3D' },
];

type ExportFormat = 'png' | 'apng' | 'gif';

export function App() {
  const [isExporting, setIsExporting] = useState(false);
  const [newEffectKind, setNewEffectKind] = useState<EffectKind>('stroke');
  const [presetQuery, setPresetQuery] = useState('');
  const [presetCategory, setPresetCategory] = useState<PresetCategory | 'all'>('all');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('png');
  const [exportScale, setExportScale] = useState(2);
  const [exportProgress, setExportProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationTime, setAnimationTime] = useState(0);
  const [isHydrated, setIsHydrated] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [serviceWorkerUpdate, setServiceWorkerUpdate] = useState<ServiceWorkerUpdate | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const animationTimeRef = useRef(0);
  const autosaveRef = useRef<AutosaveController | null>(null);
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

  const animationDuration = documentAnimationDuration(document);
  useEffect(() => {
    if (!isPlaying) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const pauseForReducedMotion = () => {
      if (!reducedMotion.matches) return false;
      setIsPlaying(false);
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

  const selectedElement = document.elements.find((element) => element.id === selectedElementId);
  const selectedText = selectedElement?.type === 'text' ? selectedElement : null;

  const removeSelected = () => {
    if (!selectedElementId) return;
    const selectedIndex = document.elements.findIndex((element) => element.id === selectedElementId);
    updateDocument('Delete element', (draft) => {
      const index = draft.elements.findIndex((element) => element.id === selectedElementId);
      if (index >= 0) draft.elements.splice(index, 1);
    });
    const next = document.elements[selectedIndex + 1] ?? document.elements[selectedIndex - 1];
    selectElement(next?.id ?? null);
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

  useKeyboardShortcuts({ undo, redo, remove: removeSelected }, isHydrated && !isImporting && !isUpdating);

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
    if (!selectedText) return;
    updateDocument(`Apply ${preset.name}`, (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedText.id);
      if (element?.type !== 'text') return;
      applyPresetToElement(element, preset);
    });
  };

  const visiblePresets = BUILT_IN_PRESETS.filter((preset) => {
    const categoryMatches = presetCategory === 'all' || preset.category === presetCategory;
    const query = presetQuery.trim().toLocaleLowerCase();
    const queryMatches = !query || `${preset.name} ${preset.tags.join(' ')}`.toLocaleLowerCase().includes(query);
    return categoryMatches && queryMatches;
  });

  const toggleEffect = (effectId: string) => {
    if (!selectedText) return;
    updateDocument('Toggle effect', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedText.id);
      const effect = element?.effects.find((candidate) => candidate.id === effectId);
      if (effect) effect.enabled = !effect.enabled;
    });
  };

  const addEffect = () => {
    if (!selectedText) return;
    const effect = createEffect(newEffectKind);
    updateDocument('Add effect', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedText.id);
      if (element?.type === 'text') element.effects.push(effect);
    });
  };

  const removeEffect = (effectId: string) => {
    if (!selectedText) return;
    updateDocument('Remove effect', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedText.id);
      if (element?.type !== 'text') return;
      const index = element.effects.findIndex((effect) => effect.id === effectId);
      if (index >= 0) element.effects.splice(index, 1);
    });
  };

  const moveEffect = (effectId: string, direction: -1 | 1) => {
    if (!selectedText) return;
    updateDocument('Reorder effect', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedText.id);
      if (element?.type !== 'text') return;
      const index = element.effects.findIndex((effect) => effect.id === effectId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= element.effects.length) return;
      const [effect] = element.effects.splice(index, 1);
      element.effects.splice(nextIndex, 0, effect!);
    });
  };

  const updateEffectPrimary = (effectId: string, value: number) => {
    if (!selectedText) return;
    updateDocument('Adjust effect', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedText.id);
      const effect = element?.effects.find((candidate) => candidate.id === effectId);
      if (!effect) return;
      if (effect.kind === 'stroke') effect.width = value;
      else if (effect.kind === 'bevel') effect.size = value;
      else if (effect.kind === 'extrude') effect.depth = value;
      else if (effect.kind === 'innerShadow' || effect.kind === 'innerGlow') effect.size = value;
      else if (effect.kind === 'outerGlow' || effect.kind === 'dropShadow' || effect.kind === 'satin') effect.size = value;
      else if (effect.kind === 'longShadow') effect.length = value;
      else if (effect.kind === 'textureOverlay') effect.scale = value;
      else if (effect.kind === 'reflection') effect.height = value;
      else if (effect.kind === 'post') effect.params.amount = value;
      else effect.opacity = value;
    }, `effect:${effectId}`);
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
        pushToast(`Exported ${result.frameCount}-frame ${exportFormat.toUpperCase()}`, 'success');
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'Export failed', 'error');
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

  const previewDocument = animationTime > 0 ? evaluateDocumentAtTime(document, animationTime) : document;

  if (restoreError) {
    return (
      <div className="loading-screen recovery-screen" role="alert">
        <strong>Could not restore your saved document</strong>
        <p>{restoreError}</p>
        <div>
          <button type="button" onClick={() => window.location.reload()}>Retry</button>
          <button type="button" onClick={() => {
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
    return <div className="loading-screen" role="status">Restoring studio...</div>;
  }

  return (
    <div className="app-shell" inert={isImporting || isUpdating} aria-busy={isImporting || isUpdating}>
      <header className="topbar">
        <button
          className="brand"
          type="button"
          aria-label="WORDWARP TYPE EFFECTS LAB"
          onClick={() => pushToast('WordWarp renderer online')}
        >
          <span className="brand-mark" aria-hidden="true">W</span>
          <span>
            <strong>WORDWARP</strong>
            <small>TYPE EFFECTS LAB</small>
          </span>
        </button>

        <div className="history-actions" aria-label="History controls">
          <button type="button" onClick={undo} disabled={pastCount === 0} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button type="button" onClick={redo} disabled={futureCount === 0} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
        </div>

        <div className="topbar-actions">
          <button
            className="panel-toggle"
            type="button"
            onClick={toggleLeftPanel}
            aria-expanded={leftPanelOpen}
            aria-controls="preset-panel"
          >Presets</button>
          <button
            className="panel-toggle"
            type="button"
            onClick={toggleRightPanel}
            aria-expanded={rightPanelOpen}
            aria-controls="inspector-panel"
          >Inspect</button>
          <button type="button" onClick={() => void handleShare()}>Share</button>
          <select
            className="export-format"
            aria-label="Export format"
            value={exportFormat}
            onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
          >
            <option value="png">PNG</option>
            <option value="apng">APNG</option>
            <option value="gif">GIF</option>
          </select>
          <select
            className="export-format"
            aria-label="Export resolution"
            value={exportScale}
            onChange={(event) => setExportScale(Number(event.target.value))}
          >
            <option value={1}>1x</option>
            <option value={2}>2x</option>
            <option value={3}>3x</option>
            <option value={4}>4x</option>
          </select>
          <button className="export-button" type="button" onClick={() => void handleExport()} disabled={isExporting}>
            {isExporting ? `${Math.round(exportProgress * 100)}%` : `Export ${exportFormat.toUpperCase()}`} <span aria-hidden="true">+</span>
          </button>
        </div>
      </header>

      <div className={`workspace ${leftPanelOpen ? '' : 'left-closed'} ${rightPanelOpen ? '' : 'right-closed'}`}>
        <aside id="preset-panel" className="preset-panel" aria-label="Preset library">
          <div className="panel-heading">
            <span>STYLE LIBRARY</span>
            <span className="count">{String(visiblePresets.length).padStart(2, '0')}</span>
          </div>
          <label className="search-field">
            <span className="sr-only">Search presets</span>
            <input
              type="search"
              placeholder="Find a look..."
              value={presetQuery}
              onChange={(event) => setPresetQuery(event.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <div className="preset-categories" aria-label="Preset categories">
            {presetCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={presetCategory === category.id ? 'active' : ''}
                onClick={() => setPresetCategory(category.id)}
              >
                {category.label}
              </button>
            ))}
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

        <main className="canvas-panel">
          <div className="canvas-toolbar">
            <div className="tool-group" aria-label="Canvas tools">
              <button className="active" type="button">Select</button>
              <button type="button" onClick={addText}>Text</button>
              <button type="button" disabled>Warp</button>
            </div>
            <span className="canvas-status">
              {document.canvas.width} x {document.canvas.height} / TRANSPARENT
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
                onSelect={selectElement}
                onMoveStart={isPlaying ? undefined : (id) => beginTransaction(`Move ${id}`, `move:${id}`)}
                onMove={isPlaying ? undefined : (id, x, y) => {
                  updateDocument('Move element', (draft) => {
                    const element = draft.elements.find((candidate) => candidate.id === id);
                    if (element && !element.locked) {
                      element.transform.x = x;
                      element.transform.y = y;
                    }
                  });
                }}
                onMoveEnd={isPlaying ? undefined : commitTransaction}
              />
            </div>
          </div>

          <div className="zoom-strip">
            <button type="button" onClick={() => setZoom(1)}>Fit</button>
            <button type="button" onClick={() => setZoom(zoom - 0.1)} aria-label="Zoom out">-</button>
            <output>{Math.round(zoom * 100)}%</output>
            <button type="button" onClick={() => setZoom(zoom + 0.1)} aria-label="Zoom in">+</button>
            <button
              type="button"
              className={isPlaying ? 'playing' : ''}
              onClick={() => setIsPlaying((playing) => !playing)}
              aria-pressed={isPlaying}
            >
              {isPlaying ? 'Pause' : 'Play'}
            </button>
          </div>
        </main>

        <aside id="inspector-panel" className="inspector-panel" aria-label="Inspector">
          <div className="panel-heading">
            <span>INSPECTOR</span>
            <span className="selection-dot" aria-hidden="true" />
          </div>
          {selectedText ? (
            <>
              <section className="inspector-section open">
                <h2>Text</h2>
                <label>
                  <span>Content</span>
                  <textarea
                    autoFocus
                    value={selectedText.text}
                    onChange={(event) => updateText(event.target.value)}
                    rows={3}
                  />
                </label>
                <label className="font-family-field">
                  <span>Font family</span>
                  <input
                    list="font-families"
                    value={selectedText.font.family}
                    onChange={(event) => {
                      const family = event.target.value;
                      updateDocument('Change font family', (draft) => {
                        const element = draft.elements.find((item) => item.id === selectedText.id);
                        if (element?.type === 'text') element.font.family = family || 'sans-serif';
                      }, `font:${selectedText.id}`);
                    }}
                  />
                  <datalist id="font-families">
                    <option value="Arial Black" />
                    <option value="Arial" />
                    <option value="Georgia" />
                    <option value="Impact" />
                    <option value="Trebuchet MS" />
                    <option value="Verdana" />
                    <option value="sans-serif" />
                  </datalist>
                </label>
                <div className="field-row">
                  <label>
                    <span>Size</span>
                    <input
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
                <label>
                  <span>Envelope</span>
                  <select
                    value={selectedText.warp.kind === 'preset' ? selectedText.warp.preset : 'none'}
                    onChange={(event) => {
                      const preset = event.target.value;
                      updateDocument('Change warp', (draft) => {
                        const element = draft.elements.find((item) => item.id === selectedText.id);
                        if (element?.type !== 'text') return;
                        if (preset === 'none') {
                          element.warp.kind = 'none';
                          element.warp.preset = undefined;
                          element.warp.bend = 0;
                        } else {
                          element.warp.kind = 'preset';
                          element.warp.preset = preset as (typeof PRESET_WARP_IDS)[number];
                          if (Math.abs(element.warp.bend) < 0.01) element.warp.bend = 0.78;
                        }
                      });
                    }}
                  >
                    <option value="none">No warp</option>
                    {PRESET_WARP_IDS.filter((preset) => preset !== 'textNoShape' && preset !== 'textPlain').map((preset) => (
                      <option key={preset} value={preset}>{warpDisplayName(preset)}</option>
                    ))}
                  </select>
                </label>
                {selectedText.warp.kind === 'preset' && (
                  <>
                    <label className="range-field">
                      <span>Bend <output>{selectedText.warp.bend.toFixed(2)}</output></span>
                      <input
                        type="range"
                        min="-2"
                        max="2"
                        step="0.01"
                        value={selectedText.warp.bend}
                        onChange={(event) => {
                          const bend = Number(event.target.value);
                          updateDocument('Adjust warp bend', (draft) => {
                            const element = draft.elements.find((item) => item.id === selectedText.id);
                            if (element?.type === 'text') element.warp.bend = bend;
                          }, `warp:${selectedText.id}`);
                        }}
                      />
                    </label>
                    <label className="range-field">
                      <span>Shape <output>{selectedText.warp.adj[0].toFixed(2)}</output></span>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={selectedText.warp.adj[0]}
                        onChange={(event) => {
                          const adjustment = Number(event.target.value);
                          updateDocument('Adjust warp shape', (draft) => {
                            const element = draft.elements.find((item) => item.id === selectedText.id);
                            if (element?.type === 'text') element.warp.adj[0] = adjustment;
                          }, `warp-adj:${selectedText.id}`);
                        }}
                      />
                    </label>
                  </>
                )}
              </section>

              <section className="effects-section">
                <div className="section-title-row">
                  <h2>Effect stack</h2>
                  <span>{selectedText.effects.length}</span>
                </div>
                <ol className="effect-list">
                  {selectedText.effects.map((effect, index) => (
                    <li key={effect.id}>
                      <span className="drag-grip" aria-hidden="true">::</span>
                      <span className={`effect-chip effect-${effect.kind}`} aria-hidden="true" />
                      <span>
                        <strong>{effectLabel(effect.kind)}</strong>
                        <small>{effect.slot.toUpperCase()} / {index + 1}</small>
                      </span>
                      <span className="effect-actions">
                        <button type="button" onClick={() => moveEffect(effect.id, -1)} aria-label="Move effect up">UP</button>
                        <button type="button" onClick={() => moveEffect(effect.id, 1)} aria-label="Move effect down">DN</button>
                        <button
                          className={effect.enabled ? 'enabled' : ''}
                          type="button"
                          aria-label={`${effect.enabled ? 'Disable' : 'Enable'} ${effectLabel(effect.kind)}`}
                          aria-pressed={effect.enabled}
                          onClick={() => toggleEffect(effect.id)}
                        >
                          {effect.enabled ? 'ON' : 'OFF'}
                        </button>
                        <button type="button" onClick={() => removeEffect(effect.id)} aria-label={`Remove ${effectLabel(effect.kind)}`}>X</button>
                      </span>
                      <EffectQuickControl effect={effect} onChange={(value) => updateEffectPrimary(effect.id, value)} />
                    </li>
                  ))}
                </ol>
                <div className="effect-adder">
                  <select value={newEffectKind} onChange={(event) => setNewEffectKind(event.target.value as EffectKind)}>
                    {EFFECT_KINDS.map((kind) => <option key={kind} value={kind}>{effectLabel(kind)}</option>)}
                  </select>
                  <button className="add-effect" type="button" onClick={addEffect}>+ Add</button>
                </div>
              </section>

              <section className="inspector-section light-section">
                <h2>Global light <span>{Math.round(document.globalLight.angle)} DEG</span></h2>
                <label className="range-field">
                  <span>Angle <output>{Math.round(document.globalLight.angle)}</output></span>
                  <input
                    type="range"
                    min="0"
                    max="360"
                    value={document.globalLight.angle}
                    onChange={(event) => {
                      const angle = Number(event.target.value);
                      updateDocument('Adjust global light', (draft) => { draft.globalLight.angle = angle; }, 'global-light');
                    }}
                  />
                </label>
                <label className="range-field">
                  <span>Altitude <output>{Math.round(document.globalLight.altitude)}</output></span>
                  <input
                    type="range"
                    min="0"
                    max="90"
                    value={document.globalLight.altitude}
                    onChange={(event) => {
                      const altitude = Number(event.target.value);
                      updateDocument('Adjust global light', (draft) => { draft.globalLight.altitude = altitude; }, 'global-light');
                    }}
                  />
                </label>
              </section>
            </>
          ) : (
            <div className="no-selection">
              <span>NO SELECTION</span>
              <p>Select a text layer to inspect it.</p>
            </div>
          )}
        </aside>
      </div>

      <footer className="layers-strip">
        <div className="layers-title">
          <span>LAYERS</span>
          <strong>{String(document.elements.length).padStart(2, '0')}</strong>
        </div>
        <div className="layer-list">
          {[...document.elements].reverse().map((element) => (
            <button
              className={element.id === selectedElementId ? 'selected' : ''}
              type="button"
              key={element.id}
              onClick={() => selectElement(element.id)}
            >
              <span className="layer-kind">{element.type === 'text' ? 'T' : 'S'}</span>
              <span>{element.name}</span>
            </button>
          ))}
        </div>
        <div className="layer-actions">
          <button type="button" onClick={() => moveSelectedLayer(-1)} disabled={!selectedElementId} aria-label="Move layer backward">BACK</button>
          <button type="button" onClick={() => moveSelectedLayer(1)} disabled={!selectedElementId} aria-label="Move layer forward">FWD</button>
          <button type="button" onClick={addText} aria-label="Add text layer">+</button>
          <button type="button" onClick={removeSelected} disabled={!selectedElementId} aria-label="Delete selected layer">DEL</button>
        </div>
      </footer>

      <div className="toast-region" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <button key={toast.id} type="button" className={`toast toast-${toast.tone}`} onClick={() => dismissToast(toast.id)}>
            {toast.message}
          </button>
        ))}
      </div>
      {serviceWorkerUpdate && (
        <div className="update-banner" role="status">
          <span>An update is ready.</span>
          <button type="button" disabled={isUpdating} onClick={() => void applyServiceWorkerUpdate()}>
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

function EffectQuickControl({ effect, onChange }: { effect: Effect; onChange: (value: number) => void }) {
  const control = effectControl(effect);
  return (
    <label className="effect-quick-control">
      <span>{control.label}</span>
      <input
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={control.value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{control.value.toFixed(control.step < 1 ? 2 : 0)}</output>
    </label>
  );
}

function effectControl(effect: Effect): { label: string; min: number; max: number; step: number; value: number } {
  if (effect.kind === 'stroke') return { label: 'Width', min: 0, max: 80, step: 1, value: effect.width };
  if (effect.kind === 'bevel') return { label: 'Size', min: 1, max: 80, step: 1, value: effect.size };
  if (effect.kind === 'extrude') return { label: 'Depth', min: 0, max: 180, step: 1, value: effect.depth };
  if (effect.kind === 'innerShadow' || effect.kind === 'innerGlow') {
    return { label: 'Size', min: 0, max: 80, step: 1, value: effect.size };
  }
  if (effect.kind === 'outerGlow' || effect.kind === 'dropShadow' || effect.kind === 'satin') {
    return { label: 'Size', min: 0, max: 100, step: 1, value: effect.size };
  }
  if (effect.kind === 'longShadow') {
    return { label: 'Length', min: 0, max: 300, step: 1, value: effect.length === 'toEdge' ? 300 : effect.length };
  }
  if (effect.kind === 'textureOverlay') return { label: 'Scale', min: 0.2, max: 5, step: 0.1, value: effect.scale };
  if (effect.kind === 'reflection') return { label: 'Height', min: 0.05, max: 1, step: 0.05, value: effect.height };
  if (effect.kind === 'post') {
    const amount = effect.params.amount;
    return { label: 'Amount', min: 0, max: 1, step: 0.01, value: typeof amount === 'number' ? amount : 0.2 };
  }
  return { label: 'Opacity', min: 0, max: 1, step: 0.01, value: effect.opacity };
}

function effectLabel(kind: TextElement['effects'][number]['kind']): string {
  return kind.replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase());
}

function clearShareFragment(): void {
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
}
