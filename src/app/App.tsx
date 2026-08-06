import { useState } from 'react';

import { downloadPng, exportPng } from '../export/png';
import { createDefaultTextElement } from '../model/defaults';
import type { TextElement } from '../model/types';
import { useDocumentStore } from '../state/document-store';
import { useEditorStore } from '../state/editor-store';
import { useUiStore } from '../state/ui-store';
import { DocumentCanvas } from '../ui/DocumentCanvas';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const presetSwatches = [
  { name: 'Chrome Classic', category: 'METAL', colors: ['#f7fbff', '#586270', '#11151e', '#e9f7ff'] },
  { name: 'Outrun Sunset', category: 'SYNTH', colors: ['#ff34d2', '#ff4f76', '#ffc642', '#5638ff'] },
  { name: 'Aqua Gel', category: 'Y2K', colors: ['#ecffff', '#55d9ff', '#087ad8', '#003767'] },
  { name: 'Memphis Party', category: '90S', colors: ['#ffd93d', '#ff6b6b', '#4ecdc4', '#17192c'] },
  { name: 'Deep Extrude', category: '3D', colors: ['#ff667a', '#bd2847', '#40182a', '#ffc0ca'] },
  { name: 'Riso Shift', category: 'TEXTURE', colors: ['#f94671', '#09a9bd', '#f1dba7', '#20202a'] },
] as const;

export function App() {
  const [isExporting, setIsExporting] = useState(false);
  const document = useDocumentStore((state) => state.document);
  const pastCount = useDocumentStore((state) => state.past.length);
  const futureCount = useDocumentStore((state) => state.future.length);
  const updateDocument = useDocumentStore((state) => state.updateDocument);
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
  const toasts = useUiStore((state) => state.toasts);
  const pushToast = useUiStore((state) => state.pushToast);
  const dismissToast = useUiStore((state) => state.dismissToast);

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

  useKeyboardShortcuts({ undo, redo, remove: removeSelected });

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

  const applySwatch = (colors: readonly string[]) => {
    if (!selectedText) return;
    updateDocument('Apply colorway', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedText.id);
      if (element?.type !== 'text') return;
      const fill = element.effects.find((effect) => effect.kind === 'fill');
      if (!fill) return;
      fill.paint = {
        kind: 'gradient',
        gradient: {
          type: 'linear',
          stops: colors.map((color, index) => ({
            offset: index / (colors.length - 1),
            color: hexToRgba(color),
          })),
          angle: 90,
          center: [0.5, 0.5],
          scale: 1,
          dither: true,
          interpolation: 'oklab',
        },
      };
    });
  };

  const toggleEffect = (effectId: string) => {
    if (!selectedText) return;
    updateDocument('Toggle effect', (draft) => {
      const element = draft.elements.find((candidate) => candidate.id === selectedText.id);
      const effect = element?.effects.find((candidate) => candidate.id === effectId);
      if (effect) effect.enabled = !effect.enabled;
    });
  };

  const handleExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const result = await exportPng(document, 2);
      downloadPng(result);
      pushToast(`Exported ${result.width} x ${result.height} transparent PNG`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : 'PNG export failed', 'error');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => pushToast('WordWarp renderer online')}>
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
          <button className="panel-toggle" type="button" onClick={toggleLeftPanel}>Presets</button>
          <button className="panel-toggle" type="button" onClick={toggleRightPanel}>Inspect</button>
          <button type="button" onClick={() => pushToast('Share links arrive in the shipping PR')}>Share</button>
          <button className="export-button" type="button" onClick={() => void handleExport()} disabled={isExporting}>
            {isExporting ? 'Rendering...' : 'Export PNG'} <span aria-hidden="true">+</span>
          </button>
        </div>
      </header>

      <div className={`workspace ${leftPanelOpen ? '' : 'left-closed'} ${rightPanelOpen ? '' : 'right-closed'}`}>
        <aside className="preset-panel" aria-label="Preset library">
          <div className="panel-heading">
            <span>STYLE LIBRARY</span>
            <span className="count">06</span>
          </div>
          <label className="search-field">
            <span className="sr-only">Search presets</span>
            <input type="search" placeholder="Find a look..." disabled />
            <kbd>/</kbd>
          </label>
          <div className="preset-grid">
            {presetSwatches.map((preset) => (
              <button
                className="preset-card"
                key={preset.name}
                type="button"
                onClick={() => applySwatch(preset.colors)}
              >
                <span className="preset-preview" style={{ background: swatchGradient(preset.colors) }}>
                  <span>Ww</span>
                </span>
                <span className="preset-meta">
                  <strong>{preset.name}</strong>
                  <small>{preset.category}</small>
                </span>
              </button>
            ))}
          </div>
          <p className="foundation-note">Full material presets land after the render graph.</p>
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
                document={document}
                selectedElementId={selectedElementId}
                onSelect={selectElement}
              />
            </div>
          </div>

          <div className="zoom-strip">
            <button type="button" onClick={() => setZoom(1)}>Fit</button>
            <button type="button" onClick={() => setZoom(zoom - 0.1)} aria-label="Zoom out">-</button>
            <output>{Math.round(zoom * 100)}%</output>
            <button type="button" onClick={() => setZoom(zoom + 0.1)} aria-label="Zoom in">+</button>
            <button type="button" disabled>Play</button>
          </div>
        </main>

        <aside className="inspector-panel" aria-label="Inspector">
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

              <section className="inspector-section muted-section">
                <h2>Warp <span>NONE</span></h2>
                <button type="button" disabled>Choose envelope</button>
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
                      <button
                        className={effect.enabled ? 'enabled' : ''}
                        type="button"
                        aria-label={`${effect.enabled ? 'Disable' : 'Enable'} ${effectLabel(effect.kind)}`}
                        aria-pressed={effect.enabled}
                        onClick={() => toggleEffect(effect.id)}
                      >
                        {effect.enabled ? 'ON' : 'OFF'}
                      </button>
                    </li>
                  ))}
                </ol>
                <button className="add-effect" type="button" disabled>+ Add effect</button>
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
    </div>
  );
}

function swatchGradient(colors: readonly string[]): string {
  return `linear-gradient(145deg, ${colors.join(', ')})`;
}

function hexToRgba(hex: string): [number, number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
}

function effectLabel(kind: TextElement['effects'][number]['kind']): string {
  return kind.replace(/([A-Z])/g, ' $1').replace(/^./, (character) => character.toUpperCase());
}
