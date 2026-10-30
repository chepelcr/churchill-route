// EL PASAJE DEL MUELLE: la puerta al norte del mapa, manejada de verdad.
//
// POR QUÉ EXISTE. El norte —Pitahaya y toda la tierra firme de esa orilla—
// está DESCONECTADO de la red manejable. Medido sobre el mundo emitido: la red
// tiene 69 componentes, el norte es la #3 (162 945 celdas) y la península la #4
// (4 228 466), y en 600 px a la redonda se acercan en UN solo punto, donde hay
// un corte de 95 px al final de la Calle del Arreo. Sin esta puerta, media isla
// se ve y no se llega, y eso es exactamente la clase de cosa que arranca bien,
// dibuja bien y no tira nada.
//
// Lo que mide y una captura no puede:
//   * la puerta es un FLANCO, no un estado. Se cruza y uno sale PARADO ENCIMA
//     del muelle de destino, así que una prueba de «¿estoy en un muelle?»
//     preguntaría otra vez en el cuadro siguiente, para siempre.
//   * se sale en SUELO MANEJABLE. El extremo de la ruta es la orilla —la última
//     celda de agua antes de la tierra— y dejar ahí un carro lo deja medio
//     dentro de una pared.
//   * Historia no la ofrece: una puerta que salta media península convierte
//     cualquier objetivo de una etapa en un atajo.
//
// Y AFIRMA EL LUGAR ADEMÁS DEL HECHO. Los dos muelles se preguntan a la ruta
// que el mundo emite (`Game.esteroMuelles()`), nunca a un píxel escrito a mano:
// ésa es la cicatriz que este repo ya lleva tres veces, la última cuando el
// reescalado convirtió la «calle del centro» de un smoke en mar abierto y la
// prueba siguió pasando.
//
// Playwright NO es dependencia del juego: si no está, esto sale 0 con una nota.
const url = process.argv[2] || "http://localhost:8799/";
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { console.log("[passage] playwright not installed — skipped (npm i -D playwright)"); process.exit(0); }

const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: CHROME }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0, 4).join("\n   ")));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/favicon|ERR_CONNECTION|Failed to load resource/.test(t)) return;
  errors.push("console: " + t.slice(0, 300));
});
let bad = 0;
const fail = (m) => { console.log("[passage] FAIL — " + m); bad++; };
//: las clases que un carro puede pisar. 0 agua, 1 tierra y 6 acera son pared.
const DRIVABLE = new Set([2, 3, 4, 5, 7, 8, 9, 10]);

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3000);
if (!(await page.evaluate(() => !!window.Game))) { fail("window.Game never appeared"); bad++; }

const res = await page.evaluate(async () => {
  const G = window.Game, S = G.state, W = window.WORLD2D;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const o = {};
  const ms = G.esteroMuelles();
  if (!ms) return { noMuelles: true };
  o.muelles = ms.map((m) => [Math.round(m.x), Math.round(m.y)]);

  G.startExplore({ realm: "ciudad" });
  await sleep(400);
  o.medium = S.veh.medium || "land";

  // EL LUGAR, AFIRMADO — y lo que hay que afirmar es lo que la puerta USA: que
  // cada extremo tiene suelo manejable al alcance. No que sea agua: el extremo
  // de Puntarenas cae sobre la CUBIERTA del muelle (clase 5) y el de Pitahaya
  // sobre la calle de la orilla.
  //
  // SE HACE EN PAUSA, y eso no es cosmético. La cámara tiene dos dueños que la
  // escriben cada cuadro —`attractTick` en el menú y el seguimiento del jugador
  // en `update`— y `W.update(cam)` EVICTA todo tile a más de cinco de ella. Sin
  // pausar, los tiles de Pitahaya que este `await` acaba de traer se los lleva
  // el cuadro siguiente y la lectura sale AGUA: la prueba falla una vez de cada
  // dos diciendo que el sitio está mal cuando lo que se movió fue la cámara.
  // Es exactamente la carrera que tenía `crossTheEstero`, y la razón de que
  // arregle la suya moviendo la cámara ANTES de esperar.
  S.paused = true;
  const streamTo = async (x, y) => {
    S.cam.x = x; S.cam.y = y;
    W.update(x, y);
    await W.ready(x, y, 1600, 1000);
    for (let i = 0; i < 30 && W.tileResident && !W.tileResident(x, y); i++) await sleep(100);
  };
  o.muelleSurfaces = []; o.muelleGround = [];
  for (const m of ms) {
    await streamTo(m.x, m.y);
    o.muelleSurfaces.push(W.surfaceAt(m.x, m.y));
    const q = W.reachablePointNear(m.x, m.y, 640);
    o.muelleGround.push(q ? [Math.round(q.x), Math.round(q.y), W.surfaceAt(q.x, q.y)] : null);
  }
  S.paused = false;
  await sleep(200);

  const park = async (x, y) => {
    S.p.x = x; S.p.y = y; S.p.vx = 0; S.p.vy = 0; S.p.speed = 0; S.p.drift = 0;
    await sleep(180);
  };
  await park(ms[0].x + 500, ms[0].y + 500); o.offerFar = S.passageOffer;
  await park(ms[0].x, ms[0].y);             o.offerAtMuelle = S.passageOffer;

  const from = { x: S.p.x, y: S.p.y };
  const to = await G.crossTheEstero();
  o.crossed = !!to;
  if (to) {
    o.jumpPx = Math.round(Math.hypot(to.x - from.x, to.y - from.y));
    o.landedSurface = W.surfaceAt(to.x, to.y);
    o.landedAt = [Math.round(to.x), Math.round(to.y)];
  }
  await sleep(220);
  o.offerStandingThere = S.passageOffer;      // desembarcar NO vuelve a preguntar

  await park(ms[1].x + 500, ms[1].y + 500);   // salirse…
  await park(ms[1].x, ms[1].y);               // …y volver a entrar
  o.offerReEntered = S.passageOffer;

  // Historia no la ofrece.
  const st = (W.STAGES || []).findIndex((s) => s.kind !== "crossing");
  if (st >= 0) {
    G.startStage(st);
    await sleep(400);
    await park(ms[0].x, ms[0].y);
    o.offerInStory = S.passageOffer;
  }
  return o;
});

if (res.noMuelles) { console.log("[passage] este mundo no trae la ruta del estero — skipped"); await browser.close(); process.exit(0); }

if (res.muelleGround.some((g) => !g || !DRIVABLE.has(g[2])))
  fail(`un muelle no tiene suelo manejable al alcance (${JSON.stringify(res.muelleGround)}) — la puerta dejaría al jugador en una pared`);
if (res.medium !== "land") fail(`Recorrer ciudad arrancó en el medio '${res.medium}'`);
if (res.offerFar !== null) fail(`la puerta se ofrece a 707 px del muelle (${res.offerFar})`);
if (res.offerAtMuelle === null) fail("entrar al muelle no levanta la puerta");
if (!res.crossed) fail("cruzar no hizo nada");
else {
  if (!DRIVABLE.has(res.landedSurface))
    fail(`se sale del agua en ${res.landedAt} sobre la clase ${res.landedSurface}, que no es manejable`);
  if (res.jumpPx < 10000)
    fail(`el salto fue de ${res.jumpPx} px — los dos muelles serían el mismo`);
}
if (res.offerStandingThere !== null)
  fail("desembarcar vuelve a preguntar en el acto — hay que salirse y volver a entrar");
if (res.offerReEntered === null) fail("volver a entrar al muelle no vuelve a ofrecer");
if (res.offerInStory !== null && res.offerInStory !== undefined)
  fail(`Historia ofrece la puerta (${res.offerInStory}) — sería un atajo para cualquier etapa`);
if (errors.length) fail("errores de página:\n   " + errors.join("\n   "));

if (bad) { await browser.close(); process.exit(1); }
console.log(`[passage] ok — muelles ${JSON.stringify(res.muelles)} clases ${JSON.stringify(res.muelleSurfaces)}; `
  + `cruzó ${res.jumpPx} px y salió en ${res.landedAt}, clase ${res.landedSurface}`);
console.log(`[passage] ok — la puerta es un FLANCO: lejos ${res.offerFar}, al entrar ${res.offerAtMuelle}, `
  + `parado al llegar ${res.offerStandingThere}, al volver a entrar ${res.offerReEntered}; `
  + `Historia ${res.offerInStory}`);
await browser.close();
