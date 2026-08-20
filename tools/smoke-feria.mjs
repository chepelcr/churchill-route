// LOS JUEGOS ESTORBAN, Y REBOTAN — medido, no mirado.
//
//   node tools/smoke-feria.mjs [devUrl]
//
// Conducir contra un carrusel tiene que hacer DOS cosas y una sola no basta:
// sacar al carro (o se queda vibrando adentro, que es peor que atravesarlo) y
// DEVOLVERLE velocidad (o es una pared, y una pared no es un bumper). Las dos
// se miden sobre la misma embestida.
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

await page.evaluate(async () => {
  const { WORLD2D: W } = await import("/src/world2d/index.js");
  const ACTORS = (await import("/src/assets/actors.json", { with: { type: "json" } })).default;
  // Por nombre, nunca por número: las clases de superficie son append-only y el
  // artefacto generado es la única copia que no se despega.
  const { SURFACE } = await import("/src/domain/vocabulary.generated.js");
  const rides = (W.ATTRACTIONS || []).filter((a) => a.kind !== "dj" && a.kind !== "chinamo");
  window.__feria = { rides: rides.length };
  if (!rides.length) return;
  const cfg = ACTORS.attraction;
  // ELEGIR UN JUEGO AL QUE SE PUEDA LLEGAR. Un juego puede estar parado sobre
  // suelo que es PARED para un carro —el malecón lo es— y entonces la embestida
  // se detiene contra el suelo y no contra el juego: la prueba mediría otra
  // cosa y fallaría por la razón equivocada. Así que se busca uno con calle
  // alrededor, y si no hay ninguno se dice, en vez de reportar un rebote roto.
  const DRIVE = new Set([SURFACE.ROAD, SURFACE.PASEO, SURFACE.BRIDGE,
                         SURFACE.BARRO, SURFACE.GRAVEL, SURFACE.BEACH]);
  let A = null, rr = 0;
  for (const cand of rides) {
    const r = (cand.r || 24) * cfg.radiusScale;
    const ok = [-1, 1].some((sx) => {
      for (let d = r + 12; d <= r + 60; d += 8) {
        if (!DRIVE.has(W.surfaceAt(cand.x + sx * d, cand.y))) return false;
      }
      return true;
    });
    if (ok) { A = cand; rr = r; break; }
  }
  if (!A) { window.__feria = { rides: rides.length, unreachable: true }; return; }
  const p = window.Game.state.p;
  // Embestida frontal desde el oeste. El lazo corre en rAF, así que se prepara
  // el carro y se dejan correr CUADROS DE VERDAD — no hay `Game.step`, y
  // fabricar uno para la prueba sería medir un motor que el juego no usa.
  p.x = A.x - rr - 45; p.y = A.y; p.a = 0;
  p.vx = 220; p.vy = 0; p.speed = 220;
  const rec = { rides: rides.length, minD: Infinity, vx: [], A, rr,
                restitution: cfg.restitution, kind: A.kind, r: A.r };
  window.__feria = rec;
  const tick = () => {
    const d = Math.hypot(p.x - A.x, p.y - A.y);
    if (d < rec.minD) rec.minD = d;
    rec.vx.push(p.vx);
    if (rec.vx.length < 90) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.waitForTimeout(2200);
const out = await page.evaluate(() => {
  const r = window.__feria;
  if (!r) return { rides: 0 };
  if (r.unreachable) return { rides: r.rides, unreachable: true };
  if (!r.vx) return { rides: 0 };
  return { rides: r.rides, kind: r.kind, r: r.r, rr: +r.rr.toFixed(1),
           minD: +r.minD.toFixed(1), minVx: +Math.min(...r.vx).toFixed(1),
           restitution: r.restitution, frames: r.vx.length };
});
await browser.close();
if (errors.length) { console.error(`[feria] page errors: ${errors.join(" | ")}`); process.exit(1); }
if (!out.rides) { console.error("[feria] FAIL — the world has no rides to hit"); process.exit(1); }
if (out.unreachable) {
  console.error(`[feria] FAIL — ninguno de los ${out.rides} juegos tiene calle alrededor: `
    + `el campo ferial está sobre suelo que es pared para un carro. `
    + `Si el mundo todavía no se reconstruyó tras mover la feria a la calzada, eso es esto.`);
  process.exit(1);
}
console.log(`[feria] ${out.rides} juegos; embestí ${out.kind} (r=${out.r}, colisión ${out.rr}px)`);
console.log(`[feria]   acercamiento máximo ${out.minD}px  ·  vx mínima ${out.minVx} en ${out.frames} cuadros (entré a +220)`);
const inside = out.minD < out.rr - 2;
const bounced = out.minVx < -20;
if (inside) { console.error(`[feria] FAIL — entró ${(out.rr - out.minD).toFixed(1)}px DENTRO del juego`); process.exit(1); }
if (!bounced) { console.error(`[feria] FAIL — no rebotó: vx mínima ${out.minVx}, esperaba negativa`); process.exit(1); }
console.log(`[feria] ok — no lo atraviesa y sale rebotado (restitución ${out.restitution})`);
