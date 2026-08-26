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
import { setLean } from "./lean.js";
import { resolveOwners } from "./migrated.js";
import { DEFAULT_LEAN_RAD } from "../domain/units.js";

const PIXI_LM = (() => {
  try {
    if (new URLSearchParams(window.location.search).has("canvas")) return false;
    if (localStorage.getItem("churchill_renderer") === "canvas") return false;
  } catch { /* SSR/private mode */ }
  return true;
})();

// EL 3-D ES EL JUEGO AHORA, y `?render=2d` (o `?canvas`) es la salida.
//
// Se invirtió el interruptor: antes había que pedir `?render=3d`. Lo que NO
// cambió es que la salida siga existiendo y siga siendo exacta — es contra ella
// que se diffean las capturas, y es a donde cae solo un aparato sin WebGL.
const THREE_MODE = (() => {
  try {
    const query = new URLSearchParams(window.location.search);
    const asked = query.get("render");
    if (asked === "2d" || query.has("canvas")) return null;
    // Explicit names keep every staged proof reproducible. `world` is the
    // shipped one: terrain, its shadow map, and the leaning town.
    const named = query.get("three");
    return ["empty", "terrain", "shadows"].includes(named) ? named : "world";
  } catch { return null; }
})();

// CUÁNTO SE INCLINA, y por qué se puede pedir por URL. Es la única perilla de
// sensación de todo esto y hay que poder moverla EN EL TELÉFONO, que es donde
// se juega — no en una recompilación.
const LEAN_RAD = (() => {
  if (!THREE_MODE || THREE_MODE === "empty") return 0;
  try {
    const asked = new URLSearchParams(window.location.search).get("lean");
    if (asked !== null && asked !== "") {
      const deg = Number(asked);
      if (Number.isFinite(deg)) return Math.max(0, deg) * Math.PI / 180;
    }
  } catch { /* SSR/private mode */ }
  // `terrain`/`shadows` are the D2/D3 proof stages: they promised zero changed
  // pixels on the flat peninsula and a lean would break that promise.
  return THREE_MODE === "world" ? DEFAULT_LEAN_RAD : 0;
})();

let renderThree = null;

export { paintVehicle };

export function setupCanvas(canvasEl) {
  // CSS-composited terrain sits above the opaque world canvas, so its
  // screen-space weather/minimap pass needs a transparent canvas above both.
  // The ordinary 2-D and explicit D1-empty paths keep the historical single
  // canvas, which also keeps that proof bit-exact.
  // CANVAS EMPIEZA SIENDO DUEÑO DE TODO, siempre. La capa Three se carga de
  // forma asíncrona —un `import()` dinámico y una compilación de shaders— así
  // que ceder los edificios en el `setup` los dejaría sin dibujar por los
  // primeros cuadros: un pueblo de calles sin una sola casa mientras arranca.
  // La propiedad se cede cuando la capa dice que está lista, y no antes.
  resolveOwners("canvas");
  setLean(LEAN_RAD);
  c2dSetup(canvasEl, { separateOverlay: THREE_MODE !== null && THREE_MODE !== "empty" });
  if (PIXI_LM) {
    setPixiLandmarks(true);
    setupPixi(canvasEl, () => setPixiLandmarks(false)); // no WebGL → canvas stands
  }
  // All Three modes stay behind the opt-in flag so ordinary 2-D downloads
  // none of the backend or dependency chunk.
  if (THREE_MODE) {
    import("./three/index.js").then(async (threeLayer) => {
      await threeLayer.setupThree(canvasEl, { mode: THREE_MODE, lean: LEAN_RAD });
      // …y AHORA sí. El siguiente cuadro es el primero en que Three tiene algo
      // que dibujar, y es el mismo en que Canvas deja de dibujarlo.
      resolveOwners(THREE_MODE, (() => {
        try { return window.location.search; } catch { return ""; }
      })());
      renderThree = threeLayer.renderThree;
    }).catch((error) => {
      // UN APARATO SIN WEBGL RECIBE EL JUEGO DE SIEMPRE, no un pueblo a medias.
      // Ésta es la obligación que trae encender el 3-D por defecto: si la capa
      // no arranca, el terreno vuelve a Canvas y la inclinación se apaga, así
      // que el cuadro siguiente es exactamente el juego plano publicado. Sin
      // esto, un teléfono viejo se queda sin relieve Y sin poder inclinarse:
      // dos fallos donde debería haber cero.
      resolveOwners("canvas");
      setLean(0);
      console.warn(`[three] ${THREE_MODE} layer unavailable — flat 2-D`, error);
    });
  }
}

export function render(tSeconds) {
  const prof = typeof window !== "undefined" ? window.__prof : null;
  const started = prof ? performance.now() : 0;
  const camera = beginCameraFrame();
  // Three resolves whether its CSS layer has pixels before Canvas chooses the
  // historical single-canvas tail or the transparent screen overlay above it.
  // The empty D1 layer remains a transparent sibling, so this is neutral there.
  if (renderThree) renderThree(tSeconds, camera);
  c2dRender(tSeconds, camera);
  if (PIXI_LM) renderPixi(tSeconds, camera);
  if (prof) {
    prof.render = (prof.render || 0) + performance.now() - started;
    prof.frames = (prof.frames || 0) + 1;
  }
}
