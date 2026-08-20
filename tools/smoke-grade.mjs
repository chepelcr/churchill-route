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
  // `ensureView` es la entrada de verdad — y `tileResident` la que dice si ya
  // llegó. Sin esperarlas, `groundZAt` responde 0 para un tile que no está,
  // igual que `surfaceAt` responde agua, y el barrido mediría FE: saldría plano
  // y la prueba diría «el mundo no tiene cota» sobre un mundo que sí la tiene.
  // Es la misma trampa que `smoke_crossing` documenta desde el otro lado.
  let best = null;
  const X0 = 50000, X1 = 78000, Y0 = 6000, Y1 = 40000;
  for (let x = X0; x < X1; x += 2000) {
    for (let y = Y0; y < Y1; y += 2000) W.ensureView(x, y, x + 2000, y + 2000, 0);
  }
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (W.tileResident((X0 + X1) / 2, (Y0 + Y1) / 2)) break;
  }
  await new Promise((r) => setTimeout(r, 1500));
  let resident = 0, probed = 0;
  for (let x = X0; x < X1; x += 400) {
    for (let y = Y0; y < Y1; y += 400) {
      probed++;
      if (!W.tileResident(x, y)) continue;
      resident++;
      const g = W.groundGradeAt(x, y);
      const m = Math.hypot(g.dzdx, g.dzdy);
      if (!best || m > best.m) best = { x, y, m, z: W.groundZAt(x, y), g };
    }
  }
  return { best, cfg: SIM.grade, resident, probed };
});
if (errors.length) { console.error(`[grade] page errors: ${errors.join(" | ")}`); await browser.close(); process.exit(1); }
console.log(`[grade] ${probe.resident}/${probe.probed} sondas sobre tiles residentes`);
if (!probe.resident) {
  console.error("[grade] FAIL — ningún tile del este llegó a tiempo; esto mide el "
    + "streaming, no la cota. Subí la espera.");
  await browser.close(); process.exit(1);
}
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
