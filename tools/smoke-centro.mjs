// EL CENTRO CÍVICO SE PUEDE RECORRER — y sólo por donde se dibuja que se puede.
//
//   pnpm build && pnpm preview --port 8799 &
//   node tools/smoke-centro.mjs [http://localhost:8799/]
//
// `tests/test_centro.py` ya lee el ráster; esto maneja el CARRO, que es lo que
// el ráster no puede prometer solo (un tuktuk mide 8 x 5 m y una boca de 9 m
// puede ser pared para él aunque sus celdas estén abiertas). Por cada boca del
// Parque Mora y Cañas y de la manzana de la Catedral: se pone el carro en la
// calle, de frente a la boca, se acelera, y tiene que terminar ADENTRO, sobre
// el piso. Y al revés: desde el paseo central, de frente al césped, no entra.
//
// Afirma el LUGAR además del hecho: las bocas se le preguntan al mundo que el
// juego cargó (`WORLD2D.CENTRO`), nunca a un píxel escrito a mano.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const url = process.argv[2] || "http://localhost:8799/";
const SURFACE = JSON.parse(readFileSync("src/assets/vocabulary.generated.json", "utf8")).surface.byName;
const BOULEVARD = SURFACE.boulevard, ROAD = SURFACE.road, LAND = SURFACE.land;
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem("churchill_intro_seen_v1", "1");
  localStorage.setItem("churchill_lang_v1", "es");
});
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 60000 });
let bad = 0;
const fail = (msg) => { console.error(`[smoke:centro] FAIL ${msg}`); bad++; };

const centro = await page.evaluate(() => window.WORLD2D.CENTRO);
if (!centro) { fail("el mundo no trae `centro`: falta `pnpm world:centro`"); await browser.close(); process.exit(1); }

// un tramo: el carro en (x, y) mirando a `a`, acelerando `ms`; devuelve dónde quedó y qué pisó
const leg = (x, y, a, ms = 2200) => page.evaluate(async ({ x, y, a, ms }) => {
  const G = window.Game, W = window.WORLD2D, st = G.state, p = st.p;
  G.setAttract(false);
  if (st.mode !== "explore") G.startExplore({ weather: "sunny", x, y });
  st.storyTip = null; st.paused = false;
  p.x = x; p.y = y; p.a = a; p.vx = 0; p.vy = 0; p.speed = 0;
  st.cam.x = x; st.cam.y = y;
  W.update(x, y); await W.ready(x, y, 1400, 900);
  // el tráfico no es lo que se prueba: un bus atravesado en la boca diría que la boca es pared
  for (const k of ["traffic", "parked"]) if (Array.isArray(G[k])) G[k].length = 0;
  p.x = x; p.y = y; p.a = a; p.vx = 0; p.vy = 0; p.speed = 0;
  const from = W.surfaceAt(x, y), seen = new Set();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
  for (let t = 0; t < ms; t += 100) { await new Promise((r) => setTimeout(r, 100)); seen.add(W.surfaceAt(p.x, p.y)); }
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
  await new Promise((r) => setTimeout(r, 150));
  return { from, to: W.surfaceAt(p.x, p.y), seen: [...seen], moved: Math.round(Math.hypot(p.x - x, p.y - y)) };
}, { x, y, a, ms });

// arrancar el modo UNA vez y dejarlo asentarse: el primer tramo, medido sobre el cuadro en
// que el modo todavía se está armando, avanza 0 px y se lee como una boca tapiada
await page.evaluate(async (p0) => {
  const G = window.Game;
  G.setAttract(false);
  G.startExplore({ weather: "sunny", x: p0.ox, y: p0.oy });
  await new Promise((r) => setTimeout(r, 1500));
}, centro.places[0]);

// …y se pregunta si PISÓ el piso, no dónde quedó: por una boca que da a un paseo corto el carro
// entra, lo cruza entero y sale por la boca de enfrente en los dos segundos del tramo.
// ENTRAR es cruzar la acera y quedar sobre el piso: una boca que da a un descanso corto (la
// diagonal del parque) no deja correr 60 px en línea recta, y no por eso está cerrada
const IN_PX = 30;
for (const place of centro.places) {
  for (const mo of place.mouths) {
    const [ax, ay, bx, by, cx, cy, dx, dy] = mo.pts;
    const ox = (ax + bx) / 2, oy = (ay + by) / 2, ix = (cx + dx) / 2, iy = (cy + dy) / 2;
    const L = Math.hypot(ix - ox, iy - oy), ux = (ix - ox) / L, uy = (iy - oy) / L;
    const r = await leg(ox - ux * 16, oy - uy * 16, Math.atan2(uy, ux));
    const tag = `${place.id}/${mo.id}`;
    if (r.from !== ROAD) fail(`${tag}: el carro no arrancó sobre calle (clase ${r.from}) — el mundo se movió debajo de la prueba`);
    else if (!r.seen.includes(BOULEVARD) || r.moved < IN_PX) fail(`${tag}: no se entra por la boca — avanzó ${r.moved} px y quedó sobre la clase ${r.to} (pisó ${r.seen})`);
    else console.log(`[smoke:centro] ${tag}: entra — ${r.moved} px, del asfalto al piso`);
  }
}

// el césped es pared: desde el paseo central del parque, de frente a la isla verde del oeste
{
  const mora = centro.places.find((p) => p.id === "mora");
  const at = (u, v) => [mora.ox + (u * Math.cos(mora.ang) - v * Math.sin(mora.ang)) * 3.125, mora.oy + (u * Math.sin(mora.ang) + v * Math.cos(mora.ang)) * 3.125];
  const [x, y] = at(0, -35);
  const r = await leg(x, y, mora.ang + Math.PI, 2200);
  if (r.from !== BOULEVARD) fail(`mora: el paseo central no es piso (clase ${r.from})`);
  else if (r.seen.includes(LAND) || r.to !== BOULEVARD) fail(`mora: el carro se subió al césped (pisó ${r.seen})`);
  else console.log(`[smoke:centro] mora: el césped es pared — el carro se quedó en el piso tras ${r.moved} px`);
  // …y el paseo se recorre a lo largo: del tanque hacia los bustos
  const [x2, y2] = at(0, -16);
  const r2 = await leg(x2, y2, mora.ang - Math.PI / 2, 2200);
  if (r2.to !== BOULEVARD || r2.moved < 60) fail(`mora: el paseo central no se recorre — ${r2.moved} px, clase ${r2.to}`);
  else console.log(`[smoke:centro] mora: el paseo central se recorre — ${r2.moved} px`);
}

await browser.close();
if (errors.length) { console.error(`[smoke:centro] errores de página: ${errors.join(" | ")}`); bad++; }
if (bad) process.exit(1);
console.log("[smoke:centro] OK");
