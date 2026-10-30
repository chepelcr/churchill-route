// EL VERBO `sprite`, DIBUJADO — con un archivo de verdad.
//
//   node tools/shot-sprites.mjs <out.png> [devUrl]
//
// Existe porque un verbo probado contra un mock no está probado: el día que
// alguien ponga el primer edificio de verdad descubriría que la ruta, el ancla o
// los metros nunca funcionaron. Esto carga el PNG que `sprites.json` nombra,
// ESPERA a que llegue, y mide tres cosas que una captura sola no dice:
//
//   * que el tamaño salga de los METROS del registro por los px/m del marco, y
//     no del tamaño en píxeles de la imagen;
//   * que el ANCLA cuelgue el sprite de donde dice (un edificio, de su base);
//   * que un id roto pinte su `placeholder` en vez de dejar un hueco — un 404
//     silencioso en el arte del mundo es peor que un bloque liso.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2];
if (!out) { console.error("usage: node tools/shot-sprites.mjs <out.png> [devUrl]"); process.exit(2); }
const url = process.argv[3] || "http://localhost:8734/";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 300 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });

const res = await page.evaluate(async () => {
  const sh = await import("/src/render/c2d/shapes.js");
  const sp = await import("/src/render/c2d/sprites.js");
  const id = sp.SPRITE_NAMES[0];
  if (!id) return { error: "sprites.json has no rows, so the verb is unexercised" };

  const PX_PER_M = 2.5;                       // la escala de este build
  const cv = document.createElement("canvas");
  cv.width = 640; cv.height = 300;
  document.body.replaceChildren(cv); document.body.style.margin = "0";
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#1d2a33"; g.fillRect(0, 0, cv.width, cv.height);

  const frame = { X: (v) => v || 0, Y: (v) => v || 0, pxPerM: PX_PER_M, t: 0 };
  const paint = (parts, cx, cy) => {
    g.save(); g.translate(cx, cy);
    sh.paintParts(g, parts, frame);
    g.restore();
  };

  // 1) SIN ESPERAR: el primer cuadro tiene que mostrar el placeholder, no nada.
  paint([{ shape: "sprite", src: id, x: 0, y: 0 }], 110, 200);
  const beforeInk = (() => {
    const d = g.getImageData(70, 120, 80, 100).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] !== 0x1d || d[i + 1] !== 0x2a) n++;
    return n;
  })();

  // 2) ESPERAR de verdad a que la imagen llegue, y volver a dibujar.
  const rec = sp.spriteRecord(id);
  await new Promise((done) => {
    const img = new Image();
    img.onload = img.onerror = done;
    img.src = rec.src;
  });
  for (let i = 0; i < 40 && !sp.spriteImage(id); i++) await new Promise((r) => setTimeout(r, 25));
  const loaded = Boolean(sp.spriteImage(id));

  g.fillStyle = "#1d2a33"; g.fillRect(0, 0, cv.width, cv.height);
  // el suelo, para que se vea que el ancla cuelga de la BASE
  g.fillStyle = "#2c3d47"; g.fillRect(0, 200, cv.width, 2);
  paint([{ shape: "sprite", src: id, x: 0, y: 0 }], 110, 200);
  paint([{ shape: "sprite", src: id, x: 0, y: 0, scale: 2 }], 260, 200);
  // 3) un id que el registro NO tiene: no debe dibujar nada ni reventar
  paint([{ shape: "sprite", src: "no_existe", x: 0, y: 0, fill: "#8a3b3b" }], 420, 200);
  // 4) el mismo sprite en un marco al doble de px/m: tiene que salir al doble
  g.save(); g.translate(540, 200);
  sh.paintParts(g, [{ shape: "sprite", src: id, x: 0, y: 0 }],
    { ...frame, pxPerM: PX_PER_M * 2 });
  g.restore();

  // Medidas: el ancho de tinta de cada uno, y dónde está su base.
  const inkBox = (x0, x1) => {
    const d = g.getImageData(x0, 60, x1 - x0, 200).data;
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < x1 - x0; x++) {
        const i = (y * (x1 - x0) + x) * 4;
        const bg = d[i] === 0x1d && d[i + 1] === 0x2a && d[i + 2] === 0x33;
        const rule = d[i] === 0x2c && d[i + 1] === 0x3d;
        if (bg || rule) continue;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    return maxX < 0 ? null : { w: maxX - minX + 1, h: maxY - minY + 1, bottom: 60 + maxY };
  };
  return {
    id, loaded, beforeInk,
    one: inkBox(60, 170), two: inkBox(200, 330),
    missing: inkBox(370, 470), doubled: inkBox(480, 620),
    png: cv.toDataURL("image/png").split(",")[1],
  };
});

await browser.close();
if (errors.length) { console.error(`[sprites] page errors: ${errors.join(" | ")}`); process.exit(1); }
if (res.error) { console.error(`[sprites] ${res.error}`); process.exit(1); }
writeFileSync(out, Buffer.from(res.png, "base64"));

const { id, loaded, beforeInk, one, two, missing, doubled } = res;
console.log(`[sprites] "${id}" cargó=${loaded} · placeholder antes de cargar: ${beforeInk} px`);
console.log(`[sprites] 1x ${one && `${one.w}x${one.h}, base y=${one.bottom}`} · `
  + `2x ${two && `${two.w}x${two.h}`} · px/m x2 ${doubled && `${doubled.w}x${doubled.h}`} · `
  + `id inexistente: ${missing ? `${missing.w}x${missing.h}` : "nada"}`);

// EL PLACEHOLDER TIENE QUE PINTARSE. Un sprite que todavía no llegó no puede
// dejar un hueco: un 404 silencioso en el arte del mundo es peor que un bloque.
if (!(beforeInk > 100)) { console.error("[sprites] FAIL — el placeholder no se pintó antes de cargar"); process.exit(1); }
if (!loaded) { console.error("[sprites] FAIL — la imagen que el registro nombra no cargó"); process.exit(1); }
if (!one) { console.error("[sprites] FAIL — no dibujó nada con la imagen cargada"); process.exit(1); }
// EL TAMAÑO SALE DE LOS METROS, no del tamaño en px del PNG. 6.4 x 9.6 m a
// 2.5 px/m = 16 x 24 px, y el PNG mide 16x24 por casualidad — así que se prueba
// con `scale` y con px/m, donde una implementación que usara el tamaño natural
// de la imagen NO cambiaría.
if (Math.abs(two.w - one.w * 2) > 2) {
  console.error(`[sprites] FAIL — scale:2 dio ${two.w} px de ancho, no ${one.w * 2}`);
  process.exit(1);
}
if (Math.abs(doubled.w - one.w * 2) > 2) {
  console.error(`[sprites] FAIL — al doble de px/m dio ${doubled.w} px, no ${one.w * 2}: `
    + "el tamaño no sale de los METROS");
  process.exit(1);
}
// EL ANCLA CUELGA DE LA BASE: `anchor [0.5, 1]` pone el pie del sprite en su y.
if (Math.abs(one.bottom - 200) > 3) {
  console.error(`[sprites] FAIL — la base quedó en y=${one.bottom}, no en 200: el ancla no se respeta`);
  process.exit(1);
}
// Y un id que el registro no tiene no dibuja NADA — ni revienta, ni inventa.
if (missing) { console.error(`[sprites] FAIL — un id inexistente dibujó ${missing.w}x${missing.h}`); process.exit(1); }
console.log("[sprites] ok — el tamaño sale de los metros, el ancla de la base, y un id roto no dibuja");
