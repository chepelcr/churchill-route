// ¿LA SOMBRA DE LAS NUBES SE MUEVE, Y SE APAGA DE NOCHE? Medido, no mirado.
//
// Son las dos cosas que una captura no puede probar y que, mal hechas, se leen
// como otra cosa: una nube que no deriva es una mancha sucia en el suelo, y una
// nube que sigue ahí a medianoche es una sombra sin sol que la proyecte.
//
// Servidor FRESCO, por lo de siempre: importa módulos fuente por su ruta, y con
// HMR encima eso acuña una segunda instancia con su propio reloj — el mismo
// fallo que ya reportó dos veces que el cielo no se movía estando bien.
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8736/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });

const out = await page.evaluate(async () => {
  const worldJsUrl = new URL("/src/render/c2d/world.js", location.href);
  const worldJsSrc = await fetch(worldJsUrl).then((r) => r.text());
  const skySpec = worldJsSrc.match(/from\s+["']([^"']*\/c2d\/skycover\.js[^"']*)["']/)?.[1];
  if (!skySpec) throw new Error("no se pudo resolver el módulo vivo de las nubes");
  const skyUrl = new URL(skySpec, worldJsUrl);
  const skySrc = await fetch(skyUrl).then((r) => r.text());
  const dnSpec = skySrc.match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)?.[1];
  if (!dnSpec) throw new Error("no se pudo resolver el reloj vivo");
  const [sky, dn] = await Promise.all([
    import(skyUrl.href), import(new URL(dnSpec, skyUrl).href),
  ]);

  const SIDE = 300, HALF = 700;
  const cv = document.createElement("canvas");
  cv.width = cv.height = SIDE;
  const g = cv.getContext("2d");
  const view = { x0: -HALF, y0: -HALF, x1: HALF, y1: HALF };
  const k = SIDE / (HALF * 2);

  function shot(t, hour) {
    dn.setDayCycle(true, hour);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SIDE, SIDE);
    g.setTransform(k, 0, 0, k, -view.x0 * k, -view.y0 * k);
    sky.paintSkyCover(g, view, t, 1);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const px = g.getImageData(0, 0, SIDE, SIDE).data;
    let ink = 0;
    const col = new Array(SIDE).fill(0);
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (!a) continue;
      ink += a;
      col[(i / 4) % SIDE] += a;
    }
    // el CENTROIDE horizontal de la tinta: es lo que tiene que correrse con el
    // viento, y no cambia si sólo sube o baja la cobertura.
    let wsum = 0, w = 0;
    for (let c = 0; c < SIDE; c++) { wsum += col[c] * c; w += col[c]; }
    return { ink: Math.round(ink), centroid: w ? wsum / w : 0 };
  }

  // VARIAS MUESTRAS Y NO UNA. La nube deriva, así que en un instante suelto
  // puede haber poca o ninguna en el cuadro por pura suerte de la retícula —
  // que es exactamente lo que hizo fallar la primera versión de esta prueba con
  // el cielo funcionando. Se suma a lo largo de medio minuto.
  const TS = [0, 12, 24, 36, 48];
  // LAS HORAS SALEN DEL REGISTRO, no de la intuición. En `simulation.json` el
  // día es sunny 0..0.42, sunset 0.42..0.60, NIGHT 0.60..0.88 y sunset otra vez
  // hasta 1. La primera versión de esto pidió "medianoche" en 0,5 y en 0,92 —
  // las dos son atardecer, que sí tiene sol, y la prueba falló con el cielo
  // perfectamente bien.
  const day = TS.map((t) => shot(t, 0.20));
  const night = TS.map((t) => shot(t, 0.72));
  return {
    dayInk: day.reduce((a, s) => a + s.ink, 0),
    nightInk: night.reduce((a, s) => a + s.ink, 0),
    first: day[0], last: day[day.length - 1],
  };
});

await browser.close();
if (errors.length) { console.error("[clouds] page errors:", errors.join(" | ")); process.exit(1); }
console.log(`[clouds] mediodía  tinta total ${out.dayInk}`);
console.log(`[clouds] medianoche tinta total ${out.nightInk}`);
console.log(`[clouds] centroide  t=0 ${out.first.centroid.toFixed(1)} -> t=48 ${out.last.centroid.toFixed(1)}`);

if (out.dayInk <= 0) {
  console.error("[clouds] FAIL — a mediodía no hay ni una sombra de nube en medio minuto");
  process.exit(1);
}
// DE NOCHE NO HAY SOL QUE PROYECTE NADA. No se exige un cero exacto: el cielo
// de este juego es un CONTINUO y la luz se apaga con él, así que un cero duro
// contradiría el diseño. Lo que se exige es que quede en el ruido.
if (out.nightInk > out.dayInk * 0.1) {
  console.error(`[clouds] FAIL — de noche queda ${(out.nightInk / out.dayInk * 100).toFixed(0)} % `
    + "de la sombra de mediodía; una sombra necesita un sol que la proyecte");
  process.exit(1);
}
// Y DERIVA ENTERA. El centroide se corre con el viento; si no se mueve, el
// desplazamiento no está llegando a la retícula y la nube es una mancha sucia.
const moved = Math.abs(out.last.centroid - out.first.centroid);
if (moved < 1) {
  console.error(`[clouds] FAIL — en 48 s la sombra se movió ${moved.toFixed(2)} px de imagen: `
    + "no está derivando");
  process.exit(1);
}
console.log(`[clouds] ok — sombra de día, ${(out.nightInk / out.dayInk * 100).toFixed(1)} % de noche, `
  + `y el centroide corrió ${moved.toFixed(1)} px en 48 s`);
