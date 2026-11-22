// EL PREVIEW DE LAS SEÑALES — las que saldrían de la cadena del builder, pintadas por el renderer
// de verdad sobre el mundo de HOY, sin reconstruir.
//
//   python3 tools/preview_signs.py                  # -> logs/signs-preview.json
//   node tools/shot-signs-preview.mjs [devUrl] [dirSalida] [x,y x,y …]
//   pnpm preview:signs                              # las dos cosas
//
// `preview_signs.py` corre `build_signs` → `settle_altos` → `clear_the_roadway` sobre los tiles
// ya emitidos; esto toma su resultado, lo pone en `W.SIGNS` del juego corriendo (en el lugar de las
// del manifest, sin tocar las que autora el editor) y saca, por cada esquina, el ANTES (lo publicado)
// y el DESPUÉS (el preview), con la misma cámara. Sin esquinas pedidas toma dos fijas del centro y
// las tres esquinas con zebra donde el ALTO más se movió.
//
// Contra un servidor de desarrollo FRESCO (importa el pintor que se está editando). Cuando se ve
// bien, `pnpm world:signs` lo escribe en el manifest — y va `world_snapshot.py save` en el commit.
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://localhost:8736/";
const out = process.argv[3] || "logs";
const data = JSON.parse(readFileSync("logs/signs-preview.json", "utf8"));
mkdirSync(out, { recursive: true });

const spots = process.argv.slice(4).map((s) => s.split(",").map(Number));
if (!spots.length) {
  spots.push([29400, 19150], [39090, 17620]);
  // las esquinas con zebra donde el ALTO más se corrió: ahí es donde se ve si el cambio sirve
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const zebras = data.signs.filter((s) => s.kind === "crossing");
  const olds = data.old.filter((s) => s.kind === "alto");
  const moved = data.signs.filter((s) => s.kind === "alto" && zebras.some((z) => near(z, s) < 60))
    .map((s) => {
      const o = olds.filter((q) => q.ang === s.ang).sort((a, b) => near(a, s) - near(b, s))[0];
      return { s, d: o ? near(o, s) : 0 };
    })
    .filter((m) => m.d > 0 && m.d < 200)
    .sort((a, b) => b.d - a.d);
  for (const m of moved) {
    if (spots.length >= 5) break;
    if (spots.every(([x, y]) => Math.hypot(x - m.s.x, y - m.s.y) > 600)) spots.push([m.s.x, m.s.y]);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.5 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem("churchill_intro_seen_v1", "1");
  localStorage.setItem("churchill_lang_v1", "es");
});
const [x0, y0] = spots[0];
await page.goto(`${url}?editorPlay=1&x=${x0}&y=${y0}`, { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 60000 });
await page.waitForTimeout(2000);
await page.evaluate(async ({ x0, y0, n, zoom }) => {
  const G = window.Game, W = window.WORLD2D, st = G.state;
  G.setAttract(false);
  G.startExplore({ weather: "sunny", x: x0, y: y0 });
  await new Promise((r) => setTimeout(r, 900));
  st.storyTip = null;
  st.paused = true;
  st.p.x = -9999; st.p.y = -9999;              // el carro fuera de cuadro: es una foto del lugar
  window.__signsManifestCount = n;
  window.__signsZoom = st.cam.zoom * zoom;          // `SIGNS_ZOOM=2` para mirar una esquina de cerca
  for (const el of document.querySelectorAll("body > *:not(canvas), #root > *:not(canvas)")) {
    if (!el.querySelector("canvas")) el.style.display = "none";
  }
}, { x0, y0, n: data.old.length, zoom: +process.env.SIGNS_ZOOM || 1.3 });

for (const [i, [x, y]] of spots.entries()) {
  for (const [tag, signs] of [["antes", data.old], ["despues", data.signs]]) {
    await page.evaluate(async ({ x, y, signs }) => {
      const G = window.Game, W = window.WORLD2D, st = G.state;
      // las del manifest se cambian EN SU LUGAR: las autoradas por el editor van detrás y se quedan
      W.SIGNS.splice(0, window.__signsManifestCount, ...signs);
      window.__signsManifestCount = signs.length;
      st.cam.x = x; st.cam.y = y; st.cam.rot = 0;
      st.cam.zoom = window.__signsZoom;
      W.update(x, y); await W.ready(x, y, 1400, 1000);
    }, { x, y, signs });
    await page.waitForTimeout(900);
    const file = path.join(out, `signs-preview-${i + 1}-${tag}.png`);
    await page.screenshot({ path: file });
    console.log(`[signs-preview] ${file}  (${x}, ${y})`);
  }
}
await browser.close();
if (errors.length) { console.error(`[signs-preview] errores en la página:\n${errors.join("\n")}`); process.exit(1); }
