// Boot the built game in a real browser, start a run, drive, and FAIL on any
// error the page throws.
//
// WHY THIS EXISTS. The render loop is one `try`-less call chain: a single
// ReferenceError anywhere in it kills the frame, and everything drawn after the
// throw point silently disappears — the car, the HUD, the debug overlay — while
// the world keeps its last painted frame. It looks exactly like a freeze, and
// it looks nothing like a stack trace unless somebody has a console open.
//
// That has now shipped three times: players invisible (`matches` never cleared
// on a mode start), `drawPassenger is not defined` (a regex tidy-up ate the
// function but not its call), and an import of a deleted export that Rollup
// only warns about. None of the three is catchable by `pnpm build`, by the
// world snapshot, or by reading — but all three are caught by loading the page
// once. That is the whole job of this file.
//
//   pnpm build && npx vite preview --port 8799 &
//   node tools/smoke.mjs http://localhost:8799/
//
// Playwright is NOT a dependency of the game: if it is not installed this exits
// 0 with a note, so it can never block a build that has nothing to do with it.
const url = process.argv[2] || "http://localhost:8799/";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("[smoke] playwright not installed — skipped (npm i -D playwright)");
  process.exit(0);
}

const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch(
  { executablePath: CHROME }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0, 4).join("\n   ")));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/favicon|ERR_CONNECTION|Failed to load resource/.test(t)) return;   // not ours
  errors.push("console: " + t.slice(0, 300));
});

const fail = (msg) => { console.log("[smoke] FAIL — " + msg); };
let bad = 0;

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3000);

if (!(await page.evaluate(() => !!window.Game))) { fail("window.Game never appeared"); bad++; }

// A run, not the attract loop: the attract camera does not read input, so a
// broken player path would go unnoticed.
await page.evaluate(() => { window.Game.setAttract(false); window.Game.startArcade(); });
await page.waitForTimeout(1500);

// Drive. The exact route does not matter — what matters is that the loop keeps
// ticking and the car answers the throttle, which a dead frame cannot fake.
const drive = await page.evaluate(async () => {
  const p = window.Game.state.p;
  // WHEREVER THE MODE PUT US, AND WHICHEVER WAY IS OPEN. This used to teleport
  // to a hardcoded world px (17944, 12240 — Avenida Centenario) and drive east,
  // and a world rescale moved that avenue out from under it: the car woke up
  // off the network and the run still "passed" on drift alone, reporting a top
  // speed of 0. The run's own spawn is the better test — if THAT is not
  // drivable the game is broken — but a spawn is an apron, so east is not
  // necessarily open. Try the four headings and keep the best.
  // …Y CADA INTENTO ARRANCA DONDE ARRANCÓ EL PRIMERO. Esto no volvía al punto
  // de partida entre rumbos: cada uno salía de donde el anterior hubiera dejado
  // el carro, así que probar «las cuatro direcciones» era en realidad probar un
  // recorrido de cuatro tramos. Con un spawn en la calle auxiliar que baja al
  // kiosco del Paseo —40 px de ancho entre dos paredes de malecón— los tres
  // primeros rumbos aparcan el carro contra la pared y el cuarto, que es el
  // BUENO, sale de una esquina y no llega a ningún lado.
  //
  // Medido sobre el mundo de 3.125 px/m: desde el spawn el rumbo norte recorre
  // 154 px a 266 px/s, muy por encima del umbral; encadenado detrás de los
  // otros tres, el mejor de los cuatro daba 82. El juego estaba bien y la
  // prueba se estaba estorbando a sí misma.
  const start = { x: p.x, y: p.y, a: p.a };
  let best = { travelled: 0, top: 0 };
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    p.x = start.x; p.y = start.y;
    const from = { x: p.x, y: p.y };
    p.a = a; p.vx = 0; p.vy = 0; p.speed = 0;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    let top = 0;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 250));
      top = Math.max(top, p.speed || 0);
    }
    window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
    const travelled = Math.round(Math.hypot(p.x - from.x, p.y - from.y));
    if (travelled > best.travelled) best = { travelled, top: Math.round(top) };
    await new Promise((r) => setTimeout(r, 200));
  }
  // Y SE AFIRMA EL SITIO, no sólo el movimiento. `smoke_boat` se pasó meses en
  // verde probando un carro «en la ciudad» que estaba en mar abierto; la regla
  // que salió de ahí es que una prueba sobre un LUGAR afirme también el lugar.
  const W = window.WORLD2D || window.Game.W;
  let spawnSurface = null;
  try { spawnSurface = W.surfaceAt(start.x, start.y); } catch { /* no accessor */ }
  return { ...best, spawnSurface, spawn: [Math.round(start.x), Math.round(start.y)] };
});

// 0 water, 1 land, 2 beach, 3 road, 4 paseo, 5 bridge, 6 acera, 7 boulevard,
// 8 barro, 9 gravel, 10 malecon — the run must start on something drivable, or
// "the car did not move" is a statement about the spawn and not about the loop.
const DRIVABLE_SPAWN = new Set([2, 3, 4, 5, 7, 8, 9]);
if (drive.spawnSurface !== null && !DRIVABLE_SPAWN.has(drive.spawnSurface)) {
  fail(`the run spawned on surface ${drive.spawnSurface} at ${drive.spawn} — not a drivable class, so this is a WORLD failure and not a loop one`);
  bad++;
}
if (drive.travelled < 150) { fail(`the car only moved ${drive.travelled} px in 2 s on its best heading from ${drive.spawn} — the loop is dead or it is walled in`); bad++; }
if (errors.length) { fail(`${errors.length} page error(s)`); bad++; }
for (const e of errors.slice(0, 8)) console.log("   " + e);

await browser.close();
if (!bad) console.log(`[smoke] ok — drove ${drive.travelled} px in 2 s, top speed ${drive.top}, no page errors`);
process.exit(bad ? 1 : 0);
