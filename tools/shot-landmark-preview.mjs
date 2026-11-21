// EL PREVIEW DE LOS HITOS AUTORADOS EN GEO — quioscos `exact` y graderías de estadio, pintados por el renderer
// de verdad sobre el mundo de HOY, sin reconstruir.
//
//   python3 tools/preview_landmarks.py [id …]      # -> logs/landmark-preview.json
//   node tools/shot-landmark-preview.mjs [devUrl] [dirSalida]
//
// Toma lo que `preview_landmarks.py` colocó con el código del builder y lo pone en `W.LANDMARKS` del juego
// corriendo: a un quiosco su posición, ángulo y arranque; a un estadio sus franjas de gradería; a una parcela
// de manzana su polígono; y quita los edificios que el registro ya no trae. Saca dos
// capturas por hito: de cerca y con su cuadra. Contra un servidor de desarrollo (lee el pintor que se edita).
//
// SE ARRANCA LEJOS, A PROPÓSITO: las graderías 3D se arman UNA vez por estadio (`stadium3d.js`) con las franjas
// que tenga el hito en ese momento; si el estadio se dibujara antes de inyectar, quedarían las viejas.
//
// LO QUE NO MUESTRA: la colisión. Las franjas de una gradería son también su pared, y esa llega al reconstruir;
// el arranque de un quiosco el preview lo calcula con una celda de tolerancia.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://localhost:8734/";
const out = process.argv[3] || "logs";
const data = JSON.parse(readFileSync("logs/landmark-preview.json", "utf8"));
if (!data.landmarks?.length) { console.error("[preview] el preview no trae hitos"); process.exit(1); }
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem("churchill_intro_seen_v1", "1");
  localStorage.setItem("churchill_lang_v1", "es");
});
await page.goto(`${url}?editorPlay=1&x=2000&y=2000`, { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 60000 });
await page.waitForTimeout(1500);
// todo el preview de una vez, antes de que nada de él se dibuje
await page.evaluate((recs) => {
  const W = window.WORLD2D;
  for (const k of recs) {
    const lm = W.LANDMARKS.find((l) => l.id === k.id);
    if (!lm) throw new Error(`el mundo no tiene el hito ${k.id}`);
    if (k.stands) lm.stands = { ...lm.stands, quads: k.stands.quads };
    else Object.assign(lm, { x: k.x, y: k.y, ang: k.ang, spawn: k.spawn });
  }
}, data.landmarks);
// las parcelas corridas: su polígono, su caja y su centro, y fuera los caminos y marcos que el pintor cacheó
await page.evaluate((parcels) => {
  for (const q of parcels || []) {
    const P = window.WORLD2D.PARCELS.find((p) => p.id === q.id);
    if (!P) throw new Error(`el mundo no tiene la parcela ${q.id}`);
    P.poly = q.poly;
    for (const key of ["cx", "x0", "x1"]) if (P[key] != null) P[key] += q.dx;
    for (const key of ["cy", "y0", "y1"]) if (P[key] != null) P[key] += q.dy;
    if (P.slot) P.slot = [P.slot[0] + q.dx, P.slot[1] + q.dy, P.slot[2], P.slot[3]];
    for (const key of ["_path", "_pframe", "_small", "_frame", "_floor", "_court"]) delete P[key];
  }
}, data.parcels);
// los edificios quitados se quitan del tile YA CARGADO, en cada toma: si el tile se desaloja y vuelve, vuelve entero
const dropBuildings = async () => page.evaluate((drops) => {
  for (const d of drops || []) {
    for (const b of window.WORLD2D.buildingsNear(d.x, d.y) || []) {
      if (b.name === d.name) b.aabb = { x0: -1e9, y0: -1e9, x1: -1e9 + 1, y1: -1e9 + 1 };
    }
  }
}, data.dropBuildings);
const extra = [...(data.parcels || []).map((q) => ({ id: q.id, at: [q.poly[0], q.poly[1]] }))];

for (const k of [...data.landmarks, ...extra]) {
  const lm = k.at ? { x: k.at[0], y: k.at[1] }
    : await page.evaluate((id) => { const l = window.WORLD2D.LANDMARKS.find((q) => q.id === id); return { x: l.x, y: l.y }; }, k.id);
  const [fx, fy] = k.stands ? [k.stands.quads[0][0], k.stands.quads[0][1]] : [lm.x, lm.y];   // una gradería: su primera franja
  for (const [name, zoom] of [["cerca", 5], ["cuadra", 2.6]]) {
    await page.evaluate(async ({ fx, fy, zoom }) => {
      const G = window.Game, W = window.WORLD2D, st = G.state;
      G.setAttract(false);
      G.startExplore({ weather: "sunny", x: fx, y: fy });
      st.storyTip = null;
      await new Promise((r) => setTimeout(r, 700));
      st.paused = true;
      st.p.x = -9999; st.p.y = -9999;          // el carro fuera de cuadro: es una foto del lugar
      st.cam.x = fx; st.cam.y = fy; st.cam.zoom = zoom;
      W.update(fx, fy); await W.ready(fx, fy, 1800, 1200);
      for (const el of document.querySelectorAll("body > *:not(canvas), #root > *:not(canvas)")) {
        if (!el.querySelector("canvas")) el.style.display = "none";
      }
    }, { fx, fy, zoom });
    await dropBuildings();
    await page.waitForTimeout(1300);
    const file = path.join(out, `preview-${k.id}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`[preview] ${file}`);
  }
}
await browser.close();
if (errors.length) { console.error(`[preview] errores de página: ${errors.join(" | ")}`); process.exit(1); }
