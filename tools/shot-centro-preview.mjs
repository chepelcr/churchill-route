// EL CENTRO CÍVICO — Parque Mora y Cañas y la manzana de la Catedral, trazados.
//
//   ./reboot-server.sh 8736
//   node tools/shot-centro-preview.mjs [devUrl] [dirSalida]     # el preview, sin tocar el mundo
//   node tools/shot-centro-preview.mjs --emit                   # ESTO ES EL BUILD: escribe src/world2d
//   node tools/shot-centro-preview.mjs --check                  # sólo calcula y cuenta, sin navegador
//
// Lee `content/world/centro.json` (lugares en METROS, cada uno en el marco de
// su cuadra) y lo lleva a píxeles de mundo con la afín del manifest. Es el
// mismo método de La Punta (`shot-punta-preview.mjs`): lo que sale es
// `manifest.centro` para `c2d/centro.js`, más los árboles, palmas y postes en
// su tile como todos los demás.
//
// CORRE DESPUÉS DE LA PUNTA Y SE PUEDE REPETIR. No necesita un mundo prístino:
// dentro del contorno `own` de cada lugar TODO lo que no sea calzada es de este
// registro, así que cada corrida lo rehace entero —ráster incluido— y dos
// corridas seguidas dan el mismo mundo byte a byte. `pnpm world:build` lo
// encadena detrás de `world:punta`.
//
// QUÉ ESTAMPA `--emit` (la física ve lo mismo que se dibuja):
//   · la cuadra vuelve a `land`, con su anillo de `acera` a la distancia de
//     siempre de la calzada;
//   · lo `paved` pasa a `boulevard` — transitable, lento: es el piso gris;
//   · cada `mouth` abre la acera hasta el asfalto, que es por donde se entra;
//   · una estructura `solid` vuelve a ser `land` aunque esté sobre el piso.
// Las islas verdes y los edificios son `land` sin que nadie lo diga.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { area2, bbox, buildBody, footprint, wound } from "../src/render/c2d/bodyGeometry.js";

const WORLD = "src/world2d";
const args = process.argv.slice(2);
const EMIT = args.includes("--emit"), CHECK = args.includes("--check");
const [url = "http://localhost:8736/", out = "logs"] = args.filter((a) => !a.startsWith("--"));

const doc = JSON.parse(readFileSync("content/world/centro.json", "utf8"));
const manifest = JSON.parse(readFileSync(`${WORLD}/manifest.json`, "utf8"));
const { geo, pxPerMeter: ppm, tilePx, cell: CELL, aceraPx } = manifest.meta;
const C = { water: 0, land: 1, road: 3, acera: 6, boulevard: 7 };
const RAD = Math.PI / 180;
const r1 = (v) => Math.round(v * 10) / 10;

// ───────────────────────────── geometría ─────────────────────────────
const inside = (x, y, pts) => {
  let hit = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
};
// el marco de un lugar: metros [u este, v sur] → píxeles de mundo
function frameOf(place) {
  const [lat, lon] = place.originLL;
  const ox = geo.ax * lon + geo.bx, oy = geo.ay * lat + geo.by;
  const a = place.axisDeg * RAD, ux = Math.cos(a), uy = Math.sin(a);
  const at = ([u, v]) => [ox + (u * ux - v * uy) * ppm, oy + (u * uy + v * ux) * ppm];
  return { ox, oy, ang: a, at, flat: (uv) => uv.flatMap((p) => at(p).map(r1)) };
}

// ───────────────────────────── el mundo de hoy ─────────────────────────────
const tiles = new Map();
const tileKey = (x, y) => `${Math.floor(x / tilePx)}_${Math.floor(y / tilePx)}`;
function loadTile(key) {
  if (!tiles.has(key)) {
    const t = JSON.parse(readFileSync(`${WORLD}/tiles/${key}.json`, "utf8"));
    const rle = Buffer.from(t.rle, "base64"), g = new Uint8Array(t.cols * t.rows);
    let o = 0;
    for (let k = 0; k + 1 < rle.length; k += 2) { g.fill(rle[k + 1], o, o + rle[k]); o += rle[k]; }
    tiles.set(key, { t, g });
  }
  return tiles.get(key);
}
const encode = (g) => {
  const o = [];
  let k = 0;
  while (k < g.length) { const v = g[k]; let n = 1; while (k + n < g.length && g[k + n] === v && n < 255) n++; o.push(n, v); k += n; }
  return Buffer.from(o).toString("base64");
};
const cellAt = (x, y) => {
  const T = loadTile(tileKey(x, y)), c = Math.floor((x - T.t.x) / CELL), r = Math.floor((y - T.t.y) / CELL);
  return { T, i: r * T.t.cols + c };
};
const classAt = (x, y) => { const q = cellAt(x, y); return q.T.g[q.i]; };

// la calle más cercana a un punto, sobre las líneas de centro que el mundo emite
function nearestStreet(x, y) {
  let best = null;
  const seen = new Set();
  for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
    const key = `${Math.floor(x / tilePx) + dc}_${Math.floor(y / tilePx) + dr}`;
    let T; try { T = loadTile(key); } catch { continue; }
    for (const rd of T.t.roads || []) {
      const id = rd.pts.join(","); if (seen.has(id)) continue; seen.add(id);
      for (let k = 0; k + 3 < rd.pts.length; k += 2) {
        const ax = rd.pts[k], ay = rd.pts[k + 1], bx = rd.pts[k + 2], by = rd.pts[k + 3];
        const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, f = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2));
        const qx = ax + (bx - ax) * f, qy = ay + (by - ay) * f, d = Math.hypot(x - qx, y - qy);
        if (!best || d < best.d) best = { d, qx, qy, w: rd.w, name: rd.name, tx: (bx - ax) / Math.sqrt(L2), ty: (by - ay) / Math.sqrt(L2) };
      }
    }
  }
  return best;
}

// ───────────────────────────── cada lugar ─────────────────────────────
const places = [], stamps = [], counts = {};
const count = (k, n = 1) => { counts[k] = (counts[k] || 0) + n; };
const flora = { trees: [], palms: [], lamps: [] }, pois = [], lmMoves = {};
const dropParcel = [];

for (const P of doc.places) {
  const F = frameOf(P), own = F.flat(P.own), B = bbox(own);
  const place = { id: P.id, name: P.name, ang: +F.ang.toFixed(4), ox: Math.round(F.ox), oy: Math.round(F.oy), lawn: P.lawn, own };
  dropParcel.push(...(P.drop?.parcels || []));

  // el piso gris: cada figura a polígono
  place.paved = P.paved.map((s) => {
    let uv;
    if (s.disc) { const n = 48; uv = Array.from({ length: n }, (_, k) => [s.at[0] + Math.cos(k / n * 2 * Math.PI) * s.disc, s.at[1] + Math.sin(k / n * 2 * Math.PI) * s.disc]); }
    else if (s.line) {
      const [[ax, ay], [bx, by]] = s.line, L = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / L * s.wM / 2, ny = (bx - ax) / L * s.wM / 2;
      uv = [[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]];
    } else uv = s.poly;
    return { id: s.id, floor: s.floor, pts: wound(F.flat(uv)) };
  });
  place.footpaths = (P.footpaths || []).map((s) => ({ pts: F.flat(s.line), w: r1(s.wM * ppm) }));
  place.steps = (P.steps || []).map((s) => ({ pts: F.flat(footprint({ box: s.size, rotDeg: s.rotDeg }, s.at, 0)), n: s.n }));

  // las bocas: de la acera al asfalto, medidas contra la calle de verdad
  place.mouths = P.mouths.map((mo) => {
    const [x, y] = F.at(mo.at), st = nearestStreet(x, y);
    if (!st || st.d > 40 * ppm) throw new Error(`[centro] la boca ${P.id}/${mo.id} no encuentra calle`);
    const nx = (st.qx - x) / st.d, ny = (st.qy - y) / st.d;              // hacia la calle
    const e0x = st.qx - nx * st.w / 2, e0y = st.qy - ny * st.w / 2;      // un punto del borde del asfalto
    // EL RUMBO de la boca: a escuadra de la calle, o el del sendero que llega (`from`), para que
    // una entrada en diagonal cruce la acera en diagonal y no doble a escuadra en el cordón
    let dx = nx, dy = ny;
    if (mo.from) { const [fx, fy] = F.at(mo.from), L = Math.hypot(x - fx, y - fy); dx = (x - fx) / L; dy = (y - fy) / L; }
    const dn = dx * nx + dy * ny;
    if (dn < 0.4) throw new Error(`[centro] la boca ${P.id}/${mo.id} llega casi paralela a su calle`);
    const s0 = ((e0x - x) * nx + (e0y - y) * ny) / dn, ex = x + dx * s0, ey = y + dy * s0;   // donde su eje toca el asfalto
    const tx = -ny, ty = nx, hs = mo.wM * ppm / 2 / dn, depth = aceraPx + 2, over = 1;       // un pelo sobre el asfalto: sin rendija
    // `a`: cuánto hacia la calle, medido a escuadra de ella; `side`·`h`: a lo largo del cordón
    const q = (a, side, h = hs) => [ex + dx * a / dn + tx * side * h, ey + dy * a / dn + ty * side * h];
    // lo que se ESTAMPA va una celda más allá por cada lado: el ráster de la calzada no cae justo
    // donde el trazo de la calle, y la boca tiene que tocar asfalto de verdad (nunca lo cambia)
    const stamp = [...q(2 * CELL, -1, hs + CELL / 2), ...q(2 * CELL, 1, hs + CELL / 2), ...q(-depth - CELL, 1, hs + CELL / 2), ...q(-depth - CELL, -1, hs + CELL / 2)];
    return { id: mo.id, street: st.name || "", stamp, pts: [...q(over, -1), ...q(over, 1), ...q(-depth, 1), ...q(-depth, -1)].map(r1) };
  });

  // el riachuelo y su puente: dibujo sobre el jardín
  place.rivers = (P.rivers || []).map((rv) => ({ pts: F.flat(rv.line), w: r1(rv.wM * ppm) }));
  place.bridges = (P.bridges || []).map((bg) => ({ pts: F.flat(footprint({ box: bg.size, rotDeg: bg.rotDeg }, bg.at, 0)) }));

  // PEGADA A UNA CALLE PEATONAL: la franja entre la cuadra y el eje de esa calle, a lo largo de
  // `v`. Se pinta con la piedra de la calle (tapa su acera de este lado) y se estampa boulevard.
  place.fused = (P.fused || []).map((fu) => {
    const [x, y] = F.at(fu.at), st = nearestStreet(x, y);
    if (!st || st.name !== fu.street) throw new Error(`[centro] ${P.id}: la calle pegada «${fu.street}» no está junto a la cuadra (hallé «${st && st.name}»)`);
    const nx = (x - st.qx) / st.d, ny = (y - st.qy) / st.d;              // de la calle hacia la cuadra
    const reach = st.w / 2 + aceraPx + 4, [a0, a1] = fu.v.map((v) => F.at([fu.at[0], v]));
    // los dos cabos, proyectados sobre el eje de la calle
    const foot = ([px, py]) => { const k = (px - st.qx) * st.tx + (py - st.qy) * st.ty; return [st.qx + st.tx * k, st.qy + st.ty * k]; };
    const [f0, f1] = [foot(a0), foot(a1)];
    return { street: st.name, pts: wound([f0[0], f0[1], f1[0], f1[1], f1[0] + nx * reach, f1[1] + ny * reach, f0[0] + nx * reach, f0[1] + ny * reach].map(r1)) };
  });

  // las estructuras: pilas de cuerpos, de abajo hacia arriba
  place.structures = [];
  const solids = [], bodies = [];
  for (const S0 of P.structures) {
    const kit = S0.kit ? doc.kits[S0.kit] : null;
    if (S0.kit && !kit) throw new Error(`[centro] kit desconocido: ${S0.kit}`);
    const rot = (S0.rotDeg || 0) * RAD;
    const B0 = buildBody(S0.kit ? kit : S0, S0.at, rot, { at: F.at, ang: F.ang, ppm });
    const tiersOut = B0.tiers;
    const st = { id: S0.id || `${S0.kit}_${place.structures.length}`, kind: S0.kit || "building", x: B0.x, y: B0.y,
      zMax: B0.zMax, x0: B0.x0, y0: B0.y0, x1: B0.x1, y1: B0.y1, tiers: tiersOut };
    const [cx, cy] = F.at(S0.at);
    if (S0.label) st.label = S0.label;
    place.structures.push(st);
    if (S0.solid) for (const t of tiersOut) if (t.z0 === 0) solids.push(t.pts);
    if (!S0.kit) for (const t of tiersOut) if (t.z0 === 0) bodies.push(t.pts);
    if (S0.name && !S0.kit && !/^(norte_|mural_)/.test(st.id)) pois.push({ x: Math.round(cx), y: Math.round(cy), name: S0.name, cat: "centro" });
    else if (S0.name && S0.kit && S0.kit !== "bench") pois.push({ x: Math.round(cx), y: Math.round(cy), name: S0.name, cat: "centro" });
    count("estructuras");
  }

  // las astas, en arco
  place.poles = [];
  place.shrubs = [];
  if (P.poles) {
    const A = P.poles.arc;
    for (let k = 0; k < A.count; k++) {
      const a = (A.fromDeg + (A.toDeg - A.fromDeg) * k / (A.count - 1)) * RAD;
      const [x, y] = F.at([A.at[0] + Math.cos(a) * A.rM, A.at[1] + Math.sin(a) * A.rM]);
      place.poles.push({ x: r1(x), y: r1(y), h: P.poles.hM, base: r1(P.poles.baseM * ppm) });
      if (P.poles.shrubs && k + 1 < A.count) {
        const am = (A.fromDeg + (A.toDeg - A.fromDeg) * (k + 0.5) / (A.count - 1)) * RAD;
        const [sx, sy] = F.at([A.at[0] + Math.cos(am) * A.rM, A.at[1] + Math.sin(am) * A.rM]);
        place.shrubs.push({ x: r1(sx), y: r1(sy), r: r1(0.85 * ppm) });
      }
    }
    count("astas", A.count);
  }
  place.labels = (P.labels || []).map((l) => { const [x, y] = F.at(l.at); return { x: Math.round(x), y: Math.round(y), text: l.text }; });
  for (const [id, uv] of Object.entries(P.landmarks || {})) lmMoves[id] = F.at(uv).map(Math.round);

  for (const tr of P.trees || []) { const [x, y] = F.at(tr.at).map(Math.round); flora.trees.push({ x, y, s: tr.s, k: tr.k }); }
  for (const uv of P.palms || []) { const [x, y] = F.at(uv).map(Math.round); flora.palms.push({ x, y, s: 1.0, sway: +((x * 0.37 + y * 0.11) % 6.28).toFixed(2) }); }
  for (const uv of P.lamps || []) { const [x, y] = F.at(uv).map(Math.round); flora.lamps.push({ x, y, ang: 0, type: "led" }); }

  places.push(place);
  // el cuadro del lugar: su cuadra y todo lo que dibuja fuera de ella (los maceteros del Bulevar)
  for (const st of place.structures) bbox([st.x0, st.y0, st.x1, st.y1], B);
  for (const fu of place.fused) bbox(fu.pts, B);
  Object.assign(place, { x0: Math.floor(B.x0), y0: Math.floor(B.y0), x1: Math.ceil(B.x1), y1: Math.ceil(B.y1) });
  stamps.push({ place, own, B: bbox(own), solids, bodies });
}

// ───────────────────────────── el ráster ─────────────────────────────
// Se calcula SIEMPRE (también en el preview): de él sale qué árbol viejo se va,
// y es lo que hace que repetir la corrida dé el mismo mundo.
const near = Math.ceil(aceraPx / CELL);
const disc = [];
for (let dy = -near; dy <= near; dy++) for (let dx = -near; dx <= near; dx++) if (dx * dx + dy * dy <= near * near) disc.push([dx, dy]);
for (const { place, own, B, solids, bodies } of stamps) {
  const cells = [];
  for (let y = Math.floor(B.y0 / CELL) * CELL + CELL / 2; y < B.y1; y += CELL) {
    for (let x = Math.floor(B.x0 / CELL) * CELL + CELL / 2; x < B.x1; x += CELL) {
      if (!inside(x, y, own)) continue;
      const q = cellAt(x, y), cls = q.T.g[q.i];
      if (cls !== C.land && cls !== C.acera && cls !== C.boulevard) continue;      // la calzada no se toca
      cells.push({ x, y, q });
    }
  }
  // 1) la cuadra vuelve a tierra, con su anillo de acera contra la calzada
  for (const c of cells) {
    let kerb = false;
    for (const [dx, dy] of disc) if (classAt(c.x + dx * CELL, c.y + dy * CELL) === C.road) { kerb = true; break; }
    c.cls = kerb ? C.acera : C.land;
  }
  // 2) el piso gris (nunca sobre la acera), 3) las bocas (sólo ellas abren la acera), 4) lo macizo
  for (const c of cells) {
    if (c.cls === C.land && place.paved.some((s) => inside(c.x, c.y, s.pts))) c.cls = C.boulevard;
    if (place.mouths.some((mo) => inside(c.x, c.y, mo.stamp))) c.cls = C.boulevard;
    if (c.cls === C.boulevard && solids.some((s) => inside(c.x, c.y, s))) c.cls = C.land;
  }
  for (const c of cells) {
    if (c.q.T.g[c.q.i] !== c.cls) { c.q.T.g[c.q.i] = c.cls; c.q.T.dirty = true; count("celdas cambiadas"); }
    count(c.cls === C.boulevard ? `${place.id}: piso` : c.cls === C.acera ? `${place.id}: acera` : `${place.id}: tierra`);
  }
  // 5) la franja pegada a su calle peatonal: tierra y acera pasan a boulevard, menos bajo un edificio.
  // Sale del contorno `own` a propósito (la acera de la calle no es de la cuadra); una celda de
  // calzada o ya boulevard no cambia, así que repetirlo da lo mismo.
  for (const fu of place.fused) {
    const fb = bbox(fu.pts);
    for (let y = Math.floor(fb.y0 / CELL) * CELL + CELL / 2; y < fb.y1; y += CELL) for (let x = Math.floor(fb.x0 / CELL) * CELL + CELL / 2; x < fb.x1; x += CELL) {
      if (!inside(x, y, fu.pts) || bodies.some((b) => inside(x, y, b))) continue;
      const q = cellAt(x, y), cls = q.T.g[q.i];
      if (cls !== C.land && cls !== C.acera) continue;
      q.T.g[q.i] = C.boulevard; q.T.dirty = true; count(`${place.id}: pegado`);
    }
  }
  // cada boca tiene que LLEGAR: del asfalto al piso sin una celda de pared en medio
  for (const mo of place.mouths) {
    const [ax, ay, bx, by, cx, cy, dx, dy] = mo.pts, mx0 = (ax + bx) / 2, my0 = (ay + by) / 2, mx1 = (cx + dx) / 2, my1 = (cy + dy) / 2;
    const L = Math.hypot(mx1 - mx0, my1 - my0), ux = (mx1 - mx0) / L, uy = (my1 - my0) / L;
    for (let s = 0; s <= L + 3 * CELL; s += CELL / 2) {
      const cls = classAt(mx0 + ux * s, my0 + uy * s);
      if (cls !== C.road && cls !== C.boulevard) throw new Error(`[centro] la boca ${place.id}/${mo.id} no llega al piso: clase ${cls} a ${s.toFixed(0)} px del asfalto`);
    }
  }
}

// ───────────────────────────── el manifest y los tiles ─────────────────────────────
const inOwn = (x, y) => stamps.some((s) => x >= s.B.x0 && x <= s.B.x1 && y >= s.B.y0 && y <= s.B.y1 && inside(x, y, s.own));
// adentro de la cuadra y NO sobre la acera: lo de la acera (árboles de calle, postes) es de la calle
const interior = (o) => { if (!inOwn(o.x, o.y)) return false; const c = classAt(o.x, o.y); return c === C.land || c === C.boulevard; };
const centroid = (pts) => { let x = 0, y = 0; for (let i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1]; } return { x: x / (pts.length / 2), y: y / (pts.length / 2) }; };

const before = manifest.parcels.length;
manifest.parcels = manifest.parcels.filter((p) => !dropParcel.some((id) => (id.endsWith("_") ? p.id.startsWith(id) : p.id === id)));
count("parcelas fuera", before - manifest.parcels.length);
manifest.pois = (manifest.pois || []).filter((p) => !inOwn(p.x, p.y)).concat(pois);
manifest.signs = (manifest.signs || []).filter((s) => !(s.kind === "banca" && interior(s)));
for (const lm of manifest.landmarks) if (lmMoves[lm.id]) [lm.x, lm.y] = lmMoves[lm.id];
for (const T of tiles.values()) {
  const t = T.t;
  // sólo los tiles que la cuadra pisa: los vecinos se cargaron para medir calles y no se tocan
  if (!stamps.some((s) => s.B.x1 >= t.x && s.B.x0 <= t.x + t.cols * CELL && s.B.y1 >= t.y && s.B.y0 <= t.y + t.rows * CELL)) continue;
  for (const k of ["buildings", "trees", "palms", "lamps"]) t[k] = t[k] || [];
  const n0 = [t.buildings.length, t.trees.length, t.palms.length, t.lamps.length];
  t.buildings = t.buildings.filter((b) => { const c = centroid(b.pts); return !inOwn(c.x, c.y); });
  t.trees = t.trees.filter((o) => !interior(o));
  t.palms = t.palms.filter((o) => !interior(o));
  t.lamps = (t.lamps || []).filter((o) => !interior(o));
  count("edificios fuera", n0[0] - t.buildings.length);
  count("árboles fuera", n0[1] - t.trees.length + n0[2] - t.palms.length);
  if ([t.buildings, t.trees, t.palms, t.lamps].some((l, k) => l.length !== n0[k])) T.dirty = true;
}
// lo sembrado tiene que quedar ADENTRO: lo que cae sobre la acera no se quitaría en la corrida
// siguiente (lo de la acera es de la calle) y se sembraría dos veces
// NINGÚN ÁRBOL BAJO UN EDIFICIO: los edificios se pintan después y su techo se corre hacia afuera,
// así que una copa pegada a un muro queda tapada. Cada árbol guarda su copa de distancia.
{
  const segD = (x, y, ax, ay, bx, by) => { const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, f = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2)); return Math.hypot(x - ax - (bx - ax) * f, y - ay - (by - ay) * f); };
  const under = [];
  for (const { place, bodies } of stamps) for (const kind of ["trees", "palms"]) for (const o of flora[kind]) {
    if (o.x < place.x0 || o.x > place.x1 || o.y < place.y0 || o.y > place.y1) continue;
    const need = (kind === "palms" ? 3.2 : 3.6 * (o.s || 1)) * ppm;
    for (const b of bodies) {
      let dmin = inside(o.x, o.y, b) ? 0 : Infinity;
      for (let i = 0, j = b.length - 2; i < b.length && dmin > 0; j = i, i += 2) dmin = Math.min(dmin, segD(o.x, o.y, b[j], b[j + 1], b[i], b[i + 1]));
      if (dmin < need) { const dx = (o.x - place.ox) / ppm, dy = (o.y - place.oy) / ppm, c = Math.cos(place.ang), s2 = Math.sin(place.ang); under.push(`${place.id} ${kind} (${(dx * c + dy * s2).toFixed(1)}, ${(-dx * s2 + dy * c).toFixed(1)}) a ${(dmin / ppm).toFixed(1)} m de un edificio (pide ${(need / ppm).toFixed(1)})`); break; }
    }
  }
  if (under.length) throw new Error(`[centro] árboles bajo un edificio:\n  ${under.join("\n  ")}`);
}
const stray = ["trees", "palms", "lamps"].flatMap((kind) => flora[kind].filter((o) => !interior(o)).map((o) => `${kind} (${o.x},${o.y})`));
if (stray.length) throw new Error(`[centro] sembrado fuera del interior de su cuadra (sobre acera o calle): ${stray.join(", ")}`);
for (const kind of ["trees", "palms", "lamps"]) for (const o of flora[kind]) {
  const T = loadTile(tileKey(o.x, o.y));
  (T.t[kind] || (T.t[kind] = [])).push(o); T.dirty = true; count(kind);
}
const all = places.reduce((b, p) => bbox([p.x0, p.y0, p.x1, p.y1], b), bbox([]));
for (const p of places) for (const mo of p.mouths) delete mo.stamp;
manifest.centro = { x0: all.x0, y0: all.y0, x1: all.x1, y1: all.y1, landmarks: Object.keys(lmMoves), places };

console.log(`[centro] ${places.map((p) => `${p.id}: ${p.paved.length} pisos, ${p.mouths.length} bocas, ${p.structures.length} estructuras`).join(" · ")}`);
console.log(`[centro] ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);

if (EMIT) {
  writeFileSync(`${WORLD}/manifest.json`, JSON.stringify(manifest));
  let n = 0;
  for (const [key, T] of tiles) {
    if (!T.dirty) continue;                    // un tile sin cambios se deja como está
    T.t.rle = encode(T.g);
    writeFileSync(`${WORLD}/tiles/${key}.json`, JSON.stringify(T.t)); n++;
  }
  console.log(`[centro-emit] manifest + ${n} tiles escritos`);
  process.exit(0);
}
if (CHECK) process.exit(0);

// ───────────────────────────── el preview ─────────────────────────────
const { chromium } = await import("playwright");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.25 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const asModule = (obj) => ({ status: 200, contentType: "text/javascript", body: `export default ${JSON.stringify(obj)};` });
await page.route("**/src/world2d/manifest.json*", (route) => route.fulfill(asModule(manifest)));
for (const [key, T] of tiles) {
  const t = { ...T.t, rle: encode(T.g) };
  await page.route(`**/src/world2d/tiles/${key}.json*`, (route) => route.fulfill(asModule(t)));
}
await page.addInitScript(() => {
  localStorage.setItem("churchill_intro_seen_v1", "1");
  localStorage.setItem("churchill_lang_v1", "es");
});
const first = places[0];
await page.goto(`${url}?editorPlay=1&x=${first.ox}&y=${first.oy}`, { waitUntil: "load" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 60000 });
await page.waitForTimeout(2500);
if (!(await page.evaluate(() => !!window.WORLD2D.CENTRO))) { console.error("[centro-preview] el juego no recibió el manifest parchado"); process.exit(1); }

const shot = async (name, weather, x, y, zoom) => {
  if (process.env.CENTRO_ONLY && !process.env.CENTRO_ONLY.split(",").includes(name)) return;
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
  const file = path.join(out, `centro-preview-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`[centro-preview] ${file}`);
};
const find = (pid, sid) => places.find((p) => p.id === pid).structures.find((s) => s.id === sid);
const mora = places.find((p) => p.id === "mora"), cat = places.find((p) => p.id === "catedral");
const mid = (p) => [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2];
// CENTRO_AT="x,y,zoom[,nombre]": una captura suelta donde se pida
if (process.env.CENTRO_AT) { const [ax, ay, az, an] = process.env.CENTRO_AT.split(","); process.env.CENTRO_ONLY = an || "at"; await shot(an || "at", "sunny", +ax, +ay, +az); }
await shot("mora", "sunny", mid(mora)[0] + 20, mid(mora)[1] + 10, 1.75);
await shot("tanque", "sunny", find("mora", "tanque").x + 60, find("mora", "tanque").y - 30, 4.2);
await shot("bustos", "sunny", find("mora", "plataforma").x + 40, find("mora", "plataforma").y + 30, 4.6);
await shot("palacio", "sunny", find("mora", "palacio").x - 50, find("mora", "palacio").y + 40, 3.6);
await shot("manzana", "sunny", mid(cat)[0], mid(cat)[1], 1.85);
await shot("catedral", "sunny", find("catedral", "catedral").x + 70, find("catedral", "catedral").y + 30, 3.6);
await shot("cultura", "sunny", find("catedral", "cultura").x - 60, find("catedral", "cultura").y - 20, 3.6);
await shot("mora-noche", "night", mid(mora)[0] + 20, mid(mora)[1] + 10, 1.75);
await shot("catedral-noche", "night", find("catedral", "catedral").x + 70, find("catedral", "catedral").y + 30, 2.6);
await browser.close();
if (errors.length) { console.error(`[centro-preview] errores de página: ${errors.join(" | ")}`); process.exit(1); }
