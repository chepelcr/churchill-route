// Renderer seam — the active render backend.
//
// The game loop (src/game/index.js) only knows this interface:
//   setupCanvas(canvasEl)  — bind the canvas + size it to the viewport
//   render(t)              — draw one frame for timestamp t (ms)
//
// Today that is the Canvas2D backend. Milestone C introduces a PixiJS/WebGL
// backend; swapping it in is a one-line change here (re-export from ./pixi).
export { setupCanvas, render } from "./canvas2d.js";
