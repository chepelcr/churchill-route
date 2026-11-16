// LA HOJA DEL TRÁFICO EN 3D: carro, camión y bus, cada uno en cuatro rumbos y alrededor de la
// cámara (así se ven costados distintos), ampliados para leer el modelo de cajas.
//   node tools/shot-traffic3d.mjs <out.png> http://localhost:8736/
// Contra un SERVIDOR FRESCO, como toda hoja que importa módulos fuente.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "traffic3d.png";
const url = process.argv[3] || "http://localhost:8736/";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 960, height: 640 } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
const res = await page.evaluate(async () => {
  const [ent, gfx, st] = await Promise.all([import("/src/render/c2d/entities.js"), import("/src/render/c2d/gfx.js"), import("/src/game/state.js")]);
  const cv = document.createElement("canvas"); cv.width = 960; cv.height = 640;
  document.body.replaceChildren(cv); document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#3d3644"; g.fillRect(0, 0, 960, 640);
  const Z = 4;
  g.setTransform(Z, 0, 0, Z, 0, 0);
  st.state.cam.x = 120; st.state.cam.y = 80; st.state.cam.rot = 0;
  const kinds = [["car", "#d4483c", 23, 12], ["truck", "#2f8f6b", 30, 13], ["bus", "#3a7bd5", 41, 14]];
  kinds.forEach(([kind, color, w, h], row) => {
    [0, Math.PI / 2, Math.PI, -Math.PI / 4].forEach((ang, col) => {
      ent.drawCar({ x: 25 + col * 60, y: 22 + row * 50, ang, color, w, h, kind });
    });
  });
  return cv.toDataURL("image/png").split(",")[1];
});
writeFileSync(out, Buffer.from(res, "base64"));
await b.close();
if (errors.length) { console.error(errors.join(" | ")); process.exit(1); }
console.log(`[traffic3d] ${out}`);
