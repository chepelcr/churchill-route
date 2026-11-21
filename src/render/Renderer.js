// Renderer seam — the active render backend.
//
// The game loop (src/game/index.js) only knows this interface:
//   setupCanvas(canvasEl)  — bind the canvas + size it to the viewport
//   render(tSeconds)       — draw one frame on the renderer's seconds clock
//   paintVehicle(ctx, key, veh) — the flat sprite at (0,0) facing +x
//   paintVehicleModel(ctx, key, veh) — the 3D model the player drives (UI preview)
//
// The shipped balance (user call, 2026-07-18): canvas2d paints the WHOLE
// painterly world + entities (the look we love), and a transparent Pixi
// layer ABOVE it carries landmark structures that canvas can't do justice —
// the estadio's gradas + the tunnel roof the player drives under. More
// landmarks migrate into that layer over time.
//
// LA CAPA PIXI ES OPT-IN DESDE EL 2026-11-21, porque hoy no dibuja NADA: ningún hito está migrado
// (`PIXI_MIGRATED` y `scene._MIGRATED` vacíos), la multitud y las monedas del estadio nunca se crean,
// y aun así se levantaba un segundo lienzo WebGL transparente, con antialias, a pantalla completa, que
// el navegador componía encima del juego en cada cuadro. Medido con el mismo cuadro a 2× de densidad:
// 61,6 ms con la capa y 45,4 sin ella en el centro — un cuarto del cuadro por una capa vacía, y en el
// WebView del APK es peor. Se enciende con `?pixi` o localStorage churchill_renderer = "pixi" (el día
// que se le migre algo, es encenderla por defecto otra vez); `?canvas` sigue apagándola.
//
// LA VISTA 2.5D se retiró el 2026-11-17: el volumen lo pinta Canvas por
// paralaje (`c2d/depth.js`, alturas en los registros). El código de three.js
// vive en el tag `3d-attempt-2026-09-29`.
import {
  setupCanvas as c2dSetup, render as c2dRender, setPixiLandmarks, paintVehicle, paintVehicleModel, vehicleModelBounds,
} from "./canvas2d.js";
import { beginCameraFrame } from "./camera.js";

const PIXI_LM = (() => {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has("canvas")) return false;
    if (q.has("pixi")) return true;
    return localStorage.getItem("churchill_renderer") === "pixi";
  } catch { /* SSR/private mode */ }
  return false;
})();

export { paintVehicle, paintVehicleModel, vehicleModelBounds };

// …y se importa sólo si se pide: estática, todo Pixi viajaba en el bundle y se parseaba al arrancar
let renderPixi = null;
export function setupCanvas(canvasEl) {
  c2dSetup(canvasEl);
  if (PIXI_LM && !renderPixi) {
    setPixiLandmarks(true);
    import("./pixi/index.js").then((pixi) => {
      pixi.setupPixi(canvasEl, () => setPixiLandmarks(false)); // no WebGL → canvas stands
      renderPixi = pixi.renderPixi;
    }).catch(() => setPixiLandmarks(false));
  }
}

export function render(tSeconds) {
  const prof = typeof window !== "undefined" ? window.__prof : null;
  const started = prof ? performance.now() : 0;
  const camera = beginCameraFrame();
  c2dRender(tSeconds, camera);
  if (renderPixi) renderPixi(tSeconds, camera);
  if (prof) {
    prof.render = (prof.render || 0) + performance.now() - started;
    prof.frames = (prof.frames || 0) + 1;
  }
}
