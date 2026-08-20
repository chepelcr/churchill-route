// THE WHOLE FLORA CATALOG, ON ONE DETERMINISTIC SHEET.
//
//   node tools/shot-flora.mjs <out.png> [devUrl]
//
// This was the pixel-identical flora-v2 transcription gate and is now the
// regional catalog sheet. It discovers every species and every woodland/
// mangrove mix from JSON; three stable variants exercise seed, palm sway and
// tide without ever restarting the persistent Vite server.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const out = process.argv[2] || "flora.png";
const url = process.argv[3] || "http://localhost:8734/";
const CELL_W = 154;
const CELL_H = 126;
const COLS = 6;
const registry = JSON.parse(readFileSync(
  new URL("../src/assets/flora.json", import.meta.url), "utf8",
));
const speciesCount = Object.keys(registry.species).filter((id) => !id.startsWith("_")).length;
const mixCount = [registry.mixes, registry.mangroveMixes]
  .flatMap((group) => Object.keys(group || {}).filter((id) => !id.startsWith("_"))).length;
const SPECIES_ROWS = Math.ceil(speciesCount / 2);
const ROWS = SPECIES_ROWS + Math.ceil(mixCount / 3);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: CELL_W * COLS, height: CELL_H * ROWS },
});
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
await page.evaluate(async () => {
  await document.fonts.load("bold 10px 'JetBrains Mono'");
  await document.fonts.ready;
});

const result = await page.evaluate(async ({ cellW, cellH, cols, rows }) => {
  const floraSource = await fetch("/src/render/c2d/flora.js").then((r) => r.text());
  const gfxUrl = floraSource.match(/from\s+["']([^"']*\/c2d\/gfx\.js[^"']*)["']/)?.[1];
  if (!gfxUrl) throw new Error("shot-flora could not resolve flora.js's live gfx module");
  const [gfx, floraShapes, floraDoc, effectsDoc] = await Promise.all([
    import(gfxUrl),
    import("/src/render/c2d/floraShapes.js"),
    import("/src/assets/flora.json", { with: { type: "json" } }),
    import("/src/assets/effects.json", { with: { type: "json" } }),
  ]);
  const documentFlora = floraDoc.default;
  const fixture = effectsDoc.default.assetPreview;
  const cv = document.createElement("canvas");
  cv.width = cellW * cols;
  cv.height = cellH * rows;
  document.body.replaceChildren(cv);
  document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = fixture.sheetBackground;
  g.fillRect(0, 0, cv.width, cv.height);
  g.font = "bold 10px 'JetBrains Mono', monospace";
  g.textAlign = "center";
  g.textBaseline = "alphabetic";

  const at = (col, row) => ({
    x: col * cellW + cellW / 2,
    y: row * cellH + cellH - 23,
  });
  const label = (text, col, row) => {
    g.fillStyle = fixture.sheetLabel;
    g.fillText(text, col * cellW + cellW / 2, (row + 1) * cellH - 7);
  };

  const solar = {
    sun: { x: 0.76, y: 0.44, alt: 0.72 },
    model: effectsDoc.default.sunShadow,
  };
  const paintSpecies = (id, x, y, scale, variant) => {
    const speciesRecord = documentFlora.species[id];
    const form = documentFlora.forms[speciesRecord.form];
    const frame = {
      x, y, s: scale, seed: 0.137 + variant * 0.337,
      solar, showShadow: true, tMs: 0,
    };
    if (form.generator === "frond-ring" || form.generator === "fan-ring") {
      frame.phase = [-Math.PI / 2, Math.PI / 2, 0][variant % 3];
    }
    if (form.generator === "tidal-root-crown") {
      frame.tide = [0.05, 0.5, 0.95][variant % 3];
      frame.radius = speciesRecord.r * scale;
      frame.shadowModel = effectsDoc.default.sunShadow;
    }
    floraShapes.paintFloraSpecies(g, speciesRecord, form, frame);
  };

  const species = Object.keys(documentFlora.species).filter((id) => !id.startsWith("_"));
  let cell = 0;
  for (const id of species) {
    const row = Math.floor(cell / 2);
    const side = cell % 2;
    for (let seedIndex = 0; seedIndex < 3; seedIndex++) {
      const col = side * 3 + seedIndex;
      const p = at(col, row);
      paintSpecies(id, p.x + seedIndex * 0.37, p.y - seedIndex * 0.29, 1, seedIndex);
      label(`${id} · ${seedIndex + 1}`, col, row);
    }
    cell += 1;
  }

  // One deterministic miniature patch per woodland and mangrove mix. Placement
  // is a fixture and never becomes world authority.
  const mixes = [
    ...Object.entries(documentFlora.mixes)
      .filter(([id]) => !id.startsWith("_")).map(([id, mix]) => ["mixes", id, mix]),
    ...Object.entries(documentFlora.mangroveMixes)
      .filter(([id]) => !id.startsWith("_")).map(([id, mix]) => ["mangroveMixes", id, mix]),
  ];
  for (let mixIndex = 0; mixIndex < mixes.length; mixIndex++) {
    const [family, mixId, mix] = mixes[mixIndex];
    const col0 = (mixIndex % 3) * 2;
    const row = Math.ceil(species.length / 2) + Math.floor(mixIndex / 3);
    const weights = mix.weights;
    for (let i = 0; i < 5; i++) {
      const total = weights.reduce((sum, pair) => sum + pair[1], 0);
      let roll = ((i * 0.371 + mixIndex * 0.193) % 1) * total;
      let id = weights.at(-1)[0];
      for (const [candidate, weight] of weights) {
        roll -= weight;
        if (roll <= 0) { id = candidate; break; }
      }
      const x = col0 * cellW + 22 + i * 27;
      const y = row * cellH + cellH - 25 - (i % 2) * 7;
      paintSpecies(id, x, y, 0.58 + (i % 3) * 0.08, i % 3);
    }
    if (mix.floor) {
      g.fillStyle = mix.floor;
      g.fillRect(col0 * cellW + 7, row * cellH + 8, cellW * 2 - 14, 9);
    }
    label(`${family === "mixes" ? "bosque" : "manglar"} · ${mixId}`, col0, row);
  }

  const bg = g.getImageData(0, 0, 1, 1).data;
  const all = g.getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  for (let i = 0; i < all.length; i += 4) {
    if (all[i] !== bg[0] || all[i + 1] !== bg[1] || all[i + 2] !== bg[2]) ink += 1;
  }
  return {
    ink,
    species: species.length,
    mixes: mixes.length,
    png: cv.toDataURL("image/png").split(",")[1],
  };
}, { cellW: CELL_W, cellH: CELL_H, cols: COLS, rows: ROWS });

writeFileSync(out, Buffer.from(result.png, "base64"));
await browser.close();
if (errors.length) {
  console.error(`[flora] page errors: ${errors.join(" | ")}`);
  process.exit(1);
}
if (!(result.ink > 8000)) {
  console.error(`[FAIL] flora sheet is blank or incomplete (${result.ink} ink pixels)`);
  process.exit(1);
}
console.log(`[flora] ${result.species} species + ${result.mixes} mixes -> ${out}`);
