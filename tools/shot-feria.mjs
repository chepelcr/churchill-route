// LA FERIA, EN UNA HOJA.
//
//   node tools/shot-feria.mjs <out.png> [devUrl]
//
// Contra el servidor de DESARROLLO, como el resto de las hojas: importa el
// módulo bajo prueba directamente y el `preview` sirve el bundle.
//
// Existe porque el campo ferial era el ÚNICO catálogo de arte sin hoja, y por lo
// tanto lo único que no se podía refactorizar con prueba: sus 16 juegos son 71
// partes afinadas a mano y un cambio de un píxel no se ve en una captura del
// mundo (ahí el ruido va de 2 % a 86 %). Una hoja sintética sí.
//
// Dibuja cada juego con `paintRide`, en su propia celda, con el reloj CONGELADO
// —`t = 0` y fase 0— porque si no la rueda gira entre dos corridas y la hoja
// diffea distinta consigo misma. Ésa es también la razón de que no use la escena
// real: en el mundo cada juego lleva su fase derivada de su posición.
import { chromium } from "playwright";
import fs from "node:fs";

const out = process.argv[2];
if (!out) { console.error("usage: node tools/shot-feria.mjs <out.png> [devUrl]"); process.exit(2); }
const url = process.argv[3] || "http://localhost:8734/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });

const result = await page.evaluate(async () => {
  const att = await import("/src/render/c2d/attractions.js");
  const ASSETS = (await import("/src/render/c2d/feriaAssets.json", { with: { type: "json" } })).default;
  const kinds = Object.keys(ASSETS).filter((k) => !k.startsWith("$") && ASSETS[k].parts);

  const CELL = 200, COLS = 5, R = 62;
  const rows = Math.ceil(kinds.length / COLS);
  const cv = document.createElement("canvas");
  cv.width = COLS * CELL; cv.height = rows * CELL;
  const g = cv.getContext("2d", { willReadFrequently: true });

  if (!att.paintRide) return { error: "attractions.js does not export paintRide" };
  kinds.forEach((kind, i) => {
    const cx = (i % COLS) * CELL + CELL / 2;
    const cy = Math.floor(i / COLS) * CELL + CELL / 2;
    g.save();
    g.translate(cx, cy);
    // reloj y fase CONGELADOS: una hoja que se mueve no se puede diffear
    att.paintRide(g, kind, R, 0, 0);
    g.restore();
  });

  // cuenta la tinta, para que una hoja en blanco no diffee «idéntica» contra
  // otra hoja en blanco — ya pasó en este repo.
  const { data } = g.getImageData(0, 0, cv.width, cv.height);
  let ink = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) ink++;
  return { png: cv.toDataURL("image/png"), kinds, ink, w: cv.width, h: cv.height };
});

await browser.close();
if (errors.length) { console.error(`[feria] page errors: ${errors.join(" | ")}`); process.exit(1); }
if (result.error) { console.error(`[feria] ${result.error}`); process.exit(1); }
fs.writeFileSync(out, Buffer.from(result.png.split(",")[1], "base64"));
if (!result.ink) { console.error("[feria] FAIL — the sheet is blank"); process.exit(1); }
console.log(`[feria] ${result.kinds.length} juegos, ${result.ink} px of ink -> ${out}`);
console.log(`        ${result.kinds.join(", ")}`);
