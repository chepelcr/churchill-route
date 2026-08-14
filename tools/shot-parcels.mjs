// EVERY PARCEL USE — GROUND AND WHAT STANDS ON IT — ON ONE SHEET.
//
//   node tools/shot-parcels.mjs <out.png> [devUrl]
//
// A parcel is drawn in TWO passes that live in two files: `paintParcels`
// (c2d/streets.js) lays the ground between the acera band and the asphalt, and
// `drawParcels` (c2d/landmarks.js) adds the building, the civic furniture and
// the name pill. Both run here, in that order, so the sheet is what the player
// sees on a block.
//
// EVERY CELL IS TURNED. The cuadrícula is not square to the screen and half the
// bugs this art has ever had were a `strokeRect` off the axis-aligned bbox, so a
// sheet of upright parcels would be a sheet that cannot see them. `ang` is
// non-zero everywhere and `hw`/`hh` are the emitted half-extents.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "parcels.png";
const url = process.argv[3] || "http://localhost:8734/";
const CELL = [190, 160];
const COLS = 5;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: COLS * CELL[0], height: 4 * CELL[1] } });
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

const drew = await page.evaluate(async ([cell, cols]) => {
  const [streets, landmarks, gfx, { WORLD2D }, { PARCEL_USE }] = await Promise.all([
    import("/src/render/c2d/streets.js"),
    import("/src/render/c2d/landmarks.js"),
    import("/src/render/c2d/gfx.js"),
    import("/src/world2d/index.js"),
    import("/src/domain/vocabulary.generated.js"),
  ]);
  // Every use, then the civic furniture the WORLD declares on a parcel — a
  // river, a kiosco, a statue, a paradita — which is dispatch of its own.
  const cases = [
    ...Object.values(PARCEL_USE).map((use) => [use, {}]),
    ["park+river", { use: "park", river: true }],
    ["park+kiosco", { use: "park", kiosco: true }],
    ["garden+statue", { use: "garden", statue: true }],
    ["lot+bus", { use: "lot", bus: true }],
  ];
  // The sponsor plate is deliberately absent: `content.lotes` is a getter over
  // remote content and cannot be faked from here, and `drawSponsorSlot` sizes
  // its font by a clamp on the world's own slot — it is not catalog art.
  const cv = document.createElement("canvas");
  cv.width = cols * cell[0];
  cv.height = Math.ceil(cases.length / cols) * cell[1];
  document.body.replaceChildren(cv);
  document.body.style.margin = "0";
  cv.style.width = `${cv.width}px`;
  cv.style.height = `${cv.height}px`;
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#cfb27a";
  g.fillRect(0, 0, cv.width, cv.height);

  const ANG = 0.22, HW = 68, HH = 48;
  const parcels = [];
  const labels = [];
  cases.forEach(([name, over], i) => {
    const cx = (i % cols) * cell[0] + cell[0] / 2;
    const cy = Math.floor(i / cols) * cell[1] + cell[1] / 2 - 6;
    const ca = Math.cos(ANG), sa = Math.sin(ANG);
    const poly = [];
    for (const [u, v] of [[-HW, -HH], [HW, -HH], [HW, HH], [-HW, HH]])
      poly.push(cx + u * ca - v * sa, cy + u * sa + v * ca);
    const xs = poly.filter((_, k) => k % 2 === 0), ys = poly.filter((_, k) => k % 2 === 1);
    const P = {
      id: `p_${i}`, use: over.use || name, name: `Parcela ${i}`,
      cx, cy, ang: ANG, hw: HW, hh: HH, poly,
      x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
    };
    if (over.river) P.river = true;
    if (over.kiosco) P.kiosco = true;
    if (over.statue) P.statue = "virgen";
    if (over.bus) P.bus = [cx - 18, cy + HH - 6, 34, 12];
    parcels.push(P);
    labels.push([name, cx, Math.floor(i / cols) * cell[1] + cell[1] - 6]);
  });

  const prev = WORLD2D.PARCELS;
  WORLD2D.PARCELS = parcels;
  const view = { x0: 0, y0: 0, x1: cv.width, y1: cv.height };
  streets.paintParcels(view);
  landmarks.drawParcels(view);
  WORLD2D.PARCELS = prev;

  g.fillStyle = "#26222c";
  g.font = "10px monospace";
  g.textAlign = "center";
  for (const [name, cx, ly] of labels) g.fillText(name, cx, ly);
  return { n: parcels.length, png: cv.toDataURL("image/png").split(",")[1] };
}, [CELL, COLS]);

// Read the bitmap in the same turn it was drawn — see tools/shot-landmarks.mjs.
writeFileSync(out, Buffer.from(drew.png, "base64"));
await browser.close();
if (errors.length) { console.error(`[parcels] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[parcels] ${drew.n} drawn -> ${out}`);
