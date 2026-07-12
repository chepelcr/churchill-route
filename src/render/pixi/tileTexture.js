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

// class -> [r,g,b]; mirrors the canvas smoke viewer's CLASS_COLOR.
const CLASS_RGB = {
  0: [0x2a, 0x7f, 0xa8], // water
  1: [0xe8, 0xd5, 0xa0], // land (cuadra interior)
  2: [0xf4, 0xd7, 0x7a], // beach
  3: [0x3a, 0x35, 0x40], // road
  4: [0xf0, 0x8a, 0x5d], // paseo
  5: [0x8c, 0x8c, 0x8c], // bridge/pier
  6: [0xce, 0xc7, 0xb2], // acera
};
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
