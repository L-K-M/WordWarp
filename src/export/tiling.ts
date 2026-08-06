export interface ExportTile {
  core: { x: number; y: number; width: number; height: number };
  render: { x: number; y: number; width: number; height: number };
}

export function planTiles(
  width: number,
  height: number,
  coreSize: number,
  halo: number,
): ExportTile[] {
  const tiles: ExportTile[] = [];
  for (let y = 0; y < height; y += coreSize) {
    for (let x = 0; x < width; x += coreSize) {
      const coreWidth = Math.min(coreSize, width - x);
      const coreHeight = Math.min(coreSize, height - y);
      const renderX = Math.max(0, x - halo);
      const renderY = Math.max(0, y - halo);
      const renderRight = Math.min(width, x + coreWidth + halo);
      const renderBottom = Math.min(height, y + coreHeight + halo);
      tiles.push({
        core: { x, y, width: coreWidth, height: coreHeight },
        render: { x: renderX, y: renderY, width: renderRight - renderX, height: renderBottom - renderY },
      });
    }
  }
  return tiles;
}
