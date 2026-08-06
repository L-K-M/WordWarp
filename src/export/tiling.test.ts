import { describe, expect, it } from 'vitest';

import { createEffect } from '../effects/defaults';
import { effectStackReach } from '../render/fallback2d/renderer';
import { planTiles } from './tiling';

describe('export tiling', () => {
  it('covers the output once with bounded overlapping render regions', () => {
    const tiles = planTiles(5000, 3000, 2048, 128);
    const area = tiles.reduce((sum, tile) => sum + tile.core.width * tile.core.height, 0);

    expect(area).toBe(5000 * 3000);
    expect(tiles).toHaveLength(6);
    expect(tiles[0]).toEqual({
      core: { x: 0, y: 0, width: 2048, height: 2048 },
      render: { x: 0, y: 0, width: 2176, height: 2176 },
    });
    expect(Math.max(...tiles.map((tile) => tile.render.width))).toBeLessThanOrEqual(2304);
  });

  it('accumulates reach when reflection and post passes consume earlier effects', () => {
    const shadow = createEffect('dropShadow');
    const reflection = createEffect('reflection');
    const aberration = createEffect('post');
    aberration.type = 'aberration';
    aberration.params.amount = 7;
    const face = { x: 0, y: 0, width: 200, height: 100 };
    const viewport = { width: 1200, height: 630 };

    const reflectedReach = effectStackReach(face, [shadow, reflection], viewport);
    expect(reflectedReach).toBeGreaterThan(shadow.distance + shadow.size + reflection.offset);
    expect(effectStackReach(face, [shadow, reflection, aberration], viewport)).toBe(reflectedReach + 7);
  });
});
