import type { AnimationTrack, Effect, FontSpec, TextElement, WarpSpec } from '../model/types';

export type PresetCategory =
  | 'metallic'
  | 'synthwave'
  | 'y2k'
  | 'nineties'
  | 'dimensional'
  | 'texture'
  | 'sweets'
  | 'spooky'
  | 'cosmic'
  | 'user';

/**
 * Category tabs, in picker order, with the short labels the chip row shows.
 *
 * Lives beside `PresetCategory` rather than in the view so that adding a category and forgetting
 * to surface it is a test failure instead of a set of presets no one can reach: widening the union
 * without adding a tab here leaves those presets filtered out of every tab but "All".
 */
export const PRESET_CATEGORY_TABS: ReadonlyArray<{ id: PresetCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'metallic', label: 'Metal' },
  { id: 'synthwave', label: 'Synth' },
  { id: 'y2k', label: 'Y2K' },
  { id: 'nineties', label: '90s' },
  { id: 'dimensional', label: '3D' },
  { id: 'texture', label: 'FX' },
  { id: 'sweets', label: 'Sweets' },
  { id: 'spooky', label: 'Spooky' },
  { id: 'cosmic', label: 'Cosmic' },
];

export interface Preset {
  id: string;
  name: string;
  category: PresetCategory;
  tags: string[];
  preview: string[];
  animated: boolean;
  apply: {
    effects: Effect[];
    warp: WarpSpec;
    font?: Partial<FontSpec>;
    animations?: AnimationTrack[];
  };
}

export type PresetTarget = Pick<TextElement, 'effects' | 'warp' | 'font' | 'animations'>;
