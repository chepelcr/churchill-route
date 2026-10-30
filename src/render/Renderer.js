// Renderer seam — the active render backend.
//
// The game loop (src/game/index.js) only knows this interface:
//   setupCanvas(canvasEl)  — bind the canvas + size it to the viewport
//   render(tSeconds)       — draw one frame on the renderer's seconds clock
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
import { beginCameraFrame } from "./camera.js";

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

export function render(tSeconds) {
  const prof = typeof window !== "undefined" ? window.__prof : null;
  const started = prof ? performance.now() : 0;
  const camera = beginCameraFrame();
  c2dRender(tSeconds, camera);
  if (PIXI_LM) renderPixi(tSeconds, camera);
  if (prof) {
    prof.render = (prof.render || 0) + performance.now() - started;
    prof.frames = (prof.frames || 0) + 1;
  }
}
