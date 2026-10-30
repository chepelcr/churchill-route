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
  // Resolve the LIVE import chain, including Vite's HMR query. Importing a
  // clean daynight path after an edit can mint a second `cycle`; the smoke then
  // moves one clock while shadows read another and reports a frozen sun.
  const shadowsUrl = new URL("/src/render/c2d/shadows.js", location.href);
  const shadowsSource = await fetch(shadowsUrl).then((r) => r.text());
  const solarSpec = shadowsSource.match(/from\s+["']([^"']*\/render\/sun\.js[^"']*)["']/)?.[1];
  if (!solarSpec) throw new Error("smoke-shadows could not resolve shadows.js's live solar module");
  const solarUrl = new URL(solarSpec, shadowsUrl);
  const solarSource = await fetch(solarUrl).then((r) => r.text());
  const daySpec = solarSource.match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)?.[1];
  if (!daySpec) throw new Error("smoke-shadows could not resolve sun.js's live daynight module");
  const [dn, sh, solar] = await Promise.all([
    import(new URL(daySpec, solarUrl).href),
    import(shadowsUrl.href),
    import(solarUrl.href),
  ]);
  const model = (await fetch("/src/assets/effects.json").then((r) => r.json())).sunShadow;
  const pxPerM = window.WORLD2D.PX_PER_M;
  const walk = [];
  let exactComponents = 0, componentChecks = 0, maxProjectionError = 0;
  let maxElevationFieldError = 0;
  const contractKeys = Object.keys(solar.sunDirection3({ x: 0, y: 0.55, alt: 1 }));
  const N = 64;
  for (let i = 0; i < N; i++) {
    dn.setDayCycle(true, i / N);
    const oldSun = dn.sunVector();
    const direction = solar.sunDirection3(oldSun);
    maxElevationFieldError = Math.max(maxElevationFieldError, Math.abs(
      direction.elevationRad - Math.atan2(direction.z, Math.hypot(direction.x, direction.y)),
    ));
    const person = sh.sunShadow(1.7);
    const block = sh.sunShadow(16);          // una manzana de cinco plantas
    const legacy = (heightM) => {
      // THE OLD BODY OF sunShadow, verbatim in operation order. This is not a
      // second runtime authority: it only lives inside the migration gate and
      // proves that moving the formula changed zero existing components.
      const reach = heightM * pxPerM * (model.reachAtNoon + (1 - oldSun.alt)
        * (model.reachAtDusk - model.reachAtNoon));
      return {
        dx: oldSun.x * reach,
        dy: oldSun.y * reach * model.squashY,
        alpha: model.alphaAtDusk
          + oldSun.alt * (model.alphaAtNoon - model.alphaAtDusk),
      };
    };
    for (const [heightM, actual] of [[1.7, person], [16, block]]) {
      const before = legacy(heightM);
      for (const key of ["dx", "dy", "alpha"]) {
        componentChecks++;
        if (Object.is(actual[key], before[key])) exactComponents++;
      }
      const hPx = heightM * pxPerM;
      maxProjectionError = Math.max(maxProjectionError,
        Math.abs(actual.dx - (-direction.x / direction.z) * hPx),
        Math.abs(actual.dy - (direction.y / direction.z) * hPx));
    }
    walk.push({
      u: +(i / N).toFixed(3),
      px: +person.dx.toFixed(3), py: +person.dy.toFixed(3), pa: +person.alpha.toFixed(3),
      bx: +block.dx.toFixed(3), blen: +Math.hypot(block.dx, block.dy).toFixed(3),
      plen: +Math.hypot(person.dx, person.dy).toFixed(3),
    });
  }
  const elevationAt = (u) => {
    dn.setDayCycle(true, u);
    const direction = solar.sunDirection3();
    return {
      deg: direction.elevationRad * 180 / Math.PI,
      length: Math.hypot(direction.x, direction.y, direction.z),
      reach: direction.reach,
    };
  };
  const angles = { noon: elevationAt(0.25), low: elevationAt(0.5) };
  // …y que la altura inferida de una huella crezca con su área.
  const heights = [
    ["caseta 6x6 m", { aabb: { x0: 0, y0: 0, x1: 15, y1: 15 }, wnd: 1 }],
    ["casa 10x10 m", { aabb: { x0: 0, y0: 0, x1: 25, y1: 25 }, wnd: 1 }],
    ["esquina 20x20 m", { aabb: { x0: 0, y0: 0, x1: 50, y1: 50 }, wnd: 1 }],
    ["mercado 70x60 m", { aabb: { x0: 0, y0: 0, x1: 175, y1: 150 }, wnd: 1 }],
    ["bodega 20x20 sin ventanas", { aabb: { x0: 0, y0: 0, x1: 50, y1: 50 }, wnd: 0 }],
  ].map(([name, b]) => [name, +sh.buildingHeightM(b).toFixed(2)]);
  return { walk, heights, exactComponents, componentChecks, maxProjectionError,
    maxElevationFieldError, contractKeys, angles };
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
console.log(`[shadows] autoridad compartida: ${out.exactComponents}/${out.componentChecks} componentes `
  + `2-D exactos; error máximo de proyección 3-D ${out.maxProjectionError.toExponential(2)}`);
console.log(`[shadows] elevación derivada del arte: mediodía ${out.angles.noon.deg.toFixed(4)}° · `
  + `sol bajo ${out.angles.low.deg.toFixed(4)}° (reach ${out.angles.low.reach.toFixed(4)})`);

// TIENE QUE BARRER. Una sombra quieta es el bug que esto vino a arreglar, y todo
// lo demás de esta prueba pasaría igual.
if (sweep < 2) { console.error(`[shadows] FAIL — sólo barre ${sweep.toFixed(2)} px: no sigue al sol`); process.exit(1); }
// …Y NO A SALTOS: el sol se mueve parejo, así que la sombra también.
if (worst > sweep / 6) { console.error(`[shadows] FAIL — paso de ${worst.toFixed(2)} px sobre un barrido de ${sweep.toFixed(2)}: brinca`); process.exit(1); }
// EL LARGO TIENE QUE CRECER CON LA ALTURA, o es una manchita que se desliza.
if (ratio < 4) { console.error(`[shadows] FAIL — una manzana tira ${ratio.toFixed(1)}x la sombra de una persona: la escena se ve plana`); process.exit(1); }
// Y una de mediodía es DURA, una de atardecer lavada.
if (alphaRange < 0.2) { console.error(`[shadows] FAIL — el alpha sólo varía ${alphaRange.toFixed(2)}`); process.exit(1); }
// THE MIGRATION IS ZERO-DRIFT. Approximate equality is not enough here: the
// helper deliberately preserves the legacy multiplication order, so every
// existing Canvas component must be the same IEEE-754 value.
if (out.exactComponents !== out.componentChecks) {
  console.error(`[shadows] FAIL — sólo ${out.exactComponents}/${out.componentChecks} componentes `
    + `siguen siendo exactamente los del arte 2-D`);
  process.exit(1);
}
if (out.maxProjectionError > 1e-12) {
  console.error(`[shadows] FAIL — la proyección del rayo 3-D se aparta `
    + `${out.maxProjectionError} px de Canvas`);
  process.exit(1);
}
const SOLAR_CONTRACT = ["x", "y", "z", "reach", "shadowAlpha", "elevationRad"];
if (JSON.stringify(out.contractKeys) !== JSON.stringify(SOLAR_CONTRACT)) {
  console.error(`[shadows] FAIL — contrato sunDirection3 ${JSON.stringify(out.contractKeys)}; `
    + `se esperaba ${JSON.stringify(SOLAR_CONTRACT)}`);
  process.exit(1);
}
if (out.maxElevationFieldError > 1e-15) {
  console.error(`[shadows] FAIL — elevationRad se aparta del rayo por `
    + `${out.maxElevationFieldError} rad`);
  process.exit(1);
}
const NOON_ELEVATION_DEG = 86.48759163527296;
const LOW_ELEVATION_DEG = 48.86119707180319;
if (Math.abs(out.angles.noon.deg - NOON_ELEVATION_DEG) > 1e-9
    || Math.abs(out.angles.low.deg - LOW_ELEVATION_DEG) > 1e-9) {
  console.error(`[shadows] FAIL — ángulos solares ${out.angles.noon.deg}, ${out.angles.low.deg}; `
    + `se esperaban ${NOON_ELEVATION_DEG}, ${LOW_ELEVATION_DEG}`);
  process.exit(1);
}
if (Math.abs(out.angles.noon.length - 1) > 1e-12
    || Math.abs(out.angles.low.length - 1) > 1e-12) {
  console.error("[shadows] FAIL — sunDirection3 no devuelve un vector unitario");
  process.exit(1);
}
// La altura inferida tiene que ser MONÓTONA en el área, o la tabla está torcida.
const byArea = out.heights.slice(0, 4).map(([, h]) => h);
for (let i = 1; i < byArea.length; i++) {
  if (byArea[i] < byArea[i - 1]) {
    console.error(`[shadows] FAIL — la altura no crece con la huella: ${byArea}`);
    process.exit(1);
  }
}
