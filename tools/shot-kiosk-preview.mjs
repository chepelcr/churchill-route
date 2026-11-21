// EL PREVIEW DE LOS QUIOSCOS — dónde quedaría cada uno, pintado por el renderer de verdad sobre el mundo
// de HOY, sin reconstruir.
//
//   python3 tools/preview_kiosks.py [id …]        # -> logs/kiosk-preview.json
//   node tools/shot-kiosk-preview.mjs [devUrl] [dirSalida]
//
// `preview_kiosks.py` coloca los quioscos con el código del builder sobre los tiles ya emitidos; esto toma su
// resultado, lo pone en `W.LANDMARKS` del juego corriendo (posición, ángulo y arranque) y saca dos capturas
// por quiosco: de cerca y con su cuadra. Contra un servidor de desarrollo (lee el pintor que se está editando).
//
// LO QUE NO MUESTRA: la superficie. Un quiosco `exact` no estampa nada, así que eso no cambia; lo que sí
// cambia al reconstruir es dónde arranca el jugador, que el preview calcula con una celda de tolerancia.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://localhost:8734/";
const out = process.argv[3] || "logs";
const data = JSON.parse(readFileSync("logs/kiosk-preview.json", "utf8"));
if (!data.landmarks?.length) { console.error("[kiosk-preview] el preview no trae quioscos"); process.exit(1); }
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem("churchill_intro_seen_v1", "1");
  localStorage.setItem("churchill_lang_v1", "es");
});
const first = data.landmarks[0];
await page.goto(`${url}?editorPlay=1&x=${first.x}&y=${first.y}`, { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 60000 });
await page.waitForTimeout(2500);

for (const k of data.landmarks) {
  for (const [name, zoom] of [["cerca", 5], ["cuadra", 2.6]]) {
    await page.evaluate(async ({ k, zoom }) => {
      const G = window.Game, W = window.WORLD2D, st = G.state;
      G.setAttract(false);
      const lm = W.LANDMARKS.find((l) => l.id === k.id);
      if (!lm) throw new Error(`el mundo no tiene el hito ${k.id}`);
      Object.assign(lm, { x: k.x, y: k.y, ang: k.ang, spawn: k.spawn });
      G.startExplore({ weather: "sunny", x: k.x, y: k.y });
      st.storyTip = null;
      await new Promise((r) => setTimeout(r, 700));
      st.paused = true;
      st.p.x = -9999; st.p.y = -9999;          // el carro fuera de cuadro: es una foto del lugar
      st.cam.x = k.x; st.cam.y = k.y; st.cam.zoom = zoom;
      W.update(k.x, k.y); await W.ready(k.x, k.y, 1800, 1200);
      for (const el of document.querySelectorAll("body > *:not(canvas), #root > *:not(canvas)")) {
        if (!el.querySelector("canvas")) el.style.display = "none";
      }
    }, { k, zoom });
    await page.waitForTimeout(1300);
    const file = path.join(out, `kiosk-preview-${k.id}-${name}.png`);
    await page.screenshot({ path: file });
    console.log(`[kiosk-preview] ${file}`);
  }
}
await browser.close();
if (errors.length) { console.error(`[kiosk-preview] errores de página: ${errors.join(" | ")}`); process.exit(1); }
