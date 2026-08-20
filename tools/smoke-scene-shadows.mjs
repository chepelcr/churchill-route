// ¿LA SOMBRA DE UNA ESCENA SIGUE AL SOL? Medido, no mirado.
//
// Dibuja la catedral con el PINTOR DE VERDAD (drawParcels) a cuatro horas y
// mide dónde cae su tinta de sombra. Resuelve la URL viva de `daynight.js`
// igual que shot-parcels resuelve la de `gfx.js`: con HMR encima, importar la
// ruta lisa acuña una SEGUNDA instancia y el reloj que se mueve no es el que
// el pintor lee.
import { chromium } from "playwright";
const url = process.argv[2] || "http://localhost:8736/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });

const out = await page.evaluate(async () => {
  const shadowsSrc = await fetch("/src/render/c2d/shadows.js").then((r) => r.text());
  const dnUrl = shadowsSrc.match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)?.[1];
  if (!dnUrl) throw new Error("could not resolve the live daynight module");
  const streetSrc = await fetch("/src/render/c2d/streets.js").then((r) => r.text());
  const gfxUrl = streetSrc.match(/from\s+["']([^"']*\/c2d\/gfx\.js[^"']*)["']/)?.[1];
  const [dn, landmarks, gfx, { WORLD2D }] = await Promise.all([
    import(dnUrl), import("/src/render/c2d/landmarks.js"), import(gfxUrl),
    import("/src/world2d/index.js"),
  ]);
  const cv = document.createElement("canvas");
  cv.width = 300; cv.height = 260;
  document.body.replaceChildren(cv);
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");

  const ANG = 0.22, HW = 68, HH = 48, cx = 150, cy = 120;
  const ca = Math.cos(ANG), sa = Math.sin(ANG), poly = [];
  for (const [u, v] of [[-HW, -HH], [HW, -HH], [HW, HH], [-HW, HH]])
    poly.push(cx + u * ca - v * sa, cy + u * sa + v * ca);
  const xs = poly.filter((_, k) => k % 2 === 0), ys = poly.filter((_, k) => k % 2 === 1);
  const P = { id: "p_cat", use: "cathedral", name: "Catedral", cx, cy, ang: ANG, hw: HW, hh: HH,
              poly, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  const prev = WORLD2D.PARCELS;
  Object.defineProperty(WORLD2D, "PARCELS", { value: [P], configurable: true });

  const rows = [];
  for (const u of [0.06, 0.25, 0.44, 0.62]) {
    dn.setDayCycle(true, u);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#cfb27a"; g.fillRect(0, 0, cv.width, cv.height);
    landmarks.drawParcels({ x0: -1e5, y0: -1e5, x1: 1e5, y1: 1e5 });
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], bb = d[i + 2];
      // the shadow ink is a neutral dark over the tan ground; stone is lighter
      if (r < 120 && Math.abs(r - gg) < 14 && Math.abs(gg - bb) < 14) {
        const px = (i / 4) % cv.width, py = Math.floor((i / 4) / cv.width);
        sx += px; sy += py; n++;
      }
    }
    rows.push({ u, sunX: +dn.sunVector().x.toFixed(3), alt: +dn.sunVector().alt.toFixed(3),
                cx: n ? +(sx / n).toFixed(1) : null, cy: n ? +(sy / n).toFixed(1) : null, px: n });
  }
  Object.defineProperty(WORLD2D, "PARCELS", { value: prev, configurable: true });
  return rows;
});
await browser.close();
if (errors.length) { console.error("[sweep] page errors:", errors.join(" | ")); process.exit(1); }
for (const r of out)
  console.log(`  u=${r.u}  sun.x=${String(r.sunX).padStart(7)} alt=${r.alt}  ink centroid (${r.cx}, ${r.cy})  ${r.px}px`);
const cxs = out.map((r) => r.cx).filter((v) => v != null);
if (cxs.length < out.length) { console.error("[sweep] FAIL — the scene drew no shadow ink at some hour"); process.exit(1); }
const sweep = Math.max(...cxs) - Math.min(...cxs);
console.log(sweep > 2
  ? `[sweep] ok — la sombra de la catedral barre ${sweep.toFixed(1)} px a lo largo del día`
  : `[sweep] FAIL — sólo barrió ${sweep.toFixed(1)} px`);
process.exit(sweep > 2 ? 0 : 1);
