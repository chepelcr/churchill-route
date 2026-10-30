// LA NOCHE, MEDIDA.
//
//   node tools/smoke-night.mjs [url]
//
// El alumbrado público es la única cosa de este juego cuyo costo escala con
// CUÁNTAS hay: miles de postes, cada uno un pozo de luz compuesto sobre el
// cuadro. Así que la cobertura no se da por buena, se mide — y si el número no
// da, baja a vías principales.
//
// Dos cosas que esta prueba tiene que hacer bien o no prueba nada:
//
//   * **forzar la noche de verdad.** El modo decide el clima, así que un smoke
//     que sólo maneja mide el camino de día — el que no cambió.
//   * **comparar contra el MISMO mundo de día.** Un número de cuadros por
//     segundo suelto no dice nada: lo que importa es lo que la noche CUESTA de
//     más, en la misma escena y con la misma cámara.
import { chromium } from "playwright";
const url = process.argv[2] || "http://localhost:8799/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });

// Arrancar una corrida para que haya mundo bajo la cámara.
await page.evaluate(() => window.Game.setAttract(false));
await page.waitForTimeout(500);

async function measure(weather) {
  // EL CLIMA SE PIDE AL ARRANCAR. `updateDayCycle` reescribe `state.weather` en
  // cada tick desde el reloj del día, así que escribirlo a mano dura UN cuadro
  // y la medición termina siendo del clima que el reloj quiso — verde por la
  // razón equivocada, que es la trampa que este repo ya documenta.
  await page.evaluate((w) => window.Game.startExplore({ weather: w }), weather);
  // …y ESPERAR a que pegue, no muestrear una vez: el arranque de una corrida
  // toca `state` en varios pasos, así que una lectura inmediata a veces cae
  // antes del último. Una medición de un clima que no está puesto no vale.
  await page.waitForFunction((w) => window.Game.state.weather === w, weather,
                             { timeout: 5000 });
  await page.waitForTimeout(700);                    // deja asentar el streaming
  return page.evaluate(() => new Promise((resolve) => {
    const N = 90;
    let n = 0;
    const t0 = performance.now();
    const tick = () => {
      if (++n >= N) return resolve({ ms: (performance.now() - t0) / N });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
}

// CALENTAR PRIMERO. La primera medición cayó en 50 ms/cuadro y la segunda en
// 25: no era el clima, era el streaming de tiles y la compilación JIT. Medir
// sin calentar mide el arranque.
await measure("sunny");
await measure("night");
// …y después INTERCALAR. Una medición de día seguida de una de noche compara
// dos momentos distintos tanto como dos climas; alternando, la deriva se
// reparte entre los dos en vez de sumarse a uno.
const days = [], nights = [];
for (let i = 0; i < 3; i++) {
  days.push((await measure("sunny")).ms);
  nights.push((await measure("night")).ms);
}
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const day = { ms: median(days) }, night = { ms: median(nights) };
// ¿DE VERDAD ALUMBRAN? Medir milisegundos prueba que el camino corre, no que
// haga algo. Un pozo de luz tiene que dejar el cuadro MÁS CLARO donde cae, así
// que se compara el brillo del cuadro de noche contra el del tinte plano: si
// las lámparas no perforan nada, los dos números son el mismo.
const bright = await page.evaluate(async () => {
  const cv = document.querySelector("canvas");
  const g = cv.getContext("2d");
  const px = g.getImageData(0, 0, cv.width, cv.height).data;
  let sum = 0, max = 0, n = 0;
  // Muestreo cada 16 píxeles: el promedio de un millón y el de sesenta mil son
  // el mismo número y uno cuesta la mitad de un cuadro.
  for (let i = 0; i < px.length; i += 4 * 16) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    sum += l; if (l > max) max = l; n++;
  }
  return { mean: sum / n, max };
});

const lamps = await page.evaluate(() => {
  const W = window.Game.world || window.WORLD2D;
  const c = window.Game.state.cam;
  const view = { x0: c.x - 700, x1: c.x + 700, y0: c.y - 400, y1: c.y + 400 };
  return W?.lampsIn ? W.lampsIn(view, 65).length : -1;
});
await browser.close();

if (errors.length) {
  console.error(`[night] page errors: ${errors.join(" | ")}`);
  process.exit(1);
}
const cost = night.ms - day.ms;
console.log(`[night] ${lamps} lámparas en vista | día ${day.ms.toFixed(2)} ms/cuadro, `
  + `noche ${night.ms.toFixed(2)} ms/cuadro (+${cost.toFixed(2)} ms) | `
  + `brillo medio ${bright.mean.toFixed(1)}, pico ${bright.max.toFixed(0)}`);
if (lamps > 0 && bright.max < bright.mean * 2) {
  console.error(`[night] FAIL — hay ${lamps} lámparas y el cuadro no tiene un solo `
    + `punto claro (pico ${bright.max.toFixed(0)} contra media ${bright.mean.toFixed(1)}): `
    + 'los pozos no están perforando nada');
  process.exit(1);
}
// 16.7 ms es el presupuesto entero de un cuadro a 60 Hz. Que el ALUMBRADO se
// coma más de un tercio de eso es la señal de bajar la cobertura, y es una
// decisión que se toma con el número y no de antemano.
if (cost > 5.5) {
  console.error(`[night] FAIL — el alumbrado cuesta ${cost.toFixed(2)} ms/cuadro`);
  process.exit(1);
}
