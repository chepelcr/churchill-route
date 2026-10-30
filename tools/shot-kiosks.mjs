// LOS PUESTOS, uno al lado del otro — el arte de recogida no tenía hoja.
//
//   node tools/shot-kiosks.mjs [out.png] [devUrl]
//
// `shot-stands` dibuja las GRADERÍAS de los estadios, que es otra cosa; el
// puesto donde empieza una entrega no se podía diffear. Y es justo el que se
// acaba de partir en cinco: un puesto se parece a lo que vende, así que esta
// hoja saca los 17 kioscos del mundo con su producto debajo y un cambio de
// paleta se ve pixel a pixel contra `tools/png-diff.mjs`.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "kiosks.png";
const url = process.argv[3] || "http://localhost:8734/";
const COLS = 6, CELL = 150, ROW = 170;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: COLS * CELL, height: 3 * ROW } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
await page.evaluate(async () => { await document.fonts.ready; });
const drew = await page.evaluate(async ({ COLS, CELL, ROW }) => {
  const [lm, gfx, w2, sh, units] = await Promise.all([
    import("/src/render/c2d/landmarks.js"),
    import("/src/render/c2d/gfx.js"),
    import("/src/world2d/index.js"),
    import("/src/render/c2d/shapes.js"),
    import("/src/domain/units.js"),
  ]);
  const kiosks = w2.WORLD2D.LANDMARKS.filter((l) => l.type === "kiosk");
  const rows = Math.ceil(kiosks.length / COLS);
  const missing = [];
  const cv = document.createElement("canvas");
  cv.width = COLS * CELL; cv.height = rows * ROW;
  document.body.replaceChildren(cv); document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = "#cbc6ba"; g.fillRect(0, 0, cv.width, cv.height);
  kiosks.forEach((k, i) => {
    const cx = (i % COLS) * CELL + CELL / 2, cy = Math.floor(i / COLS) * ROW + ROW / 2 - 12;
    // SE RESUELVE COMO EN EL JUEGO Y SE PINTA CON EL MISMO INTÉRPRETE.
    // `drawLandmark` no sirve para una hoja: arranca preguntando si una PARCELA
    // es la dueña del sitio y, si lo es, dibuja sólo la pastilla del nombre —
    // correcto en el mundo, y en una hoja deja la celda vacía. Lo que esta hoja
    // tiene que probar es la ESCALERA (id -> tipo:producto -> tipo) y el arte,
    // y `landmarkProp` es esa escalera, exportada para que la herramienta no se
    // escriba una propia.
    const prop = lm.landmarkProp(k);
    if (!prop) { missing.push(k.id); return; }
    g.save();
    g.translate(cx, cy); g.scale(2.2, 2.2);
    sh.paintAt(prop.parts, 0, 0, { g, pxPerM: units.PX_PER_M, vars: lm.propVars(k, prop) });
    g.restore();
    g.fillStyle = "#26222c"; g.font = "11px monospace"; g.textAlign = "center";
    g.fillText(k.product || "—", cx, cy + 46);
    g.fillStyle = "#5a5550"; g.font = "9px monospace";
    g.fillText(k.id, cx, cy + 58);
  });
  const bg = g.getImageData(0, 0, 1, 1).data;
  const all = g.getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  for (let i = 0; i < all.length; i += 4)
    if (all[i] !== bg[0] || all[i + 1] !== bg[1] || all[i + 2] !== bg[2]) ink++;
  const products = [...new Set(kiosks.map((k) => k.product))];
  // QUÉ ARTE RESOLVIÓ CADA UNO, para que la hoja diga si dos productos cayeron
  // en el mismo registro — que es el fallo callado de una escalera con niveles.
  const art = {};
  for (const k of kiosks) {
    const p = lm.landmarkProp(k);
    art[k.product] = p ? (p.note || "").slice(0, 24) : null;
  }
  return { ink, n: kiosks.length, products, art, missing,
           png: cv.toDataURL("image/png").split(",")[1] };
}, { COLS, CELL, ROW });
await browser.close();
if (errors.length) { console.error(`[kiosks] page errors: ${errors.join(" | ")}`); process.exit(1); }
// EL GUARDA DE BLANCO. Una hoja vacía es el modo de fallo real acá: si el grafo
// de módulos del dev server quedó partido, todo importa y nada dibuja, y el
// diff diría «idéntico» sobre dos imágenes en blanco.
if (!drew.ink) { console.error("[kiosks] FAIL — la hoja salió en blanco"); process.exit(1); }
if (drew.missing.length) {
  console.error(`[kiosks] FAIL — sin arte que resuelva: ${drew.missing.join(", ")}`);
  process.exit(1);
}
// DOS PRODUCTOS QUE CAEN EN EL MISMO REGISTRO es el fallo callado de una
// escalera con niveles: se ve idéntico a que el arte no exista.
const seen = new Map();
for (const [product, note] of Object.entries(drew.art)) {
  if (seen.has(note)) {
    console.error(`[kiosks] FAIL — "${product}" y "${seen.get(note)}" resuelven al MISMO arte`);
    process.exit(1);
  }
  seen.set(note, product);
}
writeFileSync(out, Buffer.from(drew.png, "base64"));
console.log(`[kiosks] ${drew.n} puestos, ${drew.products.length} productos `
  + `(${drew.products.join(", ")}) — ${drew.ink} px con tinta -> ${out}`);
