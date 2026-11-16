// UNA CAPTURA DEL JUEGO VIVO: arranca Recorrer en (x, y) con el clima pedido, deja correr la
// simulación `wait` ms (para que la gente, el tráfico y los barcos aparezcan) y saca la foto.
//   node tools/shot-live.mjs <url> <out.png> x y zoom [weather=sunny] [wait=4000]
// A diferencia de shot-punta-preview (que pausa y saca el carro del cuadro para fotografiar el
// lugar), esto fotografía la escena con su gente y su tráfico.
import { chromium } from "playwright";
const [url, out, x, y, zoom, weather = "sunny", wait = "4000"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => { localStorage.setItem("churchill_intro_seen_v1", "1"); localStorage.setItem("churchill_lang_v1", "es"); });
await page.goto(`${url}?editorPlay=1&x=${Math.round(+x)}&y=${Math.round(+y)}`, { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 60000 });
await page.waitForTimeout(2000);
await page.evaluate(({ x, y, zoom, weather }) => {
  const G = window.Game, st = G.state;
  G.setAttract(false);
  G.startExplore({ weather, x: +x, y: +y });
  st.storyTip = null;
}, { x, y, zoom, weather });
await page.waitForTimeout(+wait);
await page.evaluate((zoom) => { const st = window.Game.state; if (+zoom) st.cam.zoom = +zoom; }, zoom);
await page.waitForTimeout(400);
await page.screenshot({ path: out });
await browser.close();
if (errors.length) { console.error(`[live] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[live] ${out}`);
