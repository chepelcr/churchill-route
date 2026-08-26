// STAGE D1: enabling the empty Three layer must move exactly zero pixels.
//
//   node tools/shot-3d.mjs [devUrl] [outputPrefix]
//
// The normal world-scene noise floor does not apply here because this gate:
// seeds Math.random immediately before startExplore, zeros camera shake, pins
// noon through the LIVE daynight module, stops rAF and paints one named time.
import { chromium } from "playwright";
import { dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = process.argv[2] || "http://localhost:8734/";
const prefix = process.argv[3] || "/tmp/churchill-stage-d1";
mkdirSync(dirname(prefix), { recursive: true });

const browser = await chromium.launch();

function modeUrl(mode) {
  const u = new URL(baseUrl);
  u.searchParams.set("render", mode);
  if (mode === "3d") u.searchParams.set("three", "empty");
  return u.href;
}

async function capture(mode) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await context.newPage();
  const errors = [];
  const threeRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.includes("/src/render/three/")
      || path.includes("/node_modules/.vite/deps/three")
      || /\/three-[^/]+\.js$/.test(path)) threeRequests.push(path);
  });

  // Resettable LCG: Three may create UUIDs while it boots, so the meaningful
  // reset happens immediately before startExplore, after the empty layer is
  // ready. Both modes then consume the identical game RNG stream.
  await page.addInitScript(() => {
    window.__resetShotRandom = (seed = 0x5eed1234) => {
      let n = seed >>> 0;
      Math.random = () => {
        n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
        return n / 0x100000000;
      };
    };
    window.__resetShotRandom();
  });

  await page.goto(modeUrl(mode), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.Game?.state && window.WORLD2D,
    null, { timeout: 30000 });
  if (mode === "3d") {
    await page.waitForFunction(() => document.querySelector("#three-canvas")?.dataset.ready === "true",
      null, { timeout: 30000 });
  } else {
    await page.waitForTimeout(250);
  }

  const frozen = await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load("bold 10px 'JetBrains Mono'"),
      document.fonts.load("bold 12px 'Bungee'"),
      document.fonts.load("600 12px 'Space Grotesk'"),
    ]);
    await document.fonts.ready;

    const G = window.Game;
    const W = window.WORLD2D;
    window.__resetShotRandom(0x5eed1234);
    G.setAttract(false);
    const anchor = W.landmarkById("kios_paseo1") || W.landmarkById("faro");
    G.startExplore({ x: anchor.x, y: anchor.y, weather: "sunny" });
    // Mode startup has now consumed the seeded stream and created every actor.
    // Stop on the SAME JavaScript task, before awaiting tile I/O: otherwise
    // one backend's load latency buys its pedestrians a few extra sim frames.
    G.state.running = false;
    G.state.attract = false;

    // Resolve the URL that canvas2d itself imports, including Vite's HMR query.
    // Importing the clean path can mint a second cycle singleton.
    const canvasUrl = new URL("/src/render/canvas2d.js", location.href);
    const canvasSource = await fetch(canvasUrl).then((response) => response.text());
    const daySpec = canvasSource.match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)?.[1];
    if (!daySpec) throw new Error("shot-3d could not resolve canvas2d's live daynight module");
    const day = await import(new URL(daySpec, canvasUrl).href);
    day.setDayCycle(true, 0.25);

    const halfW = innerWidth / (G.state.cam.zoom || 1) / 2 + 80;
    const halfH = innerHeight / (G.state.cam.zoom || 1) / 2 + 80;
    await W.ensureView(anchor.x - halfW, anchor.y - halfH,
      anchor.x + halfW, anchor.y + halfH, 1);

    // Stop simulation and the browser clock. One already-queued callback may
    // run, then cannot enqueue a successor; after that we explicitly render at
    // a shared named second through the LIVE Renderer module.
    G.state.cam.x = G.state.p.x = anchor.x;
    G.state.cam.y = G.state.p.y = anchor.y;
    G.state.cam.shake = 0;
    G.state.p.vx = G.state.p.vy = G.state.p.speed = 0;
    window.requestAnimationFrame = () => 0;
    await new Promise((resolve) => setTimeout(resolve, 80));

    const gameUrl = new URL("/src/game/index.js", location.href);
    const gameSource = await fetch(gameUrl).then((response) => response.text());
    const rendererSpec = gameSource.match(/from\s+["']([^"']*\/render\/Renderer\.js[^"']*)["']/)?.[1];
    if (!rendererSpec) throw new Error("shot-3d could not resolve the live Renderer module");
    const liveRenderer = await import(new URL(rendererSpec, gameUrl).href);
    liveRenderer.render(123.25);

    // React is a separate layer; compare the renderer stack and nothing else.
    for (const child of document.querySelectorAll("#root > :not(canvas)")) child.style.display = "none";
    document.body.style.background = "#000";
    return {
      x: anchor.x,
      y: anchor.y,
      three: document.querySelector("#three-canvas")?.dataset.ready === "true",
      stage: document.querySelector("#three-canvas")?.dataset.stage || null,
    };
  });

  const png = await page.screenshot({ animations: "disabled" });
  await context.close();
  if (errors.length) throw new Error(`${mode} page errors: ${errors.join(" | ")}`);
  return { png, frozen, threeRequests: [...new Set(threeRequests)] };
}

const two = await capture("2d");
const three = await capture("3d");
const twoPath = `${prefix}-2d.png`;
const threePath = `${prefix}-3d.png`;
writeFileSync(twoPath, two.png);
writeFileSync(threePath, three.png);

const compare = await browser.newPage();
await compare.goto("about:blank");
const result = await compare.evaluate(async ([a64, b64]) => {
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
  let changed = 0, worst = 0;
  for (let i = 0; i < pa.data.length; i += 4) {
    let delta = 0;
    for (let k = 0; k < 4; k++) delta = Math.max(delta, Math.abs(pa.data[i + k] - pb.data[i + k]));
    if (delta) { changed++; worst = Math.max(worst, delta); }
    diff[i] = delta ? 255 : pa.data[i] * 0.35 + 160;
    diff[i + 1] = delta ? 0 : pa.data[i + 1] * 0.35 + 160;
    diff[i + 2] = delta ? 255 : pa.data[i + 2] * 0.35 + 160;
    diff[i + 3] = 255;
  }
  const canvas = document.createElement("canvas");
  canvas.width = pa.width; canvas.height = pa.height;
  canvas.getContext("2d").putImageData(new ImageData(diff, pa.width, pa.height), 0, 0);
  return {
    sized: true, changed, worst, total: pa.data.length / 4,
    diff: changed ? canvas.toDataURL("image/png").split(",")[1] : null,
  };
}, [two.png.toString("base64"), three.png.toString("base64")]);
await browser.close();

if (!result.sized) {
  console.error(`[3d] FAIL — dimensions differ: ${result.a} vs ${result.b}`);
  process.exit(1);
}
if (two.threeRequests.length) {
  console.error(`[3d] FAIL — ?render=2d downloaded Three: ${two.threeRequests.join(", ")}`);
  process.exit(1);
}
if (!three.frozen.three || three.frozen.stage !== "empty" || !three.threeRequests.length) {
  console.error("[3d] FAIL — ?render=3d&three=empty did not initialise the empty Three chunk/canvas");
  process.exit(1);
}
if (result.changed) {
  const diffPath = `${prefix}-diff.png`;
  writeFileSync(diffPath, Buffer.from(result.diff, "base64"));
  console.error(`[3d] FAIL — ${result.changed}/${result.total} pixels changed, `
    + `worst channel delta ${result.worst} -> ${diffPath}`);
  process.exit(1);
}

console.log(`[3d] ?render=2d loaded 0 Three requests; empty 3-D loaded ${three.threeRequests.length}`);
console.log(`[3d] empty canvas ready at (${three.frozen.x},${three.frozen.y})`);
console.log(`[3d] IDENTICAL — 0/${result.total} changed px -> ${twoPath}, ${threePath}`);
