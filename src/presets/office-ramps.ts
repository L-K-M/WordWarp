import type { Rgba } from '../model/types';

/**
 * Original WordWarp palettes. The historic file/API names and ramp IDs remain stable for saved
 * documents, but these colours are independently authored, not Microsoft Office gradient data.
 * Each short palette is sampled to 20 stops so every renderer and editor uses the same ramp.
 */
export const OFFICE_RAMPS: Record<string, readonly string[]> = {
  rainbow: expandRamp(['#ef426b', '#f49c34', '#f4df63', '#65ca78', '#28b8c8', '#496ecb', '#9a55b6']),
  'rainbow-ii': expandRamp(['#7b48bb', '#4299d9', '#4dccad', '#e0dc5d', '#f79950', '#e95489', '#7b48bb']),
  'early-sunset': expandRamp(['#34355f', '#745582', '#c97d95', '#eca783', '#ffdbad']),
  'late-sunset': expandRamp(['#161d3a', '#34275b', '#70426d', '#b95e68', '#eb895d', '#ffc37a']),
  nightfall: expandRamp(['#090f2b', '#172a53', '#2c477c', '#5b5299', '#916caa']),
  daybreak: expandRamp(['#658fc7', '#9bbfe0', '#d6e6ee', '#f7e4de', '#ffd6bd']),
  horizon: expandRamp(['#395a7b', '#7199b5', '#c8e2ec', '#f5f3dd', '#c18a6b', '#684f55']),
  desert: expandRamp(['#704b59', '#ba7662', '#e8ac73', '#f8d598', '#ddbf9b', '#ad8a7f']),
  ocean: expandRamp(['#a3efda', '#4ac9ce', '#2196b6', '#23658b', '#253c63']),
  'calm-water': expandRamp(['#e4f5f0', '#b0d8d9', '#7aafb9', '#527f9b', '#3c607e']),
  fire: expandRamp(['#fff1bd', '#ffd364', '#f59c37', '#e05c29', '#9b3037', '#481f33']),
  fog: expandRamp(['#faf4eb', '#d9dcdf', '#adb8c5', '#d0dce3', '#f3f9fa']),
  moss: expandRamp(['#d3ddb0', '#91b077', '#526f4a', '#304e42', '#779364']),
  peacock: expandRamp(['#293e85', '#437dae', '#39afaf', '#306a84', '#624e95', '#936eaa']),
  wheat: expandRamp(['#fff0c2', '#e8c478', '#bd9453', '#8e6943', '#d7bc85']),
  parchment: expandRamp(['#f9edcb', '#e4cda1', '#cbb184', '#ab916d', '#dfc9a1']),
  mahogany: expandRamp(['#e1b49a', '#bd8364', '#925846', '#653d37', '#402c2d']),
  gold: expandRamp(['#fff0af', '#d6ae4e', '#96702b', '#f7df8b', '#b58632', '#785325', '#efd09a']),
  'gold-ii': expandRamp(['#fbe6a9', '#bb8c39', '#6f4823', '#fff3c9', '#d5a34b', '#8d5828', '#f3d884']),
  brass: expandRamp(['#503d2c', '#bb924c', '#f3d481', '#786038', '#dac071', '#a78143', '#efe0a9']),
  chrome: expandRamp(['#dcecf7', '#607f9a', '#13253c', '#fcffff', '#8da9bc', '#234762', '#d7e9f3', '#f5faff', '#263c50']),
  'chrome-ii': expandRamp(['#345468', '#9ac0cf', '#eff9fa', '#7098af', '#172c45', '#d1e5ef', '#f9fbff', '#648ba5']),
  silver: expandRamp(['#f3f7ff', '#becadd', '#727f9b', '#e0e8f2', '#9aaaca', '#506582', '#d6e1ef']),
  sapphire: expandRamp(['#173354', '#286aaa', '#87c6f1', '#284e98', '#17265b', '#536ccb', '#b4daf7']),
};

export function officeRampColors(id: string): Rgba[] | null {
  const ramp = OFFICE_RAMPS[id.toLowerCase()];
  return ramp ? ramp.map(hexToRgba) : null;
}

function expandRamp(colors: string[]): string[] {
  const count = 20;
  const output: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const position = (index / (count - 1)) * (colors.length - 1);
    const left = Math.floor(position);
    const right = Math.min(colors.length - 1, left + 1);
    output.push(interpolateHex(colors[left]!, colors[right]!, position - left));
  }
  return output;
}

function interpolateHex(a: string, b: string, amount: number): string {
  const first = Number.parseInt(a.slice(1), 16);
  const second = Number.parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((first >> shift) & 255) + (((second >> shift) & 255) - ((first >> shift) & 255)) * amount);
  return `#${[channel(16), channel(8), channel(0)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgba(hex: string): Rgba {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, 1];
}
