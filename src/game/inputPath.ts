export type Point = { x: number; y: number };

export type TileGeometry = {
  index: number;
  center: Point;
  radius: number;
};

export type SegmentHit = {
  tile: TileGeometry;
  point: Point;
  t: number;
};

export function distanceSquared(a: Point, b: Point) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function closestTileAtPoint(point: Point, tiles: TileGeometry[], radiusScale = 1) {
  let closest: TileGeometry | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const tile of tiles) {
    const distance = distanceSquared(point, tile.center);
    const radius = tile.radius * radiusScale;
    if (distance <= radius * radius && distance < closestDistance) {
      closest = tile;
      closestDistance = distance;
    }
  }
  return closest;
}

export function firstTileCrossed(start: Point, end: Point, tiles: TileGeometry[], radiusScale = 1): SegmentHit | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  let first: SegmentHit | null = null;

  for (const tile of tiles) {
    const radius = tile.radius * radiusScale;
    let t = 0;
    if (lengthSquared > 0) {
      const projection = ((tile.center.x - start.x) * dx + (tile.center.y - start.y) * dy) / lengthSquared;
      t = Math.max(0, Math.min(1, projection));
    }
    const point = { x: start.x + dx * t, y: start.y + dy * t };
    if (distanceSquared(point, tile.center) > radius * radius) continue;

    // Find the circle-entry time so multiple crossed tiles are resolved in travel order.
    const fromCenterX = start.x - tile.center.x;
    const fromCenterY = start.y - tile.center.y;
    const b = 2 * (fromCenterX * dx + fromCenterY * dy);
    const c = fromCenterX * fromCenterX + fromCenterY * fromCenterY - radius * radius;
    const discriminant = b * b - 4 * lengthSquared * c;
    const entry = lengthSquared > 0 && discriminant >= 0
      ? Math.max(0, Math.min(1, (-b - Math.sqrt(discriminant)) / (2 * lengthSquared)))
      : 0;
    const hit = { tile, t: entry, point: { x: start.x + dx * entry, y: start.y + dy * entry } };
    if (!first || hit.t < first.t || (hit.t === first.t && distanceSquared(end, tile.center) < distanceSquared(end, first.tile.center))) first = hit;
  }
  return first;
}

