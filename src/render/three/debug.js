// F1 — LO QUE LA CAPA 3-D ESTÁ HACIENDO, en pantalla.
//
// Cuadro, draw calls, triángulos, qué tiene residente cada capa y cuánto costó
// su último tile, dónde está el carro (px de mundo, tile, cota del suelo) y la
// cámara. F2 pasa todo a alambre. Es HTML encima de todo y no toca el juego:
// sólo lee `window.__three` y el estado.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";

let el = null, on = false, wire = false, last = 0, frames = 0, fps = 0;

export function setupDebug(scene) {
  window.addEventListener("keydown", (e) => {
    if (e.key === "F1") { e.preventDefault(); on = !on; if (el) el.style.display = on ? "block" : "none"; }
    if (e.key === "F2" && on) {
      e.preventDefault();
      wire = !wire;
      scene.traverse((o) => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) if ("wireframe" in m && !m.isShadowMaterial) m.wireframe = wire;
      });
    }
  });
}

export function debugFrame(stats) {
  frames++;
  const now = performance.now();
  if (now - last >= 500) { fps = (frames * 1000) / (now - last); frames = 0; last = now; }
  if (!on) return;
  if (!el) {
    el = document.createElement("pre");
    el.id = "three-debug";
    el.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:50;margin:0;padding:8px 10px;"
      + "font:11px/1.35 'JetBrains Mono',monospace;color:#e8f0ff;background:rgba(10,14,28,.78);"
      + "border-radius:8px;pointer-events:none;white-space:pre;";
    document.body.appendChild(el);
  }
  const p = state.p;
  const tc = (p.x / W.TILE_PX) | 0, tr = (p.y / W.TILE_PX) | 0;
  const z = W.groundZAt ? W.groundZAt(p.x, p.y) : 0;
  const b = stats.build || {};
  el.textContent = [
    `FPS ${fps.toFixed(0)}   render ${stats.renderMs ?? "-"} ms   capa ${stats.ms} ms`,
    `draw calls ${stats.calls}   triángulos ${(stats.triangles / 1000).toFixed(0)}k`,
    `X ${p.x.toFixed(0)}  Y ${p.y.toFixed(0)}  tile ${tc}:${tr}  cota ${(z || 0).toFixed(2)} m`,
    `lean ${stats.lean}°  pinhole ${stats.pinhole} m  noche ${stats.night}`,
    `edificios ${stats.buildings?.buildings ?? 0}  plantas ${stats.flora?.plants ?? 0}  postes ${stats.lamps?.lamps ?? 0}  vehículos ${stats.vehicles ?? 0}`,
    `último tile (ms): edif ${b.buildings ?? "-"} flora ${b.flora ?? "-"} postes ${b.lamps ?? "-"} orilla ${b.coast ?? "-"}`,
    `sombra: ${stats.shadowUpdates ?? 0} mapas   F2 alambre ${wire ? "sí" : "no"}`,
  ].join("\n");
}
