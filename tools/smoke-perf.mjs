// EL CUADRO, MEDIDO ANTES DE OPTIMIZAR.
//
//   node tools/smoke-perf.mjs [url]
//
// The minimap is the first suspect in HANDOFF-2026-08-23 §B2. This keeps the
// world, camera and entities fixed, warms both variants, then INTERLEAVES them
// and takes medians. Alongside rAF frame time it reads the compositor's direct
// section timers, so a vsync-capped machine cannot make an expensive map look
// free merely because both variants still fit inside 16.7 ms.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8799/";
const playUrl = new URL(url);
// Enter through React's real PLAYING route. Calling Game.startExplore() alone
// starts the simulation but leaves App on TITLE, whose attract-mode renderer
// intentionally omits the minimap — a perfectly green measurement of nothing.
playUrl.searchParams.set("editorPlay", "1");
playUrl.searchParams.set("x", "24646");
playUrl.searchParams.set("y", "14400");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(playUrl.href, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 30000 });
await page.waitForFunction(() => document.body.dataset.gameScreen === "playing", null, { timeout: 30000 });

await page.evaluate(async () => {
  const G = window.Game, W = window.WORLD2D;
  G.setAttract(false);
  const centre = W.LANDMARKS.find((lm) => lm.id === "mercado");
  if (!centre) throw new Error("the dense-centre probe landmark `mercado` is missing");
  G.state.p.x = centre.x; G.state.p.y = centre.y;
  G.state.p.vx = 0; G.state.p.vy = 0; G.state.p.speed = 0;
  G.state.cam.x = centre.x; G.state.cam.y = centre.y; G.state.cam.shake = 0;
  await W.ensureView(centre.x - 1000, centre.y - 1000, centre.x + 1000, centre.y + 1000, 1);
});
await page.waitForTimeout(1000);

async function measure(minimap) {
  return page.evaluate(({ minimap }) => new Promise((resolve) => {
    const N = 120;
    window.__perfFlags = { ...(window.__perfFlags || {}), minimap };
    window.__prof = { water: 0, land: 0, minimap: 0, render: 0, n: 0, frames: 0 };
    let frames = 0;
    const t0 = performance.now();
    const tick = () => {
      if (++frames < N) return requestAnimationFrame(tick);
      const elapsed = performance.now() - t0;
      const p = window.__prof;
      const keys = ["world", "setpieces", "landmarks", "entities", "overlays",
        "worldGround", "worldStreets", "worldBuildings", "worldFlora"];
      const sections = Object.fromEntries(keys.map((key) => [key, (p[key] || 0) / Math.max(1, p.frames)]));
      resolve({
        frameMs: elapsed / N,
        updateMs: (p.update || 0) / Math.max(1, p.frames),
        renderMs: p.render / Math.max(1, p.frames),
        minimapMs: p.minimap / Math.max(1, p.frames),
        waterMs: p.water / Math.max(1, p.n),
        landMs: p.land / Math.max(1, p.n),
        frames: p.frames,
        ...sections,
        pedCandidates: (p.pedCandidates || 0) / Math.max(1, p.frames),
        pedXPass: (p.pedXPass || 0) / Math.max(1, p.frames),
        pedYCulled: (p.pedYCulled || 0) / Math.max(1, p.frames),
        trafficCandidates: (p.trafficCandidates || 0) / Math.max(1, p.frames),
        trafficXPass: (p.trafficXPass || 0) / Math.max(1, p.frames),
        trafficYCulled: (p.trafficYCulled || 0) / Math.max(1, p.frames),
      });
    };
    requestAnimationFrame(tick);
  }), { minimap });
}

// Warm-up is deliberately discarded: it pays JIT + tile texture/path caches.
await measure(true);
await measure(false);

const maps = [], noMaps = [];
for (let i = 0; i < 5; i++) {
  if (i % 2 === 0) {
    maps.push(await measure(true));
    noMaps.push(await measure(false));
  } else {
    noMaps.push(await measure(false));
    maps.push(await measure(true));
  }
}

const median = (rows, key) => rows.map((r) => r[key]).sort((a, b) => a - b)[rows.length >> 1];
const metrics = ["frameMs", "updateMs", "renderMs", "minimapMs", "waterMs", "landMs", "world",
  "setpieces", "landmarks", "entities", "overlays", "worldGround", "worldStreets",
  "worldBuildings", "worldFlora", "pedCandidates", "pedXPass", "pedYCulled",
  "trafficCandidates", "trafficXPass", "trafficYCulled"];
const on = Object.fromEntries(metrics
  .map((key) => [key, median(maps, key)]));
const off = Object.fromEntries(metrics
  .map((key) => [key, median(noMaps, key)]));
await page.evaluate(() => { delete window.__prof; delete window.__perfFlags; });
await browser.close();

if (errors.length) {
  console.error(`[perf] page errors: ${errors.join(" | ")}`);
  process.exit(1);
}
if (!(on.minimapMs > 0) || off.minimapMs !== 0) {
  console.error(`[perf] FAIL — el interruptor no aisló el minimapa `
    + `(on ${on.minimapMs.toFixed(3)}, off ${off.minimapMs.toFixed(3)} ms)`);
  process.exit(1);
}

// ---- EL PRESUPUESTO, QUE HASTA HOY NO SE AFIRMABA --------------------------
//
// Este archivo medía con cuidado —medianas de corridas intercaladas, desglose
// por fase— y después no exigía NADA. Un arnés que sólo informa es un arnés que
// nadie mira: la degradación entra de a 0,2 ms por cambio y no hay ningún
// momento en el que algo se ponga rojo.
//
// El número sale de lo que hay: el cuadro entero a 60 Hz son **16,7 ms** y el
// render medía **1,14 ms** antes de la primera fase del trabajo visual. El tope
// se pone en 4,0 ms — casi cuatro veces el costo actual, y aun así menos de un
// cuarto del cuadro — porque el margen sobra y lo que hay que cazar no es un
// milisegundo de más sino un ORDEN DE MAGNITUD: la capa que se dibuja por
// entidad en vez de por vista, el gradiente que se genera por cuadro en vez de
// cachearse. Es el mismo criterio con el que `smoke-night.mjs` fija en 5,5 ms
// el costo del alumbrado, y por la misma razón escrita al lado.
//
// Si algún día esto falla legítimamente —porque una capa nueva vale su precio—
// el tope se sube A PROPÓSITO y con la medición al lado, que es exactamente lo
// que no podía pasar cuando no había tope.
const RENDER_BUDGET_MS = 4.0;
if (on.renderMs > RENDER_BUDGET_MS) {
  console.error(`[perf] FAIL — el render tarda ${on.renderMs.toFixed(2)} ms y el `
    + `presupuesto es ${RENDER_BUDGET_MS} (el cuadro entero son 16,7). `
    + `Fases: mundo ${on.world.toFixed(2)} · piezas ${on.setpieces.toFixed(2)} · `
    + `hitos ${on.landmarks.toFixed(2)} · entidades ${on.entities.toFixed(2)} · `
    + `HUD ${on.overlays.toFixed(2)}`);
  process.exit(1);
}
// **Y EL RELOJ DEL RENDER NO VE TODO EL CUADRO.** `renderMs` mide las llamadas
// de dibujo; lo que el navegador tarda en RASTERIZAR lo que se le pidió no está
// ahí, y esa mitad se puede disparar sola. Medido el 2026-08-28 al texturizar el
// suelo: el render en JS subió de 1,24 a 1,42 ms —dentro de presupuesto y sin
// una sola alarma— mientras el cuadro real pasaba de 17,3 a 32,9. Un relleno con
// patrón del tamaño del viewport cuesta ~10 ns por píxel y NADA en JS lo dice.
//
// Así que el cuadro entero también se afirma. El número es blando a propósito y
// depende de la máquina —en headless el rasterizado es por software, así que la
// línea base son ~17 ms y no el 1,4 del render—, por eso el tope es 2x esa base
// y no un valor apretado: lo que hay que cazar es una capa que DUPLICA el
// cuadro, no medio milisegundo.
const FRAME_BUDGET_MS = 26.0;
if (on.frameMs > FRAME_BUDGET_MS) {
  console.error(`[perf] FAIL — el cuadro entero tarda ${on.frameMs.toFixed(2)} ms `
    + `(presupuesto ${FRAME_BUDGET_MS}) con el render en sólo ${on.renderMs.toFixed(2)}. `
    + `La diferencia es RASTERIZADO, no dibujo: buscá un relleno con patrón, un `
    + `clip o una sombra que cubra buena parte de la pantalla.`);
  process.exit(1);
}
// EL SIM NO ES EL RENDER. Se afirma aparte para que un cuadro caro diga cuál de
// los dos se encareció — sin esto, un `update` que se dispara se lee como un
// problema de dibujo y se busca donde no está.
const SIM_BUDGET_MS = 2.0;
if (on.updateMs > SIM_BUDGET_MS) {
  console.error(`[perf] FAIL — el sim tarda ${on.updateMs.toFixed(2)} ms `
    + `(presupuesto ${SIM_BUDGET_MS})`);
  process.exit(1);
}

console.log(`[perf] Centro, 1280×720 — medianas de 5 corridas intercaladas × 120 cuadros`);
console.log(`[perf]   con mapa  ${on.frameMs.toFixed(2)} ms rAF | ${on.updateMs.toFixed(2)} ms sim | `
  + `${on.renderMs.toFixed(2)} ms render `
  + `| mapa ${on.minimapMs.toFixed(2)} ms`);
console.log(`[perf]   sin mapa  ${off.frameMs.toFixed(2)} ms rAF | ${off.updateMs.toFixed(2)} ms sim | `
  + `${off.renderMs.toFixed(2)} ms render`);
console.log(`[perf]   costo      ${(on.frameMs - off.frameMs).toFixed(2)} ms rAF | `
  + `${(on.renderMs - off.renderMs).toFixed(2)} ms render por cuadro`);
console.log(`[perf]   fases      mundo ${on.world.toFixed(2)} | piezas ${on.setpieces.toFixed(2)} | `
  + `hitos ${on.landmarks.toFixed(2)} | entidades ${on.entities.toFixed(2)} | HUD ${on.overlays.toFixed(2)} ms`);
console.log(`[perf]   mundo      suelo ${on.worldGround.toFixed(2)} | calles ${on.worldStreets.toFixed(2)} | `
  + `edificios ${on.worldBuildings.toFixed(2)} | flora/rótulos ${on.worldFlora.toFixed(2)} ms`);
console.log(`[perf]   presupuesto render ${on.renderMs.toFixed(2)} / ${RENDER_BUDGET_MS} ms `
  + `· sim ${on.updateMs.toFixed(2)} / ${SIM_BUDGET_MS} ms · cuadro ${on.frameMs.toFixed(2)} / `
  + `${FRAME_BUDGET_MS} ms · a 60 Hz el cuadro son 16,7`);
console.log(`[perf]   culling    peds ${on.pedCandidates.toFixed(0)} → x ${on.pedXPass.toFixed(0)} `
  + `(y quitó ${on.pedYCulled.toFixed(0)}) | tráfico ${on.trafficCandidates.toFixed(0)} → `
  + `x ${on.trafficXPass.toFixed(0)} (y quitó ${on.trafficYCulled.toFixed(0)})`);
