// EL PREVIEW DE LA PUNTA — El Faro y el Balneario trazados, pintados por el
// renderer de verdad sobre el mundo de HOY, sin reconstruir.
//
//   ./reboot-server.sh 8736
//   node tools/shot-punta-preview.mjs [devUrl] [dirSalida]
//
// Lee `content/world/punta.json` (el registro del lugar, en lat/lon; su trazo
// sobre la imagen queda en docs/punta-satellite-mockup.json), lo lleva a píxeles de mundo con la afín del manifest y le
// entrega al juego un manifest y un tile PARCHADOS EN EL CAMINO — la página
// nunca ve los de disco, así que no hay caché que invalidar y `src/world2d/`
// no se toca. Lo que el juego recibe es lo que el builder emitirá después:
// `manifest.punta` para `c2d/punta.js`, y los edificios, palmas y árboles en
// su tile como todos los demás.
//
// LO QUE NO MUESTRA: la física. El ráster sigue diciendo que la cuadra es agua;
// la superficie sólo cambia al reconstruir el mundo.
import { chromium } from "playwright";
import { readFileSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";

const url = process.argv[2] || "http://localhost:8736/";
const out = process.argv[3] || "logs";
const doc = JSON.parse(readFileSync("content/world/punta.json", "utf8"));
const manifest = JSON.parse(readFileSync("src/world2d/manifest.json", "utf8"));
const { geo, pxPerMeter: ppm, tilePx } = manifest.meta;
mkdirSync(out, { recursive: true });

const xy = ([lat, lon]) => [Math.round(geo.ax * lon + geo.bx), Math.round(geo.ay * lat + geo.by)];
const inside = (x, y, pts) => {
  let hit = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
const centroid = (pts) => {
  let x = 0, y = 0; const n = pts.length / 2;
  for (let i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; }
  return [x / n, y / n];
};
const bbox = (pts) => {
  const xs = pts.filter((_, i) => i % 2 === 0), ys = pts.filter((_, i) => i % 2 === 1);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
};
const B0 = doc.balneario, ML = doc.malecon;
const raw = (lls) => lls.flatMap(xy);

// ---- EL ACOMODO A LA CALLE DEL JUEGO (`gameFit` en el registro dice por qué)
const groundsRaw = raw(B0.grounds[0].polygonLL);
const tc = Math.floor(groundsRaw[0] / tilePx), tr = Math.floor(groundsRaw[1] / tilePx);
const tile = JSON.parse(readFileSync(`src/world2d/tiles/${tc}_${tr}.json`, "utf8"));
const FIT = doc.gameFit, ACERA = manifest.meta.aceraPx, realHalf = FIT.realRoadHalfM * ppm, range = FIT.interiorRangeM * ppm;
const streets = tile.roads.filter((r) => r.w >= 40);
function nearestStreet(x, y) {
  let best = null;
  for (const r of streets) {
    for (let i = 0; i + 3 < r.pts.length; i += 2) {
      const ax = r.pts[i], ay = r.pts[i + 1], bx = r.pts[i + 2], by2 = r.pts[i + 3];
      const L2 = (bx - ax) ** 2 + (by2 - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by2 - ay)) / L2));
      const qx = ax + (bx - ax) * t, qy = ay + (by2 - ay) * t, d = Math.hypot(x - qx, y - qy);
      if (!best || d < best.d) best = { d, qx, qy, kerb: r.w / 2 + ACERA, grow: Math.max(0, r.w / 2 + ACERA - realHalf) };
    }
  }
  return best;
}
// cuánto y hacia dónde se corre un punto: entero afuera del lazo, decreciendo adentro
function push(x, y, inner, extra = 0) {
  const n = nearestStreet(x, y);
  if (!n || n.d < 1 || n.d > 70 * ppm) return [x, y];
  const k = inner ? Math.max(0, 1 - Math.max(0, n.d - realHalf) / range) : 1;
  return [Math.round(x + (x - n.qx) / n.d * (n.grow * k + extra)), Math.round(y + (y - n.qy) / n.d * (n.grow * k + extra))];
}
const about = centroid(raw(doc.buildings.find((b) => b.id === FIT.interiorAbout).polygonLL)), K = FIT.interiorScale;
const shrink = ([x, y]) => [Math.round(about[0] + (x - about[0]) * K), Math.round(about[1] + (y - about[1]) * K)];
const outer = (lls) => lls.map(xy).flatMap(([x, y]) => push(x, y, false));
const rigid = (lls) => lls.map(xy).flatMap(shrink);
// el terreno es suelo y se acomoda al cordón; todo lo demás de adentro es rígido
const groundOf = (g) => (g.id === "balneario_grounds" ? g.polygonLL.map(xy).flatMap(([x, y]) => push(x, y, true))
  : g.use === "parking" ? outer(g.polygonLL) : rigid(g.polygonLL));

// ---- UN SOLO MALECÓN, CON FORMA LIMPIA: una banda que nace en la línea de centro
// de la calle y se abre hacia el mar con una sola curva suave
const old = manifest.malecon.find((b) => b.style === ML.style);
if (!old) { console.error(`[punta-preview] el mundo no trae un malecón de estilo ${ML.style}`); process.exit(1); }
const poolC0 = centroid(raw(B0.pools[0].polygonLL));
// la guía trazada, densa, y cada punto ajustado a la línea de centro del juego
const guide = ML.alongLL.map(xy), centre = [];
for (let i = 0; i + 1 < guide.length; i++) {
  const [ax, ay] = guide[i], [bx, by2] = guide[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, by2 - ay) / (3 * ppm)));
  for (let k = 0; k < n + (i + 2 === guide.length ? 1 : 0); k++) {
    const s2 = nearestStreet(ax + (bx - ax) * k / n, ay + (by2 - ay) * k / n);
    const last = centre[centre.length - 1];
    if (!last || Math.hypot(s2.qx - last[0], s2.qy - last[1]) > ppm) centre.push([s2.qx, s2.qy, s2.kerb]);
  }
}
// normales suaves hacia AFUERA (lejos de la piscina), y el largo recorrido
const N = centre.length, cum = [0];
for (let i = 1; i < N; i++) cum.push(cum[i - 1] + Math.hypot(centre[i][0] - centre[i - 1][0], centre[i][1] - centre[i - 1][1]));
const normal = centre.map((c, i) => {
  const a = centre[Math.max(0, i - 4)], b = centre[Math.min(N - 1, i + 4)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
  if ((c[0] - poolC0[0]) * nx + (c[1] - poolC0[1]) * ny < 0) { nx = -nx; ny = -ny; }
  return [nx, ny, (b[0] - a[0]) / L, (b[1] - a[1]) / L];
});
const tipXY = xy(ML.widthM.tipAtLL);
let tipI = 0;
for (let i = 1; i < N; i++) if (Math.hypot(centre[i][0] - tipXY[0], centre[i][1] - tipXY[1]) < Math.hypot(centre[tipI][0] - tipXY[0], centre[tipI][1] - tipXY[1])) tipI = i;
const ease = (u) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, u)))) / 2;
const widthAt = (i) => ppm * (i <= tipI
  ? ML.widthM.north + (ML.widthM.tip - ML.widthM.north) * ease(cum[i] / cum[tipI])
  : ML.widthM.tip + (ML.widthM.south - ML.widthM.tip) * ease((cum[i] - cum[tipI]) / (cum[N - 1] - cum[tipI])));
const offset = (i, d) => [centre[i][0] + normal[i][0] * d, centre[i][1] + normal[i][1] * d];
const outerEdge = centre.map((_, i) => offset(i, widthAt(i)));
const band = [...centre.map((c) => [c[0], c[1]]), ...outerEdge.slice().reverse()].flat().map(Math.round);
// ¿tapa la plazoleta vieja? lo que quede afuera se vería como tierra pelada
const oldPts = old.polys[0], missed = [];
for (let i = 0; i < oldPts.length; i += 2) if (!inside(oldPts[i], oldPts[i + 1], band)) missed.push([oldPts[i], oldPts[i + 1]]);
manifest.malecon = manifest.malecon.filter((b) => b !== old);
manifest.plazas = (manifest.plazas || []).filter((p) => p[4] !== ML.style);
manifest.malecon.push({ polys: [band], ang: old.ang, ...bbox(band), style: ML.style, id: "punta" });
const arms = [{ polys: [band] }];

// las figuras, en filas paralelas a la calle: cada fila se remuestrea sobre SÍ misma
const faroXY = push(...xy(doc.faro.towerLL), false), clearFaro = ML.clearFaroM * ppm;
function rows(spec, from, to, axisOf) {
  const out = [], half = spec.halfExtentM * ppm, step = spec.spacingM * ppm;
  for (let row = 0; row < 12; row++) {
    let run = step / 2 + (row % 2) * step / 2, prev = null;    // filas alternadas, como un aparejo
    for (let i = from; i <= to; i++) {
      const d = centre[i][2] + 1.5 * ppm + half + row * spec.rowM * ppm, p = offset(i, d);
      if (prev) {
        run += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        if (run >= step) {
          run -= step;
          const fits = d + half < widthAt(i) - 2.5 * ppm && Math.hypot(p[0] - faroXY[0], p[1] - faroXY[1]) > clearFaro;
          if (fits) out.push({ x: Math.round(p[0]), y: Math.round(p[1]), ang: axisOf(i) });
        }
      }
      prev = p;
    }
  }
  return out;
}
const tangent = (i) => Math.atan2(normal[i][3], normal[i][2]);      // de norte a sur
const fans = rows(ML.fans, 0, tipI, (i) => tangent(i) + Math.PI + ML.fans.leanDeg * Math.PI / 180).map((f) => ({ ...f, r: ML.fans.rM * ppm }));
const waves = rows(ML.waves, tipI, N - 1, (i) => tangent(i) + ML.waves.leanDeg * Math.PI / 180).map((w) => ({ ...w, len: ML.waves.lenM * ppm }));
const floor = [band];

// ---- manifest.punta: lo que `c2d/punta.js` pinta
const rot = offset(N - 1, (centre[N - 1][2] + widthAt(N - 1)) / 2).map(Math.round);
const punta = {
  grounds: B0.grounds.map((g) => ({ id: g.id, use: g.use, pts: groundOf(g) })),
  pools: B0.pools.map((p) => ({ id: p.id, use: p.use, zone: !!p.zone, pts: rigid(p.polygonLL) })),
  walls: B0.walls.map((l) => ({ id: l.id, pts: rigid(l.polylineLL) })),
  islands: B0.islands.map((g) => ({ id: g.id, use: g.use, pts: rigid(g.polygonLL) })),
  fans, waves,
  riprap: [{ id: "escollera", pts: outerEdge.flat().map(Math.round), w: ML.riprap.widthM * ppm }],
  rotondas: [{ x: rot[0], y: rot[1], r: ML.rotonda.rM * ppm }],
  props: B0.props.map((p) => (p.polygonLL ? { kind: p.kind, pts: rigid(p.polygonLL) } : { kind: p.kind, x: shrink(xy(p.ll))[0], y: shrink(xy(p.ll))[1] })),
};
Object.assign(punta, bbox([...punta.grounds.flatMap((g) => g.pts), ...floor.flat()]));
const G = punta.grounds[0].pts;

// ---- el manifest parchado: la ensenada deja de existir y el Faro va a su torre
const B = manifest.balneario;
const inBaln = (poly) => {
  const xs = poly.filter((_, i) => i % 2 === 0), ys = poly.filter((_, i) => i % 2 === 1);
  return B && Math.min(...xs) >= B.x0 - 60 && Math.max(...xs) <= B.x1 + 60 && Math.min(...ys) >= B.y0 - 60 && Math.max(...ys) <= B.y1 + 60;
};
const dropped = { waters: manifest.waters.filter(inBaln).length, parcels: 0, buildings: 0 };
manifest.waters = manifest.waters.filter((p) => !inBaln(p));
manifest.greens = (manifest.greens || []).filter((g) => !(g.type === "pool" && inBaln(g.pts)));
delete manifest.balneario;
manifest.parcels = manifest.parcels.filter((p) => { const hit = inside(p.cx, p.cy, G); dropped.parcels += hit; return !hit; });
const tower = push(...xy(doc.faro.towerLL), false), poolC = centroid(punta.pools[0].pts);
for (const lm of manifest.landmarks) {
  if (lm.id === "faro") { lm.x = tower[0]; lm.y = tower[1]; lm.commas = []; lm.rim = []; }   // comas y piedras viejas: las reemplazan las figuras y la escollera nueva
  if (lm.id === "balneario") { lm.x = Math.round(poolC[0]); lm.y = Math.round(poolC[1]); }
}
manifest.punta = punta;

// ---- el tile parchado: edificios, palmas y árboles van donde van los de todos
tile.buildings = tile.buildings.filter((b) => { const hit = inside(...centroid(b.pts), G); dropped.buildings += hit; return !hit; });
const isRoof = (b) => b.use === "canopy" || b.use === "pergola";
for (const b of doc.buildings) tile.buildings.push({ pts: rigid(b.polygonLL), color: b.color, roof: b.roof, wnd: isRoof(b) ? 0 : 1, name: b.name });
// lo ya sembrado sobre el suelo nuevo se quita: no se planta dos veces
const onNew = (o) => punta.grounds.some((g) => inside(o.x, o.y, g.pts)) || arms.some((a) => inside(o.x, o.y, a.polys[0]));
tile.palms = tile.palms.filter((o) => !onNew(o));
tile.trees = tile.trees.filter((o) => !onNew(o));
const crown = (rM) => Math.max(0.6, Math.min(1.9, rM * ppm / 17));
const seat = (ll) => { const q = xy(ll); return inside(q[0], q[1], groundsRaw) ? shrink(q) : push(q[0], q[1], false); };
for (const p of doc.palms) { const [x, y] = seat(p.ll); tile.palms.push({ x, y, s: 1.0, sway: (x * 0.37 + y * 0.11) % 6.28 }); }
for (const p of [...doc.trees, doc.faro.tree]) { const [x, y] = seat(p.ll); tile.trees.push({ x, y, s: crown(p.rM) }); }
console.log(`[punta-preview] fuera: ${dropped.waters} agua, ${dropped.parcels} parcelas, ${dropped.buildings} edificios · ` +
  `dentro: ${punta.grounds.length} suelos, ${punta.pools.length} piscinas, 1 malecón (${missed.length} vértices de la plazoleta vieja quedan afuera), ${fans.length} abanicos, ${waves.length} olas`);

// PW_CHROMIUM: un Chromium ya instalado, cuando el de Playwright no está en la máquina
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const asModule = (obj) => ({ status: 200, contentType: "text/javascript", body: `export default ${JSON.stringify(obj)};` });
await page.route("**/src/world2d/manifest.json*", (route) => route.fulfill(asModule(manifest)));
await page.route(`**/src/world2d/tiles/${tc}_${tr}.json*`, (route) => route.fulfill(asModule(tile)));
await page.addInitScript(() => {
  localStorage.setItem("churchill_intro_seen_v1", "1");
  localStorage.setItem("churchill_lang_v1", "es");
});
const cx = (punta.x0 + punta.x1) / 2, cy = (punta.y0 + punta.y1) / 2;
await page.goto(`${url}?editorPlay=1&x=${Math.round(cx)}&y=${Math.round(cy)}`, { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 60000 });
await page.waitForTimeout(2500);
if (!(await page.evaluate(() => !!window.WORLD2D.PUNTA))) { console.error("[punta-preview] el juego no recibió el manifest parchado"); process.exit(1); }

const shot = async (name, weather, x, y, zoom) => {
  await page.evaluate(async ({ weather, x, y, zoom }) => {
    const G = window.Game, W = window.WORLD2D, st = G.state;
    G.setAttract(false);
    G.startExplore({ weather, x: st.p.x, y: st.p.y });
    st.storyTip = null;
    await new Promise((r) => setTimeout(r, 700));
    st.paused = true;
    st.p.x = -9999; st.p.y = -9999;            // el carro fuera de cuadro: es una foto del lugar
    st.cam.x = x; st.cam.y = y; st.cam.zoom = zoom;
    W.update(x, y); await W.ready(x, y, 1800, 1200);
    for (const el of document.querySelectorAll("body > *:not(canvas), #root > *:not(canvas)")) {
      if (!el.querySelector("canvas")) el.style.display = "none";
    }
  }, { weather, x, y, zoom });
  await page.waitForTimeout(1300);
  const file = path.join(out, `punta-preview-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`[punta-preview] ${file}`);
  return file;
};

const fan = fans[Math.min(8, fans.length - 1)], wave = waves[Math.min(1, waves.length - 1)];
const whole = await shot("punta", "sunny", cx + 40, cy, 1.55);
await shot("piscina", "sunny", poolC[0] + 30, poolC[1], 3.4);
await shot("abanicos", "sunny", fan.x + 40, fan.y, 4.2);
await shot("olas", "sunny", wave.x + 40, wave.y + 20, 4.2);
await shot("noche", "night", cx + 40, cy, 1.55);
copyFileSync(whole, "docs/punta-space-mockup.png");
await browser.close();
if (errors.length) { console.error(`[punta-preview] errores de página: ${errors.join(" | ")}`); process.exit(1); }
