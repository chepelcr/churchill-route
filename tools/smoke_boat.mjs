// The WATER MEDIUM check: a boat sails on water, and land is a wall to her.
//
// WHY THIS EXISTS, on top of tools/smoke.mjs. That file proves the render loop
// is alive by driving a car down an avenue. It cannot see the medium: a boat
// whose `isWall` was inverted the wrong way, or whose surface multiplier left
// the sea at a car's 0.35, boots fine, draws fine, throws nothing, and is
// simply unplayable — stuck in the mangrove, or crawling. The failure is in the
// PHYSICS, so it has to be measured by driving, and the two measurements that
// actually separate a working medium from a broken one are:
//
//   * on water she reaches her CONFIGURED top speed. Not "she moves" — a boat
//     being shoved out of a wall moves too. Hitting `veh.top` exactly is the
//     signature of a surface she is meant to be on.
//   * on land she cannot BUILD SPEED. Displacement proves nothing here: dropped
//     on a street she is buried in wall cells and the solver shoves her around,
//     which looks like travel. Being unable to answer the throttle is the
//     honest signature of ground that is a wall to her.
//
//   pnpm build && npx vite preview --port 8799 &
//   node tools/smoke_boat.mjs http://localhost:8799/
//
// Playwright is NOT a dependency of the game: if it is not installed this exits
// 0 with a note, exactly like tools/smoke.mjs.
const url = process.argv[2] || "http://localhost:8799/";
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { console.log("[boat] playwright not installed — skipped (npm i -D playwright)"); process.exit(0); }

const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: CHROME }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0, 4).join("\n   ")));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/favicon|ERR_CONNECTION|Failed to load resource/.test(t)) return;   // not ours
  errors.push("console: " + t.slice(0, 300));
});
let bad = 0;
const fail = (m) => { console.log("[boat] FAIL — " + m); bad++; };

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3000);
if (!(await page.evaluate(() => !!window.Game))) { fail("window.Game never appeared"); bad++; }

const out = await page.evaluate(async () => {
  const G = window.Game;
  G.setAttract(false);
  G.startExplore();
  // THE OPEN GULF, south of the Muelle Nacional's sea end (19551, 13288).
  // Deliberately NOT a point interpolated along the lancha's route: that line
  // is only guaranteed navigable to the water flood's own ~20 px resolution,
  // so a chord midpoint can sit in the mangrove and fail this check for a
  // reason that has nothing to do with the medium. The gulf is unambiguous.
  const wx = 19551, wy = 13800, wa = 0;
  G.state.progress.coins = 9999;                  // so the paid hull is ownable
  G.state.progress.owned.push("deslizador");
  G.setVehicle("deslizador");
  const p = G.state.p;
  const res = { key: G.state.vehicleKey, medium: G.state.veh.medium, configuredTop: G.state.veh.top };

  p.x = wx; p.y = wy; p.a = wa; p.vx = 0; p.vy = 0; p.speed = 0;
  const from = { x: p.x, y: p.y };
  res.top = 0;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
  for (let i = 0; i < 16; i++) {
    await new Promise((r) => setTimeout(r, 300));
    res.top = Math.max(res.top, p.speed || 0);
  }
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
  res.travelled = Math.round(Math.hypot(p.x - from.x, p.y - from.y));

  // The same hull, on a downtown street.
  //
  // THIS COORDINATE WENT STALE AND THE TEST WENT GREEN ANYWAY, which is worth a
  // note because it is the failure mode a smoke test is supposed to not have.
  // (17944, 12240) was a street when it was written; a rescale later it is OPEN
  // WATER, so the "on land" leg was measuring a boat on the sea. It still passed
  // — because the hull was tuned so badly that 2.4 s from rest could not reach a
  // quarter of her top speed even on water. Two bugs cancelling. When `boat.js`
  // made her accelerate like an arcade boat, the land leg finally reported 440
  // px/s and the test failed for the first time, on the one thing that was
  // right. Verified against the raster: this one is asphalt with no water cell
  // within 400 px, so a hull dropped here is buried in wall on every side.
  p.x = 23000; p.y = 15100; p.a = wa; p.vx = 0; p.vy = 0; p.speed = 0;
  const lFrom = { x: p.x, y: p.y };
  res.landTop = 0;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 300));
    res.landTop = Math.max(res.landTop, p.speed || 0);
  }
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
  res.landBlocked = Math.round(Math.hypot(p.x - lFrom.x, p.y - lFrom.y));
  return res;
});

if (out.medium !== "water") fail(`setVehicle('deslizador') resolved to medium ${out.medium}`);
if (out.key !== "deslizador") fail(`the vehicle fell back to ${out.key} — the ownership/medium gate is wrong`);
if (out.top < out.configuredTop * 0.9) {
  fail(`she only made ${Math.round(out.top)} px/s on open water, against a configured top of ${out.configuredTop}`);
}
if (out.travelled < 300) fail(`she only moved ${out.travelled} px on open water in 5 s`);
if (out.landTop > out.top * 0.25) {
  fail(`she reached ${Math.round(out.landTop)} px/s in the CITY vs ${Math.round(out.top)} on water — land is not a wall for her`);
}
if (errors.length) fail(`${errors.length} page error(s)`);
for (const e of errors.slice(0, 8)) console.log("   " + e);

await browser.close();
if (!bad) {
  console.log(`[boat] ok — sailed ${out.travelled} px at her full ${Math.round(out.top)} px/s, `
    + `and could not pass ${Math.round(out.landTop)} px/s on land`);
}
process.exit(bad ? 1 : 0);
