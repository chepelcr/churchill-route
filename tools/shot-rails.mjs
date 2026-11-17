// EL FERROCARRIL EN UNA HOJA: la vía y el tren, con el pintor de verdad.
//
//   node tools/shot-rails.mjs <out.png> [devUrl]
//
// Mismo portón que `shot-signs.mjs`: una escena del mundo tiene un piso de ruido del 2 % al 86 %, así
// que la migración de las medidas de la vía a METROS y su paso a 3D se prueban acá, píxel a píxel. La
// cámara se para en el centro de la hoja, así que lo que se levanta se corre hacia afuera de ella:
// tres tramos (recto, en diagonal y en curva) y un tren de tres coches sobre el recto.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "rails.png";
const url = process.argv[3] || "http://localhost:8734/";
const W = 640, H = 420;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });

const drew = await page.evaluate(async ([w, h]) => {
  const [streets, gfx, entities, bodies, { state }] = await Promise.all([
    import("/src/render/c2d/streets.js"),
    import("/src/render/c2d/gfx.js"),
    import("/src/render/c2d/entities.js"),
    import("/src/render/c2d/bodies.js"),
    import("/src/game/state.js"),
  ]);
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  document.body.replaceChildren(cv);
  document.body.style.margin = "0";
  cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#c9b48a";                       // tierra, que es por donde va la vía
  g.fillRect(0, 0, w, h);

  const curve = [];
  for (let i = 0; i <= 24; i++) {
    const a = Math.PI * (0.05 + 0.4 * i / 24);
    curve.push(Math.round(w - 40 - Math.cos(a) * 260), Math.round(h - 20 - Math.sin(a) * 260));
  }
  const rails = [
    { pts: [30, 90, w - 30, 90] },
    { pts: [40, h - 30, 300, 150] },
    { pts: curve },
  ];
  const cam = { x: state.cam.x, y: state.cam.y };
  state.cam.x = w / 2; state.cam.y = h / 2;
  const view = { x0: 0, y0: 0, x1: w, y1: h };
  streets.paintTileRails(rails, view);
  const train = { x: 300, y: 90, cars: [0, 1, 2].map((k) => ({ x: 360 - k * 38, y: 90, ang: 0 })) };
  entities.drawTrain(train, 0);
  bodies.flushBodies();
  state.cam.x = cam.x; state.cam.y = cam.y;

  const bg = g.getImageData(0, 0, 1, 1).data;
  const all = g.getImageData(0, 0, w, h).data;
  let ink = 0;
  for (let i = 0; i < all.length; i += 4) {
    if (all[i] !== bg[0] || all[i + 1] !== bg[1] || all[i + 2] !== bg[2]) ink++;
  }
  return { ink, png: cv.toDataURL("image/png").split(",")[1] };
}, [W, H]);

writeFileSync(out, Buffer.from(drew.png, "base64"));
if (!(drew.ink > 2000)) {
  console.error(`[FAIL] the sheet is blank (${drew.ink} non-background pixels). Restart the dev server `
    + `and re-run — do NOT trust a diff of this.`);
  process.exit(1);
}
await browser.close();
if (errors.length) { console.error(`[rails] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[rails] ${out}`);
