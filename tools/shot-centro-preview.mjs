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
const bbox = (pts, b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) => {
  for (let i = 0; i < pts.length; i += 2) {
    b.x0 = Math.min(b.x0, pts[i]); b.x1 = Math.max(b.x1, pts[i]);
    b.y0 = Math.min(b.y0, pts[i + 1]); b.y1 = Math.max(b.y1, pts[i + 1]);
  }
  return b;
};
const area2 = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) a += pts[j] * pts[i + 1] - pts[i] * pts[j + 1];
  return a;
};
// todos los contornos con el MISMO giro: la sombra de una estructura se rellena
// en un solo camino `nonzero`, y dos giros contrarios que se montan abren un hueco
const wound = (pts) => {
  if (area2(pts) >= 0) return pts;
  const o = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) o.push(pts[i], pts[i + 1]);
  return o;
};

// el marco de un lugar: metros [u este, v sur] → píxeles de mundo
function frameOf(place) {
  const [lat, lon] = place.originLL;
  const ox = geo.ax * lon + geo.bx, oy = geo.ay * lat + geo.by;
  const a = place.axisDeg * RAD, ux = Math.cos(a), uy = Math.sin(a);
  const at = ([u, v]) => [ox + (u * ux - v * uy) * ppm, oy + (u * uy + v * ux) * ppm];
  return { ox, oy, ang: a, at, flat: (uv) => uv.flatMap((p) => at(p).map(r1)) };
}

// una huella en metros, en el marco de su estructura (`at`, `rotDeg`) → [[u, v]…] del lugar
function footprint(t, base, rot) {
  const [du, dv] = t.at || [0, 0];
  let loc;
  if (t.box) {
    const [w, d] = t.box;
    loc = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  } else if (t.disc) {
    const n = t.n || 16;
    loc = Array.from({ length: n }, (_, k) => [Math.cos(k / n * 2 * Math.PI) * t.disc, Math.sin(k / n * 2 * Math.PI) * t.disc]);
  } else if (t.arc) {
    const { rM: r, a0, a1, n = 12 } = t.arc;
    loc = Array.from({ length: n + 1 }, (_, k) => { const a = (a0 + (a1 - a0) * k / n) * RAD; return [Math.cos(a) * r, Math.sin(a) * r]; });
  } else if (t.poly) loc = t.poly;
  else throw new Error(`[centro] cuerpo sin huella: ${JSON.stringify(t).slice(0, 80)}`);
  const tr = (t.rotDeg || 0) * RAD, ct = Math.cos(tr), st = Math.sin(tr);
  const c = Math.cos(rot), s = Math.sin(rot);
  return loc.map(([x, y]) => {
    const lx = du + x * ct - y * st, ly = dv + x * st + y * ct;        // en la estructura
    return [base[0] + lx * c - ly * s, base[1] + lx * s + ly * c];       // en el lugar
  });
}

// la cumbrera de un techo, en metros del lugar: dos puntos (iguales = un ápice)
function ridgeOf(t, uv) {
  const R = t.roof;
  if (!R || R.kind === "dome") return null;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const cen = uv.reduce((q, p) => [q[0] + p[0] / uv.length, q[1] + p[1] / uv.length], [0, 0]);
  if (R.kind === "pyramid") return [cen, cen];
  if (R.kind === "fan") { const m = mid(uv[0], uv[uv.length - 1]); return [m, m]; }   // el centro del arco
  if (!t.box) throw new Error(`[centro] un techo ${R.kind} pide una huella \`box\``);
  const [w, d] = t.box, alongX = R.axis === "x" || (R.axis === "long" ? w >= d : R.axis === "short" ? w < d : w >= d);
  // los puntos medios de los dos lados cortos de la cumbrera
  let a = alongX ? mid(uv[3], uv[0]) : mid(uv[0], uv[1]);
  let b = alongX ? mid(uv[1], uv[2]) : mid(uv[2], uv[3]);
  if (R.kind === "hip") {                     // a cuatro aguas: la cumbrera se acorta medio fondo por punta
    const len = alongX ? w : d, dep = alongX ? d : w, k = Math.min(0.5, dep / 2 / len);
    const A = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k], B = [b[0] + (a[0] - b[0]) * k, b[1] + (a[1] - b[1]) * k];
    a = A; b = B;
  }
  return [a, b];
}

// las alas del Palacio: cada una tres cuerpos que vuelan uno sobre otro en la punta
function armTiers(A) {
  const tiers = [], F = A.floorsM, n = F.length - 1;
  for (const arm of A.list) {
    for (let k = 0; k < n; k++) {
      const reach = A.reachM - A.stepM * (n - 1 - k), len = reach - A.fromM, mid = A.fromM + len / 2, a = arm.dirDeg * RAD;
      const top = k === n - 1;
      tiers.push({
        box: [len, arm.wM], at: [Math.cos(a) * mid, Math.sin(a) * mid], rotDeg: arm.dirDeg, z: [F[k], F[k + 1]],
        wall: A.wall, cap: A.cap, bands: A.bands, ...(top ? { truss: A.truss, stains: A.stains } : {}),
      });
    }
  }
  return tiers;
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
    const src = [...(S0.arms ? armTiers(S0.arms) : []), ...((kit || S0).tiers || [])];
    const tiersOut = src.map((t) => {
      const uv = footprint(t, S0.at, rot), o = { pts: F.flat(uv), z0: t.z[0], z1: t.z[1], wall: t.wall, cap: t.cap };
      const flip = area2(o.pts) < 0;
      if (flip) o.pts = wound(o.pts);
      for (const k of ["edge", "bands", "windows", "parapet", "stains"]) if (t[k]) o[k] = t[k];
      if (t.openings) {
        // `edge` se cuenta sobre la huella como se escribió; si el giro se invirtió, se re-numera
        const n = o.pts.length / 2;
        o.openings = t.openings.map((op) => (op.edge == null || !flip ? op : { ...op, edge: (n - 2 - op.edge + n) % n, f: [1 - op.f[1], 1 - op.f[0]] }));
      }
      if (t.truss) o.truss = { ink: t.truss.ink, h: t.truss.hM, every: r1(t.truss.everyM * ppm) };
      if (t.roof) {
        const rg = ridgeOf(t, uv);
        o.roof = { kind: t.roof.kind, rise: t.roof.riseM, ink: t.roof.ink, ink2: t.roof.ink2 };
        if (rg) o.roof.ridge = [...F.at(rg[0]), ...F.at(rg[1])].map(r1);
        if (t.roof.seamsM) o.roof.seams = r1(t.roof.seamsM * ppm);
        if (t.roof.cross) o.roof.cross = t.roof.cross;
      }
      return o;
    });
    tiersOut.sort((a, b) => a.z1 - b.z1);       // lo más alto, al final: tapa lo de abajo
    const [cx, cy] = F.at(S0.at), all = tiersOut.reduce((b, t) => bbox(t.pts, b), bbox([]));
    const st = { id: S0.id || `${S0.kit}_${place.structures.length}`, kind: S0.kit || "building", x: r1(cx), y: r1(cy),
      zMax: Math.max(...tiersOut.map((t) => t.z1 + (t.roof?.rise || 0) + (t.truss?.h || 0))),
      x0: Math.floor(all.x0), y0: Math.floor(all.y0), x1: Math.ceil(all.x1), y1: Math.ceil(all.y1), tiers: tiersOut };
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
