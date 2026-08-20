// LA CUESTA SE SIENTE — y se siente DISTINTO de frente que de espaldas.
//
//   node tools/smoke-grade.mjs [devUrl]
//
// Lo que una captura no puede probar: que la misma pendiente frene subiendo y
// suelte bajando. Se busca el punto con más desnivel del mundo emitido, se
// conduce por él en las dos direcciones y se comparan las velocidades.
//
// Si el mundo todavía no lleva canal de cota el terreno es plano, no hay
// pendiente que medir, y esto lo DICE en vez de pasar en verde por vacío.
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

const probe = await page.evaluate(async () => {
  const { WORLD2D: W } = await import("/src/world2d/index.js");
  const SIM = (await import("/src/content/simulation.json", { with: { type: "json" } })).default;
  // Barrer el este, que es donde el IGN pone los cerros. Se piden los tiles
  // primero: `groundZAt` responde 0 para un tile que no ha llegado, igual que
  // `surfaceAt` responde agua, así que un barrido ingenuo mide fe.
  let best = null;
  for (let x = 50000; x < 78000; x += 400) {
    for (let y = 6000; y < 40000; y += 400) {
      W.requestTilesAround?.(x, y);
    }
  }
  await new Promise((r) => setTimeout(r, 2500));
  for (let x = 50000; x < 78000; x += 400) {
    for (let y = 6000; y < 40000; y += 400) {
      const g = W.groundGradeAt(x, y);
      const m = Math.hypot(g.dzdx, g.dzdy);
      if (!best || m > best.m) best = { x, y, m, z: W.groundZAt(x, y), g };
    }
  }
  return { best, cfg: SIM.grade };
});
if (errors.length) { console.error(`[grade] page errors: ${errors.join(" | ")}`); await browser.close(); process.exit(1); }
if (!probe.best || probe.best.m < 1e-6) {
  console.error("[grade] FAIL — el mundo emitido no lleva cota: `groundZAt` es 0 en todo el este. "
    + "Si la reconstrucción con el canal de elevación todavía no corrió, esto es eso.");
  await browser.close(); process.exit(1);
}
const b = probe.best;
console.log(`[grade] el punto más empinado del este: (${b.x},${b.y})  z=${b.z.toFixed(1)} m  `
  + `pendiente ${(b.m * 100).toFixed(2)} % por px`);

const runs = await page.evaluate(async ([bx, by, gx, gy]) => {
  const p = window.Game.state.p;
  // Cuesta arriba = contra el gradiente; cuesta abajo = a favor.
  const up = Math.atan2(gy, gx), down = up + Math.PI;
  const out = [];
  for (const [a, label] of [[up, "subiendo"], [down, "bajando"]]) {
    p.x = bx; p.y = by; p.a = a; p.vx = 0; p.vy = 0; p.speed = 0;
    window.Game.state.grade = 0;
    const t0 = performance.now();
    await new Promise((r) => {
      const tick = () => (performance.now() - t0 > 1400 ? r() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });
    out.push({ label, speed: Math.hypot(p.vx, p.vy), grade: window.Game.state.grade });
  }
  return out;
}, [b.x, b.y, b.g.dzdx, b.g.dzdy]);
await browser.close();
for (const r of runs) console.log(`[grade]   ${r.label.padEnd(9)} v=${r.speed.toFixed(0)} px/s  (grade ${(r.grade * 100).toFixed(2)} %)`);
const up = runs.find((r) => r.label === "subiendo"), dn = runs.find((r) => r.label === "bajando");
if (!(dn.speed > up.speed * 1.05)) {
  console.error(`[grade] FAIL — bajando (${dn.speed.toFixed(0)}) no va más rápido que subiendo `
    + `(${up.speed.toFixed(0)}): la pendiente no está firmada, o no llega a la física`);
  process.exit(1);
}
console.log(`[grade] ok — bajando corre ${(dn.speed / up.speed).toFixed(2)}x lo que subiendo`);
