// THE SEA WORKS: tides, sandbanks, tuna schools and the people on the muelle.
//
// WHY THIS EXISTS. `smoke.mjs` proves the render loop is alive by driving a car
// down an avenue and `smoke_boat.mjs` proves the water medium works, but neither
// ever enters the estero or reaches open water, so everything the sea does is
// invisible to both. These are all SIMULATION facts that look fine in a
// screenshot and are wrong in play:
//
//   * a tide that does not move, or banks that never dry out, leave the level
//     with one difficulty instead of four;
//   * a school of tuna whose fleet orbits INSIDE the shoal reads as boats
//     driving through the fish;
//   * ambient life seeded per-place must also be CULLED — the muelleros are the
//     newest pool that can leak, and a leak only shows after you drive away.
//
//   pnpm build && npx vite preview --port 8799 &
//   node tools/smoke_sea.mjs http://localhost:8799/
//
// Playwright is NOT a dependency of the game: absent, this exits 0 with a note.
const url = process.argv[2] || "http://localhost:8799/";
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { console.log("[sea] playwright not installed — skipped (npm i -D playwright)"); process.exit(0); }

const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: CHROME }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/favicon|ERR_CONNECTION|Failed to load resource/.test(t)) return;
  errors.push("console: " + t.slice(0, 200));
});
let bad = 0;
const fail = (m) => { console.log("[sea] FAIL — " + m); bad++; };

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3000);
if (!(await page.evaluate(() => !!window.Game))) { fail("window.Game never appeared"); }

// ---- 1. the crossing: conditions rotate, banks dry out, she runs aground ----
const tide = await page.evaluate(async () => {
  const G = window.Game;
  // FIND THE CROSSING BY KIND, never by index. It used to be the last stage and
  // this said `startStage(7)`; it now sits at position 4, and the hardcoded
  // index quietly started a delivery in Caldera instead — every assertion below
  // then failed for a reason that had nothing to do with the sea.
  const CROSS = window.WORLD2D.STAGES.findIndex((s) => s.kind === "crossing");
  G.setAttract(false);
  G.state.progress.crossings = {};                 // rotation from the top
  const rotation = [];
  for (let n = 0; n < 5; n++) {
    G.setAttract(false);
    G.startStage(CROSS, "panga");
    // ONE FRAME, THEN READ. `state.tide` is published by `updateTide` inside
    // the sim tick, so it does not exist yet the instant a stage starts — but
    // read it much later and a harness artefact spoils it: leaving the UI on a
    // menu screen lets React re-arm attract mode, and `setAttract(true)` writes
    // `state.weather` as its menu backdrop a few hundred ms in.
    await new Promise((r) => setTimeout(r, 90));
    rotation.push({ weather: G.state.weather, tide: +(G.state.tide || 0).toFixed(2) });
    G.state.over = true;
  }
  G.setAttract(false);
  G.startStage(CROSS, "panga");
  await new Promise((r) => setTimeout(r, 700));
  const bancos = G.crossingThings().filter((e) => e.kind === "banco");
  const exposedAt = (lvl) => bancos.filter((e) => lvl < e.depth).length;
  const res = {
    rotation,
    bancos: bancos.length,
    low: exposedAt(0), mid: exposedAt(0.5), high: exposedAt(1),
  };
  const bank = bancos.find((e) => e.depth > 0.6) || bancos[0];
  const p = G.state.p;
  G.setTide(0.0);
  p.x = bank.x; p.y = bank.y; p.a = 0; p.vx = 260; p.vy = 0; p.speed = 260;
  await new Promise((r) => setTimeout(r, 450));
  res.agroundLow = !!bank.aground; res.speedLow = Math.round(p.speed);
  bank.aground = false;
  G.setTide(1.0);
  p.x = bank.x; p.y = bank.y; p.vx = 260; p.vy = 0; p.speed = 260;
  await new Promise((r) => setTimeout(r, 450));
  res.agroundHigh = !!bank.aground; res.speedHigh = Math.round(p.speed);
  G.state.over = true;
  return res;
});

const want = ["sunny", "sunset", "night", "storm", "sunny"];
if (tide.rotation.map((r) => r.weather).join() !== want.join()) {
  fail(`the condition rotation is ${tide.rotation.map((r) => r.weather).join()}, expected ${want.join()}`);
}
if (!(tide.rotation[0].tide < 0.2)) fail(`the first crossing should be a bajamar, got ${tide.rotation[0].tide}`);
if (!(tide.rotation[2].tide > 0.8)) fail(`the night crossing should be high water, got ${tide.rotation[2].tide}`);
if (!tide.bancos) fail("no sandbanks were placed in the channel");
if (!(tide.low > tide.mid && tide.mid > tide.high)) {
  fail(`banks do not dry out as the tide falls (${tide.low}/${tide.mid}/${tide.high} at low/mid/high)`);
}
if (tide.high !== 0) fail(`${tide.high} banks still showing at full pleamar`);
if (!tide.agroundLow) fail("did not run aground on an exposed bank at dead low water");
if (tide.agroundHigh) fail("ran aground at pleamar — that bank should be under water");
if (tide.speedLow >= tide.speedHigh) fail(`grounding did not slow her (${tide.speedLow} vs ${tide.speedHigh} px/s)`);

// ---- 2. open water: a banco de atún and its fleet ---------------------------
const sea = await page.evaluate(async () => {
  const G = window.Game;
  G.setAttract(false); G.startExplore();
  const p = G.state.p;
  p.x = 19551; p.y = 13600;                        // the gulf, south of the muelle
  G.setVehicle("panga");
  await new Promise((r) => setTimeout(r, 2500));
  const schools = G.pools().schools;
  if (!schools.length) return { n: 0 };
  const sc = schools[0];
  const before = G.state.progress.coins;
  p.x = sc.x; p.y = sc.y;                          // straight through the middle
  await new Promise((r) => setTimeout(r, 300));
  return {
    n: schools.length, r: Math.round(sc.r), fleet: sc.fleet.length,
    taken: sc.taken, coins: G.state.progress.coins - before,
    radii: sc.fleet.map((f) => Math.round(Math.hypot(f.x - sc.x, f.y - sc.y))),
  };
});
if (!sea.n) fail("no tuna schools spawned in open water");
else {
  if (sea.fleet < 2) fail("a school spawned with no fleet around it");
  if (!sea.taken || sea.coins <= 0) fail("sailing through the shoal paid nothing");
  if (sea.radii.some((r) => r < sea.r)) fail(`a panga is inside the shoal: ${sea.radii} vs r=${sea.r}`);
}

// ---- 3. the muelleros, and that they are culled ----------------------------
const muelle = await page.evaluate(async () => {
  const G = window.Game;
  const p = G.state.p;
  p.x = 19551; p.y = 12900;                        // out on the Muelle de Cruceros
  await new Promise((r) => setTimeout(r, 2000));
  const on = G.pools().pedestrians.filter((e) => e.kind === "muellero");
  const res = { n: on.length, piers: [...new Set(on.map((e) => e.pier))], sides: [...new Set(on.map((e) => e.face))] };
  p.x = 17944; p.y = 12240;                        // …and away again
  await new Promise((r) => setTimeout(r, 2500));
  res.after = G.pools().pedestrians.filter((e) => e.kind === "muellero").length;
  return res;
});
if (!muelle.n) fail("nobody is fishing off the Muelle de Cruceros");
if (muelle.sides.length < 2) fail("every muellero picked the same rail");
if (muelle.after) fail(`${muelle.after} muelleros survived driving away — the pool leaks`);

if (errors.length) fail(`${errors.length} page error(s)`);
for (const e of errors.slice(0, 6)) console.log("   " + e);

await browser.close();
if (!bad) {
  console.log(`[sea] ok — conditions ${tide.rotation.map((r) => r.weather).join("/")}; `
    + `${tide.bancos} banks (${tide.low} out at bajamar, 0 at pleamar), aground ${tide.speedLow} vs ${tide.speedHigh} px/s clear; `
    + `${sea.n} tuna schools, fleet at ${sea.radii} around r=${sea.r}; ${muelle.n} muelleros, culled on leaving`);
}
process.exit(bad ? 1 : 0);
