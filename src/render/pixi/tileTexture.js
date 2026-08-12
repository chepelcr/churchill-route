// Build a WebGL texture for a decoded WORLD2D tile's surface grid: one texel per
// grid cell (cols×rows), class byte -> RGBA. Uploaded once per tile and blitted
// scaled by the GPU (nearest-neighbour, so it keeps the crisp cuadra look). The
// Pixi renderer positions the sprite at the tile's world origin and scales it by
// WORLD2D.CELL so 1 texel = CELL world px.
//
// We fill an offscreen canvas via putImageData and wrap it in a CanvasSource —
// the most reliable buffer->texture path in Pixi 8 (a raw Uint8Array
// TextureSource uploads blank on some drivers).
import { Texture, CanvasSource } from "pixi.js";
import { SURFACE_CLASSES, surfaceColor } from "../../game/surfaces.js";

// class -> [r,g,b], from the ONE registry (src/assets/surfaces.json). This was a
// hand-written table, one of five copies of the same palette; the world editor
// kept another and stopped at 8 of the 11 classes, and the dev viewer at 7.
const CLASS_RGB = Object.fromEntries(SURFACE_CLASSES.map((_, id) => {
  const hex = surfaceColor(id);
  return [id, [parseInt(hex.slice(1, 3), 16),
               parseInt(hex.slice(3, 5), 16),
               parseInt(hex.slice(5, 7), 16)]];
}));
const FALLBACK = [0xff, 0x00, 0xff];

// Returns a Pixi Texture (nearest-filtered) for the tile's surface grid.
export function buildTileTexture(tile) {
  const { cols, rows, grid } = tile;
  const canvas = document.createElement("canvas");
  canvas.width = cols; canvas.height = rows;
  const g = canvas.getContext("2d");
  const img = g.createImageData(cols, rows);
  for (let i = 0; i < grid.length; i++) {
    const [r, gc, b] = CLASS_RGB[grid[i]] || FALLBACK;
    const o = i * 4;
    img.data[o] = r; img.data[o + 1] = gc; img.data[o + 2] = b; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  return new Texture({ source });
}
