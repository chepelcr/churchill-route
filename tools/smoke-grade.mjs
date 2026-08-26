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
  const { SURFACE } = await import("/src/domain/vocabulary.generated.js");
  const DRIVE = new Set([SURFACE.ROAD, SURFACE.PASEO, SURFACE.BRIDGE, SURFACE.BARRO, SURFACE.GRAVEL]);
  // Barrer el este, que es donde el IGN pone los cerros. Se piden los tiles
  // primero: `groundZAt` responde 0 para un tile que no ha llegado, igual que
  // `surfaceAt` responde agua, así que un barrido ingenuo mide fe.
  // `ensureView` es la entrada de verdad — y `tileResident` la que dice si ya
  // llegó. Sin esperarlas, `groundZAt` responde 0 para un tile que no está,
  // igual que `surfaceAt` responde agua, y el barrido mediría FE: saldría plano
  // y la prueba diría «el mundo no tiene cota» sobre un mundo que sí la tiene.
  // Es la misma trampa que `smoke_crossing` documenta desde el otro lado.
  // SE MUEVE LA CÁMARA Y SE DEJA QUE EL JUEGO CARGUE. `ensureView` encola, pero
  // quien procesa la cola es el lazo — pedir y contar en el mismo tick mide la
  // cola, no el mundo. Es la misma trampa que `smoke_crossing` documenta: una
  // celda sin tile responde AGUA, y aquí responde COTA CERO.
  const G = window.Game;
  const spots = [];
  for (let x = 52000; x < 76000; x += 3000)
    for (let y = 8000; y < 34000; y += 3000) spots.push([x, y]);
  let best = null, resident = 0, probed = 0;
  const grades = [];
  // UN BORDE DE TILE NO ES UN ACANTILADO. `groundZAt` used to clamp the four
  // bilinear samples to the tile containing the query, so the limit from the
  // left read sample 24 and the limit from the right read sample 25. Those are
  // neighbours 80 px apart, not two heights at the same point. Sweep both
  // orientations while the normal east-side scan already has the surrounding
  // tiles resident; an epsilon-wide crossing must therefore be continuous.
  const seamSeen = new Set(), seams = [];
  const SEAM_EPS = 0.01;
  const sampleSeam = (axis, edge, other) => {
    const key = `${axis}:${edge}:${other}`;
    if (seamSeen.has(key)) return;
    seamSeen.add(key);
    const a = axis === "x" ? [edge - SEAM_EPS, other] : [other, edge - SEAM_EPS];
    const b = axis === "x" ? [edge + SEAM_EPS, other] : [other, edge + SEAM_EPS];
    if (!W.tileResident(...a) || !W.tileResident(...b)) return;
    const za = W.groundZAt(...a), zb = W.groundZAt(...b);
    if (Math.max(Math.abs(za), Math.abs(zb)) < 1e-6) return; // flat coast: honest but uninformative
    seams.push({ axis, edge, other, jump: Math.abs(zb - za), za, zb });
  };
  for (const [sx, sy] of spots) {
    const p = G.state.p;
    p.x = sx; p.y = sy; p.vx = p.vy = 0; p.speed = 0;
    G.state.cam.x = sx; G.state.cam.y = sy;
    for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
    const bx = Math.round(sx / W.TILE_PX) * W.TILE_PX;
    const by = Math.round(sy / W.TILE_PX) * W.TILE_PX;
    if (bx > 0 && bx < W.W)
      for (let d = -600; d <= 600; d += 300) sampleSeam("x", bx, sy + d);
    if (by > 0 && by < W.H)
      for (let d = -600; d <= 600; d += 300) sampleSeam("y", by, sx + d);
    for (let dx = -800; dx <= 800; dx += 200) {
      for (let dy = -800; dy <= 800; dy += 200) {
        const x = sx + dx, y = sy + dy;
        probed++;
        if (!W.tileResident(x, y)) continue;
        resident++;
        // SOBRE CALLE, o la prueba mide un carro aparcado en la ladera. El punto
        // más empinado del mundo está en un cerro, y un cerro no es asfalto: el
        // carro no se movía ni un píxel en ninguna de las dos direcciones y eso
        // no dice NADA sobre la pendiente.
        if (!DRIVE.has(W.surfaceAt(x, y))) continue;
        const g = W.groundGradeAt(x, y);
        const m = Math.hypot(g.dzdx, g.dzdy);
        grades.push(m);
        if (!best || m > best.m) best = { x, y, m, z: W.groundZAt(x, y), g };
      }
    }
  }
  grades.sort((a, b) => a - b);
  seams.sort((a, b) => b.jump - a.jump);
  return { best, cfg: SIM.grade, resident, probed, onRoad: grades.length,
           p50: grades[(grades.length * 0.5) | 0], p95: grades[(grades.length * 0.95) | 0],
           seamCount: seams.length, worstSeam: seams[0] || null };
});
if (errors.length) { console.error(`[grade] page errors: ${errors.join(" | ")}`); await browser.close(); process.exit(1); }
console.log(`[grade] ${probe.resident}/${probe.probed} sondas residentes, ${probe.onRoad} sobre calle`);
if (probe.onRoad) console.log(`[grade] pendiente en calle: mediana ${(probe.p50*100).toFixed(2)} %, `
  + `p95 ${(probe.p95*100).toFixed(2)} %, máx ${(probe.best.m*100).toFixed(2)} %`);
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
if (probe.seamCount < 20) {
  console.error(`[grade] FAIL — sólo ${probe.seamCount} bordes de tile con cota residentes; `
    + "la prueba necesita al menos 20 para no aprobar por una costura plana");
  await browser.close(); process.exit(1);
}
const seam = probe.worstSeam;
console.log(`[grade] ${probe.seamCount} bordes de tile: salto máx ${seam.jump.toFixed(4)} m `
  + `(${seam.axis}=${seam.edge}, otro=${seam.other}, ${seam.za.toFixed(1)}→${seam.zb.toFixed(1)} m)`);
if (seam.jump > 0.05) {
  console.error(`[grade] FAIL — el borde salta ${seam.jump.toFixed(2)} m en sólo 0.02 px; `
    + "la interpolación sigue recortada al tile");
  await browser.close(); process.exit(1);
}
const b = probe.best;
console.log(`[grade] el punto más empinado del este: (${b.x},${b.y})  z=${b.z.toFixed(1)} m  `
  + `pendiente ${(b.m * 100).toFixed(2)} %`);

const runs = await page.evaluate(async ([bx, by, gx, gy]) => {
  const G = window.Game;
  const p = G.state.p;
  const cv = document.querySelector("canvas");
  const touch = (type, x, y) => {
    const t = { identifier: 7, clientX: x, clientY: y, target: cv };
    const ev = new Event(type, { bubbles: true, cancelable: true });
    ev.touches = type === "touchend" ? [] : [t];
    ev.changedTouches = [t];
    cv.dispatchEvent(ev);
  };
  // Cuesta arriba = contra el gradiente; cuesta abajo = a favor.
  const up = Math.atan2(gy, gx), down = up + Math.PI;
  const out = [];
  for (const [a, label] of [[up, "subiendo"], [down, "bajando"]]) {
    p.x = bx; p.y = by; p.a = a; p.vx = 0; p.vy = 0; p.speed = 0;
    G.state.cam.x = bx; G.state.cam.y = by;
    G.state.grade = 0;
    // …Y CON EL ACELERADOR PUESTO. Sin gas el carro no se mueve y las dos
    // corridas dan cero, que no dice nada sobre la cuesta. El dedo va DELANTE
    // del carro en pantalla: la cámara no gira aquí, así que basta con empujar
    // hacia donde ya mira.
    touch("touchstart", 450 + Math.cos(a) * 250, 280 + Math.sin(a) * 250);
    for (let i = 0; i < 120; i++) await new Promise((r) => requestAnimationFrame(r));
    touch("touchend", 450, 280);
    out.push({ label, speed: Math.hypot(p.vx, p.vy), grade: G.state.grade });
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
