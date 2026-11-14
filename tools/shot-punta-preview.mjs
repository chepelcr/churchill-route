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
// PUNTA_ONLY=frente,cruceros saca sólo esas capturas (el recorrido completo son diez).
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
// la ensenada vieja del Balneario ES su cuadra: su contorno es el césped del Balneario sencillo
const inletRings = (() => { const B = manifest.balneario; if (!B) return []; return manifest.waters.filter((p) => { const xs = p.filter((_, i) => i % 2 === 0), ys = p.filter((_, i) => i % 2 === 1); return Math.min(...xs) >= B.x0 - 60 && Math.max(...xs) <= B.x1 + 60 && Math.min(...ys) >= B.y0 - 60 && Math.max(...ys) <= B.y1 + 60; }); })();
const raw = (lls) => lls.flatMap(xy);

// ---- EL ACOMODO A LA CALLE DEL JUEGO (`gameFit` en el registro dice por qué)
const groundsRaw = raw(B0.grounds[0].polygonLL);
const tc = Math.floor(groundsRaw[0] / tilePx), tr = Math.floor(groundsRaw[1] / tilePx);
const tile = JSON.parse(readFileSync(`src/world2d/tiles/${tc}_${tr}.json`, "utf8"));
const FIT = doc.gameFit, ACERA = manifest.meta.aceraPx, realHalf = FIT.realRoadHalfM * ppm, range = FIT.interiorRangeM * ppm;
// las calles de TODO el frente: el tile de La Punta y los del Paseo hasta el Muelle de Cruceros
const cruPier = manifest.piers.find((q) => q.id === doc.paseo.until.pier), untilX = cruPier.pts[0] + doc.paseo.until.pastM * ppm;
const parkP = manifest.parcels.find((q) => q.id === doc.cruceros.park.parcel), eastX = parkP.x1 - 30;
const frontTiles = [];
for (let c = tc; c <= Math.floor(eastX / tilePx); c++) for (const r of [tr, tr + 1]) {
  if (c === tc && r === tr) continue;
  try { frontTiles.push([`${c}_${r}`, JSON.parse(readFileSync(`src/world2d/tiles/${c}_${r}.json`, "utf8"))]); } catch { /* mar abierto: no hay tile */ }
}
const seen = new Set(), streets = [];
for (const t of [tile, ...frontTiles.map((f) => f[1])]) for (const r of t.roads || []) {
  const key = r.pts.slice(0, 4).join(",") + r.pts.length;
  if (r.w >= 40 && !seen.has(key)) { seen.add(key); streets.push(r); }
}
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
// LA EXPLANADA TERMINA DONDE TERMINA SU GUÍA; de ahí al Muelle de Cruceros la guía
// es la línea de centro del Paseo, tal como el mundo la emite
const endI = centre.length - 1;
let bendI = 0, eastI = 0;
{
  const chain = streets.filter((r) => doc.paseo.along.includes(r.name))
    .map((r) => { const q = []; for (let i = 0; i < r.pts.length; i += 2) q.push([r.pts[i], r.pts[i + 1]]); return q[0][0] <= q[q.length - 1][0] ? q : q.reverse(); })
    .sort((a, b) => a[0][0] - b[0][0]).flat();
  const kerb = 81 / 2 + ACERA, from = centre[endI][0];
  // …hasta donde la calle se abre tierra adentro: de ahí las franjas siguen DERECHAS
  const bendX = Math.min(...streets.filter((r) => r.name === doc.paseo.straightFrom).flatMap((r) => r.pts.filter((_, k) => k % 2 === 0))) - 25 * ppm;
  for (let i = 0; i + 1 < chain.length; i++) {
    const [ax, ay] = chain[i], [bx, by2] = chain[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, by2 - ay) / ppm));
    for (let k = 0; k < n; k++) {
      const x = ax + (bx - ax) * k / n, y = ay + (by2 - ay) * k / n, last = centre[centre.length - 1];
      if (x > from + ppm && x < Math.min(bendX, untilX) && Math.hypot(x - last[0], y - last[1]) > ppm * 0.6) centre.push([x, y, kerb]);
    }
  }
  bendI = centre.length - 1;
  const tail = centre[centre.length - 1], back = centre[centre.length - 160], run = Math.hypot(tail[0] - back[0], tail[1] - back[1]);
  const ux = (tail[0] - back[0]) / run, uy = (tail[1] - back[1]) / run;
  for (let k = 1; tail[0] + ux * k * ppm < untilX; k++) centre.push([tail[0] + ux * k * ppm, tail[1] + uy * k * ppm, kerb]);
  // EL TRAMO DEL PARQUE, al este del muelle: otra vez sobre la calle de verdad
  eastI = centre.length;
  for (let i = 0; i + 1 < chain.length; i++) {
    const [ax, ay] = chain[i], [bx, by2] = chain[i + 1], n = Math.max(1, Math.round(Math.hypot(bx - ax, by2 - ay) / ppm));
    for (let k = 0; k < n; k++) {
      const x = ax + (bx - ax) * k / n, y = ay + (by2 - ay) * k / n;
      if (x > cruPier.pts[0] - cruPier.w / 2 + 6 && x < eastX) centre.push([x, y, kerb]);   // arranca DEBAJO del muelle
    }
  }
}
// normales suaves hacia AFUERA (el lado contrario a la piscina), y el largo recorrido
const N = centre.length, cum = [0], WINS = centre.map((_, i) => (i <= endI ? 12 : 45));
for (let i = 1; i < N; i++) cum.push(cum[i - 1] + Math.hypot(centre[i][0] - centre[i - 1][0], centre[i][1] - centre[i - 1][1]));
let side = 0;
const normal = centre.map((c, i) => {
  // (la ventana no cruza el salto entre el tramo derecho y el del parque)
  const WIN = WINS[i], lo = i >= eastI ? eastI : 0, hi = i >= eastI ? N - 1 : eastI - 1, a = centre[Math.max(lo, i - WIN)], b = centre[Math.min(hi, i + WIN)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
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
// el círculo del Faro NO empuja el borde: el malecón es lo bastante ancho para tenerlo adentro
const baseAt = (i) => widthAt(i);
const spurMid = (sp) => { const c = sp.polygonLL.map(xy); return [(c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4]; };
// el Paseo, de ahí en adelante: verde contra la acera y playa al frente, las dos regulares
const kerbS = centre.map((_, i) => { let t = 0, n = 0; for (let k = Math.max(0, i - 14); k <= Math.min(N - 1, i + 14); k++) { t += centre[k][2]; n++; } return t / n; });
const PS = doc.paseo, JOIN = Math.round(PS.joinM), END = Math.round(PS.endM);
const joinK = (i) => ease((i - endI) / JOIN);
// el verde: nace en la unión y se cierra antes del tramo de los kioscos
const grow = (i) => ease(Math.min((i - endI) / JOIN, (bendI - i) / END));
// donde el verde se cierra, el malecón ocupa su franja: la plazoleta de los kioscos y los monumentos
const plazaK = (i) => (i >= eastI ? 0 : ease((i - (bendI - END)) / END));
const warmD = (i) => kerbS[i] + PS.maleconM * ppm + PS.plazaExtraM * ppm * plazaK(i);
// la piedra gris se angosta hasta morir contra el borde del malecón de baldosa…
const greyOutW = (i) => widthAt(endI) + (warmD(i) - widthAt(endI)) * joinK(i);
const greyIn = (i) => warmD(i) * joinK(i);
// …y el verde y la playa nacen a su lado
// el verde se angosta a nada donde empieza la plazoleta de los kioscos, y la playa se arrima con él
const greenDW = (i) => Math.max(greyOutW(i), widthAt(endI) + (kerbS[i] + PS.maleconM * ppm - widthAt(endI)) * joinK(i) + PS.greenM * ppm * joinK(i) * (1 - plazaK(i)));
const sandDW = (i) => greenDW(i) + PS.beachM * ppm;
// EL TRAMO DEL PARQUE: el parque es el remate del malecón; al frente, sólo playa.
// Sus dos líneas arrancan donde terminan las del tramo de los kioscos y se acomodan al parque.
const PK = doc.cruceros.park;
const along = (pt, i) => (pt[0] - centre[i][0]) * normal[i][0] + (pt[1] - centre[i][1]) * normal[i][1];
const parkOut = (() => { const i = eastI + Math.round((N - eastI) / 2); let best = i, bd = Infinity; for (let k = eastI; k < N; k++) { const dd = Math.hypot(centre[k][0] - parkP.cx, centre[k][1] - parkP.cy); if (dd < bd) { bd = dd; best = k; } } return along([parkP.cx, parkP.cy], best) + parkP.hh + 3; })();
// (ancho entero desde el primer metro: la unión con el tramo de los kioscos es un corte derecho)
// al final el MALECÓN se cierra en curva, con su piedra, contra la acera; la playa sigue derecha
// el malecón del este mide lo que el del oeste: sus dos líneas siguen las de enfrente, al otro lado del muelle
const rockW = eastI < N ? along(offset(eastI - 1, warmD(eastI - 1)), eastI) : 0, sandW = eastI < N ? along(offset(eastI - 1, sandDW(eastI - 1)), eastI) : 0;
const rockE = (i) => centre[i][2] + (rockW - centre[i][2]) * ease((N - 1 - i) / END);
const sandE = () => sandW;
const greyOut = (i) => (i >= eastI ? rockE(i) : greyOutW(i));
const greenD = (i) => (i >= eastI ? rockE(i) : greenDW(i));
const sandD = (i) => (i >= eastI ? sandE(i) : sandDW(i));
const seaAt = (i) => (i <= endI ? baseAt(i) : sandD(i));
// los cinco malecones: el rectángulo de OSM, engordado, y corrido hasta que salga al mar
const spurs = ML.spurs.at.map((sp) => {
  const c = sp.polygonLL.map(xy), [cx, cy] = spurMid(sp);
  const i = nearestI([cx, cy]), K2 = ML.spurs.scale;
  const along = c.map(([x, y]) => (x - centre[i][0]) * normal[i][0] + (y - centre[i][1]) * normal[i][1]);
  // en la piedra arranca en su borde; en el Paseo, a media playa, y cruza las dos franjas
  const root = i <= endI ? baseAt(i) - 2 * ppm : greenD(i) + PS.beachM * ppm * 0.45;
  const shift = Math.max(0, root - Math.min(...along));
  const lift = (K2 - 1) * (Math.max(...along) - Math.min(...along)) / 2;   // crece hacia el mar, no hacia la calle
  return { i, poly: c.flatMap(([x, y]) => [cx + (x - cx) * K2 + normal[i][0] * (shift + lift), cy + (y - cy) * K2 + normal[i][1] * (shift + lift)]) };
});
const spurD = centre.map((_, i) => (i > endI ? 0 : Math.max(0, ...spurs.map((sp) => reach(i, sp.poly)))));
const outerD = centre.map((_, i) => Math.max(seaAt(i), spurD[i]));
const greyD = centre.map((_, i) => Math.max(baseAt(i), spurD[i]));
const outerEdge = centre.map((_, i) => offset(i, outerD[i]));
const idx = Array.from({ length: endI + 1 }, (_, i) => i);
const paseoI = Array.from({ length: eastI - endI }, (_, k) => endI + k);        // arranca EN el final de la explanada: sin rendija
const eastIdx = Array.from({ length: N - eastI }, (_, k) => eastI + k);
const joinI = paseoI.filter((i) => i - endI <= JOIN);
const band = [...idx.map((i) => [centre[i][0], centre[i][1]]), ...joinI.map((i) => offset(i, greyIn(i))), ...joinI.slice().reverse().map((i) => offset(i, greyOut(i))), ...idx.slice().reverse().map((i) => offset(i, greyD[i]))].flat().map(Math.round);
// las lenguas del Paseo: piedra desde la acera hasta su punta, cruzando verde y playa
const runs = (test, from, to) => { const out = []; let cur = null; for (let i = from; i <= to; i++) { if (test(i)) { (cur || (cur = [], out.push(cur), cur)).push(i); } else cur = null; } return out; };
const tongues = runs((i) => spurD[i] > 0, endI + JOIN + 1, N - 1).map((r) => [...r.map((i) => offset(i, centre[i][2] - 2)), ...r.slice().reverse().map((i) => offset(i, spurD[i]))].flat().map(Math.round));
const strip = (r, d0, d1) => [...r.map((i) => offset(i, d0(i))), ...r.slice().reverse().map((i) => offset(i, d1(i)))].flat().map(Math.round);
const inlandRaw = centre.map((c, i) => { if (i <= endI || i >= eastI) return 0; const q = nearestStreet(c[0], c[1]); return Math.min(0, (q.qx - c[0]) * normal[i][0] + (q.qy - c[1]) * normal[i][1]); });
const inland = centre.map((_, i) => { let t = 0, n = 0; for (let k = Math.max(0, i - 10); k <= Math.min(N - 1, i + 10); k++) { t += inlandRaw[k]; n++; } return t / n; });
const warm = paseoI.length ? strip(paseoI, (i) => inland[i], warmD) : null;
const green = paseoI.length ? strip(paseoI, (i) => greyOut(i) - 1, greenD) : null;
// la playa: al frente del verde en el Paseo, y ENTRE lengua y lengua en la piedra
const sands = paseoI.length ? [strip(paseoI, (i) => greenD(i) - 1, sandD)] : [];
if (eastIdx.length) sands.push(strip(eastIdx, (i) => rockE(i) - 1, sandE));
// al este del muelle la franja del parque es malecón de baldosa, de la calle a la línea de piedra
const warmE = eastIdx.length ? strip(eastIdx, () => 0, rockE) : null;
const firstSpurEnd = Math.max(...idx.filter((i) => spurD[i] > 0 && i < endI - 20 && Math.abs(i - spurs[0].i) < 60), tipI);
for (const r of runs((i) => spurD[i] === 0, firstSpurEnd, endI)) if (r.length > 12) sands.push(strip(r, (i) => baseAt(i) - 1, (i) => baseAt(i) + ML.cove.beachM * ppm));
// el frente viejo que todo esto reemplaza: la plazoleta, las bandas color arena y su playa irregular
const bb = bbox([...band, ...(green || []), ...sands.flat()]);
const within = (x, y, m = 0) => x > bb.x0 - m && x < bb.x1 + m && y > bb.y0 - m && y < bb.y1 + m;
const replaced = manifest.malecon.filter((b) => within((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2));
manifest.malecon = manifest.malecon.filter((b) => !replaced.includes(b));
manifest.plazas = (manifest.plazas || []).filter((p) => p[4] !== ML.style);
if (warm) manifest.malecon.push({ polys: [warm], ang: replaced.find((b) => !b.style)?.ang ?? old.ang, ...bbox(warm), id: "punta_paseo" });
if (warmE) manifest.malecon.push({ polys: [warmE], ang: replaced.find((b) => !b.style)?.ang ?? old.ang, ...bbox(warmE), id: "punta_parque" });
manifest.malecon.push({ polys: [band], ang: old.ang, ...bbox(band), style: ML.style, id: "punta" });
for (const [k, tg] of tongues.entries()) manifest.malecon.push({ polys: [tg], ang: old.ang, ...bbox(tg), style: ML.style, id: `punta_lengua_${k}` });
// la arena vieja de este tramo: los anillos que caen enteros se van; al que sigue
// hacia el este se le quitan los vértices de acá (un corte recto: es un preview)
const seaward = (x, y) => { const i = nearestI([x, y]); return (x - centre[i][0]) * normal[i][0] + (y - centre[i][1]) * normal[i][1] > 0 && Math.hypot(x - centre[i][0], y - centre[i][1]) < FIT.oldCoastM * ppm; };
let sandCut = 0;
manifest.beaches = manifest.beaches.map((ring) => {
  const keep = [];
  for (let i = 0; i < ring.length; i += 2) if (!(within(ring[i], ring[i + 1], 30) && seaward(ring[i], ring[i + 1]))) keep.push(ring[i], ring[i + 1]);
  if (keep.length !== ring.length) sandCut++;
  return keep;
}).filter((ring) => ring.length >= 6);
const arms = [{ polys: [band] }, ...tongues.map((tg) => ({ polys: [tg] })), ...(warm ? [{ polys: [warm] }] : [])];
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
        const fits = d - half > centre[i][2] - ppm && d + half < widthAt(i) + ppm
          && Math.hypot(p[0] - faroXY[0], p[1] - faroXY[1]) > plazaR + half * 0.7
          && !inside(p[0], p[1], parking);
        if (fits) out.push({ x: Math.round(p[0]), y: Math.round(p[1]), ang: axisOf(i) });
      }
    }
    prev = p;
  }
  return out;
}
const tangent = (i) => Math.atan2(normal[i][3], normal[i][2]);      // de norte a sur
const fans = row(ML.fans, 0, tipI, (i) => tangent(i) + Math.PI + ML.fans.leanDeg * Math.PI / 180).map((f) => ({ ...f, r: ML.fans.rM * ppm }));
const rotI = Math.min(endI, nearestI(xy(ML.rotonda.centerLL)));
const waves = row(ML.waves, tipI, rotI - Math.round(ML.rotonda.rM), (i) => tangent(i) + ML.waves.leanDeg * Math.PI / 180).map((w) => ({ ...w, len: ML.waves.lenM * ppm }));
const floor = [band];
// la escollera: el borde de mar del brazo norte hasta rodear la lengua del Faro, y cada otra lengua
// la escollera es UNA línea: el borde de la explanada —lenguas incluidas—, la unión, y de ahí entre el malecón y el verde
const riprap = [{ id: "escollera", pts: [...idx.map((i) => offset(i, greyD[i])), ...(PS.riprap ? [...paseoI, ...eastIdx].map((i) => offset(i, greyOut(i))) : [])].flat().map(Math.round), w: ML.riprap.widthM * ppm }];

// ---- manifest.punta: lo que `c2d/punta.js` pinta
const rot = offset(rotI, (centre[rotI][2] + widthAt(rotI)) / 2).map(Math.round);
const punta = {
  grounds: [...(B0.simple ? inletRings.map((pts, k) => ({ id: `balneario_cuadra_${k}`, use: "lawn", pts })) : []), ...B0.grounds.filter((g) => !(B0.simple && g.id === "balneario_grounds")).map((g) => ({ id: g.id, use: g.use, pts: g.use === "parking" ? parking : groundOf(g) }))],
  pools: B0.pools.map((p) => ({ id: p.id, use: p.use, zone: !!p.zone, pts: rigid(p.polygonLL) })),
  walls: B0.walls.map((l) => ({ id: l.id, pts: rigid(l.polylineLL) })),
  islands: B0.islands.map((g) => ({ id: g.id, use: g.use, pts: rigid(g.polygonLL) })),
  fans, waves,
  riprap,
  sands: sands.map((pts) => ({ pts })),
  greens: green ? [{ pts: green, type: PS.green }] : [],
  rotondas: [{ x: rot[0], y: rot[1], r: ML.rotonda.rM * ppm }],
  discs: [{ x: faroXY[0], y: faroXY[1], r: plazaR }],
  fun: B0.simple ? [] : B0.fun.map((f) => (f.pathLL ? { kind: f.kind, color: f.color, pts: rigid(f.pathLL) } : { kind: f.kind, color: f.color, x: shrink(xy(f.ll))[0], y: shrink(xy(f.ll))[1] })),
  props: B0.simple ? [] : B0.props.map((p) => (p.polygonLL ? { kind: p.kind, pts: rigid(p.polygonLL) } : { kind: p.kind, x: shrink(xy(p.ll))[0], y: shrink(xy(p.ll))[1] })),
};
Object.assign(punta, bbox([...punta.grounds.flatMap((g) => g.pts), ...floor.flat(), ...sands.flat(), ...tongues.flat(), ...(green || [])]));
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
  if (lm.id === "balneario") { lm.x = Math.round(poolC[0]); lm.y = Math.round(poolC[1]); }
}
// EL MUELLE SE QUEDA: nace en el borde del malecón nuevo, y su calle auxiliar sigue
// ahí, manejable y sin pintar — un huevo de pascua
const MU = doc.muelle, pier = manifest.piers.find((q) => q.id === MU.pier);
const lane = manifest.kioskPaths.find((k) => Math.hypot(k.pts[0] - pier.pts[0], k.pts[1] - pier.pts[1]) < 30 || Math.hypot(k.pts[2] - pier.pts[0], k.pts[3] - pier.pts[1]) < 30);
if (lane) {
  lane.hidden = !!MU.hiddenLane;
  const far = Math.hypot(lane.pts[0] - pier.pts[0], lane.pts[1] - pier.pts[1]) < 30 ? 0 : 2, near = 2 - far;
  const [sx, sy, ex, ey] = [lane.pts[near], lane.pts[near + 1], lane.pts[far], lane.pts[far + 1]];
  let last = 0;                                  // dónde sale la calle del piso: ahí arranca la madera
  for (let u = 0; u <= 1; u += 0.01) if (inside(sx + (ex - sx) * u, sy + (ey - sy) * u, band)) last = u;
  pier.pts[0] = Math.round(sx + (ex - sx) * (last - 0.03)); pier.pts[1] = Math.round(sy + (ey - sy) * (last - 0.03));
}
// LA COSTA VIEJA: lo que queda de tierra más allá del frente nuevo sigue siendo TIERRA
// en el ráster. El build lo devolverá al mar; acá se tapa con una franja de agua.
{
  const all = Array.from({ length: N }, (_, i) => i);
  manifest.waters.push(strip(all, (i) => outerD[i] + 1, (i) => outerD[i] + FIT.oldCoastM * ppm));
}
// ---- LA ENTRADA DEL MUELLE DE CRUCEROS
const CR = doc.cruceros;
let capAt = null, capRow = null;
{
  // el muelle se corre al norte hasta el final de su calle: una sola línea, y la playa pasa por debajo
  const st = streets.filter((r) => r.name === CR.street).map((r) => [[r.pts[0], r.pts[1]], [r.pts[r.pts.length - 2], r.pts[r.pts.length - 1]]]).flat()
    .sort((a, b) => Math.hypot(a[0] - cruPier.pts[0], a[1] - cruPier.pts[1]) - Math.hypot(b[0] - cruPier.pts[0], b[1] - cruPier.pts[1]))[0];
  cruPier.pts[0] = st[0]; cruPier.pts[1] = st[1] - 4;
  // el muelle mide de ancho lo que su arco; la estructura blanca sale y la caseta azul ocupa su sitio
  cruPier.w = Math.round(CR.gate.widthM * ppm);
  const hx0 = Math.round(cruPier.pts[0] - (cruPier.w / 2 + 17 * ppm)), ci = Math.min(eastI - 1, nearestI([hx0, cruPier.pts[1] + 60])), hutY0 = Math.round(offset(ci, warmD(ci) - 9 * ppm)[1]);
  manifest.landmarks = manifest.landmarks.filter((q) => q.id !== CR.dropLandmark);
  // las banderas, a los dos lados del muelle
  punta.flags = [];
  for (let k = 0; k < CR.flags.count; k++) for (const sd of [-1, 1]) punta.flags.push({ x: cruPier.pts[0] + sd * (cruPier.w / 2 - 3), y: Math.round(cruPier.pts[1] + (CR.flags.firstM + k * CR.flags.everyM) * ppm) });
  punta.gates = [{ x: cruPier.pts[0], y: cruPier.pts[1] + 10, w: CR.gate.widthM * ppm, ang: 0, text: CR.gate.text }];
  // la Capitanía, donde OSM tiene el edificio del MOPT
  for (const [, nb] of frontTiles) {
    const b = (nb.buildings || []).find((q) => q.name === CR.capitania.replacesBuilding);
    if (!b) continue;
    const [bx, by3] = centroid(b.pts);
    nb.buildings = nb.buildings.filter((q) => q !== b);
    for (const lm of manifest.landmarks) if (lm.id === CR.capitania.landmark) { lm.x = Math.round(bx); lm.y = Math.round(by3 + CR.capitania.southM * ppm); capAt = [lm.x, lm.y]; }
  }
  manifest.parcels = manifest.parcels.filter((q) => q.id !== CR.capitania.dropParcel);
  // LA FILA DE LA CAPITANÍA: kioscos y Cañones van a su misma distancia de la calle
  { const ic = Math.min(eastI - 1, nearestI(capAt)); capRow = along(capAt, ic) - CR.kiosks.rowNudgeM * ppm; }
  // la caseta, en la columna de la Capitanía: al sur de ella y un poco más al norte de donde estaba
  cruPier.hutAt = [capAt[0], Math.round(Math.max(capAt[1] + CR.caseta.clearM * ppm, hutY0 - CR.caseta.northM * ppm))];
  if (CR.park.dropParcel) manifest.parcels = manifest.parcels.filter((q) => q.id !== CR.park.parcel);
  manifest.piers = manifest.piers.filter((q) => !CR.dropPiers.includes(q.id));
  // los kioscos suben al malecón de baldosa; su calle auxiliar se queda, sin pintar
  for (const id of CR.kiosks.ids) {
    const lm = manifest.landmarks.find((q) => q.id === id);
    const lane = manifest.kioskPaths.find((k) => Math.hypot(k.pts[0] - lm.x, k.pts[1] - lm.y) < 30 || Math.hypot(k.pts[2] - lm.x, k.pts[3] - lm.y) < 30);
    const i = Math.min(eastI - 1, nearestI([lm.x, lm.y])), [nx2, ny2] = offset(i, Math.min(capRow, warmD(i) - 5 * ppm)).map(Math.round);
    if (lane) { const k = Math.hypot(lane.pts[0] - lm.x, lane.pts[1] - lm.y) < 30 ? 0 : 2; lane.pts[k] = nx2; lane.pts[k + 1] = ny2; lane.hidden = !!CR.kiosks.hiddenLanes; }
    lm.x = nx2; lm.y = ny2;
  }
}
if (B0.simple) manifest.pois = (manifest.pois || []).filter((q) => !(inletRings.some((r) => inside(q.x, q.y, r)) || inside(q.x, q.y, groundsRaw)));
manifest.punta = punta;
let neighbours = [];

// ---- el tile parchado: edificios, palmas y árboles van donde van los de todos
tile.buildings = tile.buildings.filter((b) => { const hit = inside(...centroid(b.pts), G); dropped.buildings += hit; return !hit; });
const isRoof = (b) => b.use === "canopy" || b.use === "pergola";
// NINGÚN EDIFICIO SOBRE LA CALLE: el que quede con un vértice dentro del cordón se corre, entero, lo que le falte
const offStreet = (pts) => {
  for (let pass = 0; pass < 4; pass++) {
    let worst = null;
    for (let i = 0; i < pts.length; i += 2) { const n = nearestStreet(pts[i], pts[i + 1]), lack = n.kerb + 4 - n.d; if (lack > 0 && (!worst || lack > worst.lack)) worst = { lack, ux: (pts[i] - n.qx) / (n.d || 1), uy: (pts[i + 1] - n.qy) / (n.d || 1) }; }
    if (!worst) break;
    for (let i = 0; i < pts.length; i += 2) { pts[i] = Math.round(pts[i] + worst.ux * worst.lack); pts[i + 1] = Math.round(pts[i + 1] + worst.uy * worst.lack); }
  }
  return pts;
};
const roofs = [];
for (const b of B0.simple ? [] : doc.buildings) {
  if (B0.dropBuildings.includes(b.id)) continue;
  const pts = offStreet(rigid(b.polygonLL));
  if (isRoof(b)) roofs.push({ kind: b.use, pts });            // toldos y pérgola: techos de verdad, los pinta c2d/punta.js
  else tile.buildings.push({ pts, color: b.color, roof: b.roof, wnd: 1, name: b.name });
}
punta.roofs = roofs;
// lo ya sembrado sobre el suelo nuevo se quita: no se planta dos veces
// EL MOBILIARIO Y LAS PALMERAS, EN ORDEN. Todo lo que el mundo tenía sembrado del lado
// del mar de este frente sale (menos los árboles de la acera) y se pone en fila.
const FU = doc.furniture;
const rockAt = (i) => (i <= endI ? greyD[i] : greyOut(i));
const sideOf = (o) => { const i = nearestI([o.x, o.y]), dd = (o.x - centre[i][0]) * normal[i][0] + (o.y - centre[i][1]) * normal[i][1]; return { i, dd, off: Math.hypot(o.x - centre[i][0] - normal[i][0] * dd, o.y - centre[i][1] - normal[i][1] * dd) }; };
const inFront = (o, from = 0) => { const q = sideOf(o); return q.off < 45 * ppm && q.dd > centre[q.i][2] + from && q.dd < outerD[q.i] + FIT.oldCoastM * ppm; };
const inNewSea = (o) => { const q = sideOf(o); return q.off < 20 * ppm && q.dd > outerD[q.i] - 2 && q.dd < outerD[q.i] + FIT.oldCoastM * ppm; };
const tilesByKey = new Map([[`${tc}_${tr}`, tile], ...frontTiles]);
const tileAt = (x, y) => tilesByKey.get(`${Math.floor(x / tilePx)}_${Math.floor(y / tilePx)}`);
for (const t of tilesByKey.values()) {
  t.palms = (t.palms || []).filter((o) => !inFront(o) && Math.hypot(o.x - faroXY[0], o.y - faroXY[1]) > plazaR);
  t.trees = (t.trees || []).filter((o) => !inFront(o, FU.keepStreetTreesM * ppm));
}
// una fila sobre SU línea: `d` dice a qué distancia de la calle, `ok` dónde sí
const along2 = (stepM, d, ok) => { const out = []; let run = 0, prev = null; for (let i = 0; i < N; i++) { if (i === eastI) prev = null; const pt = offset(i, d(i)); if (prev) run += Math.hypot(pt[0] - prev[0], pt[1] - prev[1]); prev = pt; if (run >= stepM * ppm) { run = 0; if (ok(i)) out.push({ i, x: Math.round(pt[0]), y: Math.round(pt[1]) }); } } return out; };
const calm = (i) => spurD[i] === 0 && (i < endI || i > endI + JOIN) && N - 1 - i > END && Math.hypot(centre[i][0] - cruPier.pts[0], centre[i][1] - cruPier.pts[1]) > 40 * ppm;
// LOS MONUMENTOS, sobre el frente: cada uno en su punto, girado con la calle
punta.monuments = doc.monuments.map((mo) => {
  const i = Math.min(eastI - 1, nearestI(xy(mo.ll)));
  // la Concha llena el malecón: de la acera de la calle de verdad a la piedra, menos el paso del lado de la playa
  const start = Math.min(0, inland[i]) + centre[i][2], size = mo.fill ? (rockAt(i) - start - mo.walkM * ppm - ppm) / 2.1 : 0;
  const dd = mo.fill ? start + ppm + size * 1.04 : mo.alignTo ? Math.min(capRow, rockAt(i) - 8 * ppm) : rockAt(i) - mo.fromRocksM * ppm, [x, y] = offset(i, dd).map(Math.round);
  return { id: mo.id, kind: mo.kind, text: mo.text, x, y, r: (mo.plazaRM || 0) * ppm, size, ang: mo.compass ? 0 : Math.atan2(normal[i][3], normal[i][2]) + (mo.rotDeg || 0) * Math.PI / 180 };
});
// lo que quede parado SOBRE el malecón de baldosa sale: el malecón es de la gente, los kioscos y los monumentos
for (const t of tilesByKey.values()) t.buildings = (t.buildings || []).filter((b) => !(warm && inside(...centroid(b.pts), warm)));
for (const t of tilesByKey.values()) t.buildings = (t.buildings || []).filter((b) => { const [bx, by3] = centroid(b.pts); return !(inFront({ x: bx, y: by3 }) && punta.monuments.some((mo) => mo.kind !== "cannons" && Math.hypot(mo.x - bx, mo.y - by3) < FU.clearBuildingsM * ppm)); });
const nearMonument = (q) => punta.monuments.some((mo) => Math.hypot(mo.x - q.x, mo.y - q.y) < FU.clearMonumentsM * ppm);
let planted = 0;
for (const q of along2(FU.palmEveryM, (i) => rockAt(i) + FU.palmPastRocksM * ppm, (i) => calm(i) && i > firstSpurEnd)) {
  const t = tileAt(q.x, q.y); if (!t || nearMonument(q)) continue;
  (t.palms || (t.palms = [])).push({ x: q.x, y: q.y, s: 1.0, sway: (q.x * 0.37 + q.y * 0.11) % 6.28 }); planted++;
}
const oldBenches = (manifest.signs || []).filter((o) => o.kind === "banca" && inFront(o, -ACERA));
manifest.signs = (manifest.signs || []).filter((o) => !oldBenches.includes(o) && !(typeof o.x === "number" && inNewSea(o)));
const benches = along2(FU.benchEveryM, (i) => rockAt(i) - FU.benchFromRocksM * ppm, (i) => calm(i) && rockAt(i) - FU.benchFromRocksM * ppm > centre[i][2] + 2 * ppm);
for (const q of benches) if (!nearMonument(q)) manifest.signs.push({ x: q.x, y: q.y, kind: "banca", ang: Math.round(Math.atan2(normal[q.i][1], normal[q.i][0]) * 1000) / 1000 });
// el haz del Faro: sale de la linterna, arriba de la torre
const towerArt = JSON.parse(readFileSync("src/assets/world-props.json", "utf8")).scenes.faro.parts.find((q) => q.verb === "lighthouse-tower");
punta.beams = doc.faro.beam ? [{ x: faroXY[0], y: Math.round(faroXY[1] - towerArt.height * towerArt.lean * doc.faro.scale) }] : [];
const crown = (rM) => Math.max(0.6, Math.min(1.9, rM * ppm / 17));
const seat = (ll) => { const q = xy(ll); return inside(q[0], q[1], groundsRaw) ? shrink(q) : push(q[0], q[1], false); };
const faroTree = offset(tipI + Math.round(plazaR / ppm) + 8, centre[tipI][2] + 5 * ppm).map(Math.round);
for (const p of doc.palms) { const [x, y] = seat(p.ll); tile.palms.push({ x, y, s: 1.0, sway: (x * 0.37 + y * 0.11) % 6.28 }); }
for (const p of doc.trees) { const [x, y] = seat(p.ll); tile.trees.push({ x, y, s: crown(p.rM) }); }
tile.trees.push({ x: faroTree[0], y: faroTree[1], s: crown(doc.faro.tree.rM) });   // el almendro, a la par del círculo
console.log(`[punta-preview] fuera: ${dropped.waters} agua, ${dropped.parcels} parcelas, ${dropped.buildings} edificios · ` +
  `dentro: ${punta.grounds.length} suelos, ${punta.pools.length} piscinas, 1 malecón de ${Math.round(cum[N - 1] / ppm)} m (${Math.round(cum[endI] / ppm)} de piedra) con ${spurs.length} lenguas, ${sands.length} playas (reemplaza ${replaced.length} bandas, recorta ${sandCut} anillos de arena), ${fans.length} abanicos, ${waves.length} olas, ${planted} palmeras en fila, ${benches.length} bancas (de ${oldBenches.length} sueltas), ${punta.monuments.length} monumentos`);

// PW_CHROMIUM: un Chromium ya instalado, cuando el de Playwright no está en la máquina
for (const [key, nb] of frontTiles) neighbours.push([key, nb]);
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const asModule = (obj) => ({ status: 200, contentType: "text/javascript", body: `export default ${JSON.stringify(obj)};` });
await page.route("**/src/world2d/manifest.json*", (route) => route.fulfill(asModule(manifest)));
await page.route(`**/src/world2d/tiles/${tc}_${tr}.json*`, (route) => route.fulfill(asModule(tile)));
for (const [key, nb] of neighbours) await page.route(`**/src/world2d/tiles/${key}.json*`, (route) => route.fulfill(asModule(nb)));
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
  if (process.env.PUNTA_ONLY && !process.env.PUNTA_ONLY.split(",").includes(name)) return null;
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
await shot("paseo", "sunny", centre[Math.round(endI * 0.8)][0] - 40, centre[Math.round(endI * 0.8)][1] + 80, 1.3);
await shot("union", "sunny", centre[endI][0] + 60, centre[endI][1] + 80, 1.5);
await shot("frente", "sunny", centre[Math.round((endI + N) / 2)][0], centre[Math.round((endI + N) / 2)][1] + 90, 1.0);
await shot("cruceros", "sunny", cruPier.pts[0] - 60, cruPier.pts[1] - 10, 1.3);
await shot("parque", "sunny", (cruPier.pts[0] + eastX) / 2, centre[Math.round((eastI + N) / 2)][1] + 100, 0.85);
await shot("kioscos", "sunny", centre[bendI][0] + 60, centre[bendI][1] + 60, 1.2);
await shot("noche", "night", px0, py0, 1.55);
await shot("faro-noche", "night", faroXY[0] + 30, faroXY[1] + 40, 2.2);
await shot("monumentos", "sunny", (punta.monuments[0].x + punta.monuments[2].x) / 2, punta.monuments[0].y + 10, 1.75);
if (whole) copyFileSync(whole, "docs/punta-space-mockup.png");
await browser.close();
if (errors.length) { console.error(`[punta-preview] errores de página: ${errors.join(" | ")}`); process.exit(1); }
