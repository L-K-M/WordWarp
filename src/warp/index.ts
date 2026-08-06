import { mapMeshPoint } from './mesh';
import { mapPathPoint } from './path';
import { mapPerspectivePoint } from './perspective';
import { mapPresetPoint } from './presets';
import type { Point, WarpSpec } from '../model/types';

export function mapWarpPoint(u: number, v: number, warp: WarpSpec): Point {
  if (warp.kind === 'none') return [u, v];
  if (warp.kind === 'preset') {
    if (!warp.preset) return [u, v];
    return mapPresetPoint(u, v, { ...warp, preset: warp.preset });
  }
  if (warp.kind === 'mesh') return warp.mesh ? mapMeshPoint(u, v, warp.mesh) : [u, v];
  if (warp.kind === 'perspective') return warp.corners ? mapPerspectivePoint(u, v, warp.corners) : [u, v];
  if (warp.kind === 'path') return warp.path ? mapPathPoint(u, v, warp.path) : [u, v];
  return [u, v];
}

export function warpDisplayName(id: string): string {
  return id
    .replace(/^text/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
}
