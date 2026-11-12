// EL PREVIEW DE LA FERIA — el tablado y los juegos mapeados, pintados por el
// renderer de verdad sobre el mundo de HOY, sin reconstruir.
//
//   python3 tools/preview_feria.py            # -> logs/feria-preview.json
//   node tools/shot-feria-preview.mjs [devUrl] [dirSalida]
//
// `preview_feria.py` corre el servicio del builder encima de los tiles ya
// emitidos; esto toma su resultado, lo mete en `W.FERIA` y `W.ATTRACTIONS` del
// juego corriendo y saca tres capturas: el campo entero de día, un acercamiento
// y el campo de noche. Contra un servidor de desarrollo FRESCO (importa el
// pintor que se está editando).
//
// LO QUE NO MUESTRA: la física. La superficie manejable sólo cambia al
// reconstruir el mundo, así que aquí el carro todavía no puede subir al tablado.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://localhost:8736/";
const out = process.argv[3] || "logs";
const data = JSON.parse(readFileSync("logs/feria-preview.json", "utf8"));
const lot = data.feria[0];
if (!lot) { console.error("[feria-preview] el preview no trae lote"); process.exit(1); }
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.25 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem("churchill_intro_seen_v1", "1");
  localStorage.setItem("churchill_lang_v1", "es");
});
await page.goto(`${url}?editorPlay=1&x=${lot.cx}&y=${lot.y0 - 30}`, { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 60000 });
await page.waitForTimeout(2500);

const shot = async (name, weather, cx, cy, zoom) => {
  await page.evaluate(async ({ data, weather, cx, cy, zoom }) => {
    const G = window.Game, W = window.WORLD2D, st = G.state;
    G.setAttract(false);
    // el lote y los juegos MAPEADOS, antes de arrancar: así el público del DJ
    // nace de las posiciones del preview y no de las del mundo viejo
    W.FERIA.length = 0; W.FERIA.push(...structuredClone(data.feria));
    W.ATTRACTIONS.length = 0; W.ATTRACTIONS.push(...structuredClone(data.attractions));
    G.startExplore({ weather, x: st.p.x, y: st.p.y });
    st.storyTip = null;
    await new Promise((r) => setTimeout(r, 700));
    st.paused = true;
    st.p.x = -9999; st.p.y = -9999;            // el carro fuera de cuadro: es una foto del lugar
    st.cam.x = cx; st.cam.y = cy; st.cam.zoom = zoom;
    W.update(cx, cy); await W.ready(cx, cy, 1800, 1200);
    for (const el of document.querySelectorAll("body > *:not(canvas), #root > *:not(canvas)")) {
      if (!el.querySelector("canvas")) el.style.display = "none";
    }
  }, { data, weather, cx, cy, zoom });
  await page.waitForTimeout(1300);
  const file = path.join(out, `feria-preview-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`[feria-preview] ${file}`);
};

const midY = (lot.y0 + lot.y1) / 2;
await shot("campo", "sunny", lot.cx, midY - 20, 2.05);
await shot("cerca", "sunny", lot.cx - 190, midY - 10, 3.6);
await shot("noche", "night", lot.cx, midY - 20, 2.05);
await browser.close();
if (errors.length) { console.error(`[feria-preview] errores de página: ${errors.join(" | ")}`); process.exit(1); }
