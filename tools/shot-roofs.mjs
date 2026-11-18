// LOS TECHOS DE LOS EDIFICIOS DE OSM EN UNA HOJA, con el pintor de verdad.
//
//   node tools/shot-roofs.mjs <out.png> [devUrl]
//
// Cada huella con nombre se levanta como un cuerpo (`structures.js → paintBuildingsInView`) y su
// techo sale de su FORMA (`building-styles.json → body3d`). Esta hoja pone un caso por regla, con la
// cámara en el centro para que cada uno se incline hacia afuera:
//   fila 1 — alargada (dos aguas), cuadrada (cuatro aguas en punta), casi cuadrada (cuatro aguas),
//            un templo (`roofKind: gable`), un banco (`roofKind: flat`);
//   fila 2 — una L (azotea: no se parece a su rectángulo), una grande (azotea: pasa de `maxAreaM2`),
//            una de seis vértices casi rectangular (inclinado);
//   fila 3 — dos que se PISAN (la menor se encoge), una ANIDADA (se descarta) y una fila de tres que
//            se TOCAN (se inclinan como un grupo, con la pared común a la par).
// Como las otras hojas que importan módulos fuente, va contra un SERVIDOR FRESCO.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "roofs.png";
const url = process.argv[3] || "http://localhost:8734/";
const W = 960, H = 720;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });

const drew = await page.evaluate(async ([w, h]) => {
  const [structures, gfx, bodies, { state }] = await Promise.all([
    import("/src/render/c2d/structures.js"),
    import("/src/render/c2d/gfx.js"),
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
  g.fillStyle = "#d8c49a";                       // tierra de manzana
  g.fillRect(0, 0, w, h);

  let id = 900000001;
  const bld = (pts, extra = {}) => {
    const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
    return { pts, osmId: id++, name: extra.name || "x", cat: extra.cat, color: extra.color || "#e8d9bd",
      roof: extra.roof || "#8a6a4a", wnd: extra.wnd ?? 1,
      aabb: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } };
  };
  const rect = (x, y, rw, rh) => [x, y, x + rw, y, x + rw, y + rh, x, y + rh];
  const list = [
    // fila 1
    bld(rect(40, 50, 120, 50)),                                        // alargada → dos aguas
    bld(rect(220, 40, 70, 70), { color: "#cfe3d4" }),                   // cuadrada → cuatro aguas en punta
    bld(rect(350, 40, 95, 75), { color: "#f2d7c4" }),                   // casi cuadrada → cuatro aguas
    bld(rect(510, 30, 70, 120), { cat: "amenity=place_of_worship" }),   // templo → dos aguas
    bld(rect(650, 40, 140, 90), { cat: "amenity=bank" }),               // banco → azotea
    // fila 2
    bld([40, 250, 190, 250, 190, 300, 100, 300, 100, 380, 40, 380], { color: "#e3d3b6" }),   // L → azotea
    bld(rect(260, 230, 260, 170), { color: "#d9dde3", wnd: 0 }),        // grande → azotea
    bld([600, 240, 720, 240, 740, 270, 720, 300, 600, 300, 590, 270], { color: "#f0e2a8" }), // seis vértices
    // fila 3
    bld(rect(40, 500, 140, 110), { color: "#e8d9bd" }),                 // la mayor del par
    bld(rect(172, 560, 90, 90), { color: "#bcd8e8" }),                  // la que la pisa → se encoge
    bld(rect(320, 480, 160, 160), { color: "#e3d3b6" }),
    bld(rect(360, 520, 60, 60), { color: "#ff3d80" }),                  // anidada → se descarta
    bld(rect(560, 520, 80, 110), { color: "#f2d7c4" }),                 // la fila que se toca
    bld(rect(640, 520, 80, 110), { color: "#cfe3d4" }),
    bld(rect(720, 520, 110, 110), { color: "#e8d9bd" }),
  ];
  const cam = { x: state.cam.x, y: state.cam.y };
  state.cam.x = w / 2; state.cam.y = h / 2;
  structures.paintBuildingsInView(list, list);
  bodies.flushBodies();
  state.cam.x = cam.x; state.cam.y = cam.y;

  const bg = g.getImageData(0, 0, 1, 1).data;
  const all = g.getImageData(0, 0, w, h).data;
  let ink = 0;
  for (let i = 0; i < all.length; i += 4) {
    if (all[i] !== bg[0] || all[i + 1] !== bg[1] || all[i + 2] !== bg[2]) ink++;
  }
  // la anidada no puede verse: su rosa no aparece en ningún píxel
  let pink = 0;
  for (let i = 0; i < all.length; i += 4) if (all[i] > 240 && all[i + 1] < 80 && all[i + 2] > 100) pink++;
  return { ink, pink, png: cv.toDataURL("image/png").split(",")[1] };
}, [W, H]);

writeFileSync(out, Buffer.from(drew.png, "base64"));
await browser.close();
if (!(drew.ink > 5000)) {
  console.error(`[FAIL] the sheet is blank (${drew.ink} non-background pixels). Restart the dev server `
    + `and re-run — do NOT trust a diff of this.`);
  process.exit(1);
}
if (drew.pink > 0) {
  console.error(`[FAIL] la huella anidada se pintó (${drew.pink} px de su rosa): el descarte no corrió.`);
  process.exit(1);
}
if (errors.length) { console.error(`[roofs] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[roofs] ${out}`);
