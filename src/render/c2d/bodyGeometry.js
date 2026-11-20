// LA GEOMETRÍA DE UN CUERPO 2.5D — compartida por el juego y por las herramientas.
//
// Un «cuerpo» es una pila de bloques (`tiers`), cada uno una huella en METROS
// (`box` [largo, fondo] | `disc` radio | `arc` | `ring` | `poly`) levantada de
// `z[0]` a `z[1]`, con su techo, sus bandas y sus vanos. Esto la lleva de
// metros a píxeles de mundo y deja cada bloque listo para `c2d/bodies.js`.
//
// NO IMPORTA NADA, a propósito: la usa `tools/shot-centro-preview.mjs` desde
// node para emitir el centro cívico, y el juego para armar en el momento los
// cuerpos que no vienen del mundo (la Capitanía, los quioscos, los cañones).
// Una sola copia de la regla — escrita dos veces, el techo de una salía con la
// cumbrera de la otra.
const RAD = Math.PI / 180;
const r1 = (v) => Math.round(v * 10) / 10;

export const bbox = (pts, b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }) => {
  for (let i = 0; i < pts.length; i += 2) {
    b.x0 = Math.min(b.x0, pts[i]); b.x1 = Math.max(b.x1, pts[i]);
    b.y0 = Math.min(b.y0, pts[i + 1]); b.y1 = Math.max(b.y1, pts[i + 1]);
  }
  return b;
};
export const area2 = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) a += pts[j] * pts[i + 1] - pts[i] * pts[j + 1];
  return a;
};
// todos los contornos con el MISMO giro: la sombra de una estructura se rellena
// en un solo camino `nonzero`, y dos giros contrarios que se montan abren un hueco
export const wound = (pts) => {
  if (area2(pts) >= 0) return pts;
  const o = [];
  for (let i = pts.length - 2; i >= 0; i -= 2) o.push(pts[i], pts[i + 1]);
  return o;
};


export // una huella en metros, en el marco de su estructura (`at`, `rotDeg`) → [[u, v]…] del lugar
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
  } else if (t.ring) {
    // un muro curvo: el arco de afuera de ida y el de adentro de vuelta
    const { rM, wM, a0, a1, n = 10 } = t.ring, arc = (r, k) => { const a = (a0 + (a1 - a0) * k / n) * RAD; return [Math.cos(a) * r, Math.sin(a) * r]; };
    loc = [...Array.from({ length: n + 1 }, (_, k) => arc(rM, k)), ...Array.from({ length: n + 1 }, (_, k) => arc(rM - wM, n - k))];
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
export function ridgeOf(t, uv) {
  const R = t.roof;
  if (!R || R.kind === "dome") return null;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const cen = uv.reduce((q, p) => [q[0] + p[0] / uv.length, q[1] + p[1] / uv.length], [0, 0]);
  if (R.kind === "pyramid") return [cen, cen];
  if (R.kind === "fan") { const m = mid(uv[0], uv[uv.length - 1]); return [m, m]; }   // el centro del arco
  if (!t.box) throw new Error(`[centro] un techo ${R.kind} pide una huella \`box\``);
  if (R.kind === "shed") {
    // A UN AGUA: la cumbrera ES la arista alta (`high`: n/e/s/w en el marco de la caja) y el techo baja
    // de ahí hasta la arista de enfrente — las naves de los lados de la Aduana, que bajan hacia la calle
    const side = { n: [0, 1], e: [1, 2], s: [2, 3], w: [3, 0] }[R.high];
    if (!side) throw new Error(`[centro] un techo a un agua pide \`high\`: n, e, s o w`);
    return [uv[side[0]], uv[side[1]]];
  }
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
export function armTiers(A) {
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


/**
 * Arma un cuerpo: `spec` trae `tiers` (y opcionalmente `arms`), `base` es su
 * centro en el marco del lugar (metros), `rot` su giro (radianes) y `F` el
 * marco del lugar: `{ at([u, v]) → [x, y] px de mundo, ang, ppm }`.
 * Devuelve `{ tiers, x, y, zMax, x0, y0, x1, y1 }` en píxeles de mundo.
 */
export function buildBody(spec, base, rot, F) {
  const ppm = F.ppm;
  const flat = (uv) => uv.flatMap((p) => F.at(p).map(r1));
  const src = [...(spec.arms ? armTiers(spec.arms) : []), ...(spec.tiers || [])];
  const tiersOut = src.map((t) => {
    const uv = footprint(t, base, rot), o = { pts: flat(uv), z0: t.z[0], z1: t.z[1], wall: t.wall, cap: t.cap };
    const flip = area2(o.pts) < 0;
    if (flip) o.pts = wound(o.pts);
    for (const k of ["edge", "bands", "windows", "parapet", "stains", "mosaic"]) if (t[k]) o[k] = t[k];
    if (t.decal) {
      // el estampado: en qué paredes va (índices de vértice, como `openings.edge`), re-numeradas si el giro se invirtió
      const n = o.pts.length / 2;
      o.decal = { roof: !!t.decal.roof, edges: t.decal.edges.map((e) => (flip ? (n - 2 - e + n) % n : e)) };
    }
    if (t.faces) {
      // una cara distinta por arista (`bodies.js`), re-numerada como `openings` si el giro se invirtió
      const n = o.pts.length / 2;
      o.faces = Object.fromEntries(Object.entries(t.faces).filter(([e]) => !e.startsWith("_"))
        .map(([e, f]) => [flip ? (n - 2 - +e + n) % n : +e, f]));
    }
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
      if (t.roof.stripes) o.roof.stripes = t.roof.stripes;
      if (t.roof.cross) {
        // la cruz: en qué punta de la cumbrera va (`front` = la primera) y hacia dónde apunta su cabeza
        o.roof.cross = t.roof.cross;
        if (t.roof.crossAt === "front") o.roof.crossAt = 0;
        if (t.roof.crossDeg != null) o.roof.crossAng = +(F.ang + t.roof.crossDeg * RAD).toFixed(4);
      }
    }
    return o;
  });
  tiersOut.sort((a, b) => a.z1 - b.z1);       // lo más alto, al final: tapa lo de abajo
  const [cx, cy] = F.at(base), all = tiersOut.reduce((b, t) => bbox(t.pts, b), bbox([]));
  return { x: r1(cx), y: r1(cy), zMax: Math.max(...tiersOut.map((t) => t.z1 + (t.roof?.rise || 0) + (t.truss?.h || 0))),
    x0: Math.floor(all.x0), y0: Math.floor(all.y0), x1: Math.ceil(all.x1), y1: Math.ceil(all.y1), tiers: tiersOut };
}
