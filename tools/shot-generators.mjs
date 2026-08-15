// LOS VERBOS GENERADORES, dibujados.
//
//   node tools/shot-generators.mjs <out.png> [devUrl]
//
// `scatter`, `orbit` and `arcs` exist so an algorithmic drawing can be a parts
// list without arithmetic in JSON. This draws each one from a synthetic record,
// which is the only way to know a generator does what its name says before a
// catalog depends on it.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "generators.png";
const url = process.argv[3] || "http://localhost:8734/";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 760, height: 280 } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
const drew = await page.evaluate(async () => {
  const [sh, gfx] = await Promise.all([
    import("/src/render/c2d/shapes.js"), import("/src/render/c2d/gfx.js")]);
  const cv = document.createElement("canvas");
  cv.width = 760; cv.height = 280;
  document.body.replaceChildren(cv); document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#20496b"; g.fillRect(0, 0, cv.width, cv.height);

  const CASES = [
    ["scatter (a shoal)", [
      { shape: "scatter", n: 40, rx: 80, ry: 58, rotate: true, scaleVar: 0.4, seed: 3,
        parts: [{ shape: "roundRect", fill: "#eefaff", x: -4, y: -1, w: 8, h: 2, r: 1 }] },
    ]],
    ["orbit + face (turning)", [
      { shape: "orbit", n: 16, r: 62, face: true, seed: 1,
        parts: [{ shape: "roundRect", fill: "#9be6ff", x: -5, y: -1.5, w: 10, h: 3, r: 1.5 }] },
    ]],
    ["arcs (a broken rim)", [
      { shape: "arcs", stroke: "rgba(255,255,255,0.85)", n: 7, r: 66, width: 3,
        span: 0.09, spanVar: 0.06, rVar: 0.16, seed: 2 },
    ]],
  ];
  const labels = [];
  CASES.forEach(([name, parts], i) => {
    const cx = 130 + i * 250, cy = 120;
    g.save(); g.translate(cx, cy);
    sh.paintParts(g, parts, { X: (v) => v || 0, Y: (v) => v || 0, t: 0 });
    g.restore();
    labels.push([name, cx]);
  });
  g.fillStyle = "#dff2ff"; g.font = "12px monospace"; g.textAlign = "center";
  labels.forEach(([n, cx]) => g.fillText(n, cx, 250));
  const bg = g.getImageData(0, 0, 1, 1).data;
  const all = g.getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  for (let i = 0; i < all.length; i += 4)
    if (all[i] !== bg[0] || all[i + 1] !== bg[1] || all[i + 2] !== bg[2]) ink++;
  return { ink, png: cv.toDataURL("image/png").split(",")[1] };
});
writeFileSync(out, Buffer.from(drew.png, "base64"));
if (!(drew.ink > 2000)) { console.error(`[FAIL] blank (${drew.ink} px)`); process.exit(1); }
await b.close();
if (errors.length) { console.error(`[generators] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[generators] 3 verbs, ${drew.ink} px of ink -> ${out}`);
