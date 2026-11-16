// LOS CUERPOS 2.5D — el pintor de todo lo que se levanta «como los edificios nuevos».
//
// Un cuerpo es una pila de bloques ya llevados a píxeles de mundo
// (`bodyGeometry.js → buildBody`): cada uno una huella que sube de `z0` a `z1`
// metros, con su tapa, sus paredes, bandas, ventanas, vanos y techo. Se
// levanta con el MISMO pinhole que los edificios del mundo (`depth.js`), y
// todos los bloques de un cuerpo comparten UN vector —el del cuerpo entero—
// o cada uno se inclinaría por su lado.
//
// Nació en `centro.js` para el centro cívico; vive aparte desde que la
// Capitanía, los quioscos y los cañones se pintan igual. Dos cosas que hace:
//
// * UNA COLA POR CUADRO. Quien quiera un cuerpo lo ENCOLA (`queueBody`) en su
//   pasada —el suelo, los hitos— y `flushBodies` los pinta todos juntos
//   DESPUÉS de la gente y el tráfico: la tapa se corre alejándose de la
//   cámara y tapa lo que camina detrás. Pintado en la pasada de hitos, un
//   peatón salía parado en el techo de un quiosco.
// * PRIMERO TODAS LAS SOMBRAS, DESPUÉS TODOS LOS CUERPOS, de lejos a cerca:
//   ninguna sombra cae encima de otro cuerpo.
//
// Las tintas son llaves de `materials.json → centro.inks` (la paleta de todos
// los cuerpos); una llave `$x` la pone quien encola (el color de cada quiosco).
import { WORLD2D as W } from "../../world2d/index.js";
import { ctx, hash01, label, mixColor } from "./gfx.js";
import { sunShadow } from "./shadows.js";
import { facingEdges, parallaxOffset } from "./depth.js";
import { buildBody } from "./bodyGeometry.js";
import { paintAt } from "./shapes.js";
import { state } from "../../game/state.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };

const M = MATERIALS.centro;
const INK = M.inks;
let VARS = null;   // las tintas `$x` del cuerpo que se está pintando
const ink = (key) => (key && key[0] === "$" ? VARS && VARS[key.slice(1)] : INK[key]) || M.missing;

// ───────────────────────────── las estructuras ─────────────────────────────
// una pared: el tramo [f0, f1] de la arista `i`, levantado de za a zb
function wallQuad(T, i, f0, f1, a, b) {
  const pts = T.pts, j = (i + 2) % pts.length;
  const px = pts[i], py = pts[i + 1], ex = pts[j] - px, ey = pts[j + 1] - py;
  ctx.moveTo(px + ex * f0 + a[0], py + ey * f0 + a[1]);
  ctx.lineTo(px + ex * f1 + a[0], py + ey * f1 + a[1]);
  ctx.lineTo(px + ex * f1 + b[0], py + ey * f1 + b[1]);
  ctx.lineTo(px + ex * f0 + b[0], py + ey * f0 + b[1]);
  ctx.closePath();
}
const shade = (color, lit) => (lit ? mixColor(color, M.wall.lit, M.wall.litMix) : mixColor(color, M.wall.dark, M.wall.darkMix));

function capPath(T, o) {
  const p = new Path2D(), pts = T.pts;
  p.moveTo(pts[0] + o[0], pts[1] + o[1]);
  for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i] + o[0], pts[i + 1] + o[1]);
  p.closePath();
  return p;
}

// EL ESTAMPADO: un cartel pintado en la pared `i`, del zócalo al alero. Sus partes vienen del hito
// (`VARS._decal`: `parts` en su propio marco `box` [x, y, ancho, alto]) y se llevan a la pared con una
// afín: el ancho del cartel a lo largo de la arista, su alto de la tapa al pie. Una pared que en la
// pantalla mide menos de `decalMinPx` no lo lleva: sería una raya de colores.
function paintDecal(T, i, lo, hi, lit) {
  const D = VARS._decal, [bx, by, bw, bh] = D.box, pts = T.pts, j = (i + 2) % pts.length;
  const ex = pts[j] - pts[i], ey = pts[j + 1] - pts[i + 1];
  const hx = hi[0] - lo[0], hy = hi[1] - lo[1];
  if (Math.hypot(hx, hy) < M.decalMinPx) return;
  const m = M.decalMargin;   // el cartel no toca las esquinas ni el zócalo
  const ox = pts[i] + ex * m + lo[0] + hx * (1 - m), oy = pts[i + 1] + ey * m + lo[1] + hy * (1 - m);
  const ux = ex * (1 - 2 * m) / bw, uy = ey * (1 - 2 * m) / bw;            // una unidad del cartel a lo ancho
  const vx = -hx * (1 - 2 * m) / bh, vy = -hy * (1 - 2 * m) / bh;          // …y a lo alto (+y del cartel = hacia el pie)
  ctx.save();
  ctx.transform(ux, uy, vx, vy, ox - ux * bx - vx * by, oy - uy * bx - vy * by);
  ctx.fillStyle = D.bg; ctx.fillRect(bx, by, bw, bh);
  paintAt(D.parts, 0, 0, { g: ctx });
  if (!lit) { ctx.fillStyle = M.decalShade; ctx.fillRect(bx, by, bw, bh); }
  ctx.restore();
}

// EL MOSAICO ANTIGUO sobre una tapa: losetas de cemento de `everyM` alineadas con la PRIMERA arista
// de la huella (la del marco del lugar), cada una con su fondo, su rombo y su centro, y un cuadro sí
// y otro no con las tintas cambiadas — el piso de las iglesias viejas. `inks`: [fondo, rombo,
// centro, fondo alterno]. Se pinta en tres trazos por tinta, no por loseta.
function paintMosaic(T, cap, o, ppm) {
  const { everyM, inks } = T.mosaic, pts = T.pts, n = pts.length, s = everyM * ppm;
  if (!(s > 1.2)) return;
  let ex = pts[2] - pts[0], ey = pts[3] - pts[1];
  const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
  const nx = -ey, ny = ex, ox = pts[0] + o[0], oy = pts[1] + o[1];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i += 2) {
    const dx = pts[i] + o[0] - ox, dy = pts[i + 1] + o[1] - oy, u = dx * ex + dy * ey, v = dx * nx + dy * ny;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const P = (u, v) => [ox + ex * u + nx * v, oy + ey * u + ny * v];
  const quad = (path, pp) => { path.moveTo(pp[0][0], pp[0][1]); for (let k = 1; k < 4; k++) path.lineTo(pp[k][0], pp[k][1]); path.closePath(); };
  const alt = new Path2D(), rhomb = [new Path2D(), new Path2D()], dot = new Path2D(), grout = new Path2D();
  for (let i = Math.floor(u0 / s); i * s < u1; i++) for (let j = Math.floor(v0 / s); j * s < v1; j++) {
    const a = i * s, b = j * s, c = (i + j) & 1, m = s / 2;
    if (c) quad(alt, [P(a, b), P(a + s, b), P(a + s, b + s), P(a, b + s)]);
    const r = s * 0.36;
    quad(rhomb[c], [P(a + m, b + m - r), P(a + m + r, b + m), P(a + m, b + m + r), P(a + m - r, b + m)]);
    const q = s * 0.11;
    quad(dot, [P(a + m - q, b + m - q), P(a + m + q, b + m - q), P(a + m + q, b + m + q), P(a + m - q, b + m + q)]);
    grout.moveTo(...P(a, b)); grout.lineTo(...P(a + s, b)); grout.moveTo(...P(a, b)); grout.lineTo(...P(a, b + s));
  }
  ctx.save(); ctx.clip(cap);
  ctx.fillStyle = ink(inks[3] || inks[0]); ctx.fill(alt);
  ctx.fillStyle = ink(inks[1]); ctx.fill(rhomb[0]);
  ctx.fillStyle = ink(inks[0]); ctx.fill(rhomb[1]);
  ctx.fillStyle = ink(inks[2]); ctx.fill(dot);
  ctx.strokeStyle = ink(inks[2]); ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(0.4, s * 0.05); ctx.stroke(grout);
  ctx.restore();
}

function paintTier(T, at, vis, sunlit, sun, ppm) {
  const h = T.z1 - T.z0, o0 = at(T.z0), o1 = at(T.z1), pts = T.pts, n = pts.length;
  const zAt = (f) => at(T.z0 + h * f);
  // ---- las paredes que miran a la cámara
  if (h > 0) for (const i of vis) {
    const lit = sunlit.has(i);
    const mural = T.wall === "mural";
    ctx.fillStyle = shade(ink(mural ? "white" : T.wall), lit);
    ctx.beginPath(); wallQuad(T, i, 0, 1, o0, o1); ctx.fill();
    for (const [f0, f1, key] of T.bands || []) {
      ctx.fillStyle = shade(ink(key), lit);
      ctx.beginPath(); wallQuad(T, i, 0, 1, zAt(f0), zAt(f1)); ctx.fill();
    }
    const j = (i + 2) % n, len = Math.hypot(pts[j] - pts[i], pts[j + 1] - pts[i + 1]), lenM = len / ppm;
    if (mural && lenM > M.mural.minM) {
      // el mural: paños de color a lo largo del muro, estables por posición. Un muro recto se parte
      // en paños; en uno curvo cada tramo del arco ya es un paño.
      const cols = Math.max(1, Math.round(lenM / M.mural.everyM));
      for (let k = 0; k < cols; k++) {
        ctx.fillStyle = M.mural.inks[Math.floor(hash01(pts[i] * 0.31 + pts[i + 1] * 0.17 + k * 7.7) * M.mural.inks.length)];
        ctx.beginPath(); wallQuad(T, i, (k + 0.06) / cols, (k + 0.94) / cols, zAt(0.14), zAt(0.9)); ctx.fill();
      }
    }
    const Wn = T.windows;
    if (Wn && lenM > Wn.wM * 1.6) {
      const cnt = Math.max(1, Math.floor(lenM / Wn.everyM)), hw = Wn.wM / 2 / lenM;
      const za = at(Wn.z[0]), zb = at(Wn.z[1]);
      ctx.fillStyle = shade(ink(Wn.ink), lit);
      ctx.beginPath();
      for (let k = 0; k < cnt; k++) { const c = (k + 0.5) / cnt; wallQuad(T, i, c - hw, c + hw, za, zb); }
      ctx.fill();
    }
    if (T.decal && VARS && VARS._decal && T.decal.edges.includes(i / 2)) paintDecal(T, i, at(T.z0), at(T.z1), lit);
    for (const op of T.openings || []) {
      if (op.edge != null && op.edge * 2 !== i) continue;
      ctx.fillStyle = shade(ink(op.ink), lit);
      ctx.beginPath(); wallQuad(T, i, op.f[0], op.f[1], at(op.z[0]), at(op.z[1])); ctx.fill();
    }
  }
  // ---- la tapa
  const cap = capPath(T, o1);
  ctx.fillStyle = ink(T.cap); ctx.fill(cap);
  if (T.stains) {
    // el concreto manchado: unas cuantas manchas, quietas, recortadas a la tapa
    ctx.save(); ctx.clip(cap);
    ctx.fillStyle = ink(T.stains);
    let cx = 0, cy = 0, r = 0;
    for (let i = 0; i < n; i += 2) { cx += pts[i] / (n / 2); cy += pts[i + 1] / (n / 2); }
    for (let i = 0; i < n; i += 2) r = Math.max(r, Math.hypot(pts[i] - cx, pts[i + 1] - cy));
    for (let k = 0; k < 9; k++) {
      const a = hash01(cx * 0.13 + k * 3.1) * 6.283, d = hash01(cy * 0.11 + k * 5.3) * r * 0.95;
      const rr = r * (0.05 + hash01(k * 9.7 + cx) * 0.07);
      ctx.beginPath(); ctx.ellipse(cx + o1[0] + Math.cos(a) * d, cy + o1[1] + Math.sin(a) * d, rr, rr * 0.62, a * 2.3, 0, 6.283); ctx.fill();
    }
    ctx.restore();
  }
  if (T.mosaic) paintMosaic(T, cap, o1, ppm);
  if (T.edge) { ctx.strokeStyle = ink(T.edge); ctx.lineWidth = 1; ctx.stroke(cap); }
  if (T.parapet) {
    // las almenas: el pretil, con sus dientes
    ctx.strokeStyle = ink(T.parapet); ctx.lineWidth = M.parapet.width;
    ctx.setLineDash(M.parapet.dash); ctx.lineCap = "butt"; ctx.stroke(cap); ctx.setLineDash([]);
    ctx.lineWidth = 0.7; ctx.stroke(cap);
  }
  const R = T.roof;
  if (R && R.kind === "dome") paintDome(T, R, at);
  else if (R && R.ridge) paintRidgeRoof(T, R, at, sun, sunlit);
  if (T.truss) paintTruss(T, at);
}

// la cúpula: la huella encogida hacia su centro mientras sube
function paintDome(T, R, at) {
  const pts = T.pts, n = pts.length, rings = 4;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i += 2) { cx += pts[i] / (n / 2); cy += pts[i + 1] / (n / 2); }
  for (let k = 0; k <= rings; k++) {
    const a = (k / (rings + 1)) * Math.PI / 2, s = Math.cos(a), o = at(T.z1 + R.rise * Math.sin(a));
    ctx.fillStyle = mixColor(ink(R.ink), ink(R.ink2), k / rings);
    ctx.beginPath();
    for (let i = 0; i < n; i += 2) {
      const x = cx + (pts[i] - cx) * s + o[0], y = cy + (pts[i + 1] - cy) * s + o[1];
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath(); ctx.fill();
  }
  const top = at(T.z1 + R.rise);
  ctx.fillStyle = ink(R.ink); ctx.beginPath(); ctx.arc(cx + top[0], cy + top[1], 1.1, 0, 6.283); ctx.fill();
}

// un techo con cumbrera (dos aguas, cuatro aguas, pirámide, medio cono): cada
// arista del alero sube a la punta de cumbrera que le queda más cerca
function paintRidgeRoof(T, R, at, sun, sunlit) {
  const pts = T.pts, n = pts.length, eave = at(T.z1), top = at(T.z1 + R.rise);
  const [ax, ay, bx, by] = R.ridge, apex = ax === bx && ay === by;
  const end = (x, y) => (apex || Math.hypot(x - ax, y - ay) <= Math.hypot(x - bx, y - by) ? 0 : 1);
  const rx = [ax + top[0], bx + top[0]], ry = [ay + top[1], by + top[1]];
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n, px = pts[i], py = pts[i + 1], qx = pts[j], qy = pts[j + 1];
    const ea = end(px, py), eb = end(qx, qy), tri = ea === eb;
    // la cara: clara si le da el sol. Un hastial (la cara triangular de un dos aguas) es pared.
    const gableEnd = tri && !apex && R.kind === "gable";
    // una lona a rayas no tiene «cara clara de otro color»: las dos caras son la lona, con su luz o su sombra
    ctx.fillStyle = gableEnd ? shade(ink(T.wall), sunlit.has(i)) : R.stripes ? shade(ink(R.ink), sunlit.has(i)) : mixColor(ink(R.ink2), ink(R.ink), sunlit.has(i) ? 1 : 0.15);
    ctx.beginPath();
    ctx.moveTo(px + eave[0], py + eave[1]); ctx.lineTo(qx + eave[0], qy + eave[1]);
    ctx.lineTo(rx[eb], ry[eb]);
    if (!tri) ctx.lineTo(rx[ea], ry[ea]);
    ctx.closePath(); ctx.fill();
    if (R.stripes && !tri) {
      // el toldo a rayas: bandas que van del alero a la cumbrera, una sí y una no en la segunda tinta
      const n = R.stripes, lit = sunlit.has(i);
      ctx.fillStyle = shade(ink(R.ink2), lit);
      ctx.beginPath();
      for (let k = 1; k < n; k += 2) {
        const f0 = k / n, f1 = (k + 1) / n;
        ctx.moveTo(px + (qx - px) * f0 + eave[0], py + (qy - py) * f0 + eave[1]);
        ctx.lineTo(px + (qx - px) * f1 + eave[0], py + (qy - py) * f1 + eave[1]);
        ctx.lineTo(rx[ea] + (rx[eb] - rx[ea]) * f1, ry[ea] + (ry[eb] - ry[ea]) * f1);
        ctx.lineTo(rx[ea] + (rx[eb] - rx[ea]) * f0, ry[ea] + (ry[eb] - ry[ea]) * f0);
        ctx.closePath();
      }
      ctx.fill();
    }
    // EL ESTAMPADO DEL TOLDO: en la cara que da a la calle, sobre las rayas
    if (T.decal && T.decal.roof && !tri && VARS && VARS._decal && T.decal.edges.includes(i / 2)) {
      const D = VARS._decal, [bx0, by0, bw, bh] = D.box, F = M.decalRoof;
      const ex = (qx - px), ey = (qy - py), mx = (px + qx) / 2 + eave[0], my = (py + qy) / 2 + eave[1];
      const rmx = (rx[ea] + rx[eb]) / 2, rmy = (ry[ea] + ry[eb]) / 2;          // el medio de la cumbrera
      const L = Math.hypot(ex, ey), ux = ex / L, uy = ey / L, hx = mx - rmx, hy = my - rmy;
      const sw = Math.min(L * F.widthK, Math.hypot(hx, hy) * F.heightK * bw / bh);   // el cartel conserva su proporción
      const cx = rmx + hx * 0.5, cy = rmy + hy * 0.5, H = Math.hypot(hx, hy) || 1;
      const ax = ux * sw / bw, ay = uy * sw / bw, cxv = hx / H * sw * bh / bw / bh, cyv = hy / H * sw * bh / bw / bh;
      ctx.save();
      ctx.transform(ax, ay, cxv, cyv, cx - ax * (bx0 + bw / 2) - cxv * (by0 + bh / 2), cy - ay * (bx0 + bw / 2) - cyv * (by0 + bh / 2));
      ctx.fillStyle = D.bg; ctx.fillRect(bx0, by0, bw, bh);
      paintAt(D.parts, 0, 0, { g: ctx });
      ctx.strokeStyle = F.frame; ctx.lineWidth = F.frameW; ctx.strokeRect(bx0, by0, bw, bh);
      ctx.restore();
    }
    if (R.seams && !tri) {
      // las láminas de zinc: una costura cada tanto, del alero a la cumbrera
      const len = Math.hypot(qx - px, qy - py), cnt = Math.floor(len / R.seams);
      ctx.strokeStyle = M.roofSeam; ctx.lineWidth = 0.6; ctx.beginPath();
      for (let k = 1; k < cnt; k++) {
        const f = k / cnt;
        ctx.moveTo(px + (qx - px) * f + eave[0], py + (qy - py) * f + eave[1]);
        ctx.lineTo(rx[ea] + (rx[eb] - rx[ea]) * f, ry[ea] + (ry[eb] - ry[ea]) * f);
      }
      ctx.stroke();
    }
  }
  if (!apex) { ctx.strokeStyle = M.roofRidge; ctx.lineWidth = 1.1; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(rx[0], ry[0]); ctx.lineTo(rx[1], ry[1]); ctx.stroke(); }
  if (R.cross) {
    // LA CRUZ ESTÁ DE PIE, como todo lo demás: un palo que sube de la punta del techo y su travesaño
    // a dos tercios, los dos corridos por el mismo pinhole. `crossAng` es hacia dónde MIRA (rumbo del
    // mundo): el travesaño va a escuadra de esa mirada.
    const first = R.crossAt === 0, K = M.cross, ppm = W.PX_PER_M;
    const bx0 = apex || first ? ax : bx, by0 = apex || first ? ay : by, z0 = T.z1 + R.rise;
    const foot = at(z0), head = at(z0 + K.heightM), mid = at(z0 + K.heightM * K.barAt);
    const ang = R.crossAng == null ? 0 : R.crossAng, hx = -Math.sin(ang) * K.barM * ppm / 2, hy = Math.cos(ang) * K.barM * ppm / 2;
    ctx.lineCap = "butt";
    for (const [color, w, dx, dy] of [[K.shade, K.widthPx + 1, 0.7, 0.9], [ink(R.cross), K.widthPx, 0, 0]]) {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
      ctx.moveTo(bx0 + foot[0] + dx, by0 + foot[1] + dy); ctx.lineTo(bx0 + head[0] + dx, by0 + head[1] + dy);
      ctx.moveTo(bx0 + mid[0] - hx + dx, by0 + mid[1] - hy + dy); ctx.lineTo(bx0 + mid[0] + hx + dx, by0 + mid[1] + hy + dy);
      ctx.stroke();
    }
  }
}

// la celosía de concreto del Palacio: dos cuerdas y su zigzag, sobre los lados largos
function paintTruss(T, at) {
  const pts = T.pts, lo = at(T.z1), hi = at(T.z1 + T.truss.h);
  ctx.strokeStyle = ink(T.truss.ink); ctx.lineWidth = 1.3; ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const i of [0, 4]) {
    const j = (i + 2) % pts.length, px = pts[i], py = pts[i + 1], ex = pts[j] - px, ey = pts[j + 1] - py;
    const cnt = Math.max(2, Math.round(Math.hypot(ex, ey) / T.truss.every));
    ctx.beginPath();
    ctx.moveTo(px + lo[0], py + lo[1]); ctx.lineTo(px + ex + lo[0], py + ey + lo[1]);
    ctx.moveTo(px + hi[0], py + hi[1]); ctx.lineTo(px + ex + hi[0], py + ey + hi[1]);
    ctx.moveTo(px + lo[0], py + lo[1]);
    for (let k = 0; k < cnt; k++) {
      ctx.lineTo(px + ex * (k + 0.5) / cnt + hi[0], py + ey * (k + 0.5) / cnt + hi[1]);
      ctx.lineTo(px + ex * (k + 1) / cnt + lo[0], py + ey * (k + 1) / cnt + lo[1]);
    }
    ctx.stroke();
  }
}

// la sombra de una estructura: el barrido de cada cuerpo, en UN solo relleno
function paintShadow(S) {
  let alpha = 0;
  ctx.beginPath();
  const poly = (pts, dx, dy) => {
    ctx.moveTo(pts[0] + dx, pts[1] + dy);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + dx, pts[i + 1] + dy);
    ctx.closePath();
  };
  for (const T of S.tiers) {
    const top = T.z1 + (T.roof ? T.roof.rise * 0.6 : 0);
    if (top < M.shadowMinM) continue;
    const sh = sunShadow(top);
    if (!sh.dx && !sh.dy) continue;
    alpha = Math.max(alpha, sh.alpha);
    const pts = T.pts, n = pts.length;
    poly(pts, 0, 0); poly(pts, sh.dx, sh.dy);
    for (let i = 0; i < n; i += 2) {
      const j = (i + 2) % n, px = pts[i], py = pts[i + 1], qx = pts[j], qy = pts[j + 1];
      // cada costado con el MISMO giro que las huellas: en un relleno `nonzero`
      // dos giros contrarios que se montan abren un hueco
      if ((qx - px) * sh.dy - (qy - py) * sh.dx >= 0) {
        ctx.moveTo(px, py); ctx.lineTo(qx, qy); ctx.lineTo(qx + sh.dx, qy + sh.dy); ctx.lineTo(px + sh.dx, py + sh.dy);
      } else {
        ctx.moveTo(px, py); ctx.lineTo(px + sh.dx, py + sh.dy); ctx.lineTo(qx + sh.dx, qy + sh.dy); ctx.lineTo(qx, qy);
      }
      ctx.closePath();
    }
  }
  if (!alpha) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = M.shadow; ctx.fill(); ctx.restore();
}

function paintStructure(S, ppm, pill = null) {
  const ro = parallaxOffset(state.cam, S.x, S.y, S.zMax, ppm);
  const at = (z) => { const k = z / S.zMax; return [ro.dx * k, ro.dy * k]; };
  const sun = sunShadow(S.zMax);
  for (const T of S.tiers) {
    const vis = ro.dx || ro.dy ? facingEdges(T.pts, ro.dx, ro.dy) : [];
    const sunlit = new Set(facingEdges(T.pts, sun.dx, sun.dy));
    paintTier(T, at, vis, sunlit, sun, ppm);
  }
  const top = at(S.zMax);
  if (S.label) label(S.x + top[0], S.y0 + top[1] - 9, S.label, M.label.fg, M.label.bg, 9);
  if (pill) label(S.x + top[0], S.y0 + top[1] - (pill.size || 10), pill.text, pill.fg, pill.bg, pill.size || 10);
}


// ───────────────────────────── la cola ─────────────────────────────
const queue = [];

/** Encola un cuerpo ya armado. `vars`: sus tintas `$x`. `pill`: {text, fg, bg} sobre su techo. */
export function queueBody(S, vars = null, pill = null, over = false) { queue.push({ S, vars, pill, over }); }

// LO QUE VA ENCIMA DEL CARRO. Un quiosco es un toldo bajo el que el carro entra a recoger: su sombra
// se pinta con las demás, pero el cuerpo espera a `flushOverBodies`, que el compositor llama
// DESPUÉS del jugador. Lo demás sigue bajo él (el carro rebota contra un edificio; no pasa debajo).
const overQueue = [];

/** Encola cualquier otra cosa que se pinta con los cuerpos (un asta): `{x, y, paint(ppm)}`. */
export function queueBodyLike(o) { queue.push({ S: o, other: true }); }

const built = new WeakMap();
/**
 * Arma (una vez) un cuerpo de receta —`world-props.json → bodies`— parado en (x, y) de mundo y
 * girado `ang`: metros de receta → píxeles de mundo. Se guarda por receta y lugar.
 */
export function bodyAt(spec, x, y, ang = 0, key = "") {
  let byKey = built.get(spec);
  if (!byKey) built.set(spec, (byKey = new Map()));
  const k = `${Math.round(x)},${Math.round(y)},${ang.toFixed(3)},${key}`;
  let S = byKey.get(k);
  if (!S) {
    const ppm = W.PX_PER_M, c = Math.cos(ang), s = Math.sin(ang);
    S = buildBody(spec, [0, 0], 0, { ppm, ang, at: ([u, v]) => [x + (u * c - v * s) * ppm, y + (u * s + v * c) * ppm] });
    byKey.set(k, S);
  }
  return S;
}

/** Pinta lo encolado: lo bajo primero, después de lejos a cerca; todas las sombras antes que los cuerpos. */
export function flushBodies() {
  if (!queue.length) return;
  const ppm = W.PX_PER_M, cam = state.cam;
  const low = (q) => (!q.other && q.S.zMax <= M.lowM ? 0 : 1);
  queue.sort((a, b) => low(a) - low(b) || Math.hypot(b.S.x - cam.x, b.S.y - cam.y) - Math.hypot(a.S.x - cam.x, a.S.y - cam.y));
  ctx.lineJoin = "round";
  for (const q of queue) if (!q.other) paintShadow(q.S);
  for (const q of queue) {
    if (q.other) { q.S.paint(ppm); continue; }
    if (q.over) { overQueue.push(q); continue; }
    VARS = q.vars;
    paintStructure(q.S, ppm, q.pill);
  }
  VARS = null;
  queue.length = 0;
}

/** Pinta lo que va encima del carro (ver `queueBody(…, over)`). */
export function flushOverBodies() {
  if (!overQueue.length) return;
  const ppm = W.PX_PER_M;
  ctx.lineJoin = "round";
  // CON EL CARRO DEBAJO, EL TOLDO SE VUELVE TRANSLÚCIDO: el jugador tiene que verse recogiendo
  const p = state.p, pad = M.overUnderPadPx;
  for (const q of overQueue) {
    VARS = q.vars;
    const under = p && p.x > q.S.x0 - pad && p.x < q.S.x1 + pad && p.y > q.S.y0 - pad && p.y < q.S.y1 + pad;
    if (under) { ctx.save(); ctx.globalAlpha = M.overUnderAlpha; }
    paintStructure(q.S, ppm, under ? null : q.pill);
    if (under) { ctx.restore(); if (q.pill) { const S = q.S; label(S.x, S.y0 - (q.pill.size || 10), q.pill.text, q.pill.fg, q.pill.bg, q.pill.size || 10); } }
  }
  VARS = null;
  overQueue.length = 0;
}
