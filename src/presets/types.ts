import type { AnimationTrack, Effect, FontSpec, TextElement, WarpSpec } from '../model/types';

export type PresetCategory = 'metallic' | 'synthwave' | 'y2k' | 'nineties' | 'dimensional' | 'texture' | 'user';

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
