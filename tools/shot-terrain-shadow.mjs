// STAGE D3: one sun, one terrain shadow map, and no Canvas readback.
//
//   node tools/shot-terrain-shadow.mjs [devUrl] [outputPrefix]
//
// Run this against Vite's DEVELOPMENT server. The gate imports the live
// day/night and Renderer modules (including Vite's HMR query) so it can stop
// simulation, pin the shared solar clock, and render named frames. Explicit
// `three=terrain` is the D2 baseline; explicit `three=shadows` must leave the
// flat Paseo bit-identical while darkening surveyed mountain relief. A ninth
// capture proves bare `?render=3d` selects that same D3 mode.
import { chromium } from "playwright";
import { dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const baseUrl = process.argv[2] || "http://localhost:8734/";
const prefix = process.argv[3] || "/tmp/churchill-stage-d3";
const viewport = { width: 1100, height: 700 };
const probes = {
  flat: { x: 24646, y: 14400 }, // interior Paseo/spit; elevation slab omitted
  hill: { x: 57320, y: 3080 },  // cordillera; a 77–357 m surveyed slab
};
const cycles = { noon: 0.25, low: 0.5 };
const expectedOrder = [
  "game-canvas",
  "three-terrain-source",
  "pixi-canvas",
  "game-overlay-canvas",
];
const authoredShadow = JSON.parse(readFileSync(
  new URL("../src/assets/effects.json", import.meta.url), "utf8",
)).terrainShadow;
mkdirSync(dirname(prefix), { recursive: true });

const browser = await chromium.launch();

function modeUrl(mode, point) {
  const url = new URL(baseUrl);
  url.searchParams.set("render", "3d");
  if (mode !== "default") url.searchParams.set("three", mode);
  // Keep React in PLAYING; otherwise Boot may re-enter attract mode while the
  // alternating rAF measurement is still running.
  url.searchParams.set("editorPlay", "1");
  url.searchParams.set("x", point.x);
  url.searchParams.set("y", point.y);
  return url.href;
}

async function capture(name, point, cycleName, mode, { perf = false } = {}) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    window.__shadowNativeRaf = window.requestAnimationFrame.bind(window);
    window.__resetShadowRandom = (seed = 0x5a17d003) => {
      let n = seed >>> 0;
      Math.random = () => {
        n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
        return n / 0x100000000;
      };
    };
    window.__resetShadowRandom();
  });

  await page.goto(modeUrl(mode, point), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.Game?.state && window.WORLD2D,
    null, { timeout: 30000 });
  await page.waitForFunction(() => document.body.dataset.gameScreen === "playing",
    null, { timeout: 30000 });
  const expectedMode = mode === "default" ? "shadows" : mode;
  await page.waitForFunction((wanted) => window.__threeTerrain?.ready
    && window.__threeTerrain.mode === wanted, expectedMode, { timeout: 30000 });

  const frozen = await page.evaluate(async ({ name, point, cycleName, cycle }) => {
    await Promise.all([
      document.fonts.load("bold 10px 'JetBrains Mono'"),
      document.fonts.load("bold 12px 'Bungee'"),
      document.fonts.load("600 12px 'Space Grotesk'"),
    ]);
    await document.fonts.ready;

    const G = window.Game;
    const W = window.WORLD2D;
    window.__resetShadowRandom(0x5a17d003);
    G.setAttract(false);
    G.startExplore({ x: point.x, y: point.y, weather: "sunny" });
    // Stop in this same task. Backend load time must not buy one capture more
    // pedestrian/traffic simulation than another.
    G.setTide(0.5);
    G.state.tide = 0.5;
    G.state.tideRising = true;
    G.state.running = false;
    G.state.attract = false;

    // Import the exact daynight singleton canvas2d already imported, including
    // Vite's cache-busting query. Importing a clean URL after HMR can create a
    // second clock and make the screenshot appear to have a frozen sun.
    const canvasUrl = new URL("/src/render/canvas2d.js", location.href);
    const canvasSource = await fetch(canvasUrl).then((response) => response.text());
    const daySpec = canvasSource.match(
      /from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/,
    )?.[1];
    if (!daySpec) throw new Error("shot-terrain-shadow could not resolve live daynight module");
    const day = await import(new URL(daySpec, canvasUrl).href);
    day.setDayCycle(true, cycle);

    // The low sun's conservative 400 m caster volume extends by <1,000 world
    // px at current tuning. Loading +/-1,600 px plus two tiles supplies that
    // volume and the elevation seam's mandatory one-tile interpolation halo.
    await W.ensureView(point.x - 1600, point.y - 1600,
      point.x + 1600, point.y + 1600, 2);

    G.state.cam.x = G.state.p.x = point.x;
    G.state.cam.y = G.state.p.y = point.y;
    G.state.cam.shake = 0;
    G.state.cam.rot = 0;
    G.state.p.vx = G.state.p.vy = G.state.p.speed = 0;
    // Let one already-queued callback finish, then freeze the browser loop.
    window.requestAnimationFrame = () => 0;
    await new Promise((resolve) => setTimeout(resolve, 80));

    const gameUrl = new URL("/src/game/index.js", location.href);
    const gameSource = await fetch(gameUrl).then((response) => response.text());
    const rendererSpec = gameSource.match(
      /from\s+["']([^"']*\/render\/Renderer\.js[^"']*)["']/,
    )?.[1];
    if (!rendererSpec) throw new Error("shot-terrain-shadow could not resolve live Renderer module");
    const liveRenderer = await import(new URL(rendererSpec, gameUrl).href);
    window.__shadowGateRender = liveRenderer.render;

    // Equal warm-up counts protect cross-mode pixel comparisons from shader,
    // glyph and Canvas cache construction. One final named time is captured.
    window.__perfFlags = { ...(window.__perfFlags || {}), terrainShadows: true };
    for (let i = 0; i < 24; i++) liveRenderer.render(319.75);
    liveRenderer.render(319.75);

    // React is outside the renderer contract. Keep later replacements hidden,
    // including while the longer performance walk runs after the screenshot.
    const hideUi = document.createElement("style");
    hideUi.textContent = "#root > :not(canvas){display:none!important}";
    document.head.appendChild(hideUi);
    document.body.style.background = "#000";

    const canvasOrder = [...document.querySelectorAll("#root > canvas")]
      .map((node) => node.id)
      .filter((id) => [
        "game-canvas", "three-terrain-source", "pixi-canvas", "game-overlay-canvas",
      ].includes(id));
    return {
      name,
      cycleName,
      cycle,
      x: point.x,
      y: point.y,
      canvasOrder,
      sourceActive: document.querySelector("#three-terrain-source")?.dataset.active || null,
      three: JSON.parse(JSON.stringify(window.__threeTerrain || null)),
    };
  }, { name, point, cycleName, cycle: cycles[cycleName] });

  const png = await page.screenshot({ animations: "disabled" });
  let performance = null;
  if (perf) {
    performance = await page.evaluate(async () => {
      const render = window.__shadowGateRender;
      if (typeof render !== "function") throw new Error("live Renderer escaped the gate");
      const percentile = (values, p) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.min(sorted.length - 1,
          Math.max(0, Math.floor((sorted.length - 1) * p)))] ?? null;
      };
      const setActive = (active) => {
        window.__perfFlags = {
          ...(window.__perfFlags || {}), terrainShadows: active,
        };
      };

      const measureRaf = (active, frames = 60) => new Promise((resolve) => {
        setActive(active);
        window.__terrainRenderSamples = [];
        window.__prof = { render: 0, frames: 0 };
        const intervals = [];
        let first = null, previous = null, count = 0;
        const tick = (now) => {
          if (first === null) first = now;
          if (previous !== null) intervals.push(now - previous);
          previous = now;
          render(319.75);
          count++;
          if (count < frames) window.__shadowNativeRaf(tick);
          else {
            const samples = [...window.__terrainRenderSamples];
            resolve({
              active,
              frames: count,
              samples: samples.length,
              averageMs: intervals.length
                ? (now - first) / intervals.length : 0,
              p95Ms: percentile(intervals, 0.95),
              renderMs: window.__prof.render / Math.max(1, window.__prof.frames),
              threeMedianMs: percentile(samples, 0.5),
              threeP95Ms: percentile(samples, 0.95),
            });
          }
        };
        window.__shadowNativeRaf(tick);
      });

      const measureSync = (active, frames = 120) => {
        setActive(active);
        window.__terrainRenderSamples = [];
        window.__prof = { render: 0, frames: 0 };
        const started = performance.now();
        for (let i = 0; i < frames; i++) render(319.75);
        const elapsed = performance.now() - started;
        const samples = [...window.__terrainRenderSamples];
        return {
          active,
          frames,
          samples: samples.length,
          averageMs: elapsed / frames,
          renderMs: window.__prof.render / Math.max(1, window.__prof.frames),
          threeMedianMs: percentile(samples, 0.5),
          threeP95Ms: percentile(samples, 0.95),
        };
      };

      // Warm both paths before measurement, then reverse their order on every
      // other pair so thermal/load drift cannot systematically favor one.
      await measureRaf(true, 20);
      await measureRaf(false, 20);
      const raf = [];
      const sync = [];
      for (let i = 0; i < 3; i++) {
        const order = i % 2 ? [false, true] : [true, false];
        for (const active of order) raf.push(await measureRaf(active));
      }
      for (let i = 0; i < 3; i++) {
        const order = i % 2 ? [false, true] : [true, false];
        for (const active of order) sync.push(measureSync(active));
      }

      const medianRun = (rows, active, field) => {
        const values = rows.filter((row) => row.active === active)
          .map((row) => row[field]).sort((a, b) => a - b);
        return values[values.length >> 1] ?? null;
      };
      const summarize = (rows) => ({
        activeMs: medianRun(rows, true, "averageMs"),
        inactiveMs: medianRun(rows, false, "averageMs"),
        activeRenderMs: medianRun(rows, true, "renderMs"),
        inactiveRenderMs: medianRun(rows, false, "renderMs"),
        activeThreeMedianMs: medianRun(rows, true, "threeMedianMs"),
        inactiveThreeMedianMs: medianRun(rows, false, "threeMedianMs"),
        activeThreeP95Ms: medianRun(rows, true, "threeP95Ms"),
        inactiveThreeP95Ms: medianRun(rows, false, "threeP95Ms"),
        activeSamples: rows.filter((row) => row.active)
          .reduce((sum, row) => sum + row.samples, 0),
        inactiveSamples: rows.filter((row) => !row.active)
          .reduce((sum, row) => sum + row.samples, 0),
      });
      const rafSummary = summarize(raf);
      rafSummary.deltaMs = rafSummary.activeMs - rafSummary.inactiveMs;
      rafSummary.renderDeltaMs = rafSummary.activeRenderMs - rafSummary.inactiveRenderMs;
      const syncSummary = summarize(sync);
      syncSummary.deltaMs = syncSummary.activeMs - syncSummary.inactiveMs;
      syncSummary.renderDeltaMs = syncSummary.activeRenderMs - syncSummary.inactiveRenderMs;

      // Move through more than four elevation cells. The stable world-space
      // fit must invalidate occasionally as coverage advances, not rerasterize
      // its 1024-square depth texture on every driving frame.
      const measureMoving = (frames = 180, stepPx = 2) => new Promise((resolve) => {
        setActive(true);
        const G = window.Game;
        const originX = G.state.cam.x;
        const before = window.__threeTerrain.shadowMapUpdates;
        const intervals = [];
        let first = null, previous = null, count = 0;
        const tick = (now) => {
          if (first === null) first = now;
          if (previous !== null) intervals.push(now - previous);
          previous = now;
          G.state.cam.x = originX + count * stepPx;
          render(319.75);
          count++;
          if (count < frames) window.__shadowNativeRaf(tick);
          else {
            const updates = window.__threeTerrain.shadowMapUpdates - before;
            G.state.cam.x = originX;
            render(319.75);
            resolve({
              frames,
              distancePx: (frames - 1) * stepPx,
              updates,
              averageMs: intervals.length ? (now - first) / intervals.length : 0,
              p95Ms: percentile(intervals, 0.95),
            });
          }
        };
        window.__shadowNativeRaf(tick);
      });
      const moving = await measureMoving();

      setActive(true);
      delete window.__terrainRenderSamples;
      delete window.__prof;
      render(319.75);
      return { raf: rafSummary, sync: syncSummary, moving };
    });
  }

  await context.close();
  if (errors.length) {
    throw new Error(`${name}/${cycleName}/${mode} page errors: ${errors.join(" | ")}`);
  }
  return { png, frozen, performance };
}

async function comparePNGs(baseline, candidate) {
  const page = await browser.newPage();
  const result = await page.evaluate(async ([a64, b64]) => {
    const load = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/png;base64,${base64}`;
    });
    const [a, b] = await Promise.all([load(a64), load(b64)]);
    if (a.width !== b.width || a.height !== b.height) {
      return { sized: false, a: [a.width, a.height], b: [b.width, b.height] };
    }
    const pixels = (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const g = canvas.getContext("2d");
      g.drawImage(image, 0, 0);
      return g.getImageData(0, 0, image.width, image.height);
    };
    const pa = pixels(a), pb = pixels(b);
    const diff = new Uint8ClampedArray(pa.data.length);
    let changed = 0, worst = 0, totalDelta = 0;
    let darkPixels = 0, darkLumaEnergy = 0, lightLumaEnergy = 0;
    const darkDelta = new Float32Array(pa.width * pa.height);
    for (let i = 0; i < pa.data.length; i += 4) {
      let delta = 0;
      for (let k = 0; k < 4; k++) {
        delta = Math.max(delta, Math.abs(pa.data[i + k] - pb.data[i + k]));
      }
      const baseLuma = (77 * pa.data[i] + 150 * pa.data[i + 1] + 29 * pa.data[i + 2]) / 256;
      const nextLuma = (77 * pb.data[i] + 150 * pb.data[i + 1] + 29 * pb.data[i + 2]) / 256;
      if (baseLuma > nextLuma) {
        darkPixels++;
        darkLumaEnergy += baseLuma - nextLuma;
        darkDelta[i / 4] = baseLuma - nextLuma;
      } else {
        lightLumaEnergy += nextLuma - baseLuma;
      }
      if (delta) {
        changed++;
        worst = Math.max(worst, delta);
        totalDelta += delta;
      }
      diff[i] = delta ? 255 : pa.data[i] * 0.35 + 160;
      diff[i + 1] = delta ? 0 : pa.data[i + 1] * 0.35 + 160;
      diff[i + 2] = delta ? 255 : pa.data[i + 2] * 0.35 + 160;
      diff[i + 3] = 255;
    }
    // Self-shadow acne is a repeated high-frequency lattice, not merely "many
    // changed pixels". Measure the absolute discrete Laplacian of the darkening
    // field: the clean 0.7 m probe is <1.2/pixel; the striped 0.4 m trial >2.6.
    let highFrequencyEnergy = 0;
    for (let y = 1; y < pa.height - 1; y++) {
      for (let x = 1; x < pa.width - 1; x++) {
        const p = y * pa.width + x;
        highFrequencyEnergy += Math.abs(
          4 * darkDelta[p] - darkDelta[p - 1] - darkDelta[p + 1]
          - darkDelta[p - pa.width] - darkDelta[p + pa.width],
        );
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = pa.width;
    canvas.height = pa.height;
    canvas.getContext("2d").putImageData(new ImageData(diff, pa.width, pa.height), 0, 0);
    return {
      sized: true,
      changed,
      worst,
      meanChangedDelta: changed ? totalDelta / changed : 0,
      darkPixels,
      darkLumaEnergy,
      lightLumaEnergy,
      highFrequencyEnergy,
      highFrequencyPerPixel: highFrequencyEnergy / (pa.width * pa.height),
      total: pa.data.length / 4,
      diff: canvas.toDataURL("image/png").split(",")[1],
    };
  }, [baseline.toString("base64"), candidate.toString("base64")]);
  await page.close();
  return result;
}

function assertTopology(label, frozen) {
  if (JSON.stringify(frozen.canvasOrder) !== JSON.stringify(expectedOrder)) {
    throw new Error(`${label}: canvas order ${JSON.stringify(frozen.canvasOrder)}; `
      + `expected ${JSON.stringify(expectedOrder)}`);
  }
}

function mapIsAuthored(value) {
  return value === authoredShadow.mapSize
    || (Array.isArray(value) && value.length === 2
      && value.every((n) => n === authoredShadow.mapSize));
}

const results = {};
for (const [place, point] of Object.entries(probes)) {
  results[place] = {};
  for (const cycleName of Object.keys(cycles)) {
    const baseline = await capture(place, point, cycleName, "terrain");
    const shadows = await capture(place, point, cycleName, "shadows", {
      perf: place === "hill" && cycleName === "low",
    });
    const stem = `${prefix}-${place}-${cycleName}`;
    const baselinePath = `${stem}-terrain.png`;
    const shadowsPath = `${stem}-shadows.png`;
    const diffPath = `${stem}-diff.png`;
    writeFileSync(baselinePath, baseline.png);
    writeFileSync(shadowsPath, shadows.png);
    const comparison = await comparePNGs(baseline.png, shadows.png);
    if (!comparison.sized) {
      throw new Error(`${place}/${cycleName}: dimensions differ: `
        + `${comparison.a} vs ${comparison.b}`);
    }
    writeFileSync(diffPath, Buffer.from(comparison.diff, "base64"));
    delete comparison.diff;
    assertTopology(`${place}/${cycleName}/terrain`, baseline.frozen);
    assertTopology(`${place}/${cycleName}/shadows`, shadows.frozen);
    results[place][cycleName] = {
      ...comparison,
      baseline: baseline.frozen,
      shadows: shadows.frozen,
      performance: shadows.performance,
      baselinePath,
      shadowsPath,
      diffPath,
    };
  }
}

// Bare render=3d is a product contract, not just a query-parser unit test:
// capture it under the same frozen low sun and require its pixels to equal the
// explicitly named D3 mode.
const defaultCapture = await capture("hill", probes.hill, "low", "default");
const defaultPath = `${prefix}-hill-low-default.png`;
const defaultDiffPath = `${prefix}-hill-low-default-diff.png`;
writeFileSync(defaultPath, defaultCapture.png);
const defaultComparison = await comparePNGs(
  readFileSync(results.hill.low.shadowsPath),
  defaultCapture.png,
);
if (!defaultComparison.sized) {
  throw new Error(`default: dimensions differ: ${defaultComparison.a} vs ${defaultComparison.b}`);
}
writeFileSync(defaultDiffPath, Buffer.from(defaultComparison.diff, "base64"));
delete defaultComparison.diff;
assertTopology("hill/low/default", defaultCapture.frozen);

// Keep the numeric artifact even when a later acceptance assertion fails; it
// is the tuning evidence that explains why, alongside the PNG/diff set.
const metricsPath = `${prefix}-metrics.json`;
writeFileSync(metricsPath, `${JSON.stringify({
  probes: results,
  defaultMode: defaultCapture.frozen,
  defaultComparison,
}, null, 2)}\n`);

await browser.close();

for (const cycleName of Object.keys(cycles)) {
  const flat = results.flat[cycleName];
  if (flat.changed !== 0) {
    console.error(`[terrain-shadow] FAIL — flat Paseo/${cycleName} changed `
      + `${flat.changed}/${flat.total} px -> ${flat.diffPath}`);
    process.exit(1);
  }
  const hill = results.hill[cycleName];
  const diagnostic = hill.shadows.three;
  if (diagnostic?.mode !== "shadows"
      || !mapIsAuthored(diagnostic.shadowMapSize)
      || !(diagnostic.casterCount > 0)
      || !(diagnostic.triangles > 0)
      || diagnostic.sharedGeometry !== true
      || diagnostic.lightCount !== 1) {
    console.error(`[terrain-shadow] FAIL — cordillera/${cycleName} diagnostics `
      + `${JSON.stringify(diagnostic)}`);
    process.exit(1);
  }
}

const low = results.hill.low;
if (low.changed < low.total * 0.1 || low.darkLumaEnergy <= 0) {
  console.error(`[terrain-shadow] FAIL — low-sun cordillera shadow is not substantial: `
    + `${low.changed}/${low.total} px, energy ${low.darkLumaEnergy.toFixed(1)}`);
  process.exit(1);
}
if (low.lightLumaEnergy !== 0) {
  console.error(`[terrain-shadow] FAIL — multiply shadow brightened by `
    + `${low.lightLumaEnergy.toFixed(1)}`);
  process.exit(1);
}
if (low.highFrequencyPerPixel >= 1.5) {
  console.error(`[terrain-shadow] FAIL — shadow acne/moire energy `
    + `${low.highFrequencyPerPixel.toFixed(3)} per pixel -> ${low.diffPath}`);
  process.exit(1);
}
if (results.hill.low.darkLumaEnergy <= results.hill.noon.darkLumaEnergy) {
  console.error(`[terrain-shadow] FAIL — low-sun dark energy `
    + `${results.hill.low.darkLumaEnergy.toFixed(1)} <= noon `
    + `${results.hill.noon.darkLumaEnergy.toFixed(1)}`);
  process.exit(1);
}
if (defaultCapture.frozen.three?.mode !== "shadows") {
  console.error(`[terrain-shadow] FAIL — bare ?render=3d diagnosed `
    + `${defaultCapture.frozen.three?.mode || "no mode"}`);
  process.exit(1);
}
if (defaultComparison.changed !== 0) {
  console.error(`[terrain-shadow] FAIL — bare ?render=3d differs from explicit shadows by `
    + `${defaultComparison.changed}/${defaultComparison.total} px -> ${defaultDiffPath}`);
  process.exit(1);
}

const perf = results.hill.low.performance;
if (!perf || perf.raf.activeSamples < 180 || perf.raf.inactiveSamples < 180
    || perf.sync.activeSamples < 360 || perf.sync.inactiveSamples < 360
    || !(perf.moving.updates > 0) || perf.moving.updates >= perf.moving.frames / 8) {
  console.error(`[terrain-shadow] FAIL — interleaved CPU samples missing: ${JSON.stringify(perf)}`);
  process.exit(1);
}

console.log(`[terrain-shadow] flat Paseo IDENTICAL at noon + low sun — `
  + `0/${results.flat.noon.total} changed px each`);
for (const cycleName of Object.keys(cycles)) {
  const hill = results.hill[cycleName];
  console.log(`[terrain-shadow] cordillera ${cycleName} — `
    + `${hill.changed}/${hill.total} changed px, ${hill.darkPixels} darker, `
    + `dark energy ${hill.darkLumaEnergy.toFixed(1)}, `
    + `light energy ${hill.lightLumaEnergy.toFixed(1)}, worst ${hill.worst}, `
    + `moire ${hill.highFrequencyPerPixel.toFixed(3)}/px`);
}
console.log(`[terrain-shadow] low/noon dark-energy ratio `
  + `${results.hill.noon.darkLumaEnergy === 0 ? "infinite (noon 0)"
    : `${(results.hill.low.darkLumaEnergy / results.hill.noon.darkLumaEnergy).toFixed(3)}x`}`);
console.log(`[terrain-shadow] one ${results.hill.low.shadows.three.shadowMapSize}² map; `
  + `${results.hill.low.shadows.three.casterCount} casters; shared geometry; `
  + `${results.hill.low.shadows.three.lightCount} DirectionalLight; `
  + `${results.hill.low.shadows.three.triangles} submitted triangles`);
console.log(`[terrain-shadow] rAF active ${perf.raf.activeMs.toFixed(3)} ms, `
  + `inactive ${perf.raf.inactiveMs.toFixed(3)} ms, delta ${perf.raf.deltaMs.toFixed(3)} ms/frame; `
  + `Three CPU median ${perf.raf.activeThreeMedianMs.toFixed(3)} ms, `
  + `p95 ${perf.raf.activeThreeP95Ms.toFixed(3)} ms`);
console.log(`[terrain-shadow] sync full render active ${perf.sync.activeRenderMs.toFixed(3)} ms, `
  + `inactive ${perf.sync.inactiveRenderMs.toFixed(3)} ms, `
  + `delta ${perf.sync.renderDeltaMs.toFixed(3)} ms/frame; `
  + `${perf.sync.activeSamples}/${perf.sync.inactiveSamples} active/inactive Three samples`);
console.log(`[terrain-shadow] moving camera ${perf.moving.distancePx} px / ${perf.moving.frames} frames — `
  + `${perf.moving.updates} shadow-map updates, rAF ${perf.moving.averageMs.toFixed(3)} ms, `
  + `p95 ${perf.moving.p95Ms.toFixed(3)} ms`);
console.log(`[terrain-shadow] bare ?render=3d = explicit shadows, `
  + `DOM ${expectedOrder.join(" -> ")}; PNGs/diffs/metrics ${prefix}-*`);
