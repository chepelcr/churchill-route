// LAS SOMBRAS SIGUEN AL SOL — medido, no mirado.
//
//   node tools/smoke-shadows.mjs [devUrl]
//
// Contra el servidor de DESARROLLO: importa `daynight.js` y `shadows.js` para
// mover el reloj, y el `preview` sirve el bundle.
//
// Una captura no puede probar esto. Lo que hay que saber es que el
// desplazamiento BARRE con la hora y que su largo CRECE con la altura — que es
// lo que separa una sombra de una manchita que se desliza. Las dos cosas son
// series, no cuadros, así que se caminan.
import { chromium } from "playwright";
const url = process.argv[2] || "http://localhost:8734/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });
await page.evaluate(() => { window.Game.setAttract(false); window.Game.startExplore(); });
await page.waitForTimeout(800);

const out = await page.evaluate(async () => {
  const dn = await import("/src/game/daynight.js");
  const sh = await import("/src/render/c2d/shadows.js");
  const walk = [];
  const N = 64;
  for (let i = 0; i < N; i++) {
    dn.setDayCycle(true, i / N);
    const person = sh.sunShadow(1.7);
    const block = sh.sunShadow(16);          // una manzana de cinco plantas
    walk.push({
      u: +(i / N).toFixed(3),
      px: +person.dx.toFixed(3), py: +person.dy.toFixed(3), pa: +person.alpha.toFixed(3),
      bx: +block.dx.toFixed(3), blen: +Math.hypot(block.dx, block.dy).toFixed(3),
      plen: +Math.hypot(person.dx, person.dy).toFixed(3),
    });
  }
  // …y que la altura inferida de una huella crezca con su área.
  const heights = [
    ["caseta 6x6 m", { aabb: { x0: 0, y0: 0, x1: 15, y1: 15 }, wnd: 1 }],
    ["casa 10x10 m", { aabb: { x0: 0, y0: 0, x1: 25, y1: 25 }, wnd: 1 }],
    ["esquina 20x20 m", { aabb: { x0: 0, y0: 0, x1: 50, y1: 50 }, wnd: 1 }],
    ["mercado 70x60 m", { aabb: { x0: 0, y0: 0, x1: 175, y1: 150 }, wnd: 1 }],
    ["bodega 20x20 sin ventanas", { aabb: { x0: 0, y0: 0, x1: 50, y1: 50 }, wnd: 0 }],
  ].map(([name, b]) => [name, +sh.buildingHeightM(b).toFixed(2)]);
  return { walk, heights };
});
await browser.close();
if (errors.length) { console.error(`[shadows] page errors: ${errors.join(" | ")}`); process.exit(1); }

const xs = out.walk.map((w) => w.px);
const sweep = Math.max(...xs) - Math.min(...xs);
const plen = out.walk.map((w) => w.plen);
const blen = out.walk.map((w) => w.blen);
const ratio = Math.max(...blen) / Math.max(...plen);
const alphas = out.walk.map((w) => w.pa);
const alphaRange = Math.max(...alphas) - Math.min(...alphas);
// EL SALTO MÁS GRANDE, no el promedio: tres horas iguales y un brinco entre
// ellas promedian igual que una transición pareja.
let worst = 0;
for (let i = 1; i < out.walk.length; i++) worst = Math.max(worst, Math.abs(xs[i] - xs[i - 1]));

console.log(`[shadows] la de una persona barre ${sweep.toFixed(2)} px en el día `
  + `(paso máximo ${worst.toFixed(2)}), su alpha va ${alphaRange.toFixed(2)}`);
console.log(`[shadows] largo máximo: persona ${Math.max(...plen).toFixed(2)} px, `
  + `manzana ${Math.max(...blen).toFixed(2)} px — ${ratio.toFixed(1)}x, que es el 2.5D`);
console.log(`[shadows] alturas inferidas de la huella: `
  + out.heights.map(([n, h]) => `${n} ${h} m`).join(" · "));

// TIENE QUE BARRER. Una sombra quieta es el bug que esto vino a arreglar, y todo
// lo demás de esta prueba pasaría igual.
if (sweep < 2) { console.error(`[shadows] FAIL — sólo barre ${sweep.toFixed(2)} px: no sigue al sol`); process.exit(1); }
// …Y NO A SALTOS: el sol se mueve parejo, así que la sombra también.
if (worst > sweep / 6) { console.error(`[shadows] FAIL — paso de ${worst.toFixed(2)} px sobre un barrido de ${sweep.toFixed(2)}: brinca`); process.exit(1); }
// EL LARGO TIENE QUE CRECER CON LA ALTURA, o es una manchita que se desliza.
if (ratio < 4) { console.error(`[shadows] FAIL — una manzana tira ${ratio.toFixed(1)}x la sombra de una persona: la escena se ve plana`); process.exit(1); }
// Y una de mediodía es DURA, una de atardecer lavada.
if (alphaRange < 0.2) { console.error(`[shadows] FAIL — el alpha sólo varía ${alphaRange.toFixed(2)}`); process.exit(1); }
// La altura inferida tiene que ser MONÓTONA en el área, o la tabla está torcida.
const byArea = out.heights.slice(0, 4).map(([, h]) => h);
for (let i = 1; i < byArea.length; i++) {
  if (byArea[i] < byArea[i - 1]) {
    console.error(`[shadows] FAIL — la altura no crece con la huella: ${byArea}`);
    process.exit(1);
  }
}
