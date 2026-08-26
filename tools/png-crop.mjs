// Recorta y amplía un cuadro para mirarlo de cerca. Herramienta de diagnóstico.
//   node tools/png-crop.mjs in.png out.png x y w h [zoom]
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
const [, , inPath, outPath, x, y, w, h, zoom = "3"] = process.argv;
const b64 = readFileSync(inPath).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +w * +zoom, height: +h * +zoom } });
await page.goto("about:blank");
await page.evaluate(async ([src, X, Y, W, H, Z]) => {
  const img = new Image();
  await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = `data:image/png;base64,${src}`; });
  const c = document.createElement("canvas");
  c.width = W * Z; c.height = H * Z;
  const g = c.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.drawImage(img, X, Y, W, H, 0, 0, W * Z, H * Z);
  document.body.style.margin = "0";
  document.body.appendChild(c);
}, [b64, +x, +y, +w, +h, +zoom]);
writeFileSync(outPath, await page.screenshot());
await browser.close();
console.log(`[crop] ${inPath} (${x},${y} ${w}x${h} @${zoom}x) -> ${outPath}`);
