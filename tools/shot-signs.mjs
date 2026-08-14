// EVERY SIGN KIND, DRAWN BY THE REAL PAINTER, ON ONE SHEET.
//
//   node tools/shot-signs.mjs <out.png> [devUrl]
//
// Same gate as tools/shot-vehicles.mjs and tools/shot-landmarks.mjs, for the
// same reason: turning the 10-case `switch` in c2d/streets.js into a walk over
// world-props.json is only correct if the pixels do not move, and a screenshot
// of the running world cannot show that — the measured run-to-run noise of a
// world scene with ZERO code change is 2 % to 86 % of the frame.
//
// Each kind is drawn TWICE: square to the sheet, and turned. Six of the ten read
// `s.ang`, one reads `s.side` and one reads `s.value`, so a sheet with a single
// upright copy of each would prove nothing about the half of the catalog that
// lives inside a rotation.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "signs.png";
const url = process.argv[3] || "http://localhost:8734/";
const CELL = [110, 90];
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
  const [streets, gfx, { WORLD2D }, { SIGN_KIND }] = await Promise.all([
    import("/src/render/c2d/streets.js"),
    import("/src/render/c2d/gfx.js"),
    import("/src/world2d/index.js"),
    import("/src/domain/vocabulary.generated.js"),
  ]);
  // Two rows per kind: upright, then turned — see the note at the top.
  const kinds = Object.values(SIGN_KIND);
  const variants = [{ ang: 0, side: 1, value: 40 }, { ang: 0.45, side: -1, value: 60 }];
  const cv = document.createElement("canvas");
  cv.width = cols * cell[0];
  cv.height = Math.ceil((kinds.length * variants.length) / cols) * cell[1];
  document.body.replaceChildren(cv);
  document.body.style.margin = "0";
  cv.style.width = `${cv.width}px`;
  cv.style.height = `${cv.height}px`;
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#4a4640";                       // asphalt, what a sign stands on
  g.fillRect(0, 0, cv.width, cv.height);

  // `drawSigns` culls against a view rect and reads the world's own list, so the
  // sheet IS the world for one call: same entry the game uses, no special path.
  const cells = [];
  const signs = [];
  kinds.forEach((kind, k) => variants.forEach((v, j) => {
    const i = k * variants.length + j;
    const cx = (i % cols) * cell[0] + cell[0] / 2;
    const cy = Math.floor(i / cols) * cell[1] + cell[1] / 2;
    signs.push({ kind, x: cx, y: cy, ...v });
    cells.push([kind, cx, Math.floor(i / cols) * cell[1] + cell[1] - 6]);
  }));
  const prev = WORLD2D.SIGNS;
  WORLD2D.SIGNS = signs;
  streets.drawSigns({ x0: 0, y0: 0, x1: cv.width, y1: cv.height });
  WORLD2D.SIGNS = prev;

  g.fillStyle = "#e8e2d2";
  g.font = "9px monospace";
  g.textAlign = "center";
  for (const [kind, cx, ly] of cells) g.fillText(kind, cx, ly);
  return { n: signs.length, png: cv.toDataURL("image/png").split(",")[1] };
}, [CELL, COLS]);

// Read the bitmap in the same turn it was drawn — a `page.screenshot` shows the
// running game's rAF painted over the sheet, because binding gfx's shared `ctx`
// to our canvas points the whole renderer at it.
writeFileSync(out, Buffer.from(drew.png, "base64"));
await browser.close();
if (errors.length) { console.error(`[signs] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[signs] ${drew.n} drawn -> ${out}`);
