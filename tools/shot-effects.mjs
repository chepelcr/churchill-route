// THE VEHICLE EFFECTS, ON ONE SHEET — the wake, the turn swirls, the shadow,
// the heel and the speed lines.
//
//   node tools/shot-effects.mjs <out.png> [devUrl]
//
// `shot-vehicles.mjs` draws the BODY: `paintVehicle` plus the silhouette. It
// cannot see any of this, because every effect here is painted by `drawPlayer`
// around the body from the live `state` — so moving them into a registry could
// have changed all of them and that sheet would still have reported IDENTICAL.
//
// Each cell drives one effect at a FIXED, chosen state: an angular velocity for
// the swirls and the heel, a speed for the wake, an elevation for the shadow.
// The clock is pinned with `setLastT`, because three of the five read it — this
// measures a palette and a geometry, not a stopwatch.
//
// SPEED LINES ARE EXCLUDED ON PURPOSE. They are `Math.random()` per frame, so
// two runs never agree and a diff of them means nothing; the test asserts their
// PARAMETERS instead (`tests/test_effects.py`).
//
// Reads the bitmap in-page rather than screenshotting, for the reason
// shot-landmarks.mjs documents: binding gfx's shared ctx to our canvas also
// points the running game's rAF at it.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "effects.png";
const url = process.argv[3] || "http://localhost:8734/";
const CELL = [220, 190];
const COLS = 4;
const ROWS = 2;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: COLS * CELL[0], height: ROWS * CELL[1] } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
await page.evaluate(async () => { await document.fonts.ready; });

const drew = await page.evaluate(async ([cell, cols]) => {
  const [ent, gfx, st, veh] = await Promise.all([
    import("/src/render/c2d/entities.js"),
    import("/src/render/c2d/gfx.js"),
    import("/src/game/state.js"),
    import("/src/game/vehicles.js"),
  ]);
  const cv = document.createElement("canvas");
  cv.width = cols * cell[0];
  cv.height = 2 * cell[1];
  document.body.replaceChildren(cv);
  document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#3d6f86";                 // a sea-ish ground so a white wake shows
  g.fillRect(0, 0, cv.width, cv.height);
  gfx.setLastT(12000);                     // PIN THE CLOCK — wake churn and bob read it

  // Each cell: [vehicle, angular velocity, speed, elevation, label]
  const CASES = [
    ["turbo", 0, 60, 0, "kart · still"],
    ["turbo", 2.6, 160, 0, "kart · hard left"],
    ["turbo", -3.4, 200, 0, "kart · hard right"],
    ["turbo", 0, 120, 1, "kart · on the ramp"],
    ["panga", 0, 0, 0, "panga · at rest"],
    ["panga", 0, 240, 0, "panga · making way"],
    ["panga", 1.8, 300, 0, "panga · heeled"],
    ["deslizador", -2.2, 420, 0, "deslizador · flat out"],
  ];

  const labels = [];
  CASES.forEach(([key, av, speed, elev, name], i) => {
    const cx = (i % cols) * cell[0] + cell[0] / 2;
    const cy = Math.floor(i / cols) * cell[1] + cell[1] / 2;
    // drawPlayer reads the live singleton, so the case IS the state.
    st.state.vehicleKey = key;
    st.state.elev = elev;
    st.state.carrying = null;
    ent.drawPlayer({ x: cx, y: cy, a: 0.35, av, speed }, { ...veh.VEHICLES[key] });
    labels.push(name);
  });

  g.fillStyle = "#0d1c24";
  g.font = "11px monospace";
  g.textAlign = "center";
  labels.forEach((name, i) => {
    const cx = (i % cols) * cell[0] + cell[0] / 2;
    g.fillText(name, cx, (Math.floor(i / cols) + 1) * cell[1] - 8);
  });

  // COUNT THE INK — see the note in shot-scenes.mjs. A blank sheet diffs as
  // IDENTICAL against another blank sheet, and that has been believed twice.
  const bg = g.getImageData(0, 0, 1, 1).data;
  const all = g.getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  for (let i = 0; i < all.length; i += 4) {
    if (all[i] !== bg[0] || all[i + 1] !== bg[1] || all[i + 2] !== bg[2]) ink++;
  }
  return { ink, cases: labels, png: cv.toDataURL("image/png").split(",")[1] };
}, [CELL, COLS]);

writeFileSync(out, Buffer.from(drew.png, "base64"));
const MIN_INK = 3000;
if (!(drew.ink > MIN_INK)) {
  console.error(`[FAIL] the sheet is blank (${drew.ink} non-background pixels). `
    + `Restart the dev server and re-run — do NOT trust a diff of this.`);
  process.exit(1);
}
await browser.close();
if (errors.length) { console.error(`[effects] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[effects] ${drew.cases.length} cases, ${drew.ink} px of ink -> ${out}`);
