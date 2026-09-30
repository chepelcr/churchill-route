// DE UNA MÁSCARA A LAZOS — marching squares con sus agujeros.
//
// Entra una máscara binaria (1 = sólido) de `w × h` píxeles; salen lazos
// cerrados en coordenadas de PÍXEL (centros de píxel en .5), ya encadenados,
// simplificados y clasificados en exteriores con sus agujeros — lo que
// `ShapeUtils.triangulateShape(contorno, agujeros)` necesita para una tapa.
//
// Los puntos caen en los puntos medios de las aristas de cada celda de 2×2
// píxeles, así que un borde diagonal sale a 45° y no en escalera. En las
// sillas (casos 5 y 10) los dos tramos no comparten punto, así que encadenar
// por punto las resuelve solo.

/** Lazos de la máscara: `[{ outer: [[x, y], …], holes: [[[x, y], …], …] }]`. */
export function maskLoops(mask, w, h, tolerance = 0.35) {
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const segs = [];
  // puntos en medias unidades: la arista horizontal entre (x, y) y (x+1, y)
  // tiene su medio en (2x+1, 2y); la vertical entre (x, y) y (x, y+1) en (2x, 2y+1)
  for (let y = -1; y < h; y++) {
    for (let x = -1; x < w; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
      const k = tl | (tr << 1) | (br << 2) | (bl << 3);
      if (k === 0 || k === 15) continue;
      const T = [2 * x + 1, 2 * y], R = [2 * x + 2, 2 * y + 1];
      const B = [2 * x + 1, 2 * y + 2], L = [2 * x, 2 * y + 1];
      const add = (p, q) => segs.push(p, q);
      switch (k) {
        case 1: case 14: add(L, T); break;
        case 2: case 13: add(T, R); break;
        case 4: case 11: add(R, B); break;
        case 8: case 7: add(B, L); break;
        case 3: case 12: add(L, R); break;
        case 6: case 9: add(T, B); break;
        case 5: add(L, T); add(R, B); break;
        case 10: add(T, R); add(B, L); break;
        default: break;
      }
    }
  }
  // encadenar por punto compartido
  const key = (p) => p[0] * 131072 + p[1];
  const byPoint = new Map();
  for (let i = 0; i < segs.length; i += 2) {
    for (const j of [i, i + 1]) {
      const kk = key(segs[j]);
      let l = byPoint.get(kk);
      if (!l) byPoint.set(kk, (l = []));
      l.push(i);
    }
  }
  const used = new Uint8Array(segs.length / 2);
  const loops = [];
  for (let s0 = 0; s0 < segs.length; s0 += 2) {
    if (used[s0 / 2]) continue;
    used[s0 / 2] = 1;
    const loop = [segs[s0]];
    let cur = segs[s0 + 1];
    const start = key(segs[s0]);
    for (let guard = 0; guard < segs.length && key(cur) !== start; guard++) {
      loop.push(cur);
      const next = (byPoint.get(key(cur)) || []).find((i) => !used[i / 2]);
      if (next === undefined) break;
      used[next / 2] = 1;
      cur = key(segs[next]) === key(cur) ? segs[next + 1] : segs[next];
    }
    if (loop.length >= 3) loops.push(loop.map(([a, b]) => [a / 2, b / 2]));
  }
  const simple = loops.map((l) => simplifyClosed(l, tolerance)).filter((l) => l.length >= 3);
  return nest(simple);
}

function area(l) {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const [x0, y0] = l[i], [x1, y1] = l[(i + 1) % l.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function inside(pt, l) {
  let c = false;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    const [xi, yi] = l[i], [xj, yj] = l[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Un lazo dentro de un número IMPAR de otros es un agujero; se le asigna al
// exterior más chico que lo contiene.
function nest(loops) {
  const depth = loops.map((l, i) => loops.reduce((n, o, j) => n + (j !== i && inside(l[0], o) ? 1 : 0), 0));
  const out = [];
  const outers = [];
  loops.forEach((l, i) => { if (depth[i] % 2 === 0) { const o = { outer: l, holes: [], a: Math.abs(area(l)) }; out.push(o); outers.push(o); } });
  loops.forEach((l, i) => {
    if (depth[i] % 2 === 0) return;
    let best = null;
    for (const o of outers) if (inside(l[0], o.outer) && (!best || o.a < best.a)) best = o;
    if (best) best.holes.push(l);
  });
  for (const o of out) delete o.a;
  return out;
}

// Douglas-Peucker sobre un lazo cerrado: se parte en los dos puntos más
// alejados entre sí y se simplifica cada mitad.
function simplifyClosed(l, tol) {
  if (l.length < 8) return l;
  let far = 0, fd = -1;
  for (let i = 1; i < l.length; i++) {
    const d = (l[i][0] - l[0][0]) ** 2 + (l[i][1] - l[0][1]) ** 2;
    if (d > fd) { fd = d; far = i; }
  }
  const a = dp(l.slice(0, far + 1), tol), b = dp(l.slice(far).concat([l[0]]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function dp(pts, tol) {
  if (pts.length < 3) return pts;
  const [x0, y0] = pts[0], [x1, y1] = pts[pts.length - 1];
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1e-9;
  let idx = 0, dmax = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - x0) * dy - (pts[i][1] - y0) * dx) / L;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= tol) return [pts[0], pts[pts.length - 1]];
  const left = dp(pts.slice(0, idx + 1), tol), right = dp(pts.slice(idx), tol);
  return left.slice(0, -1).concat(right);
}
