import { create } from 'zustand';

import { documentStore } from './document-store';

export type EditorTool = 'select' | 'text' | 'warp' | 'gradient';

type ViewportMode = 'mobile' | 'tablet' | 'desktop';

const initialViewportMode = viewportMode(typeof window === 'undefined' ? 1200 : window.innerWidth);

interface EditorState {
  selectedElementId: string | null;
  zoom: number;
  pan: { x: number; y: number };
  activeTool: EditorTool;
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  viewportMode: ViewportMode;
  selectElement: (id: string | null) => void;
  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  setActiveTool: (tool: EditorTool) => void;
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  syncPanelsForViewport: (width: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  selectedElementId: documentStore.getState().document.elements[0]?.id ?? null,
  zoom: 1,
  pan: { x: 0, y: 0 },
  activeTool: 'select',
  leftPanelOpen: initialViewportMode === 'desktop',
  rightPanelOpen: initialViewportMode !== 'mobile',
  viewportMode: initialViewportMode,
  selectElement: (selectedElementId) => set({ selectedElementId }),
  setZoom: (zoom) => set({ zoom: Math.min(4, Math.max(0.1, zoom)) }),
  setPan: (x, y) => set({ pan: { x, y } }),
  setActiveTool: (activeTool) => set({ activeTool }),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  syncPanelsForViewport: (width) => set((state) => {
    const nextMode = viewportMode(width);
    if (nextMode === state.viewportMode) return state;
    return {
      viewportMode: nextMode,
      leftPanelOpen: nextMode === 'desktop',
      rightPanelOpen: nextMode !== 'mobile',
    };
  }),
}));

function viewportMode(width: number): ViewportMode {
  if (width <= 740) return 'mobile';
  if (width <= 1050) return 'tablet';
  return 'desktop';
}
