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
  // THE OPEN GULF, south of the Muelle Nacional's sea end.
  // Deliberately NOT a point interpolated along the lancha's route: that line
  // is only guaranteed navigable to the water flood's own ~20 px resolution,
  // so a chord midpoint can sit in the mangrove and fail this check for a
  // reason that has nothing to do with the medium. The gulf is unambiguous.
  //
  // ANCLADO EN GEO Y NO EN PÍXELES, que es la lección que este archivo ya tenía
  // escrita y volvió a cobrar. Estaba en (19551, 13800) px, y el reescalado a
  // 3.125 px/m del 2026-08-27 movió el mundo un 25 %: ese punto seguía siendo
  // agua por casualidad, pero el de tierra de abajo pasó a ser mar y la prueba
  // volvió a medir un barco en el mar contra un barco en el mar. Una lat/lon
  // sobrevive a cualquier reescalado; un píxel sólo es verdad a la escala en
  // que se escribió.
  const W = window.WORLD2D || window.Game.W;
  const gulf = W.geoToWorld(9.982269, -84.849290);
  const wx = gulf.x, wy = gulf.y, wa = 0;
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
  // right.
  //
  // Y VOLVIÓ A PASAR EN EL SIGUIENTE REESCALADO, con la coordenada de repuesto:
  // (23000, 15100) también era asfalto a 2.5 px/m y a 3.125 es mar abierto. Dos
  // veces el mismo fallo con el mismo arreglo a medias dice que el arreglo era
  // el equivocado — el sitio se ancla en GEO, y además se AFIRMA (ver abajo),
  // porque una prueba sobre un lugar tiene que afirmar el lugar.
  const city = W.geoToWorld(9.977564, -84.836707);
  const lx = city.x, ly = city.y;
  p.x = lx; p.y = ly; p.a = wa; p.vx = 0; p.vy = 0; p.speed = 0;
  const lFrom = { x: p.x, y: p.y };
  res.landTop = 0;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 300));
    res.landTop = Math.max(res.landTop, p.speed || 0);
  }
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
  res.landBlocked = Math.round(Math.hypot(p.x - lFrom.x, p.y - lFrom.y));
  // Y SE AFIRMA EL SITIO. Las dos veces que esta prueba mintió fue porque nadie
  // comprobaba QUÉ había debajo: un casco «en la ciudad» que estaba en el mar
  // se lee exactamente igual que un casco que ignora la tierra.
  res.gulfSurface = W.surfaceAt(wx, wy);
  res.citySurface = W.surfaceAt(lx, ly);
  res.gulfPx = [Math.round(wx), Math.round(wy)];
  res.cityPx = [Math.round(lx), Math.round(ly)];
  return res;
});

// SHE ONLY GOES WHERE SHE IS SENT — the three legs that keep the auto-ride out.
//
// The hull used to carry an idle floor (`hullThrottle`, 22% throttle under
// 95 px/s) so she always made way, because a boat with no way on has no
// steerage and could neither turn nor recover. True of a boat; the cost was
// that with the controls untouched she DROVE HERSELF, which is exactly what a
// player reports as "the boat auto drives". The deadlock is now paid for
// directly — `hullPivot` lets her turn on the spot the way every car in the
// game already does — so all three of these can be asserted at once:
//
//   1. hands off, she stays put;
//   2. turn alone, from a dead stop, actually points her — AND she does not
//      arc away while doing it (that is the difference between a pivot and a
//      circle, and it is the whole reason the pivot term exists);
//   3. the brake brings her to a real stop. There was no dead-stop clamp on a
//      hull, so she was always creeping somewhere nobody steered.
//
// Leg 2 is measured AGAINST A CAR in the same run rather than against a
// number, because "like the cars" is the actual requirement and a bare
// threshold would drift away from the vehicles it is supposed to match.
const feel = await page.evaluate(async () => {
  const G = window.Game;
  const p = G.state.p;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = (type, k) => window.dispatchEvent(new KeyboardEvent(type, { key: k }));
  // The open gulf again, and for the same reason as above — anclado en geo.
  const W = window.WORLD2D || window.Game.W;
  const g0 = W.geoToWorld(9.982269, -84.849290);
  const gx = g0.x, gy = g0.y;
  const put = () => { p.x = gx; p.y = gy; p.a = 0; p.vx = 0; p.vy = 0; p.speed = 0; };
  const res = {};

  put();
  await wait(3000);
  res.driftPx = Math.round(Math.hypot(p.x - gx, p.y - gy));

  const pivot = async () => {
    put();
    key("keydown", "a");
    await wait(2000);
    key("keyup", "a");
    return { deg: Math.abs(p.a) * 180 / Math.PI,
             movedPx: Math.round(Math.hypot(p.x - gx, p.y - gy)) };
  };
  const hull = await pivot();
  res.pivotDeg = Math.round(hull.deg);
  res.pivotMovedPx = hull.movedPx;

  put();
  key("keydown", "w");
  await wait(2500);
  key("keyup", "w");
  res.beforeBrake = Math.round(p.speed || 0);
  key("keydown", " ");
  await wait(3000);
  key("keyup", " ");
  res.afterBrake = Math.round(Math.hypot(p.vx, p.vy));

  // …and the same two seconds in a CAR, on the same water, so the comparison is
  // of the two turn models and nothing else. It is a wall for her, which is
  // fine: a pivot in place needs no room.
  G.setVehicle("pickup");
  const car = await pivot();
  res.carPivotDeg = Math.round(car.deg);
  G.setVehicle("deslizador");
  return res;
});

if (feel.driftPx > 24) {
  fail(`hands off the controls she travelled ${feel.driftPx} px in 3 s — something is `
    + `driving her (idle thrust? bank assist pushing instead of braking?)`);
}
if (feel.pivotDeg < 120) {
  fail(`turning from a dead stop she came round only ${feel.pivotDeg}° in 2 s — `
    + `she cannot point herself, which is the deadlock \`hullPivot\` exists to break`);
}
if (feel.pivotDeg < feel.carPivotDeg * 0.5) {
  fail(`she pivots at ${feel.pivotDeg}°/2s against a pickup's ${feel.carPivotDeg}° — `
    + `the hull is supposed to turn LIKE the cars, not a fraction of them`);
}
if (feel.pivotMovedPx > 40) {
  fail(`pivoting she also travelled ${feel.pivotMovedPx} px — that is a circle, not a pivot`);
}
if (feel.afterBrake > 12) {
  fail(`3 s on the brake from ${feel.beforeBrake} px/s left her still making `
    + `${feel.afterBrake} px/s — the dead-stop clamp is not reaching a hull`);
}

// PRIMERO EL SITIO, Y ANTES QUE NADA. Las dos veces que esta prueba mintió fue
// aquí: la coordenada «de la ciudad» era mar, así que la pata de «la tierra es
// pared» comparaba mar contra mar y salía verde. Un fallo de SITIO se reporta
// como lo que es —un mundo que cambió debajo— y no como una regresión del casco.
// 0 water … 3 road, 6 acera, 10 malecon.
if (out.gulfSurface !== 0) {
  fail(`the "open gulf" anchor is surface ${out.gulfSurface} at ${out.gulfPx}, not water `
     + `— the water leg would be measuring a hull on land`);
}
if (out.citySurface === 0) {
  fail(`the "downtown" anchor is WATER at ${out.cityPx} — this is the exact stale-place `
     + `failure this file already documents twice; re-anchor it, do not retune the hull`);
}
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
  console.log(`[boat] ok — hands off she drifted ${feel.driftPx} px; pivots ${feel.pivotDeg}°/2s `
    + `(a pickup: ${feel.carPivotDeg}°) without leaving her own ${feel.pivotMovedPx} px; `
    + `brakes from ${feel.beforeBrake} to ${feel.afterBrake} px/s`);
}
process.exit(bad ? 1 : 0);
