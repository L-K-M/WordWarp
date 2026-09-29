import { z } from 'zod';
import type { WordWarpDocument } from '../model/types';
import type { InspectorSection } from './inspector';

const id = z.string().min(1).max(150);
export const nativeCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setText'), text: z.string().max(5000) }),
  z.object({ type: z.literal('setPreset'), presetId: id }),
  z.object({ type: z.literal('select'), elementId: id.nullable() }),
  z.object({ type: z.literal('addText') }),
  z.object({ type: z.literal('addStamp'), stampId: id }),
  z.object({
    type: z.literal('nudge'),
    dx: z.number().finite().min(-100).max(100),
    dy: z.number().finite().min(-100).max(100),
  }),
  z.object({
    type: z.literal('layer'),
    action: z.enum([
      'duplicate',
      'delete',
      'up',
      'down',
      'front',
      'back',
      'visibility',
      'lock',
    ]),
    elementId: id,
  }),
  z.object({
    type: z.literal('setField'),
    fieldId: z.string().max(500),
    value: z.unknown(),
  }),
  z.object({
    type: z.literal('inspectorAction'),
    actionId: z.string().max(500),
  }),
  z.object({
    type: z.literal('effect'),
    action: z.enum(['add', 'delete', 'up', 'down', 'toggle']),
    kind: id.optional(),
    effectId: id.optional(),
  }),
  z.object({
    type: z.literal('animation'),
    action: z.enum(['add', 'delete', 'toggle']),
    kind: id.optional(),
    animationId: id.optional(),
  }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('redo') }),
  z.object({ type: z.literal('getDocument'), id }),
  z.object({ type: z.literal('newDocument'), id: id.optional() }),
  z.object({
    type: z.literal('setView'),
    tool: z.enum(['select', 'pan']).optional(),
    zoom: z.number().finite().min(0.05).max(8).optional(),
    fit: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('playback'),
    playing: z.boolean().optional(),
    time: z.number().finite().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal('export'),
    id,
    format: z.enum(['png', 'apng', 'gif']),
    scale: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    fps: z.number().int().min(1).max(30).optional(),
  }),
  z.object({
    type: z.literal('exportPng'),
    id,
    scale: z.union([z.literal(1), z.literal(2)]),
  }),
  z.object({
    type: z.literal('restore'),
    id: id.optional(),
    document: z.unknown(),
    presetId: id.nullable().optional(),
  }),
]);
export interface NativeView {
  tool: 'select' | 'pan';
  zoom: number;
  playing: boolean;
  time: number;
  duration: number;
}
export interface NativeState {
  text: string;
  presetId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
  document: WordWarpDocument;
  selectedElementId: string | null;
  layers: {
    id: string;
    name: string;
    type: string;
    visible: boolean;
    locked: boolean;
  }[];
  inspector: InspectorSection[];
  view: NativeView;
}
export interface Choice {
  value: string;
  label: string;
  category?: string;
}
export type NativeEvent =
  | {
      type: 'ready';
      version: 2;
      presets: {
        id: string;
        name: string;
        category: string;
        preview: string[];
        animated: boolean;
      }[];
      stamps: Choice[];
      effectKinds: Choice[];
      animationKinds: Choice[];
      state: NativeState;
    }
  | { type: 'state'; state: NativeState }
  | { type: 'view'; view: NativeView }
  | { type: 'rendered'; revision: number; width: number; height: number }
  | { type: 'document'; id: string; document: WordWarpDocument }
  | { type: 'restored'; id?: string }
  | { type: 'exportProgress'; id: string; progress: number }
  | {
      type: 'export';
      id: string;
      filename: string;
      mimeType: string;
      base64: string;
      width: number;
      height: number;
      frameCount?: number;
      fps?: number;
      reduced?: boolean;
    }
  | { type: 'error'; id?: string; message: string };
declare global {
  interface Window {
    wordwarp: { dispatch: (command: unknown) => void };
    webkit?: {
      messageHandlers?: {
        wordwarp?: { postMessage: (event: NativeEvent) => void };
      };
    };
    WordWarpAndroid?: { postMessage: (json: string) => void };
  }
}
export function postToHost(event: NativeEvent): void {
  const mac = window.webkit?.messageHandlers?.wordwarp;
  if (mac) mac.postMessage(event);
  else if (window.WordWarpAndroid)
    window.WordWarpAndroid.postMessage(JSON.stringify(event));
  else
    window.dispatchEvent(
      new CustomEvent('wordwarp-message', { detail: event }),
    );
}
