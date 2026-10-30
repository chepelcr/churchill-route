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
//
// LA VISTA 2.5D (`?render=3d`, opt-in): a three.js layer between the Canvas
// ground and the screen overlay takes the things that have HEIGHT — see
// `src/render/three/index.js` and `src/render/owners.js`. Three is imported
// dynamically, so the 2-D game never downloads it; if WebGL fails, Canvas
// keeps owning everything and the game looks exactly as it always has.
import {
  setupCanvas as c2dSetup, render as c2dRender, setPixiLandmarks, setScreenOverlay, paintVehicle,
} from "./canvas2d.js";
import { setupPixi, renderPixi } from "./pixi/index.js";
import { beginCameraFrame } from "./camera.js";
import { quality, render3dRequested } from "./view3d.js";

const WANT_3D = (() => {
  try { return render3dRequested(); } catch { return false; }
})();
let three = null;

const PIXI_LM = (() => {
  try {
    if (new URLSearchParams(window.location.search).has("canvas")) return false;
    if (localStorage.getItem("churchill_renderer") === "canvas") return false;
  } catch { /* SSR/private mode */ }
  return true;
})();

export { paintVehicle };

export function setupCanvas(canvasEl) {
  // In 3-D the screen pass (sky tint, night, rain, minimap) gets its own canvas
  // ABOVE the three layer, so the night darkens the buildings exactly as much
  // as the street under them.
  c2dSetup(canvasEl, { separateOverlay: WANT_3D, maxDpr: WANT_3D && quality() === "low" ? 1 : 2 });
  if (PIXI_LM) {
    setPixiLandmarks(true);
    setupPixi(canvasEl, () => setPixiLandmarks(false)); // no WebGL → canvas stands
  }
  if (WANT_3D) {
    setScreenOverlay(true);
    import("./three/index.js")
      .then((m) => m.setupThree(canvasEl))
      .then((api) => { three = api; })
      .catch((e) => { console.warn("[three] layer unavailable — Canvas draws everything", e); });
  }
}

export function render(tSeconds) {
  const prof = typeof window !== "undefined" ? window.__prof : null;
  const started = prof ? performance.now() : 0;
  const camera = beginCameraFrame();
  c2dRender(tSeconds, camera);
  if (PIXI_LM) renderPixi(tSeconds, camera);
  if (three) three.render(tSeconds, camera);
  if (prof) {
    prof.render = (prof.render || 0) + performance.now() - started;
    prof.frames = (prof.frames || 0) + 1;
  }
}
