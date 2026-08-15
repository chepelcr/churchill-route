// LA GRADERÍA, sobre el contorno real de cada estadio.
//
//   node tools/shot-stands.mjs <out.png> [devUrl]
//
// Draws both stadiums' footprints at their real shape with the stand fitted to
// the named side. The footprints are the BUILD's — 4 points for Lito Pérez, 5
// for Las Playitas, neither square to the screen — because a stand that only
// looks right on a rectangle is the bug this is drawn to avoid.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "stands.png";
const url = process.argv[3] || "http://localhost:8734/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 420 } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
await page.evaluate(async () => { await document.fonts.ready; });
const drew = await page.evaluate(async () => {
  const [lm, gfx, w2] = await Promise.all([
    import("/src/render/c2d/landmarks.js"),
    import("/src/render/c2d/gfx.js"),
    import("/src/world2d/index.js"),
  ]);
  const cv = document.createElement("canvas");
  cv.width = 900; cv.height = 420;
  document.body.replaceChildren(cv); document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#cbc6ba"; g.fillRect(0, 0, cv.width, cv.height);
  const stadiums = w2.WORLD2D.LANDMARKS.filter((l) => l.type === "stadium");
  const cells = [];
  stadiums.forEach((st, i) => {
    const pts = st.footprint;
    const xs = pts.filter((_, k) => k % 2 === 0), ys = pts.filter((_, k) => k % 2 === 1);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const wpx = Math.max(...xs) - x0, hpx = Math.max(...ys) - y0;
    const s = Math.min(360 / wpx, 300 / hpx);
    g.save();
    g.translate(40 + i * 440, 50);
    g.scale(s, s);
    g.translate(-x0, -y0);
    // the pitch, so the stand reads against something
    g.fillStyle = "#4f9d5b";
    g.beginPath(); g.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
    g.closePath(); g.fill();
    lm.drawLandmark(st);
    g.restore();
    cells.push(st.id);
  });
  g.fillStyle = "#26222c"; g.font = "12px monospace"; g.textAlign = "center";
  cells.forEach((id, i) => g.fillText(id, 40 + i * 440 + 180, 400));
  const bg = g.getImageData(0, 0, 1, 1).data;
  const all = g.getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  for (let i = 0; i < all.length; i += 4)
    if (all[i] !== bg[0] || all[i + 1] !== bg[1] || all[i + 2] !== bg[2]) ink++;
  return { ink, cells, png: cv.toDataURL("image/png").split(",")[1] };
});
writeFileSync(out, Buffer.from(drew.png, "base64"));
if (!(drew.ink > 3000)) { console.error(`[FAIL] blank sheet (${drew.ink} px)`); process.exit(1); }
await browser.close();
if (errors.length) { console.error(`[stands] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[stands] ${drew.cells.join(", ")} — ${drew.ink} px of ink -> ${out}`);
