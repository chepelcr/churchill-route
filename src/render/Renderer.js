// Renderer seam — the active render backend.
//
// The game loop (src/game/index.js) only knows this interface:
//   setupCanvas(canvasEl)  — bind the canvas + size it to the viewport
//   render(t)              — draw one frame for timestamp t (ms)
//   paintVehicle(ctx, key, veh) — vehicle sprite at (0,0) facing +x (UI preview)
//
// The shipped balance (user call, 2026-07-18): canvas2d paints the WHOLE
// painterly world + entities (the look we love), and a transparent Pixi
// layer ABOVE it carries landmark structures that canvas can't do justice —
// the estadio's gradas + the tunnel roof the player drives under. More
// landmarks migrate into that layer over time. Escape hatch: `?canvas` or
// localStorage churchill_renderer = "canvas" disables the Pixi layer
// (canvas then draws fallback stands too, via setPixiLandmarks(false)).
import { setupCanvas as c2dSetup, render as c2dRender, setPixiLandmarks, paintVehicle } from "./canvas2d.js";
import { setupPixi, renderPixi } from "./pixi/index.js";

const PIXI_LM = (() => {
  try {
    if (new URLSearchParams(window.location.search).has("canvas")) return false;
    if (localStorage.getItem("churchill_renderer") === "canvas") return false;
  } catch { /* SSR/private mode */ }
  return true;
})();

export { paintVehicle };

export function setupCanvas(canvasEl) {
  c2dSetup(canvasEl);
  if (PIXI_LM) {
    setPixiLandmarks(true);
    setupPixi(canvasEl, () => setPixiLandmarks(false)); // no WebGL → canvas stands
  }
}

export function render(t) {
  c2dRender(t);
  if (PIXI_LM) renderPixi(t);
}
