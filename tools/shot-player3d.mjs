// LA HOJA DE LOS VEHÍCULOS DEL JUGADOR EN 3D, con su chofer: los nueve, en dos rumbos, alrededor de
// la cámara para que se vean costados distintos.
//   node tools/shot-player3d.mjs <out.png> http://localhost:8736/
// Contra un SERVIDOR FRESCO, como toda hoja que importa módulos fuente.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "player3d.png";
const url = process.argv[3] || "http://localhost:8736/";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1200, height: 520 } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
const res = await page.evaluate(async () => {
  const [ent, gfx, st, veh] = await Promise.all([import("/src/render/c2d/entities.js"), import("/src/render/c2d/gfx.js"),
    import("/src/game/state.js"), import("/src/game/vehicles.js")]);
  const cv = document.createElement("canvas"); cv.width = 1200; cv.height = 520;
  document.body.replaceChildren(cv); document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = "#6b6470"; g.fillRect(0, 0, 1200, 520);
  const Z = 4; g.setTransform(Z, 0, 0, Z, 0, 0);
  st.state.cam.x = 150; st.state.cam.y = 65; st.state.cam.rot = 0; st.state.carrying = null;
  const keys = Object.keys(veh.VEHICLES);
  keys.forEach((key, i) => {
    st.state.vehicleKey = key;
    for (const [row, a] of [[0, 0], [1, -Math.PI / 2]]) {
      ent.drawPlayer({ x: 18 + i * 33, y: 28 + row * 70, a, vx: 0, vy: 0, speed: 0 }, veh.VEHICLES[key]);
    }
  });
  return cv.toDataURL("image/png").split(",")[1];
});
writeFileSync(out, Buffer.from(res, "base64"));
await b.close();
if (errors.length) { console.error(errors.join(" | ")); process.exit(1); }
console.log(`[player3d] ${out}`);
