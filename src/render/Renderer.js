// Renderer seam — the active render backend.
//
// The game loop (src/game/index.js) only knows this interface:
//   setupCanvas(canvasEl)  — bind the canvas + size it to the viewport
//   render(t)              — draw one frame for timestamp t (ms)
//   paintVehicle(ctx, key, veh) — vehicle sprite at (0,0) facing +x (UI preview)
//
// Milestone C: the DEFAULT is the HYBRID stack — Pixi/WebGL draws the world
// (surfaces, roads, buildings, greenery) and every moving entity, while
// canvas2d runs above it in overlay mode (landmarks, pier/bridge, weather,
// particles/floats, compass, minimap). Escape hatches back to pure canvas2d:
// `?canvas` in the URL, or localStorage churchill_renderer = "canvas"
// (plus the automatic no-WebGL fallback in setupCanvas).
import { setupCanvas as c2dSetup, render as c2dRender, setOverlayMode, paintVehicle } from "./canvas2d.js";
import { setupPixi, renderPixi } from "./pixi/index.js";

const USE_PIXI = (() => {
  try {
    if (new URLSearchParams(window.location.search).has("canvas")) return false;
    if (localStorage.getItem("churchill_renderer") === "canvas") return false;
  } catch { /* SSR/private mode */ }
  return true;
})();

export { paintVehicle };

export function setupCanvas(canvasEl) {
  c2dSetup(canvasEl);
  if (USE_PIXI) {
    setOverlayMode(true);
    setupPixi(canvasEl, () => setOverlayMode(false)); // no WebGL → full canvas2d
  }
}

export function render(t) {
  if (USE_PIXI) renderPixi(t);
  c2dRender(t);
}
