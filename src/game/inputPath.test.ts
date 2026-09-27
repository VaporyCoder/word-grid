import { describe, expect, it } from "vitest";
import { closestTileAtPoint, firstTileCrossed, type TileGeometry } from "./inputPath";

const tiles: TileGeometry[] = [
  { index: 1, center: { x: 100, y: 100 }, radius: 40 },
  { index: 2, center: { x: 200, y: 100 }, radius: 40 },
];

describe("intent-aware tile geometry", () => {
  it("chooses the closest center only inside the activation radius", () => {
    expect(closestTileAtPoint({ x: 132, y: 100 }, tiles)?.index).toBe(1);
    expect(closestTileAtPoint({ x: 150, y: 100 }, tiles)).toBeNull();
    expect(closestTileAtPoint({ x: 170, y: 100 }, tiles)?.index).toBe(2);
  });

  it("detects a tile crossed between sparse pointer events", () => {
    const hit = firstTileCrossed({ x: 40, y: 100 }, { x: 240, y: 100 }, tiles, 0.85);
    expect(hit?.tile.index).toBe(1);
    expect(hit?.t).toBeGreaterThan(0);
    expect(hit?.t).toBeLessThan(1);
  });

  it("ignores a segment that only grazes the outer edge", () => {
    expect(firstTileCrossed({ x: 40, y: 137 }, { x: 240, y: 137 }, tiles, 0.85)).toBeNull();
  });
});
