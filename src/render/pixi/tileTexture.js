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
import { SURFACE } from "../../domain/vocabulary.generated.js";

// class -> [r,g,b]. Keyed through SURFACE so the class a colour belongs to is
// named rather than counted; the world editor keeps the same table for its own
// preview and used to stop at 8 of these, which is how `malecon` came to be
// missing from its tile palette entirely.
const CLASS_RGB = {
  [SURFACE.WATER]: [0x2a, 0x7f, 0xa8],
  [SURFACE.LAND]: [0xe8, 0xd5, 0xa0],       // cuadra interior
  [SURFACE.BEACH]: [0xf4, 0xd7, 0x7a],
  [SURFACE.ROAD]: [0x3a, 0x35, 0x40],
  [SURFACE.PASEO]: [0xf0, 0x8a, 0x5d],
  [SURFACE.BRIDGE]: [0x8c, 0x8c, 0x8c],     // bridge and pier decks
  [SURFACE.ACERA]: [0xce, 0xc7, 0xb2],
  [SURFACE.BOULEVARD]: [0xd9, 0xd6, 0xcd],  // stone paving
  [SURFACE.BARRO]: [0x9c, 0x7a, 0x4f],      // the same dirt the road vector uses
  [SURFACE.GRAVEL]: [0xa9, 0x9d, 0x8b],     // lastre
  [SURFACE.MALECON]: [0xe4, 0xd2, 0xae],    // warm pavers, a shade off the sand
};
// MAGENTA ON PURPOSE: a class with no colour has to be visible, not plausible.
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
