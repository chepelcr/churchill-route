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
// de la calle, con el círculo del Faro y los cinco malecones saliendo de ella
const old = manifest.malecon.find((b) => b.style === ML.style);
if (!old) { console.error(`[punta-preview] el mundo no trae un malecón de estilo ${ML.style}`); process.exit(1); }
const poolC0 = centroid(raw(B0.pools[0].polygonLL));
// la guía, densa (un punto por metro), y cada punto ajustado a la línea de centro del juego
const guide = ML.alongLL.map(xy), centre = [];
for (let i = 0; i + 1 < guide.length; i++) {
  const [ax, ay] = guide[i], [bx, by2] = guide[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, by2 - ay) / ppm));
  for (let k = 0; k < n + (i + 2 === guide.length ? 1 : 0); k++) {
    const s2 = nearestStreet(ax + (bx - ax) * k / n, ay + (by2 - ay) * k / n);
    const last = centre[centre.length - 1];
    if (!last || Math.hypot(s2.qx - last[0], s2.qy - last[1]) > ppm * 0.6) centre.push([s2.qx, s2.qy, s2.kerb]);
  }
}
// normales suaves hacia AFUERA (el lado contrario a la piscina), y el largo recorrido
const N = centre.length, cum = [0], WIN = 12;
for (let i = 1; i < N; i++) cum.push(cum[i - 1] + Math.hypot(centre[i][0] - centre[i - 1][0], centre[i][1] - centre[i - 1][1]));
let side = 0;
const normal = centre.map((c, i) => {
  const a = centre[Math.max(0, i - WIN)], b = centre[Math.min(N - 1, i + WIN)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
  // el lado se decide UNA vez, frente a la piscina, y se conserva: la guía va siempre en el mismo sentido
  if (!side) side = (c[0] - poolC0[0]) * nx + (c[1] - poolC0[1]) * ny < 0 ? -1 : 1;
  return [nx * side, ny * side, (b[0] - a[0]) / L, (b[1] - a[1]) / L];
});
const nearestI = ([x, y]) => { let best = 0, bd = Infinity; for (let i = 0; i < N; i++) { const d = Math.hypot(centre[i][0] - x, centre[i][1] - y); if (d < bd) { bd = d; best = i; } } return best; };
const tipI = nearestI(xy(ML.widthM.tipAtLL));
const ease = (u) => (1 - Math.cos(Math.PI * Math.max(0, Math.min(1, u)))) / 2;
const widthAt = (i) => ppm * (i <= tipI
  ? ML.widthM.north + (ML.widthM.tip - ML.widthM.north) * ease(cum[i] / cum[tipI])
  : ML.widthM.tip + (ML.widthM.south - ML.widthM.tip) * ease((cum[i] - cum[tipI]) / (40 * ppm)));
const offset = (i, d) => [centre[i][0] + normal[i][0] * d, centre[i][1] + normal[i][1] * d];
// lo que sale de la banda: polígonos convexos, y el borde de mar es su ENVOLVENTE
// sobre cada rayo — así el piso sigue siendo UN contorno, sin costuras por dentro
const reach = (i, poly) => {
  const [ox, oy] = centre[i], [dx, dy] = normal[i]; let far = 0;
  for (let k = 0, j = poly.length - 2; k < poly.length; j = k, k += 2) {
    const ex = poly[k] - poly[j], ey = poly[k + 1] - poly[j + 1], den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((poly[j] - ox) * ey - (poly[j + 1] - oy) * ex) / den, u = ((poly[j] - ox) * dy - (poly[j + 1] - oy) * dx) / den;
    if (t > 0 && u >= 0 && u <= 1) far = Math.max(far, t);
  }
  return far;
};
// el Faro: la torre al centro de su círculo, el círculo recién pasada la acera
const plazaR = doc.faro.plazaRM * ppm;
const faroXY = offset(tipI, centre[tipI][2] + plazaR + ppm).map(Math.round);
const circle = Array.from({ length: 40 }, (_, k) => [faroXY[0] + Math.cos(k / 40 * 2 * Math.PI) * plazaR, faroXY[1] + Math.sin(k / 40 * 2 * Math.PI) * plazaR]).flat();
const baseAt = (i) => Math.max(widthAt(i), reach(i, circle));
// los cinco malecones: el rectángulo de OSM, engordado, y corrido hasta que arranque en el borde del piso
const spurs = ML.spurs.at.map((sp) => {
  const c = sp.polygonLL.map(xy), cx = (c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, cy = (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4;
  const i = nearestI([cx, cy]), g = ML.spurs.growM * ppm;
  const along = c.map(([x, y]) => (x - centre[i][0]) * normal[i][0] + (y - centre[i][1]) * normal[i][1]);
  const shift = Math.max(0, baseAt(i) - Math.min(...along) - 2 * ppm);
  return c.flatMap(([x, y]) => { const L = Math.hypot(x - cx, y - cy) || 1; return [x + (x - cx) / L * g * 1.4 + normal[i][0] * shift, y + (y - cy) / L * g * 1.4 + normal[i][1] * shift]; });
});
const outerD = centre.map((_, i) => Math.max(baseAt(i), ...spurs.map((sp) => reach(i, sp))));
const outerEdge = centre.map((_, i) => offset(i, outerD[i]));
const band = [...centre.map((c) => [c[0], c[1]]), ...outerEdge.slice().reverse()].flat().map(Math.round);
// la plazoleta vieja y las bandas del Paseo que la nueva reemplaza: un solo malecón
const bb = bbox(band);
const replaced = manifest.malecon.filter((b) => { const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2; return mx > bb.x0 && mx < bb.x1 && my > bb.y0 && my < bb.y1; });
manifest.malecon = manifest.malecon.filter((b) => !replaced.includes(b));
manifest.plazas = (manifest.plazas || []).filter((p) => p[4] !== ML.style);
manifest.malecon.push({ polys: [band], ang: old.ang, ...bb, style: ML.style, id: "punta" });
const arms = [{ polys: [band] }];

// el patio de comidas: un puesto que da directo a la calle, a la par del parqueo
const FC = doc.foodCourt, fcI = nearestI(xy(FC.ll)), [fcL, fcD] = FC.sizeM.map((m) => m * ppm);
const fcIn = centre[fcI][2] + ppm, tx = normal[fcI][2], ty = normal[fcI][3], fcMid = offset(fcI, fcIn + fcD / 2);
const foodCourt = [[-1, -1], [1, -1], [1, 1], [-1, 1]].flatMap(([u, v]) => [
  Math.round(fcMid[0] + tx * u * fcL / 2 + normal[fcI][0] * v * fcD / 2), Math.round(fcMid[1] + ty * u * fcL / 2 + normal[fcI][1] * v * fcD / 2)]);
const parking = outer(B0.grounds.find((g) => g.use === "parking").polygonLL);

// las figuras: UNA fila al centro del malecón, remuestreada sobre sí misma
function row(spec, from, to, axisOf) {
  const out = [], half = spec.halfExtentM * ppm, step = spec.spacingM * ppm;
  let run = step / 2, prev = null;
  for (let i = from; i <= to; i++) {
    const d = (centre[i][2] + widthAt(i)) / 2, p = offset(i, d);
    if (prev) {
      run += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      if (run >= step) {
        run -= step;
        const fits = d - half > centre[i][2] && d + half < widthAt(i) + ppm
          && Math.hypot(p[0] - faroXY[0], p[1] - faroXY[1]) > plazaR + half
          && !inside(p[0], p[1], parking) && !inside(p[0], p[1], foodCourt);
        if (fits) out.push({ x: Math.round(p[0]), y: Math.round(p[1]), ang: axisOf(i) });
      }
    }
    prev = p;
  }
  return out;
}
const tangent = (i) => Math.atan2(normal[i][3], normal[i][2]);      // de norte a sur
const fans = row(ML.fans, 0, tipI, (i) => tangent(i) + Math.PI + ML.fans.leanDeg * Math.PI / 180).map((f) => ({ ...f, r: ML.fans.rM * ppm }));
const waves = row(ML.waves, tipI, N - 1, (i) => tangent(i) + ML.waves.leanDeg * Math.PI / 180).map((w) => ({ ...w, len: ML.waves.lenM * ppm }));
const floor = [band];

// ---- manifest.punta: lo que `c2d/punta.js` pinta
const rotI = nearestI(xy(ML.rotonda.centerLL)), rot = offset(rotI, (centre[rotI][2] + widthAt(rotI)) / 2).map(Math.round);
const punta = {
  grounds: B0.grounds.map((g) => ({ id: g.id, use: g.use, pts: g.use === "parking" ? parking : groundOf(g) })),
  pools: B0.pools.map((p) => ({ id: p.id, use: p.use, zone: !!p.zone, pts: rigid(p.polygonLL) })),
  walls: B0.walls.map((l) => ({ id: l.id, pts: rigid(l.polylineLL) })),
  islands: B0.islands.map((g) => ({ id: g.id, use: g.use, pts: rigid(g.polygonLL) })),
  fans, waves,
  riprap: [{ id: "escollera", pts: outerEdge.flat().map(Math.round), w: ML.riprap.widthM * ppm }],
  rotondas: [{ x: rot[0], y: rot[1], r: ML.rotonda.rM * ppm }, { x: faroXY[0], y: faroXY[1], r: plazaR - 1.6 * ppm }],
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
const tower = faroXY, poolC = centroid(punta.pools[0].pts);
for (const lm of manifest.landmarks) {
  if (lm.id === "faro") { lm.x = tower[0]; lm.y = tower[1]; lm.scale = doc.faro.scale; lm.commas = []; lm.rim = []; }   // comas y piedras viejas: las reemplazan las figuras y la escollera nueva
  if (lm.id === FC.replaces.kiosk) {            // el puesto deja el muelle y pasa a dar a la calle
    lm.x = Math.round(fcMid[0]); lm.y = Math.round(fcMid[1]); lm.name = FC.name;
    lm.spawn = offset(fcI, centre[fcI][2] - ACERA - 10).map(Math.round);
  }
  if (lm.id === "balneario") { lm.x = Math.round(poolC[0]); lm.y = Math.round(poolC[1]); }
}
manifest.piers = manifest.piers.filter((p) => p.id !== FC.replaces.pier);
const inOld = (x, y) => x > old.x0 - 40 && x < old.x1 + 40 && y > old.y0 - 40 && y < old.y1 + 40;
manifest.kioskPaths = manifest.kioskPaths.filter((k) => !inOld(k.pts[0], k.pts[1]) && !inOld(k.pts[2], k.pts[3]));
// LA COSTA VIEJA: la plazoleta de hoy es más ancha que el malecón nuevo, y lo que
// sobra sigue siendo TIERRA en el ráster. El build lo devolverá al mar; acá se
// tapa con una franja de agua pegada al borde nuevo, para ver el resultado.
const sea = [];
for (let i = 0; i < N; i++) if (inOld(...outerEdge[i])) sea.push(i);
if (sea.length) {
  const strip = [...sea.map((i) => offset(i, outerD[i] + 1)), ...sea.slice().reverse().map((i) => offset(i, outerD[i] + FIT.oldCoastM * ppm))];
  manifest.waters.push(strip.flat().map(Math.round));
}
manifest.punta = punta;

// ---- el tile parchado: edificios, palmas y árboles van donde van los de todos
tile.buildings = tile.buildings.filter((b) => { const hit = inside(...centroid(b.pts), G); dropped.buildings += hit; return !hit; });
const isRoof = (b) => b.use === "canopy" || b.use === "pergola";
tile.buildings.push({ pts: foodCourt, color: FC.color, roof: FC.roof, wnd: 0, name: FC.name });
for (const b of doc.buildings) tile.buildings.push({ pts: rigid(b.polygonLL), color: b.color, roof: b.roof, wnd: isRoof(b) ? 0 : 1, name: b.name });
// lo ya sembrado sobre el suelo nuevo se quita: no se planta dos veces
const onNew = (o) => Math.hypot(o.x - faroXY[0], o.y - faroXY[1]) < plazaR || (inside(o.x, o.y, old.polys[0]) && !inside(o.x, o.y, band)) || punta.grounds.some((g) => inside(o.x, o.y, g.pts)) || arms.some((a) => inside(o.x, o.y, a.polys[0]));
tile.palms = tile.palms.filter((o) => !onNew(o));
tile.trees = tile.trees.filter((o) => !onNew(o));
const crown = (rM) => Math.max(0.6, Math.min(1.9, rM * ppm / 17));
const seat = (ll) => { const q = xy(ll); return inside(q[0], q[1], groundsRaw) ? shrink(q) : push(q[0], q[1], false); };
const faroTree = offset(tipI + Math.round(plazaR / ppm) + 8, centre[tipI][2] + 5 * ppm).map(Math.round);
for (const p of doc.palms) { const [x, y] = seat(p.ll); tile.palms.push({ x, y, s: 1.0, sway: (x * 0.37 + y * 0.11) % 6.28 }); }
for (const p of doc.trees) { const [x, y] = seat(p.ll); tile.trees.push({ x, y, s: crown(p.rM) }); }
tile.trees.push({ x: faroTree[0], y: faroTree[1], s: crown(doc.faro.tree.rM) });   // el almendro, a la par del círculo
console.log(`[punta-preview] fuera: ${dropped.waters} agua, ${dropped.parcels} parcelas, ${dropped.buildings} edificios · ` +
  `dentro: ${punta.grounds.length} suelos, ${punta.pools.length} piscinas, 1 malecón de ${Math.round(cum[N - 1] / ppm)} m con ${spurs.length} lenguas (reemplaza ${replaced.length} bandas), ${fans.length} abanicos, ${waves.length} olas`);

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
const cx = faroXY[0], cy = faroXY[1];
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

const fan = fans[Math.max(0, fans.length - 4)], wave = waves[Math.min(3, waves.length - 1)];
const px0 = (faroXY[0] + poolC[0]) / 2 + 60, py0 = (faroXY[1] + poolC[1]) / 2 + 40;
const whole = await shot("punta", "sunny", px0, py0, 1.55);
await shot("faro", "sunny", faroXY[0] + 30, faroXY[1] + 20, 3.2);
await shot("piscina", "sunny", poolC[0] + 30, poolC[1], 3.4);
await shot("abanicos", "sunny", fan.x + 40, fan.y, 4.2);
await shot("olas", "sunny", wave.x + 40, wave.y + 20, 3.4);
await shot("paseo", "sunny", (bb.x0 + bb.x1) / 2 + 250, bb.y1 - 330, 1.25);
await shot("noche", "night", px0, py0, 1.55);
copyFileSync(whole, "docs/punta-space-mockup.png");
await browser.close();
if (errors.length) { console.error(`[punta-preview] errores de página: ${errors.join(" | ")}`); process.exit(1); }
