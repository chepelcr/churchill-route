// LA CAPA 2.5D ARRANCA, TOMA SUS CLASES Y NO ROMPE EL LAZO.
//
// Boot the built game with `?render=3d`, start a run, drive, and FAIL when:
//   * the three layer never reports ready (WebGL or the lazy import died);
//   * it draws nothing — no buildings or no plants resident around the car;
//   * the page throws anywhere (the render loop has no try, see smoke.mjs);
//   * the car does not move: the 3-D layer must never cost the sim its frame.
//
//   pnpm build && npx vite preview --port 8799 &
//   node tools/smoke-3d.mjs http://localhost:8799/
//
// Headless Chromium rasterises WebGL in SOFTWARE (SwiftShader), so a frame
// here costs ~100 ms that a phone's GPU pays in two. So this counts FRAMES and
// asks for movement at all, far below smoke.mjs's bar — it checks that the
// loop is ALIVE under the layer, not how fast it is. Speed is for real hardware.
const url = process.argv[2] || "http://localhost:8799/";
const sep = url.includes("?") ? "&" : "?";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("[smoke-3d] playwright not installed — skipped");
  process.exit(0);
}
const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: CHROME }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0, 4).join("\n   ")));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/favicon|ERR_CONNECTION|ERR_CERT|Failed to load resource/.test(t)) return;
  errors.push("console: " + t.slice(0, 300));
});

let bad = 0;
const fail = (msg) => { console.log("[smoke-3d] FAIL — " + msg); bad++; };

await page.goto(url + sep + "render=3d", { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });
const ready = await page.waitForFunction(() => window.__three?.ready, null, { timeout: 30000 })
  .then(() => true, () => false);
if (!ready) fail("the three layer never reported ready (lazy import or WebGL failed)");

await page.evaluate(() => { window.Game.setAttract(false); window.Game.startArcade(); });
// the streaming world and the per-tile meshes need a few frames to arrive
await page.waitForFunction(() => (window.__three?.buildings?.buildings || 0) > 0
  && (window.__three?.flora?.plants || 0) > 0, null, { timeout: 30000 }).catch(() => {});
const layer = await page.evaluate(() => window.__three);
if (ready && !(layer.buildings?.buildings > 0)) fail(`no buildings resident around the car (${JSON.stringify(layer.buildings)})`);
if (ready && !(layer.flora?.plants > 0)) fail(`no plants resident around the car (${JSON.stringify(layer.flora)})`);
if (ready && !(layer.calls > 0)) fail("the layer issued no draw calls");

const drive = await page.evaluate(async () => {
  const p = window.Game.state.p;
  const frames0 = window.__three.frames;
  const start = { x: p.x, y: p.y };
  let best = 0;
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    p.x = start.x; p.y = start.y; p.a = a; p.vx = 0; p.vy = 0; p.speed = 0;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    await new Promise((r) => setTimeout(r, 2000));
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
    best = Math.max(best, Math.hypot(p.x - start.x, p.y - start.y));
    await new Promise((r) => setTimeout(r, 200));
  }
  return { px: Math.round(best), frames: window.__three.frames - frames0 };
});
// ALIVE, not fast: the layer drew frames AND the sim moved the car. How far it
// got depends on how slow software GL happens to be on this machine.
if (drive.frames < 10) fail(`the 3-D layer drew only ${drive.frames} frames in ~9 s — the loop is dead`);
if (drive.px < 10) fail(`the car only moved ${drive.px} px under the 3-D layer — the sim is not advancing`);
if (errors.length) fail(`${errors.length} page error(s)`);
for (const e of errors.slice(0, 8)) console.log("   " + e);

await browser.close();
if (!bad) {
  console.log(`[smoke-3d] ok — three r${layer.revision}, ${layer.buildings.buildings} buildings / `
    + `${layer.flora.plants} plants resident, ${layer.calls} draw calls, drove ${drive.px} px over ${drive.frames} frames, no page errors`);
}
process.exit(bad ? 1 : 0);
