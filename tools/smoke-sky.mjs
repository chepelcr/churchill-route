// EL CIELO, RECORRIDO.
//
//   node tools/smoke-sky.mjs [devUrl]
//
// Contra el servidor de DESARROLLO (:8734) y no el `preview`: importa
// `daynight.js` y `gfx.js` directamente para mover el reloj, y el preview sirve
// el bundle — ahí `/src/...` no existe. Es la misma razón por la que las hojas
// de arte usan el dev server.
//
// El día era CUATRO ESTADOS y ahora es un continuo, y esa diferencia no se ve
// en una captura: se ve caminando el reloj. Esta prueba lo camina y mide lo que
// de verdad importa — que el color del cielo CAMBIE de a poco en vez de saltar.
//
// Dos cosas que tiene que hacer bien o no prueba nada:
//
//   * **pedir el reloj al arrancar.** `startExplore()` sin `weather` prende el
//     ciclo; con `weather` lo apaga. Escribir `state.weather` a mano dura un
//     cuadro, que es la trampa que este repo ya documenta dos veces.
//   * **medir el SALTO más grande, no el promedio.** Un promedio suave esconde
//     exactamente el defecto que se está buscando: tres horas idénticas y un
//     brinco entre ellas promedian igual que una transición pareja.
import { chromium } from "playwright";
const url = process.argv[2] || "http://localhost:8734/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });
await page.evaluate(() => { window.Game.setAttract(false); window.Game.startExplore(); });
await page.waitForTimeout(1200);

// Camina el día en pasos, leyendo la paleta mezclada en cada uno. Se mueve el
// RELOJ y no el clima: es la única forma de ver la transición, que es justamente
// lo que un cambio de estado no tiene.
const walk = await page.evaluate(async () => {
  const dn = await import("/src/game/daynight.js");
  const gfx = await import("/src/render/c2d/gfx.js");
  const out = [];
  // SUFICIENTEMENTE FINO PARA DISTINGUIR UNA RAMPA DE UN INTERRUPTOR, y ése es
  // todo el criterio. La mezcla más grande del día —atardecer a noche, 159
  // unidades de color— dura 37 s de un día de 600. A 48 muestras caían 2.9 en
  // esa ventana y cada paso medía 54: parecía un brinco y era el muestreo. A 480
  // caen 29 y el paso propio de una rampa es ~5,5, mientras un interruptor sigue
  // midiendo los 159 de un golpe. Los dos casos quedan a un orden de distancia.
  const N = 480;
  for (let i = 0; i < N; i++) {
    dn.setDayCycle(true, i / N);
    const blend = dn.skyBlend();
    const sun = dn.sunVector();
    const c = gfx.weatherColors();
    out.push({
      u: i / N, from: blend.from, to: blend.to, k: +blend.k.toFixed(3),
      land: c.land, tint: c.tint,
      sunX: +sun.x.toFixed(3), alt: +sun.alt.toFixed(3),
      moon: +dn.moonlight().toFixed(3), range: +dn.tideRange().toFixed(3),
    });
  }
  return out;
});

const hex = (v) => {
  const n = parseInt(v.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const dist = (a, b) => {
  const [ar, ag, ab] = hex(a), [br, bg, bb] = hex(b);
  return Math.hypot(ar - br, ag - bg, ab - bb);
};

let worst = 0, worstAt = 0, moved = 0;
for (let i = 1; i < walk.length; i++) {
  const d = dist(walk[i - 1].land, walk[i].land);
  if (d > 0) moved++;
  if (d > worst) { worst = d; worstAt = walk[i].u; }
}
const blended = walk.filter((w) => w.k > 0).length;

// LA LUNA NECESITA SU PROPIO PASEO. Un día es un octavo del mes lunar, así que
// caminar el día deja la luna casi quieta y la marea siempre viva — el paseo de
// arriba no puede probarla. Éste camina un mes.
const moonWalk = await (async () => {
  const b2 = await chromium.launch();
  const pg = await b2.newPage();
  await pg.goto(url, { waitUntil: "domcontentloaded" });
  await pg.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });
  await pg.evaluate(() => { window.Game.setAttract(false); window.Game.startExplore(); });
  await pg.waitForTimeout(1000);
  const out = await pg.evaluate(async () => {
    const dn = await import("/src/game/daynight.js");
    const rows = [];
    for (let d = 0; d <= 32; d++) {
      // media jornada por paso a lo largo de dos meses lunares
      dn.setDayCycle(true, 0.25);
      dn.updateDayCycle(d * 150);
      rows.push({ moon: +dn.moonlight().toFixed(3), range: +dn.tideRange().toFixed(3) });
    }
    return rows;
  });
  await b2.close();
  return out;
})();
const moonSwing = Math.max(...moonWalk.map((m) => m.moon)) - Math.min(...moonWalk.map((m) => m.moon));
const rangeSwing = Math.max(...moonWalk.map((m) => m.range)) - Math.min(...moonWalk.map((m) => m.range));
const sunSwept = Math.max(...walk.map((w) => w.sunX)) - Math.min(...walk.map((w) => w.sunX));
const altRange = Math.max(...walk.map((w) => w.alt)) - Math.min(...walk.map((w) => w.alt));

// LA TORMENTA ENTRA EN ACTOS, y eso es una secuencia en el TIEMPO: no se ve en
// una lectura. Se dispara y se mira la rampa, el agarre y si las luces prenden.
const storm = await page.evaluate(async () => {
  const dn = await import("/src/game/daynight.js");
  const lights = await import("/src/render/c2d/lights.js");
  dn.setDayCycle(true, 0.2);                 // mediodía: una tormenta de DÍA
  // SE GRABA TODO EL RATO. El primer intento avanzaba «hasta que caiga una» con
  // un `rows.some()` sobre un arreglo vacío —que nunca es cierto—, así que
  // corría los 400 s completos y empezaba a grabar DESPUÉS de que la tormenta
  // había pasado: reportó pico 0 con la tormenta funcionando. Una tormenta llega
  // cada 210-420 s y dura 45-90, así que 600 lecturas capturan al menos una
  // entera sin tener que adivinar cuándo.
  const rows = [];
  for (let i = 0; i < 600; i++) {
    dn.updateDayCycle(1);
    rows.push({ storm: +dn.stormLevel().toFixed(3), grip: +dn.wetGrip().toFixed(3),
                bolt: +dn.lightning().toFixed(2), weather: window.Game.state.weather });
  }
  return rows;
});
const peak = Math.max(...storm.map((r) => r.storm));
const minGrip = Math.min(...storm.map((r) => r.grip));
const bolts = storm.filter((r) => r.bolt > 0).length;
// Niveles DISTINTOS mientras hay tormenta: si sólo hay 0 y 1, es un interruptor.
const ramped = new Set(storm.filter((r) => r.storm > 0).map((r) => r.storm)).size;

await browser.close();
if (errors.length) { console.error(`[sky] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[storm] pico ${peak.toFixed(2)}, ${ramped} niveles distintos (una rampa, `
  + `no un interruptor) | agarre baja a ${minGrip.toFixed(2)} | ${bolts} cuadros con relámpago`);
if (peak <= 0) { console.error("[storm] FAIL — nunca cayó una tormenta"); process.exit(1); }
// UNA RAMPA, NO UN INTERRUPTOR: si sólo hay dos niveles (0 y 1) volvimos al bug.
if (ramped < 5) { console.error(`[storm] FAIL — sólo ${ramped} niveles: es un interruptor`); process.exit(1); }
// Y TIENE QUE MOJAR LA CALLE, que es lo que no hacía.
if (minGrip > 0.9) { console.error(`[storm] FAIL — el agarre sólo bajó a ${minGrip.toFixed(2)}`); process.exit(1); }

console.log(`[sky] ${walk.length} horas | el suelo cambia en ${moved} de ellas, `
  + `salto máximo ${worst.toFixed(1)} en u=${worstAt.toFixed(2)} | `
  + `${blended} mezclando | sol barre ${sunSwept.toFixed(2)}, altura ${altRange.toFixed(2)} | `
  + `luna oscila ${moonSwing.toFixed(2)}, rango de marea ${rangeSwing.toFixed(2)}`);

// EL DÍA TIENE QUE MOVERSE. Un cielo que no cambia es un ciclo apagado, y todo
// lo demás de esta prueba pasaría igual.
if (moved < 40) { console.error(`[sky] FAIL — el cielo sólo cambió en ${moved} de ${walk.length} lecturas`); process.exit(1); }
// …Y NO A SALTOS. 30 es el número calibrado, no elegido: una rampa da ~5,5 por
// paso y un interruptor da 159. Cualquier umbral entre esos dos separa los
// casos; 30 deja margen para el paso más grande de una rampa sin acercarse al
// de un corte.
if (worst > 30) { console.error(`[sky] FAIL — salto de ${worst.toFixed(1)} en u=${worstAt.toFixed(2)}: el cielo brinca`); process.exit(1); }
// El sol tiene que BARRER, o las sombras no se mueven con él.
if (sunSwept < 1.2) { console.error(`[sky] FAIL — el sol barre ${sunSwept.toFixed(2)}, las sombras no se moverían`); process.exit(1); }
// LA LUNA TIENE QUE ABRIR Y CERRAR LA MAREA, o es decoración. Viva a llena y
// nueva, muerta en los cuartos: si el rango no oscila, la fase no está llegando
// al modelo.
if (moonSwing < 0.6) { console.error(`[sky] FAIL — la luna sólo oscila ${moonSwing.toFixed(2)}`); process.exit(1); }
if (rangeSwing < 0.25) { console.error(`[sky] FAIL — el rango de marea sólo oscila ${rangeSwing.toFixed(2)}: la luna no la mueve`); process.exit(1); }
