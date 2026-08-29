// ¿EL RELIEVE DIBUJA DONDE HAY LADERA Y CALLA DONDE NO? Medido, no mirado.
//
// Esta capa es la más fácil de creer rota, y por una razón escrita en su propio
// archivo: **el arenal es plano de verdad**. Quien la pruebe en el Paseo o en el
// Centro no va a ver nada y va a concluir que no funciona. Así que la prueba
// afirma las DOS mitades — que no dibuja en la península y que sí dibuja tierra
// adentro — y además que el sombreado SIGUE AL SOL, que es lo que separa un
// relieve de una mancha fija.
//
// Corre contra un servidor FRESCO porque importa módulos fuente por su ruta: con
// HMR encima, `import("/src/…")` acuña una SEGUNDA instancia y el mundo que tiene
// los tiles no es el que responde. Se resuelve la URL VIVA de `relief.js` desde
// el fuente de `world.js`, que es el patrón que ya usan `shot-parcels` y
// `smoke-scene-shadows`.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8736/";
// La península, plana de verdad: el faro está a 2,49 m y el tile del Centro
// varía 2,15 m de punta a punta.
const LLANO = [29500, 18800];
// El punto más empinado del este, el mismo que busca `smoke:grade`: ese tile
// va de 81,5 a 229 m.
const CERRO = [73200, 8600];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });

const out = await page.evaluate(async ([llano, cerro]) => {
  const worldJsUrl = new URL("/src/render/c2d/world.js", location.href);
  const worldJsSrc = await fetch(worldJsUrl).then((r) => r.text());
  const reliefSpec = worldJsSrc.match(/from\s+["']([^"']*\/c2d\/relief\.js[^"']*)["']/)?.[1];
  if (!reliefSpec) throw new Error("no se pudo resolver el módulo vivo del relieve");
  const reliefUrl = new URL(reliefSpec, worldJsUrl);
  const reliefSrc = await fetch(reliefUrl).then((r) => r.text());
  const dnSpec = reliefSrc.match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)?.[1];
  const wSpec = reliefSrc.match(/from\s+["']([^"']*\/world2d\/index\.js[^"']*)["']/)?.[1];
  if (!dnSpec || !wSpec) throw new Error("no se pudieron resolver las dependencias vivas");
  const [relief, dn, { WORLD2D }] = await Promise.all([
    import(reliefUrl.href),
    import(new URL(dnSpec, reliefUrl).href),
    import(new URL(wSpec, reliefUrl).href),
  ]);

  const G = window.Game;
  G.setAttract(false);
  G.startExplore();
  // EN PAUSA. La cámara tiene dos dueños que la escriben cada cuadro y
  // `W.update(cam)` evicta todo tile a más de cinco de ella, así que sin pausar
  // el lazo se lleva por delante los tiles que este `await` acaba de traer.
  G.state.paused = true;

  const SIDE = 320;
  const cv = document.createElement("canvas");
  cv.width = cv.height = SIDE;
  const g = cv.getContext("2d");

  async function measure([x, y], hour) {
    G.state.cam.x = x; G.state.cam.y = y;
    WORLD2D.update(x, y);
    await WORLD2D.ready(x, y, 1600, 1000);
    await new Promise((r) => setTimeout(r, 1200));
    dn.setDayCycle(true, hour);
    const half = 900;                       // px de mundo a cada lado
    const view = { x0: x - half, y0: y - half, x1: x + half, y1: y + half };
    const k = SIDE / (half * 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SIDE, SIDE);
    g.setTransform(k, 0, 0, k, -view.x0 * k, -view.y0 * k);
    relief.paintRelief(g, view);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const px = g.getImageData(0, 0, SIDE, SIDE).data;
    let painted = 0, sum = 0, leftInk = 0, rightInk = 0;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (!a) continue;
      painted++; sum += a;
      // ¿de qué lado del cuadro está la tinta CLARA? Es lo que tiene que
      // cambiar cuando el sol cruza el cielo.
      const col = ((i / 4) % SIDE);
      const bright = px[i] > px[i + 2];      // la tinta al sol es cálida
      if (bright) (col < SIDE / 2 ? leftInk++ : rightInk++);
    }
    return { painted, meanAlpha: painted ? sum / painted : 0, leftInk, rightInk };
  }

  const llanoRes = await measure(llano, 0.25);
  const cerroAm = await measure(cerro, 0.15);
  const cerroPm = await measure(cerro, 0.38);
  return { llano: llanoRes, cerroAm, cerroPm, total: SIDE * SIDE };
}, [LLANO, CERRO]);

await browser.close();
if (errors.length) {
  console.error("[relief] page errors:", errors.join(" | "));
  process.exit(1);
}
const pct = (n) => `${((n / out.total) * 100).toFixed(1)} %`;
console.log(`[relief] península  ${out.llano.painted} px pintados (${pct(out.llano.painted)})`);
console.log(`[relief] cerro AM   ${out.cerro_am ?? out.cerroAm.painted} px (${pct(out.cerroAm.painted)})  `
  + `alfa medio ${out.cerroAm.meanAlpha.toFixed(1)}  claro izq/der ${out.cerroAm.leftInk}/${out.cerroAm.rightInk}`);
console.log(`[relief] cerro PM   ${out.cerroPm.painted} px (${pct(out.cerroPm.painted)})  `
  + `alfa medio ${out.cerroPm.meanAlpha.toFixed(1)}  claro izq/der ${out.cerroPm.leftInk}/${out.cerroPm.rightInk}`);

// LA PENÍNSULA NO SE SOMBREA. No es que "casi no se note": el tile entero se
// descarta por su rango, así que tiene que salir en CERO. Si un día sale con
// tinta, alguien bajó `minTileReliefM` sin medir lo que cuesta.
if (out.llano.painted !== 0) {
  console.error(`[relief] FAIL — la península salió sombreada (${out.llano.painted} px). `
    + `Es plana de verdad (2,15 m de rango en todo el tile): esto es la `
    + `interpolación entre curvas del IGN, y cuesta 2,3 ms de cuadro por dibujarla.`);
  process.exit(1);
}
// …Y EL CERRO SÍ. Sin esta mitad, "no pinta nada" pasaría la prueba.
if (out.cerroAm.painted < out.total * 0.2) {
  console.error(`[relief] FAIL — el cerro casi no se sombreó (${pct(out.cerroAm.painted)}) `
    + `y ese tile va de 81,5 a 229 m. O no llegó la cota, o el umbral se pasó de alto.`);
  process.exit(1);
}
// LA LADERA AL SOL CAMBIA DE LADO. Es lo que separa un relieve de una textura
// fija: por la mañana el sol viene del este y por la tarde del oeste, así que la
// mitad iluminada tiene que cruzar el cuadro.
const am = out.cerroAm.leftInk / Math.max(1, out.cerroAm.leftInk + out.cerroAm.rightInk);
const pm = out.cerroPm.leftInk / Math.max(1, out.cerroPm.leftInk + out.cerroPm.rightInk);
console.log(`[relief] fracción de luz a la izquierda: mañana ${am.toFixed(2)} · tarde ${pm.toFixed(2)}`);
if (Math.abs(am - pm) < 0.05) {
  console.error(`[relief] FAIL — la ladera iluminada no se movió entre la mañana y la tarde `
    + `(${am.toFixed(2)} vs ${pm.toFixed(2)}): el sombreado no está leyendo el sol.`);
  process.exit(1);
}
console.log("[relief] ok — la península queda lisa, el cerro se sombrea y la luz cruza con el día");
