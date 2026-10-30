// Does the stadium painter apply a height-scaled solar shadow to the emitted
// stand quad, on Lito Perez's requested NORTH side (negative world Y)?
//
//   node tools/smoke-stand-shadow.mjs [devUrl]
//
// This is a mechanism measurement, not a screenshot hunch: it instruments the
// real Canvas context and records the translation used by drawStadium at four
// hours. The shared sun answer is south-positive today, so the stadium scene
// keeps its east/west sweep, length and alpha but mirrors world Y northward.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8736/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 360, height: 280 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });

const rows = await page.evaluate(async () => {
  const landmarksUrl = new URL("/src/render/c2d/landmarks.js", location.href);
  const landmarksSrc = await fetch(landmarksUrl).then((r) => r.text());
  const gfxUrl = landmarksSrc.match(/from\s+["']([^"']*\/c2d\/gfx\.js[^"']*)["']/)?.[1];
  const liveShadowsUrl = landmarksSrc.match(/from\s+["']([^"']*\/c2d\/shadows\.js[^"']*)["']/)?.[1];
  if (!gfxUrl || !liveShadowsUrl) throw new Error("could not resolve live renderer modules");
  const shadowsUrl = new URL(liveShadowsUrl, landmarksUrl);
  const shadowsSrc = await fetch(shadowsUrl).then((r) => r.text());
  const solarSpec = shadowsSrc.match(/from\s+["']([^"']*\/render\/sun\.js[^"']*)["']/)?.[1];
  if (!solarSpec) throw new Error("could not resolve the live solar module");
  const solarUrl = new URL(solarSpec, shadowsUrl);
  const solarSrc = await fetch(solarUrl).then((r) => r.text());
  const dnSpec = solarSrc.match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)?.[1];
  if (!dnSpec) throw new Error("could not resolve the live daynight module");
  const [dn, shadows, landmarks, gfx] = await Promise.all([
    import(new URL(dnSpec, solarUrl).href),
    import(shadowsUrl.href),
    import(landmarksUrl.href),
    import(new URL(gfxUrl, landmarksUrl).href),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = 360; canvas.height = 280;
  document.body.replaceChildren(canvas);
  gfx.setupCanvas(canvas);
  const g = canvas.getContext("2d");
  const calls = [];
  const nativeTranslate = CanvasRenderingContext2D.prototype.translate;
  CanvasRenderingContext2D.prototype.translate = function measuredTranslate(x, y) {
    if (this === g) calls.push([x, y]);
    return nativeTranslate.call(this, x, y);
  };

  // One emitted north-side trapezoid. No towers: every recorded displacement
  // matching the solar vector comes from the stand painter itself.
  const lm = {
    id: "stand_shadow_probe", name: "Probe", type: "stadium", x: 180, y: 150,
    footprint: [60, 90, 300, 90, 300, 220, 60, 220],
    stands: {
      quads: [[90, 90, 270, 90, 266, 102, 94, 102]],
      palette: { tierA: "#f08020", tierB: "#a84a18", structure: "#503018" },
    },
  };
  const out = [];
  try {
    for (const u of [0.06, 0.25, 0.44, 0.62]) {
      dn.setDayCycle(true, u);
      calls.length = 0;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      landmarks.drawStadium(lm);
      const raw = shadows.sunShadow(6);
      const expectedY = -Math.abs(raw.dy);
      const applied = calls.find(([x, y]) =>
        Math.abs(x - raw.dx) < 1e-6 && Math.abs(y - expectedY) < 1e-6);
      out.push({
        u,
        sunX: +dn.sunVector().x.toFixed(3),
        rawDx: +raw.dx.toFixed(2), rawDy: +raw.dy.toFixed(2),
        appliedDx: applied ? +applied[0].toFixed(2) : null,
        appliedDy: applied ? +applied[1].toFixed(2) : null,
        extent: applied ? +Math.hypot(applied[0], applied[1]).toFixed(2) : null,
      });
    }
  } finally {
    CanvasRenderingContext2D.prototype.translate = nativeTranslate;
  }
  return out;
});
await browser.close();

if (errors.length) {
  console.error(`[stand-shadow] page errors: ${errors.join(" | ")}`);
  process.exit(1);
}
for (const row of rows) {
  console.log(`  u=${row.u} sun.x=${String(row.sunX).padStart(6)} `
    + `shared=(${row.rawDx}, ${row.rawDy})px `
    + `stand=(${row.appliedDx}, ${row.appliedDy})px extent=${row.extent}px`);
}
const ok = rows.every((row) => row.rawDy > 0 && row.appliedDy < 0
  && row.appliedDx === row.rawDx && row.extent > 0);
const eastWestSweep = Math.max(...rows.map((row) => row.appliedDx))
  - Math.min(...rows.map((row) => row.appliedDx));
if (!ok || eastWestSweep < 2) {
  console.error("[stand-shadow] FAIL — no measured northward, solar-sweeping stand shadow");
  process.exit(1);
}
console.log(`[stand-shadow] ok — negative Y (north), ${eastWestSweep.toFixed(2)}px east/west sweep`);
