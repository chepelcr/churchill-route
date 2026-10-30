// THE SCENE FUNCTIONS, ON ONE SHEET.
//
//   node tools/shot-scenes.mjs <out.png> [devUrl]
//
// The landmark and sign sheets cover the things drawn from a parts list. These
// are the other kind: the faro, a green space, the fountain, the pool — drawn
// by code that loops and clamps and reads world geometry. Their CONTROL FLOW is
// staying in the engine; their colours, counts and proportions are moving to
// `world-props.json` -> `scenes`, and this is how that move is proved.
//
// Two of them are animated (the fountain's ripples, the pool's shimmer) and one
// reads the shared clock, so the sheet PINS the clock with `setLastT` before
// drawing. Without that this measures a stopwatch, not a palette.
//
// Reads the bitmap in-page rather than screenshotting, for the reason
// shot-landmarks.mjs documents: binding gfx's shared ctx to our canvas also
// points the running game's rAF at it.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "scenes.png";
const url = process.argv[3] || "http://localhost:8734/";
const CELL = [260, 220];
const COLS = 3;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: COLS * CELL[0], height: 2 * CELL[1] } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });

// Wait for the self-hosted faces, or the pills are measured in a fallback and
// two runs of different warmth disagree by thousands of pixels.
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
await page.evaluate(async () => {
  await document.fonts.load("bold 10px 'JetBrains Mono'");
  await document.fonts.ready;
});

const drew = await page.evaluate(async ([cell, cols]) => {
  const [lm, gfx] = await Promise.all([
    import("/src/render/c2d/landmarks.js"),
    import("/src/render/c2d/gfx.js"),
  ]);
  const cv = document.createElement("canvas");
  cv.width = cols * cell[0];
  cv.height = 2 * cell[1];
  cv.style.width = `${cv.width}px`;
  cv.style.height = `${cv.height}px`;
  document.body.replaceChildren(cv);
  document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#cbc6ba";
  g.fillRect(0, 0, cv.width, cv.height);

  // PIN THE CLOCK. The fountain and the pool animate off `lastT`; leaving it
  // free means the sheet records whatever millisecond it was taken at.
  gfx.setLastT(12000);

  // A synthetic rim for the faro. The real one is build-emitted world geometry;
  // a fixed ellipse of points exercises the same loop deterministically.
  const rim = [];
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 2;
    rim.push([Math.cos(a) * 62, Math.sin(a) * 40]);
  }

  const at = (i) => [(i % cols) * cell[0] + cell[0] / 2, Math.floor(i / cols) * cell[1] + cell[1] / 2];
  const cells = [];

  let [x, y] = at(0);
  lm.drawFaroScene({ id: "faro", type: "lighthouse", x, y, rim: rim.map(([a, b]) => [x + a, y + b]) });
  cells.push("faro");

  [x, y] = at(1);
  lm.drawGreenSpace({ id: "p", x, y }, 170, 130, { fountain: true, ground: false });
  cells.push("greenSpace(park)");

  [x, y] = at(2);
  lm.drawGreenSpace({ id: "s", x, y }, 190, 140, { pitch: true, fountain: false });
  cells.push("greenSpace(field)");

  [x, y] = at(3);
  lm.drawFountain(x, y);
  cells.push("fountain");

  [x, y] = at(4);
  lm.drawPool(x, y, 0, 0.9, true);
  cells.push("pool");

  [x, y] = at(5);
  lm.drawPool(x, y, 0.4, 0.6, false);
  cells.push("pool(turned, no palms)");

  g.fillStyle = "#26222c";
  g.font = "11px monospace";
  g.textAlign = "center";
  cells.forEach((name, i) => {
    const [cx] = at(i);
    g.fillText(name, cx, (Math.floor(i / cols) + 1) * cell[1] - 6);
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
  return { ink, cells, png: cv.toDataURL("image/png").split(",")[1] };
}, [CELL, COLS]);

writeFileSync(out, Buffer.from(drew.png, "base64"));
// A sheet with almost no ink on it did not draw — see the note inside the page.
const MIN_INK = 2000;
if (!(drew.ink > MIN_INK)) {
  console.error(`[FAIL] the sheet is blank (${drew.ink} non-background pixels). `
    + `The modules were evaluated in the wrong order, so the art went to the game's `
    + `canvas. Restart the dev server and re-run — do NOT trust a diff of this.`);
  process.exit(1);
}
await browser.close();
if (errors.length) { console.error(`[scenes] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[scenes] ${drew.cells.length} drawn -> ${out}`);
