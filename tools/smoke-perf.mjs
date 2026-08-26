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
console.log(`[perf]   culling    peds ${on.pedCandidates.toFixed(0)} → x ${on.pedXPass.toFixed(0)} `
  + `(y quitó ${on.pedYCulled.toFixed(0)}) | tráfico ${on.trafficCandidates.toFixed(0)} → `
  + `x ${on.trafficXPass.toFixed(0)} (y quitó ${on.trafficYCulled.toFixed(0)})`);
