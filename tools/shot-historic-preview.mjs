// EL PREVIEW DE LOS EDIFICIOS HISTÓRICOS — los lotes que saldrían de `content/world/historic.json`,
// con sus cuerpos de receta (`world-props.json → bodies`), pintados por el renderer de verdad sobre el
// mundo de HOY, sin emitir nada.
//
//   python3 tools/emit_historic.py                       # -> logs/historic-preview.json
//   node tools/shot-historic-preview.mjs [devUrl] [dirSalida] [id,id…]
//   pnpm preview:historic                                # las dos cosas
//
// Mete las parcelas del preview en `W.PARCELS` (en lugar de las `hist_*` que ya tenga el mundo), quita
// de los tiles cargados las huellas que el lote reemplaza, y saca por lugar una vista de día a la altura
// del juego, otra de cerca y otra de noche. Contra un servidor de desarrollo FRESCO, como toda hoja que
// importa módulos fuente.
//
// LO QUE NO MUESTRA: la física. Lo manejable (`drive`) y las bocas en la acera los estampa `--emit`; hasta
// entonces el carro no entra.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://localhost:8736/";
const out = process.argv[3] || "logs";
const only = process.argv[4] ? process.argv[4].split(",") : null;
const data = JSON.parse(readFileSync("logs/historic-preview.json", "utf8"));
const parcels = data.parcels.filter((p) => !only || only.includes(p.historic));
if (!parcels.length) { console.error("[historic-preview] el preview no trae lotes"); process.exit(1); }
mkdirSync(out, { recursive: true });

// PW_CHROMIUM: un Chromium ya instalado, cuando el de Playwright no está en la máquina (como las otras hojas)
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem("churchill_intro_seen_v1", "1");
  localStorage.setItem("churchill_lang_v1", "es");
});
const P0 = parcels[0];
await page.goto(`${url}?editorPlay=1&x=${P0.cx}&y=${P0.cy}`, { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 90000 });
await page.waitForTimeout(1500);
await page.evaluate(async ({ x, y }) => {
  const G = window.Game, st = G.state;
  G.setAttract(false);
  G.startExplore({ weather: "sunny", x, y });
  await new Promise((r) => setTimeout(r, 900));
  const S = await import("/src/game/state.js"); S.vendors.length = 0;
  st.storyTip = null; st.paused = true; st.p.x = -9999; st.p.y = -9999;   // una foto del lugar, sin el carro
  window.__z0 = st.cam.zoom;
  for (const el of document.querySelectorAll("body > *:not(canvas), #root > *:not(canvas)")) if (!el.querySelector("canvas")) el.style.display = "none";
}, { x: P0.cx, y: P0.cy });

// las vistas: [nombre, zoom, hora, du, dv] — la cámara corrida (du, dv) metros del centro del lote, en su
// marco (u a lo largo de su calle `front`, v hacia adentro): `frente` mira desde esa calle, que es de donde
// se ven las fachadas con el pinhole; `costado` desde la otra.
// `HISTORIC_VIEWS='[["cerca", 2.6, 0.33, -12, -8]]'` las reemplaza, para mirar un detalle de cerca.
const VIEWS = process.env.HISTORIC_VIEWS ? JSON.parse(process.env.HISTORIC_VIEWS)
  : [["dia", 1.25, 0.3, 0, 0], ["frente", 1.7, 0.33, 0, -26], ["costado", 1.7, 0.36, -30, 4], ["noche", 1.25, 0.74, 0, -14]];
for (const P of parcels) {
  for (const [tag, zoom, hour, du, dv] of VIEWS) {
    await page.evaluate(async ({ P, zoom, hour, du, dv, drop, margin, gone }) => {
      const W = window.WORLD2D, st = window.Game.state;
      const dn = await import("/src/game/daynight.js"); dn.setDayCycle(true, hour);
      // el lote del preview, en lugar del que el mundo traiga; y fuera las parcelas que un lugar reemplaza
      // (`dropParcels`: la Antigua Fábrica de Hielo bajo el recinto del Matadero)
      const i = W.PARCELS.findIndex((q) => q.id === P.id);
      if (i >= 0) W.PARCELS.splice(i, 1);
      W.PARCELS.push(structuredClone(P));
      for (let j = W.PARCELS.length - 1; j >= 0; j--) if (gone.includes(W.PARCELS[j].id)) W.PARCELS.splice(j, 1);
      const k = W.PX_PER_M, c = Math.cos(P.ang), s = Math.sin(P.ang);
      const cx = P.cx + (du * c - dv * s) * k, cy = P.cy + (du * s + dv * c) * k;
      st.cam.x = cx; st.cam.y = cy; st.cam.rot = 0; st.cam.zoom = window.__z0 * zoom;
      W.update(cx, cy); await W.ready(cx, cy, 1400, 1000);
      // las huellas que el lote reemplaza: las que caen adentro y las de `dropNamed` por su nombre (la de
      // «Repuestos Acón»), con el mismo margen que usa el emit; y los puntos de OSM, igual
      const inside = (x, y, pts) => { let hit = false; for (let a = 0, b = pts.length - 2; a < pts.length; b = a, a += 2) { const xi = pts[a], yi = pts[a + 1], xj = pts[b], yj = pts[b + 1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit; } return hit; };
      const near = (x, y) => x > P.x0 - margin && x < P.x1 + margin && y > P.y0 - margin && y < P.y1 + margin;
      for (let i = W.POIS.length - 1; i >= 0; i--) {
        const p = W.POIS[i];
        if (inside(p.x, p.y, P.poly) || (drop.includes(p.name) && near(p.x, p.y))) W.POIS.splice(i, 1);
      }
      for (const t of W.visibleTiles(P.x0 - 200, P.y0 - 200, P.x1 + 200, P.y1 + 200)) {
        t.buildings = t.buildings.filter((b) => {
          let cx = 0, cy = 0; for (let k = 0; k < b.pts.length; k += 2) { cx += b.pts[k]; cy += b.pts[k + 1]; } cx /= b.pts.length / 2; cy /= b.pts.length / 2;
          return !inside(cx, cy, P.poly) && !(drop.includes(b.name) && near(cx, cy));
        });
      }
    }, { P, zoom, hour, du, dv, drop: data.drops?.[P.id] || [], margin: data.margin || 0, gone: data.dropParcels || [] });
    await page.waitForTimeout(1000);
    const file = path.join(out, `historic-${P.historic}-${tag}.png`);
    await page.screenshot({ path: file });
    console.log(`[historic-preview] ${file}`);
  }
}
await browser.close();
if (errors.length) { console.error(`[historic-preview] errores en la página:\n${errors.join("\n")}`); process.exit(1); }
