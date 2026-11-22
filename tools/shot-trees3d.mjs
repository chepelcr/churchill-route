// LA HOJA DE LOS ÁRBOLES EN 3D: cada especie con copa cenital, sembrada alrededor de la cámara (así
// el pinhole la levanta hacia lados y largos distintos), a media tarde y de noche.
//   node tools/shot-trees3d.mjs <out.png> http://localhost:8736/ [especie,especie…] [zoom]
// Con especies, sólo ésas (repetidas hasta llenar la hoja, así se ven en varios lugares respecto de la
// cámara) y al zoom pedido: para mirar una de cerca.
// Contra un SERVIDOR FRESCO, como toda hoja que importa módulos fuente.
//
// Lo que tiene que verse: el tronco asoma del lado del CENTRO (como la pared de un edificio), la copa
// es un domo y no una pila de discos, la sombra sale del PIE hacia el mismo lado en todas, y la
// mitad de abajo —la noche— no tiene ni una sombra.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "trees3d.png";
const url = process.argv[3] || "http://localhost:8736/";
const only = process.argv[4] ? process.argv[4].split(",") : null;
const zoom = +process.argv[5] || 2;
const W_PX = 1200, H_PX = 900;
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: W_PX, height: H_PX } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.WORLD2D && window.Game?.state, null, { timeout: 60000 });
const res = await page.evaluate(async ({ W_PX, H_PX, only, zoom }) => {
  const [flora, gfx, st, dn, floraDoc, effectsDoc] = await Promise.all([
    import("/src/render/c2d/flora.js"), import("/src/render/c2d/gfx.js"), import("/src/game/state.js"),
    import("/src/game/daynight.js"),
    import("/src/assets/flora.json", { with: { type: "json" } }),
    import("/src/assets/effects.json", { with: { type: "json" } }),
  ]);
  const F = floraDoc.default, T = effectsDoc.default.flora25.topdown;
  let ids = Object.keys(F.species).filter((id) => !id.startsWith("_")
    && T.byGenerator[F.forms[F.species[id].form]?.generator]);
  if (only) { ids = []; for (let k = 0; k < 8; k++) ids.push(...only); }
  const cv = document.createElement("canvas"); cv.width = W_PX; cv.height = H_PX;
  document.body.replaceChildren(cv); document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  const Z = zoom, panelH = H_PX / 2, cols = only ? 4 : 8, rows = Math.ceil(ids.length / cols);
  const cellW = W_PX / Z / cols, cellH = panelH / Z / rows;
  // dos paneles: la tarde (u = 0,36 — el sol bajando al oeste) y la noche
  [[0.36, "#c9ad74"], [0.74, "#3a3f4c"]].forEach(([u, bg], panel) => {
    dn.setDayCycle(true, u);
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = bg; g.fillRect(0, panel * panelH, W_PX, panelH);
    g.setTransform(Z, 0, 0, Z, 0, panel * panelH);
    // la cámara al centro del panel: cada árbol queda a otra distancia y rumbo de ella
    st.state.cam.x = W_PX / Z / 2; st.state.cam.y = panelH / Z / 2; st.state.cam.rot = 0;
    flora.beginFloraBatch();
    ids.forEach((id, i) => {
      const x = (i % cols + 0.5) * cellW, y = (Math.floor(i / cols) + 0.62) * cellH;
      const sp = F.species[id];
      if (F.forms[sp.form].generator === "frond-ring" || F.forms[sp.form].generator === "fan-ring") flora.paintPalm({ x, y, k: id, s: 1, sway: 0 }, null);
      // un mangle se pinta del tamaño de un árbol de su mata (`flora.json → mangroveClump`), como en el estero
      else if (F.forms[sp.form].generator === "tidal-root-crown") flora.paintTree({ x, y, k: id, s: (F.mangroveClump?.crownM || 4) * window.WORLD2D.PX_PER_M / sp.r });
      else flora.paintTree({ x, y, k: id, s: 1 });
    });
    flora.endFloraBatch();
  });
  return cv.toDataURL("image/png").split(",")[1];
}, { W_PX, H_PX, only, zoom });
writeFileSync(out, Buffer.from(res, "base64"));
await b.close();
if (errors.length) { console.error(errors.join(" | ")); process.exit(1); }
console.log(`[trees3d] ${out}`);
