// STAGE D2: Three terrain is composited as a GPU-resident CSS multiply layer.
//
//   node tools/shot-terrain.mjs [devUrl] [outputPrefix]
//
// Two deterministic pairs prove both halves of the contract: the surveyed
// sand bank remains bit-identical, while an elevated cordillera tile produces
// measurable hillshade. The same run records Three's synchronous CPU submit
// cost and interleaves rAF runs with the CSS terrain layer visible/hidden to
// bound the browser-compositor cost without a GPU→CPU readback.
import { chromium } from "playwright";
import { dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = process.argv[2] || "http://localhost:8734/";
const prefix = process.argv[3] || "/tmp/churchill-stage-d2";
const viewport = { width: 1100, height: 700 };
const probes = {
  flat: { x: 24646, y: 14400 },     // interior spit, survey range <= 4 m
  hill: { x: 57320, y: 3080 },      // cordillera, tile range 77–357 m
};
mkdirSync(dirname(prefix), { recursive: true });

const browser = await chromium.launch();

function modeUrl(terrain, point) {
  const url = new URL(baseUrl);
  url.searchParams.set("render", terrain ? "3d" : "2d");
  if (terrain) url.searchParams.set("three", "terrain");
  // Hold React on PLAYING; otherwise Boot advances to Intro halfway through
  // the compositor timing run and flips the simulation back to attract mode.
  url.searchParams.set("editorPlay", "1");
  url.searchParams.set("x", point.x);
  url.searchParams.set("y", point.y);
  return url.href;
}

async function capture(name, point, terrain) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.addInitScript(() => {
    window.__terrainNativeRaf = window.requestAnimationFrame.bind(window);
    window.__resetTerrainRandom = (seed = 0x7e22a11) => {
      let n = seed >>> 0;
      Math.random = () => {
        n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
        return n / 0x100000000;
      };
    };
    window.__resetTerrainRandom();
  });

  await page.goto(modeUrl(terrain, point), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.Game?.state && window.WORLD2D,
    null, { timeout: 30000 });
  await page.waitForFunction(() => document.body.dataset.gameScreen === "playing",
    null, { timeout: 30000 });
  if (terrain) {
    await page.waitForFunction(() => window.__threeTerrain?.ready
      && window.__threeTerrain.mode === "terrain", null, { timeout: 30000 });
  } else {
    await page.waitForTimeout(250);
  }

  const frozen = await page.evaluate(async ({ name, point, terrain }) => {
    await Promise.all([
      document.fonts.load("bold 10px 'JetBrains Mono'"),
      document.fonts.load("bold 12px 'Bungee'"),
      document.fonts.load("600 12px 'Space Grotesk'"),
    ]);
    await document.fonts.ready;

    const G = window.Game;
    const W = window.WORLD2D;
    window.__resetTerrainRandom(0x7e22a11);
    G.setAttract(false);
    G.startExplore({ x: point.x, y: point.y, weather: "sunny" });
    G.setTide(0.5);
    G.state.tide = 0.5;
    G.state.tideRising = true;
    G.state.running = false;
    G.state.attract = false;

    const canvasUrl = new URL("/src/render/canvas2d.js", location.href);
    const canvasSource = await fetch(canvasUrl).then((response) => response.text());
    const daySpec = canvasSource.match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)?.[1];
    if (!daySpec) throw new Error("shot-terrain could not resolve live daynight module");
    const day = await import(new URL(daySpec, canvasUrl).href);
    day.setDayCycle(true, 0.25);

    const halfW = innerWidth / (G.state.cam.zoom || 1) / 2 + 80;
    const halfH = innerHeight / (G.state.cam.zoom || 1) / 2 + 80;
    await W.ensureView(point.x - halfW, point.y - halfH,
      point.x + halfW, point.y + halfH, 2);

    G.state.cam.x = G.state.p.x = point.x;
    G.state.cam.y = G.state.p.y = point.y;
    G.state.cam.shake = 0;
    G.state.cam.rot = 0;
    G.state.p.vx = G.state.p.vy = G.state.p.speed = 0;
    window.requestAnimationFrame = () => 0;
    await new Promise((resolve) => setTimeout(resolve, 80));

    const gameUrl = new URL("/src/game/index.js", location.href);
    const gameSource = await fetch(gameUrl).then((response) => response.text());
    const rendererSpec = gameSource.match(/from\s+["']([^"']*\/render\/Renderer\.js[^"']*)["']/)?.[1];
    if (!rendererSpec) throw new Error("shot-terrain could not resolve live Renderer module");
    const liveRenderer = await import(new URL(rendererSpec, gameUrl).href);

    window.__terrainRenderSamples = [];
    if (terrain) {
      for (let i = 0; i < 24; i++) liveRenderer.render(211.5);
      window.__terrainRenderSamples.length = 0;
      for (let i = 0; i < 120; i++) liveRenderer.render(211.5);
    } else {
      liveRenderer.render(211.5);
    }

    // Boot/intro can advance while the rAF compositor measurement runs. A
    // persistent rule keeps later React replacements out of the renderer diff.
    const hideUi = document.createElement("style");
    hideUi.textContent = "#root > :not(canvas){display:none!important}";
    document.head.appendChild(hideUi);
    document.body.style.background = "#000";

    const samples = [...window.__terrainRenderSamples].sort((a, b) => a - b);
    const percentile = (p) => samples[Math.min(samples.length - 1,
      Math.floor((samples.length - 1) * p))] ?? null;
    delete window.__terrainRenderSamples;

    // Both variants still submit the same Three + Canvas drawing work. The
    // feature flag changes only the fallback stack itself: CSS terrain becomes
    // visible and the screen tail targets its transparent canvas above it. A
    // run average is more stable than individual vsync intervals, then three
    // alternating runs protect the delta from one-sided warm-up.
    let compositor = null;
    if (terrain && name === "hill") {
      const terrainCanvas = document.querySelector("#three-terrain-source");
      if (!terrainCanvas) throw new Error("CSS terrain source canvas is not mounted");
      const measureLayer = (visible, frames = 60) => new Promise((resolve) => {
        window.__perfFlags = {
          ...(window.__perfFlags || {}), terrainComposite: visible,
        };
        window.__prof = { water: 0, land: 0, n: 0, render: 0, frames: 0 };
        let first = null, previous = null, count = 0;
        const intervals = [];
        const tick = (now) => {
          if (first === null) first = now;
          if (previous !== null) intervals.push(now - previous);
          previous = now;
          liveRenderer.render(211.5);
          if (++count <= frames) window.__terrainNativeRaf(tick);
          else {
            const prof = window.__prof;
            resolve({
              averageMs: (now - first) / Math.max(1, intervals.length),
              p95Ms: [...intervals].sort((a, b) => a - b)[Math.floor(intervals.length * 0.95)],
              renderMs: prof.render / Math.max(1, prof.frames),
            });
          }
        };
        window.__terrainNativeRaf(tick);
      });
      await measureLayer(true, 20);
      await measureLayer(false, 20);
      const visible = [], hidden = [];
      for (let i = 0; i < 3; i++) {
        if (i % 2 === 0) {
          visible.push(await measureLayer(true));
          hidden.push(await measureLayer(false));
        } else {
          hidden.push(await measureLayer(false));
          visible.push(await measureLayer(true));
        }
      }
      const median = (rows, key) => rows.map((row) => row[key])
        .sort((a, b) => a - b)[rows.length >> 1];
      compositor = {
        visibleMs: median(visible, "averageMs"),
        hiddenMs: median(hidden, "averageMs"),
        visibleP95Ms: median(visible, "p95Ms"),
        hiddenP95Ms: median(hidden, "p95Ms"),
        visibleRenderMs: median(visible, "renderMs"),
        hiddenRenderMs: median(hidden, "renderMs"),
      };
      compositor.deltaMs = compositor.visibleMs - compositor.hiddenMs;
      compositor.renderDeltaMs = compositor.visibleRenderMs - compositor.hiddenRenderMs;
      delete window.__perfFlags.terrainComposite;
      delete window.__prof;
      liveRenderer.render(211.5);
    }
    return {
      name,
      x: point.x,
      y: point.y,
      samples: samples.length,
      cpuMedianMs: percentile(0.5),
      cpuP95Ms: percentile(0.95),
      compositor,
      three: terrain ? { ...window.__threeTerrain } : null,
    };
  }, { name, point, terrain });

  const png = await page.screenshot({ animations: "disabled" });
  await context.close();
  if (errors.length) throw new Error(`${name}/${terrain ? "terrain" : "2d"} page errors: ${errors.join(" | ")}`);
  return { png, frozen };
}

async function comparePNGs(a, b) {
  const page = await browser.newPage();
  const result = await page.evaluate(async ([a64, b64]) => {
    const load = (base64) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = `data:image/png;base64,${base64}`;
    });
    const [a, b] = await Promise.all([load(a64), load(b64)]);
    if (a.width !== b.width || a.height !== b.height)
      return { sized: false, a: [a.width, a.height], b: [b.width, b.height] };
    const pixels = (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      const g = canvas.getContext("2d");
      g.drawImage(image, 0, 0);
      return g.getImageData(0, 0, image.width, image.height);
    };
    const pa = pixels(a), pb = pixels(b);
    const diff = new Uint8ClampedArray(pa.data.length);
    let changed = 0, worst = 0, totalDelta = 0;
    for (let i = 0; i < pa.data.length; i += 4) {
      let delta = 0;
      for (let k = 0; k < 4; k++)
        delta = Math.max(delta, Math.abs(pa.data[i + k] - pb.data[i + k]));
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
    const canvas = document.createElement("canvas");
    canvas.width = pa.width; canvas.height = pa.height;
    canvas.getContext("2d").putImageData(new ImageData(diff, pa.width, pa.height), 0, 0);
    return {
      sized: true,
      changed,
      worst,
      meanChangedDelta: changed ? totalDelta / changed : 0,
      total: pa.data.length / 4,
      diff: changed ? canvas.toDataURL("image/png").split(",")[1] : null,
    };
  }, [a.toString("base64"), b.toString("base64")]);
  await page.close();
  return result;
}

const results = {};
for (const [name, point] of Object.entries(probes)) {
  const two = await capture(name, point, false);
  const terrain = await capture(name, point, true);
  const twoPath = `${prefix}-${name}-2d.png`;
  const terrainPath = `${prefix}-${name}-terrain.png`;
  writeFileSync(twoPath, two.png);
  writeFileSync(terrainPath, terrain.png);
  const diff = await comparePNGs(two.png, terrain.png);
  if (!diff.sized) throw new Error(`${name}: dimensions differ: ${diff.a} vs ${diff.b}`);
  if (diff.changed) {
    const diffPath = `${prefix}-${name}-diff.png`;
    writeFileSync(diffPath, Buffer.from(diff.diff, "base64"));
    diff.diffPath = diffPath;
  }
  results[name] = { ...diff, terrain: terrain.frozen, twoPath, terrainPath };
}
await browser.close();

if (results.flat.changed !== 0) {
  console.error(`[terrain] FAIL — flat spit changed ${results.flat.changed}/${results.flat.total} px -> ${results.flat.diffPath}`);
  process.exit(1);
}
if (results.hill.changed < 500) {
  console.error(`[terrain] FAIL — cordillera relief changed only ${results.hill.changed}/${results.hill.total} px`);
  process.exit(1);
}
if (results.hill.terrain.samples !== 120 || results.hill.terrain.three?.triangles <= 0) {
  console.error("[terrain] FAIL — terrain pass/composite samples were not produced");
  process.exit(1);
}

console.log(`[terrain] flat spit IDENTICAL — 0/${results.flat.total} changed px`);
console.log(`[terrain] cordillera RELIEF — ${results.hill.changed}/${results.hill.total} changed px, `
  + `worst ${results.hill.worst}, mean changed delta ${results.hill.meanChangedDelta.toFixed(2)}`);
console.log(`[terrain] Three CPU submit — median ${results.hill.terrain.cpuMedianMs.toFixed(3)} ms, `
  + `p95 ${results.hill.terrain.cpuP95Ms.toFixed(3)} ms (${results.hill.terrain.samples} warm samples)`);
console.log(`[terrain] CSS stack rAF — active ${results.hill.terrain.compositor.visibleMs.toFixed(3)} ms, `
  + `hidden ${results.hill.terrain.compositor.hiddenMs.toFixed(3)} ms, `
  + `delta ${results.hill.terrain.compositor.deltaMs.toFixed(3)} ms/frame`);
console.log(`[terrain] full render CPU — visible ${results.hill.terrain.compositor.visibleRenderMs.toFixed(3)} ms, `
  + `inactive ${results.hill.terrain.compositor.hiddenRenderMs.toFixed(3)} ms, `
  + `delta ${results.hill.terrain.compositor.renderDeltaMs.toFixed(3)} ms/frame`);
console.log(`[terrain] resident ${results.hill.terrain.three.residentTiles} elevated tiles, `
  + `${results.hill.terrain.three.meshTiles} cached meshes, `
  + `${results.hill.terrain.three.triangles} visible triangles`);
