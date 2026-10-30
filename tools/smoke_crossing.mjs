// LA TRAVESÍA: is the course actually in the water, and can she be driven down it?
//
// WHY THIS EXISTS. `tools/smoke.mjs` proves the render loop is alive and
// `tools/smoke_boat.mjs` proves the water medium works. Neither can see the
// thing that made this level unplayable, because it was not a crash and not a
// medium bug — it was GEOMETRY. The crossing derives its buoys, gates and
// obstacles from the lancha's route, and the route was a plain shortest path
// with no clearance term, so it ran along the mangrove: 82 of the 170 buoys
// stood on dry land, 16 of the 22 gates had a mark ashore, and roughly half the
// roots were inland. Every one of those booted fine, drew fine and threw
// nothing. You only found out by sailing into them.
//
// So the assertions here are about PLACES, and the first one is worth more than
// all the rest: every mark of the marked channel must stand on water.
//
//   pnpm build && npx vite preview --port 8799 &
//   node tools/smoke_crossing.mjs http://localhost:8799/
//
// Playwright is NOT a dependency of the game: if it is not installed this exits
// 0 with a note, exactly like the other two.
const url = process.argv[2] || "http://localhost:8799/";
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { console.log("[crossing] playwright not installed — skipped (npm i -D playwright)"); process.exit(0); }

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
const fail = (m) => { console.log("[crossing] FAIL — " + m); bad++; };

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3000);
if (!(await page.evaluate(() => !!window.Game))) { fail("window.Game never appeared"); bad++; }

// ---- 1. the course is in the water ----------------------------------------
//
// The tiles STREAM, and `surfaceAt` answers 0 — water — for a tile that is not
// resident. A naive sweep of the whole 5,7 km would therefore pass on faith
// over every unloaded tile and prove nothing. So the camera is walked down the
// route and each mark is only judged once its own tile is in: `W.ready()` is
// what the mode starts use to prime an area, and `tileResident` is the honest
// question. Marks whose tile never loads are REPORTED, not silently skipped.
const geom = await page.evaluate(async () => {
  const G = window.Game;
  G.setAttract(false);
  // find the crossing stage by kind, not by index: the carousel order moves.
  const W = window.WORLD2D;
  const idx = (W.STAGES || []).findIndex((s) => s.kind === "crossing");
  if (idx < 0) return { noStage: true };
  const stg = W.STAGES[idx];
  G.state.progress.coins = 9999;
  G.startStage(idx);
  const ch = G.crossingChannel(stg.ferry);
  if (!ch) return { noChannel: true, ferry: stg.ferry };

  const out = {
    ferry: stg.ferry, total: Math.round(ch.total),
    buoys: ch.buoys.length, gates: ch.gates.length,
    measured: !!ch.chan,
    dryBuoys: 0, dryGateMarks: 0, checkedBuoys: 0, unloaded: 0,
    minHw: 1e9, maxHw: 0, hwSamples: 0, dryThings: 0, checkedThings: 0,
    minRoom: ch.chan && ch.chan.hw ? Math.min(...ch.chan.hw) : 1e9,
  };

  const dry = (x, y) => W.surfaceAt(x, y) !== 0;
  // walk the camera down the channel, letting each stretch stream in
  const marks = ch.buoys.map((b) => ({ x: b.x, y: b.y, gate: b.gate }));
  const things = G.crossingThings().map((e) => ({ x: e.x, y: e.y, kind: e.kind }));
  for (let s = 0; s <= ch.total; s += 900) {
    const q = G.crossingLaneAt(stg.ferry, s);
    G.state.cam.x = q.x; G.state.cam.y = q.y;
    W.update(q.x, q.y);
    W.ready(q.x, q.y, 1600, 1000);
    await new Promise((r) => setTimeout(r, 140));
    const near = (m) => Math.hypot(m.x - q.x, m.y - q.y) < 700;
    for (const m of marks) {
      if (m.done || !near(m)) continue;
      if (!W.tileResident || W.tileResident(m.x, m.y)) {
        m.done = true; out.checkedBuoys++;
        if (dry(m.x, m.y)) { out.dryBuoys++; if (m.gate) out.dryGateMarks++; }
      }
    }
    for (const e of things) {
      if (e.done || !near(e)) continue;
      // roots MARK the bank and bancos are ground by definition — both are
      // meant to be at or past the water's edge, so neither is a failure.
      if (e.kind === "roots" || e.kind === "banco") { e.done = true; continue; }
      if (!W.tileResident || W.tileResident(e.x, e.y)) {
        e.done = true; out.checkedThings++;
        if (dry(e.x, e.y)) out.dryThings++;
      }
    }
  }
  out.unloaded = marks.filter((m) => !m.done).length;

  for (let s = 0; s <= ch.total; s += 200) {
    const q = G.crossingLaneAt(stg.ferry, s);
    out.minHw = Math.min(out.minHw, q.hw);
    out.maxHw = Math.max(out.maxHw, q.hw);
    out.hwSamples++;
  }
  return out;
});

if (geom.noStage) fail("this world contains no crossing stage");
else if (geom.noChannel) fail(`stage wants ferry '${geom.ferry}', which has no channel`);
else {
  console.log(`[crossing] ${geom.ferry}: ${geom.total}px, ${geom.buoys} buoys, `
    + `${geom.gates} gates, lane ${Math.round(geom.minHw)}..${Math.round(geom.maxHw)}px `
    + `(${geom.measured ? "measured by the build" : "FALLBACK constant"})`);
  // THE ASSERTION THIS FILE EXISTS FOR, in two parts.
  //
  // The renderer refuses to DRAW a mark that is on land (`buoyWet`), so a test
  // that only checked what is drawn would be green by construction — the exact
  // "passes for the wrong reason" trap `smoke_boat`'s stale coordinate fell
  // into. So this measures the DATA, and holds two different lines:
  //
  //   * a GATE mark ashore is a hard failure. A gate is scored geometry: it is
  //     the thing you steer through, and it has to be real water.
  //   * ordinary buoys get a small budget. They are placed inside a channel
  //     sounded every 40 px along a line dug at half-cell steps, and on the
  //     sharpest bends of a real estuary those disagree by a pixel or two.
  //     The budget is what tells you if that ever stops being a rounding
  //     difference and becomes a broken channel again — it was 46 %.
  if (geom.dryGateMarks) {
    fail(`${geom.dryGateMarks} GATE mark(s) stand on DRY LAND — a gate must be water`);
  }
  const dryPct = geom.checkedBuoys ? geom.dryBuoys / geom.checkedBuoys : 0;
  if (dryPct > 0.05) {
    fail(`${geom.dryBuoys}/${geom.checkedBuoys} buoys (${Math.round(dryPct * 100)}%) `
      + `are on dry land — the channel data has regressed`);
  } else if (geom.dryBuoys) {
    console.log(`[crossing]    (${geom.dryBuoys}/${geom.checkedBuoys} buoys suppressed `
      + `as ashore — within budget)`);
  }
  if (geom.dryThings > geom.checkedThings * 0.05) {
    fail(`${geom.dryThings}/${geom.checkedThings} obstacles are on dry land`);
  }
  // THE WATER IS THE TEST, NOT THE MARKS. The marked lane is a fraction of the
  // measured room, so on a narrow reach it is narrow — and that is correct, not
  // a fault: it is what keeps the buoys wet. Asserting a floor on the LANE was
  // asserting the wrong number (it failed at 22 px where the estero has 72 px
  // of water and the hull's beam is 12).
  // What has to hold is that a boat can get through, so it is measured against
  // the WATER the build emitted and the beam of the widest hull.
  if (geom.minRoom * 2 < 48) {
    fail(`the channel closes to ${Math.round(geom.minRoom * 2)}px of water — `
      + `a 34px hull cannot pass`);
  }
  // Open water may be arbitrarily broad, but the buoys mark an authored
  // regatta course rather than the banks of the whole basin.
  if (geom.maxHw > 190.001) {
    fail(`the marked course opens to ${Math.round(geom.maxHw)}px half-width — `
      + `the authored maximum is 190px`);
  }
  if (geom.unloaded > geom.buoys * 0.2) {
    fail(`${geom.unloaded}/${geom.buoys} buoys were never checked — tiles did not stream`);
  }
}

// ---- 2. she can be driven down it -----------------------------------------
const run = await page.evaluate(async () => {
  const G = window.Game;
  const W = window.WORLD2D;
  const idx = (W.STAGES || []).findIndex((s) => s.kind === "crossing");
  G.startStage(idx);
  const p = G.state.p;
  const out = { top: G.state.veh.top, speeds: [], prog: [], over: false, active: true };
  const press = (k, down) =>
    window.dispatchEvent(new KeyboardEvent(down ? "keydown" : "keyup", { key: k }));
  press("w", true);
  let held = null;
  for (let i = 0; i < 60; i++) {
    // steer toward the lane a little way ahead, which is what the compass
    // gives a player — see `crossingTarget`.
    const c = G.state.crossing;
    const want = c && c.active ? G.crossingLaneAt(c.ferry.id, (c.s || 0) + 320) : null;
    if (want) {
      let e = Math.atan2(want.y - p.y, want.x - p.x) - p.a;
      e = Math.atan2(Math.sin(e), Math.cos(e));
      const k = e > 0.06 ? "d" : e < -0.06 ? "a" : null;
      if (held !== k) { if (held) press(held, false); if (k) press(k, true); held = k; }
    }
    await new Promise((r) => setTimeout(r, 100));
    out.speeds.push(Math.round(p.speed || 0));
    out.prog.push(Math.round((G.state.crossing?.progress || 0) * 1000) / 1000);
    if (G.state.over) { out.over = true; break; }
  }
  press("w", false); if (held) press(held, false);
  out.active = !!G.state.crossing?.active;
  out.boost = G.state.crossing?.boost || 0;
  return out;
});

const mean = run.speeds.reduce((a, b) => a + b, 0) / Math.max(1, run.speeds.length);
console.log(`[crossing] drove 6 s: mean ${Math.round(mean)} px/s of a ${run.top} top, `
  + `progress ${run.prog[0]} -> ${run.prog[run.prog.length - 1]}`);
// SHE MUST NOT BE SLOW. This is the direct guard against the complaint that
// started the rewrite: a hull that cannot average half her top speed down her
// own channel is being held by something.
if (mean < run.top * 0.45) {
  fail(`she averaged ${Math.round(mean)} px/s against a top of ${run.top} — something is holding her`);
}
if (run.prog[run.prog.length - 1] <= run.prog[0]) {
  fail(`no progress down the course (${run.prog[0]} -> ${run.prog[run.prog.length - 1]})`);
}
if (run.over) fail("the run ended inside the first 6 seconds");
if (!run.active) fail("the crossing went inactive while sailing — the swamped path is back");
if (errors.length) fail(`${errors.length} page error(s)`);
for (const e of errors.slice(0, 8)) console.log("   " + e);

await browser.close();
if (!bad) console.log("[crossing] ok — the course is in the water and she sails it");
process.exit(bad ? 1 : 0);
