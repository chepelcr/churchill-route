// EVERY VEHICLE, DRAWN BY THE REAL PAINTERS, ON ONE SHEET.
//
//   node tools/shot-vehicles.mjs <out.png> [devUrl]
//
// The point is a diffable image. Phase B of the asset-catalog migration turns
// `paintVehicle`'s per-key if/else chain into a walk over `vehicles.json`
// parts, and "it still renders something" is not evidence it renders the SAME
// thing — so the sheet is taken before and after and compared pixel for pixel.
//
// It runs against the DEV server, not the build, because that is the only way
// to import the module under test directly (`/src/render/c2d/entities.js`) and
// call it with a canvas of our own. A screenshot of the game would be a
// screenshot of the camera, the weather and the clock as much as of the car.
//
// Both painters are exercised: `traceVehicleSilhouette` first as the ground
// shadow (that is what it draws in the game), then `paintVehicle` on top. A
// vehicle whose sprite is right and whose shadow is somebody else's is exactly
// the failure the split makes possible, so both belong on the sheet.
import { chromium } from "playwright";

const out = process.argv[2] || "vehicles.png";
const url = process.argv[3] || "http://localhost:5173/";
const SCALE = 5;          // a 20 px scooter is not reviewable at 20 px
const CELL = [230, 150];  // per vehicle, in CSS px

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 3 * CELL[0], height: 3 * CELL[1] } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(url, { waitUntil: "domcontentloaded" });

// WAIT FOR THE FONTS, or this measures a coin flip. The game self-hosts its
// woff2 faces (`@fontsource/*` imported by main.jsx), so a sheet drawn at
// domcontentloaded races them: whichever side of a comparison loses the race
// measures its pills in the FALLBACK monospace, at different widths and with
// different glyphs. Two servers of different warmth lose it differently — that
// is 5 724 pixels of "the art moved" that was nothing but a cold Vite.
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
await page.evaluate(async () => {
  await Promise.all([
    document.fonts.load("bold 10px 'JetBrains Mono'"),
    document.fonts.load("600 10px 'JetBrains Mono'"),
    document.fonts.load("bold 12px 'Bungee'"),
  ]);
  await document.fonts.ready;
});

const drew = await page.evaluate(async ([scale, cell]) => {
  const [{ paintVehicle }, { traceVehicleSilhouette }, { VEHICLES }] = await Promise.all([
    import("/src/render/c2d/entities.js"),
    import("/src/render/vehicleShapes.js"),
    import("/src/game/vehicles.js"),
  ]);
  const keys = Object.keys(VEHICLES);
  const cols = 3;
  const cv = document.createElement("canvas");
  cv.width = cols * cell[0];
  cv.height = Math.ceil(keys.length / cols) * cell[1];
  document.body.replaceChildren(cv);
  document.body.style.margin = "0";
  const g = cv.getContext("2d");
  g.fillStyle = "#cfb27a";                       // the land tan they stand on
  g.fillRect(0, 0, cv.width, cv.height);

  keys.forEach((key, i) => {
    const veh = VEHICLES[key];
    const cx = (i % cols) * cell[0] + cell[0] / 2;
    const cy = Math.floor(i / cols) * cell[1] + cell[1] / 2;

    g.save();
    g.translate(cx, cy);
    g.scale(scale, scale);
    g.fillStyle = "rgba(20,16,12,0.30)";         // the shadow, from the trace
    traceVehicleSilhouette(g, key, veh);
    g.fill();
    paintVehicle(g, key, veh);
    g.restore();

    g.fillStyle = "#26222c";
    g.font = "12px monospace";
    g.textAlign = "center";
    g.fillText(`${key}  ${veh.kind}/${veh.medium}  ${veh.w}x${veh.h}`, cx, cy + cell[1] / 2 - 8);
  });
  // COUNT THE INK before handing the sheet back. These harnesses draw through
  // gfx's shared `ctx`, which the game's own boot also binds — so if the modules
  // evaluate in the wrong order every draw lands on the game canvas and this one
  // comes back empty. A before/after diff of two BLANK sheets reports IDENTICAL,
  // and that was once taken as proof. So the sheet must prove it has art on it.
  const bg = g.getImageData(0, 0, 1, 1).data;
  const all = g.getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  for (let i = 0; i < all.length; i += 4) {
    if (all[i] !== bg[0] || all[i + 1] !== bg[1] || all[i + 2] !== bg[2]) ink++;
  }
  return { ink, keys };
}, [SCALE, CELL]);

await page.screenshot({ path: out });
// A sheet with almost no ink on it did not draw — see the note inside the page.
const MIN_INK = 2000;
if (!(drew.ink > MIN_INK)) {
  console.error(`[FAIL] the sheet is blank (${drew.ink} non-background pixels). `
    + `The modules were evaluated in the wrong order, so the art went to the game's `
    + `canvas. Restart the dev server and re-run — do NOT trust a diff of this.`);
  process.exit(1);
}
await browser.close();

if (errors.length) {
  console.error(`[vehicles] page errors: ${errors.join(" | ")}`);
  process.exit(1);
}
console.log(`[vehicles] ${drew.keys.length} drawn -> ${out}  (${drew.keys.join(", ")})`);
