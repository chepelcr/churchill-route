// EVERY LANDMARK TYPE, DRAWN BY THE REAL PAINTER, ON ONE SHEET.
//
//   node tools/shot-landmarks.mjs <out.png> [devUrl]
//
// Same gate as tools/shot-vehicles.mjs and for the same reason: turning the
// 26-branch `switch` in c2d/landmarks.js into a walk over world-props.json is
// only correct if the pixels do not move, and a screenshot of the running world
// cannot show that — those scenes have animated sea, traffic and a clock, and
// the measured run-to-run noise is 2 % to 86 % of the frame depending on where
// the camera is. A synthetic sheet has no animation in it at all.
//
// The three SCENE types are excluded on purpose: `lighthouse`, `stadium` and a
// marine `park` are drawn from world geometry (a footprint, a residual, a
// beam on the clock), not from the catalog, so they are not what this proves.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "landmarks.png";
const url = process.argv[3] || "http://localhost:8734/";
const SCENES = ["lighthouse", "stadium", "park"];
const CELL = [190, 130];
const COLS = 6;

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

const drew = await page.evaluate(async ([scenes, cell, cols]) => {
  const [{ drawLandmark }, gfx, { LANDMARK_TYPE }] = await Promise.all([
    import("/src/render/c2d/landmarks.js"),
    import("/src/render/c2d/gfx.js"),
    import("/src/domain/vocabulary.generated.js"),
  ]);
  const props = (await import("/src/assets/world-props.json", { with: { type: "json" } })).default;
  const types = Object.values(LANDMARK_TYPE).filter((t) => !scenes.includes(t));
  // …AND THE PLACES THAT OWN THEIR ART. `propFor` tries the landmark's ID
  // before its type, so a record keyed by an id draws one PLACE and never
  // appears on a walk over the type vocabulary — i.e. it would ship with no
  // sheet and no diff at all. Anything in the catalog that is not a type and
  // not a scene is one of those, so the sheet finds them by subtraction rather
  // than by a hand-kept list that can go stale.
  const owned = Object.keys(props.landmarks)
    .filter((k) => !types.includes(k) && !scenes.includes(k)
                   && props.landmarks[k] && props.landmarks[k].parts);
  const cells = [
    ...types.map((t) => ({ key: t, id: `t_${t}`, type: t })),
    ...owned.map((k) => ({ key: k, id: k, type: "house" })),
  ];
  const cv = document.createElement("canvas");
  cv.width = cols * cell[0];
  cv.height = Math.ceil(cells.length / cols) * cell[1];
  document.body.replaceChildren(cv);
  document.body.style.margin = "0";
  // The painters draw through gfx's shared `ctx` live binding, so bind it to
  // this canvas — that is what setupCanvas is for, and it is the same entry the
  // game uses, so nothing here is a special path.
  cv.style.width = `${cv.width}px`;
  cv.style.height = `${cv.height}px`;
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#cfb27a";
  g.fillRect(0, 0, cv.width, cv.height);

  cells.forEach((c, i) => {
    const cx = (i % cols) * cell[0] + cell[0] / 2;
    const cy = Math.floor(i / cols) * cell[1] + cell[1] / 2 + 8;
    drawLandmark({ id: c.id, type: c.type, x: cx, y: cy, name: "Hotel Tioga", w: 116, h: 90 });
    g.fillStyle = "#26222c";
    g.font = "11px monospace";
    g.textAlign = "center";
    g.fillText(c.key, cx, (Math.floor(i / cols) + 1) * cell[1] - 6);
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
  return { ink, types: cells.map((c) => c.key), png: cv.toDataURL("image/png").split(",")[1] };
}, [SCENES, CELL, COLS]);

// The canvas is read back INSIDE the page, in the same turn it was drawn.
// A `page.screenshot` cannot be used here: binding gfx's shared context to our
// canvas also points the running game's rAF loop at it, so by the time a
// screenshot is taken the sheet has the whole port painted over it. Reading the
// bitmap before yielding is the only way to capture just what we drew.
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
if (errors.length) { console.error(`[landmarks] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[landmarks] ${drew.types.length} drawn -> ${out}`);
