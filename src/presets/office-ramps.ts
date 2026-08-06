import type { Rgba } from '../model/types';

export const OFFICE_RAMPS: Record<string, readonly string[]> = {
  rainbow: expandRamp(['#ff0000', '#ff7f00', '#ffff00', '#00c853', '#00b8ff', '#3d3dff', '#a000ff'], 20),
  'rainbow-ii': expandRamp(['#7f00ff', '#0095ff', '#00d084', '#fff000', '#ff6b00', '#ff006e', '#7f00ff'], 20),
  'early-sunset': expandRamp(['#2b1055', '#5f2c82', '#c33764', '#f2994a', '#fceabb'], 20),
  'late-sunset': [
    '#010400', '#01040f', '#01041f', '#01042f', '#01043f', '#0e043f', '#15053f', '#1e063f', '#2c073f', '#34083f',
    '#3c0a40', '#4b0d40', '#621241', '#691441', '#791741', '#8f243b', '#ae3f2c', '#ce6529', '#e99335', '#f3b13e',
  ],
  nightfall: [
    '#010400', '#01040f', '#01041f', '#020c2f', '#020c3f', '#020c56', '#090c66', '#0b1476', '#0b1486', '#0b148e',
    '#11149e', '#131ca6', '#191cae', '#191cb5', '#191cbe', '#3416c6', '#4b19c6', '#6217c6', '#7124b6', '#7a3997',
  ],
  daybreak: [
    '#709df8', '#709df8', '#78a4f8', '#7aacf9', '#82b4f9', '#82b4f9', '#8abcf9', '#91bcfa', '#93c5fa', '#9fc6f3',
    '#a5c6f3', '#adcef3', '#b4ceec', '#c2d6ed', '#c9d7ed', '#d1dfed', '#d8dff5', '#dedfee', '#eee7f6', '#f4e7f6',
  ],
  horizon: [
    '#d1dfed', '#a8b6d3', '#8dadbb', '#7a95b2', '#829dba', '#9fadcb', '#acc6d4', '#c0cedc', '#d1dfed', '#e8eff6',
    '#ffffff', '#956f65', '#894136', '#a15346', '#b85c56', '#bb7975', '#c4918e', '#d1b7a7', '#e4d8c8', '#876e65',
  ],
  desert: [
    '#eba9c5', '#f2aa98', '#ecb16f', '#ecb15d', '#edb95e', '#edb96a', '#eec078', '#efc98d', '#f1d0a2', '#f7d1b2',
    '#f2d8c8', '#fae0d8', '#fbe8ef', '#e5619a', '#b6294c', '#ae3971', '#a84c82', '#b96374', '#d28a62', '#e4a961',
  ],
  ocean: [
    '#61d4a8', '#62d4b6', '#63d4be', '#64d4cd', '#64d4d5', '#66d4dc', '#60ccdb', '#5dc4db', '#57bbe3', '#53b3da',
    '#50abe2', '#4ba3e1', '#479ce1', '#4294e0', '#3e8ce0', '#3a84d7', '#367bd7', '#3273cf', '#2e6bc7', '#2a63bf',
  ],
  'calm-water': expandRamp(['#f1fbff', '#b7e4ec', '#76c7d4', '#4a9fb5', '#316c87'], 20),
  fire: [
    '#fcef50', '#fbe84d', '#f9d949', '#f6c944', '#f5c142', '#f3b13e', '#f2aa3c', '#f19b38', '#ee8432', '#ee7d30',
    '#ec682c', '#eb4e27', '#ea4425', '#ea3b24', '#ea3423', '#c42a1c', '#ad2718', '#8f1d11', '#69140a', '#52140e',
  ],
  fog: expandRamp(['#fafafa', '#d9dde1', '#aeb6bf', '#d9dde1', '#ffffff'], 20),
  moss: expandRamp(['#dbe7a7', '#9aaa55', '#536c35', '#243c2a', '#8da05d'], 20),
  peacock: [
    '#539cf0', '#54abe9', '#53b3da', '#5ac4cc', '#5bc4d3', '#60bbda', '#68b4da', '#6face9', '#84a5f1', '#969ef8',
    '#7f8dd8', '#4e74a1', '#3c6c91', '#374caf', '#3234c6', '#2e5ce6', '#3573f6', '#306bd7', '#306bb7', '#2e6ba0',
  ],
  wheat: expandRamp(['#fff8d6', '#ead59c', '#c6a767', '#8f7143', '#e8d5a8'], 20),
  parchment: expandRamp(['#fff5d6', '#e7d1a4', '#c4a875', '#9b7848', '#e4c994'], 20),
  mahogany: [
    '#c9af9e', '#d0af98', '#d0af90', '#cfa889', '#c8a781', '#c6a072', '#cfa87a', '#c5986b', '#be9062', '#bd895b',
    '#b48053', '#a47043', '#aa693c', '#a26135', '#9b5933', '#8b512b', '#835025', '#7c4829', '#6b381a', '#64371e',
  ],
  gold: [
    '#e4d8ab', '#e6dfa4', '#e4d895', '#dbcf8d', '#d3c77e', '#cab768', '#c2af5a', '#cbbf70', '#dbcf86', '#e4d895',
    '#dbcf8d', '#d3c77e', '#d2bf76', '#cbbf70', '#cab768', '#c2af5a', '#cab76f', '#d2bf7d', '#dbcf94', '#e4d8ab',
  ],
  'gold-ii': [
    '#f3e0ac', '#e2c87f', '#c6a058', '#b79845', '#b6903e', '#c09f4c', '#c1a753', '#c9af67', '#d9bf77', '#e2c87f',
    '#ead095', '#ecdfa4', '#f4e7ad', '#b6903e', '#7f6625', '#8f763c', '#9a8e54', '#b2a66c', '#d3c793', '#ecdfb3',
  ],
  brass: [
    '#7e5f1c', '#ad7f2a', '#db9a35', '#f2aa3c', '#bd892e', '#8d6720', '#8d6720', '#b4802a', '#e3a238', '#db9a35',
    '#b4802a', '#855f1d', '#9d6f24', '#c4892e', '#eba93b', '#c49130', '#a57727', '#7e5f1c', '#b4802a', '#dca137',
  ],
  chrome: [
    '#efefef', '#b5b6b5', '#6b6d6b', '#323431', '#efefef', '#bdbebd', '#a5a6a5', '#8c8e8c', '#636563', '#8c8e8c',
    '#bdbebd', '#cecfce', '#d6d7d6', '#cecfce', '#6b6d6b', '#222421', '#efefef', '#c6c7c6', '#a5a6a5', '#8c8e8c',
  ],
  'chrome-ii': [
    '#bdbebd', '#9c9e9c', '#7b7d7b', '#636563', '#5b5d5a', '#6b6d6b', '#848684', '#949694', '#adaead', '#c6c7c6',
    '#cecfce', '#efefef', '#f7f7f7', '#adaead', '#2a2c29', '#636563', '#7b7d7b', '#949694', '#bdbebd', '#dedfde',
  ],
  silver: [
    '#ffffff', '#e7e7e7', '#dedfde', '#c6c7c6', '#afb6bc', '#9c9eac', '#848693', '#8f9eab', '#bdbecd', '#e7e7e7',
    '#dedfde', '#cecfce', '#bfc7c6', '#adaebc', '#a5a6b4', '#9496a4', '#868e9b', '#7d8693', '#b5b6c5', '#d1dfde',
  ],
  sapphire: [
    '#020c86', '#0a23ae', '#163bd5', '#1a44f5', '#0e2bc6', '#020c8e', '#04148e', '#0a23b5', '#163be6', '#1233de',
    '#0e2bb6', '#020c86', '#04149e', '#0e2bc6', '#1a44ee', '#1233ce', '#071ba6', '#01047e', '#0a23ae', '#163be6',
  ],
};

export function officeRampColors(id: string): Rgba[] | null {
  const ramp = OFFICE_RAMPS[id.toLowerCase()];
  return ramp ? ramp.map(hexToRgba) : null;
}

function expandRamp(colors: string[], count: number): string[] {
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
