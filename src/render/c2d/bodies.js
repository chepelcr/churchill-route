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
import { nightLevel } from "../../game/daynight.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import EFFECTS from "../../assets/effects.json" with { type: "json" };

const M = MATERIALS.centro;
const INK = M.inks;
let VARS = null;   // las tintas `$x` del cuerpo que se está pintando
// CUÁNTO SE CORRE UN PUNTO (x, y) A `z` METROS — `off(x, y, z)` → [dx, dy]. Sin `perspective` en la
// receta es el MISMO vector para todo el cuerpo (el de su centro), que es lo de siempre; con él, cada
// punto se corre según dónde ESTÁ. A una altura dada el pinhole es una escala alrededor de la cámara,
// así que un cuerpo grande —la UTN mide 75 m— deja de inclinarse entero hacia donde mira su centro: de
// costado, la fachada se hundía hacia el fondo porque se corría como si estuviera en medio de la cuadra.
let OFF = (x, y, z) => [0, 0];
const PAR = EFFECTS.parallax;
const ink = (key) => (key && key[0] === "$" ? VARS && VARS[key.slice(1)] : INK[key]) || M.missing;

// ───────────────────────────── las estructuras ─────────────────────────────
// una pared: el tramo [f0, f1] de la arista `i`, levantado de za a zb
function wallQuad(T, i, f0, f1, za, zb) {
  const pts = T.pts, j = (i + 2) % pts.length;
  const px = pts[i], py = pts[i + 1], ex = pts[j] - px, ey = pts[j + 1] - py;
  const x0 = px + ex * f0, y0 = py + ey * f0, x1 = px + ex * f1, y1 = py + ey * f1;
  const a0 = OFF(x0, y0, za), a1 = OFF(x1, y1, za), b0 = OFF(x0, y0, zb), b1 = OFF(x1, y1, zb);
  ctx.moveTo(x0 + a0[0], y0 + a0[1]);
  ctx.lineTo(x1 + a1[0], y1 + a1[1]);
  ctx.lineTo(x1 + b1[0], y1 + b1[1]);
  ctx.lineTo(x0 + b0[0], y0 + b0[1]);
  ctx.closePath();
}
const shade = (color, lit) => (lit ? mixColor(color, M.wall.lit, M.wall.litMix) : mixColor(color, M.wall.dark, M.wall.darkMix));

// un punto de la pared `i`: `f` a lo largo de la arista (0…1) y `z` metros de alto, ya corrido por el pinhole
function wallPt(T, i, f, z) {
  const pts = T.pts, j = (i + 2) % pts.length;
  const x = pts[i] + (pts[j] - pts[i]) * f, y = pts[i + 1] + (pts[j + 1] - pts[i + 1]) * f, o = OFF(x, y, z);
  return [x + o[0], y + o[1]];
}
// EL CONTORNO DE UN VANO en la pared `i` (`openings`): un rectángulo, o —con `shape`— un ARCO (el
// rectángulo coronado por su medio punto: el radio es medio ancho del vano y la clave queda en `z[1]`) o
// un DISCO (el óculo, inscrito en su caja). Se arma en metros de la pared —el ancho del vano en metros,
// con el largo de la arista— y cada punto se lleva a la pantalla como las esquinas de `wallQuad`, así un
// medio punto sigue siendo redondo en una pared en escorzo. `grow` lo agranda parejo: el marco.
const ARC_N = 14;
function openingPath(T, i, op, lenM, grow) {
  const [f0, f1] = op.f, [z0, z1] = op.z, g = grow || 0, gf = g / (lenM || 1);
  if (!op.shape || op.shape === "rect" || !(lenM > 0)) { wallQuad(T, i, f0 - gf, f1 + gf, z0 - g, z1 + g); return; }
  const fc = (f0 + f1) / 2, P = (f, z) => wallPt(T, i, f, z);
  let pts;
  if (op.shape === "arch") {
    const r = (f1 - f0) * lenM / 2 + g, rf = r / lenM, zs = Math.max(z0 - g, z1 + g - r);
    pts = [P(fc - rf, z0 - g), P(fc + rf, z0 - g)];
    for (let k = 0; k <= ARC_N; k++) { const a = (k / ARC_N) * Math.PI; pts.push(P(fc + rf * Math.cos(a), zs + r * Math.sin(a))); }
  } else {                                    // "disc"
    const a = (f1 - f0) * lenM / 2 + g, b = (z1 - z0) / 2 + g, zc = (z0 + z1) / 2;
    pts = [];
    for (let k = 0; k < ARC_N * 2; k++) { const t = (k / (ARC_N * 2)) * Math.PI * 2; pts.push(P(fc + (a / lenM) * Math.cos(t), zc + b * Math.sin(t))); }
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
  ctx.closePath();
}

// LA CORTINA QUE SE ENROLLA CON EL DÍA (`tiers[].roll`: {slat}): un bloque delgado —la cortina del
// frente de una bahía, sus rejas a los lados— que de día está ENROLLADO arriba, en su caja, y de noche
// baja hasta el piso; al atardecer baja y al amanecer sube, siguiendo el MISMO continuo del cielo que apaga
// las sombras y prende las lámparas (`nightLevel`), así que no hay un segundo reloj que se le desfase al
// cielo. Abierta, lo de adentro se ve —en la ACON, la isla con sus bombas—, que es la diferencia con
// pintarla como un vano oscuro. `M.roll.band` dice en qué tramo de ese continuo se mueve: entero tardaría
// un minuto —hora y media de juego—, y una cortina baja de un tirón. Sin ciclo del día (una etapa con su
// clima fijo) sigue al clima: de noche cerrada, si no abierta.
function rolledDown() {
  const [a, b] = M.roll.band, x = Math.max(0, Math.min(1, (nightLevel() - a) / (b - a)));
  return x * x * (3 - 2 * x);
}

function capPath(T, z) {
  const p = new Path2D(), pts = T.pts;
  for (let i = 0; i < pts.length; i += 2) {
    const o = OFF(pts[i], pts[i + 1], z);
    if (i) p.lineTo(pts[i] + o[0], pts[i + 1] + o[1]); else p.moveTo(pts[i] + o[0], pts[i + 1] + o[1]);
  }
  p.closePath();
  return p;
}

// EL ESTAMPADO: un cartel pintado en la pared `i`, del zócalo al alero. Sus partes vienen del hito
// (`VARS._decal`: `parts` en su propio marco `box` [x, y, ancho, alto]) y se llevan a la pared con una
// afín: el ancho del cartel a lo largo de la arista, su alto de la tapa al pie. Una pared que en la
// pantalla mide menos de `decalMinPx` no lo lleva: sería una raya de colores.
// Un cuerpo puede llevar MÁS DE UN cartel: el bloque nombra el suyo con `decal.key` y el cartel sale de
// `VARS._decal_<key>` (la losa de la bahía de la ACON dice BOMBA ACON S.A. en su canto de Calle 4); sin llave, `VARS._decal`.
const decalOf = (T) => VARS && (T.decal.key ? VARS[`_decal_${T.decal.key}`] : VARS._decal);
function paintDecal(T, i, lo, hi, lit) {
  const D = decalOf(T), [bx, by, bw, bh] = D.box, pts = T.pts, j = (i + 2) % pts.length;
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
  const { everyM, inks } = T.mosaic, s = everyM * ppm;
  if (!(s > 1.2)) return;
  // LAS LOSETAS SE ARMAN UNA VEZ. La tapa sólo se TRASLADA con la cámara (`o`, su corrimiento a esa
  // altura), así que el mosaico entero es el mismo dibujo corrido: se arma sin corrimiento, se guarda
  // en la huella y cada cuadro se pinta bajo un `translate`. Armarlo por cuadro eran cientos de
  // losetas recalculadas en el piso de cada iglesia vieja a la vista.
  const M2 = T._mosaic && T._mosaic.s === s ? T._mosaic : (T._mosaic = buildMosaic(T.pts, s));
  ctx.save(); ctx.clip(cap); ctx.translate(o[0], o[1]);
  ctx.fillStyle = ink(inks[3] || inks[0]); ctx.fill(M2.alt);
  ctx.fillStyle = ink(inks[1]); ctx.fill(M2.rhomb[0]);
  ctx.fillStyle = ink(inks[0]); ctx.fill(M2.rhomb[1]);
  ctx.fillStyle = ink(inks[2]); ctx.fill(M2.dot);
  ctx.strokeStyle = ink(inks[2]); ctx.globalAlpha = 0.35; ctx.lineWidth = Math.max(0.4, s * 0.05); ctx.stroke(M2.grout);
  ctx.restore();
}

function buildMosaic(pts, s) {
  const n = pts.length;
  let ex = pts[2] - pts[0], ey = pts[3] - pts[1];
  const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
  const nx = -ey, ny = ex, ox = pts[0], oy = pts[1];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i += 2) {
    const dx = pts[i] - ox, dy = pts[i + 1] - oy, u = dx * ex + dy * ey, v = dx * nx + dy * ny;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const P = (u, v) => [ox + ex * u + nx * v, oy + ey * u + ny * v];
  // sin `closePath`: sólo se rellenan, y en un camino de cientos de losetas el cierre es cuadrático (ver `paintShadow`)
  const quad = (path, pp) => { path.moveTo(pp[0][0], pp[0][1]); for (let k = 1; k < 4; k++) path.lineTo(pp[k][0], pp[k][1]); };
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
  return { s, alt, rhomb, dot, grout };
}

// UNA CARA DE TECHO (`facet`): el plano entre sus vértices, cada uno corrido a SU altura. Clara si mira al
// sol, como las caras de un techo con cumbrera; una cara de pared (un hastial) se sombrea como pared.
function paintFacet(T, at, sun) {
  const P = T.facet;
  ctx.beginPath();
  P.forEach(([x, y, z], i) => { const o = OFF(x, y, z); if (i) ctx.lineTo(x + o[0], y + o[1]); else ctx.moveTo(x + o[0], y + o[1]); });
  ctx.closePath();
  // la normal del plano, en planta: hacia dónde baja la cara
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const lit = -(nx * sun.dx + ny * sun.dy) * Math.sign(nz || 1) > 0;
  ctx.fillStyle = T.wallFacet ? shade(ink(T.ink), lit) : mixColor(ink(T.ink2), ink(T.ink), lit ? 1 : 0.15);
  ctx.fill();
  if (!T.noSeam) { ctx.strokeStyle = M.roofSeam; ctx.lineWidth = 0.6; ctx.stroke(); }
}

function paintTier(T, at, vis, sunlit, sun, ppm) {
  if (T.facet) { paintFacet(T, at, sun); return; }
  const h = T.z1 - T.z0, o1 = at(T.z1), pts = T.pts, n = pts.length;
  const zAt = (f) => T.z0 + h * f;
  // ---- las paredes que miran a la cámara
  if (h > 0) for (const i of vis) {
    const lit = sunlit.has(i);
    // UNA CARA PUEDE SER DISTINTA DE LAS OTRAS (`faces`, por arista): la fachada de la UTN es azul y
    // blanca, su costado de Calle 3 es de murales y el de atrás concreto pelado. Sin `faces`, igual que siempre.
    const F = T.faces && T.faces[i / 2];
    const wall = F && F.wall ? F.wall : T.wall, bands = F && F.bands ? F.bands : T.bands;
    const mural = wall === "mural";
    ctx.fillStyle = shade(ink(mural ? "white" : wall), lit);
    ctx.beginPath(); wallQuad(T, i, 0, 1, T.z0, T.z1); ctx.fill();
    for (const [f0, f1, key] of bands || []) {
      ctx.fillStyle = shade(ink(key), lit);
      ctx.beginPath(); wallQuad(T, i, 0, 1, zAt(f0), zAt(f1)); ctx.fill();
    }
    if (T.roll && T.roll.slat) {
      // las tablillas quedan del tamaño que tienen: se cuentan desde la caja hacia abajo, no se aprietan
      const every = M.roll.slatEveryM, w = M.roll.slatM;
      ctx.fillStyle = shade(ink(T.roll.slat), lit);
      ctx.beginPath();
      for (let z = T.z1 - every; z > T.z0 + w; z -= every) wallQuad(T, i, 0, 1, z - w, z);
      ctx.fill();
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
    const Wn = F && "windows" in F ? F.windows : T.windows;
    if (Wn && lenM > Wn.wM * 1.6) {
      const cnt = Math.max(1, Math.floor(lenM / Wn.everyM)), hw = Wn.wM / 2 / lenM;
      const za = Wn.z[0], zb = Wn.z[1];
      ctx.fillStyle = shade(ink(Wn.ink), lit);
      ctx.beginPath();
      for (let k = 0; k < cnt; k++) { const c = (k + 0.5) / cnt; wallQuad(T, i, c - hw, c + hw, za, zb); }
      ctx.fill();
    }
    if (T.decal && decalOf(T) && T.decal.edges.includes(i / 2)) {
      const mx = (pts[i] + pts[j]) / 2, my = (pts[i + 1] + pts[j + 1]) / 2;
      paintDecal(T, i, OFF(mx, my, T.z0), OFF(mx, my, T.z1), lit);
    }
    for (const op of T.openings || []) {
      if (op.edge != null && op.edge * 2 !== i) continue;
      // `rim`: [tinta, metros] — el marco que rodea el vano (el cerco blanco de un óculo ciego), el mismo
      // contorno crecido, pintado antes
      if (op.rim) { ctx.fillStyle = shade(ink(op.rim[0]), lit); ctx.beginPath(); openingPath(T, i, op, lenM, op.rim[1]); ctx.fill(); }
      ctx.fillStyle = shade(ink(op.ink), lit);
      ctx.beginPath(); openingPath(T, i, op, lenM, 0); ctx.fill();
    }
  }
  // ---- la tapa
  const cap = capPath(T, T.z1);
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
  if (T.capText) paintCapText(T);
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

// EL NOMBRE PINTADO SOBRE EL TECHO (`capText`: {lines, atM, heightM, ink, maxWM?, weight?}), sin píldora —
// como el del DJ sobre su dosel (`feriaRigs.js → stage`)—. Una tapa plana con el pinhole es la huella
// ESCALADA alrededor de la cámara (1 + z/H), así que las letras van al punto ya corrido y con esa misma
// escala; sin perspectiva el corrimiento es parejo y la escala 1. `maxWM`: lo más ancho que puede ir la
// línea más larga, en metros —si no cabe, se achica todo el bloque—.
function paintCapText(T) {
  const C = T.capText, o = OFF(C.x, C.y, T.z1), d = OFF(C.x + 100, C.y, T.z1), s = 1 + (d[0] - o[0]) / 100;
  const hPx = C.heightM * C.ppm, D = M.capText;
  ctx.save();
  ctx.translate(C.x + o[0], C.y + o[1]); ctx.rotate(C.ang); ctx.scale(s, s);
  ctx.font = `${C.weight || D.weight} ${hPx.toFixed(2)}px ${D.family}`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = ink(C.ink);
  if (C.maxWM) {
    const w = Math.max(...C.lines.map((l) => ctx.measureText(l).width));
    if (w > C.maxWM * C.ppm) { const k = C.maxWM * C.ppm / w; ctx.scale(k, k); }
  }
  const gap = (C.lineK || D.lineK) * hPx;
  C.lines.forEach((l, i) => ctx.fillText(l, 0, (i - (C.lines.length - 1) / 2) * gap));
  ctx.restore();
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
  const pts = T.pts, n = pts.length, zt = T.z1 + R.rise;
  const [ax, ay, bx, by] = R.ridge, apex = ax === bx && ay === by;
  const end = (x, y) => (apex || Math.hypot(x - ax, y - ay) <= Math.hypot(x - bx, y - by) ? 0 : 1);
  const ta = OFF(ax, ay, zt), tb = OFF(bx, by, zt);
  const rx = [ax + ta[0], bx + tb[0]], ry = [ay + ta[1], by + tb[1]];
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n, px = pts[i], py = pts[i + 1], qx = pts[j], qy = pts[j + 1];
    // el alero de esta arista: su corrimiento en cada punta (iguales sin `perspective`); a lo largo, lineal
    const ep = OFF(px, py, T.z1), eq = OFF(qx, qy, T.z1);
    const eave = [ep[0], ep[1]], eAt = (f) => [px + (qx - px) * f + ep[0] + (eq[0] - ep[0]) * f, py + (qy - py) * f + ep[1] + (eq[1] - ep[1]) * f];
    const ea = end(px, py), eb = end(qx, qy), tri = ea === eb;
    // la cara: clara si le da el sol. Un hastial (la cara triangular de un dos aguas) es pared.
    // Un techo a un agua tiene dos: los triángulos de sus puntas y la pared alta que corre bajo su cumbrera.
    const under = R.kind === "shed" && !tri && Math.min(Math.hypot(px - ax, py - ay), Math.hypot(px - bx, py - by)) < 0.5
      && Math.min(Math.hypot(qx - ax, qy - ay), Math.hypot(qx - bx, qy - by)) < 0.5;
    const gableEnd = (tri && !apex && (R.kind === "gable" || R.kind === "shed")) || under;
    // una lona a rayas no tiene «cara clara de otro color»: las dos caras son la lona, con su luz o su sombra
    ctx.fillStyle = gableEnd ? shade(ink(T.wall), sunlit.has(i)) : R.stripes ? shade(ink(R.ink), sunlit.has(i)) : mixColor(ink(R.ink2), ink(R.ink), sunlit.has(i) ? 1 : 0.15);
    ctx.beginPath();
    ctx.moveTo(px + ep[0], py + ep[1]); ctx.lineTo(qx + eq[0], qy + eq[1]);
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
        ctx.moveTo(...eAt(f0));
        ctx.lineTo(...eAt(f1));
        ctx.lineTo(rx[ea] + (rx[eb] - rx[ea]) * f1, ry[ea] + (ry[eb] - ry[ea]) * f1);
        ctx.lineTo(rx[ea] + (rx[eb] - rx[ea]) * f0, ry[ea] + (ry[eb] - ry[ea]) * f0);
        ctx.closePath();
      }
      ctx.fill();
    }
    // EL ESTAMPADO DEL TOLDO: en la cara que da a la calle, sobre las rayas
    if (T.decal && T.decal.roof && !tri && decalOf(T) && T.decal.edges.includes(i / 2)) {
      const D = decalOf(T), [bx0, by0, bw, bh] = D.box, F = M.decalRoof;
      const ex = (qx - px), ey = (qy - py), [mx, my] = eAt(0.5);
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
        ctx.moveTo(...eAt(f));
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
    const foot = OFF(bx0, by0, z0), head = OFF(bx0, by0, z0 + K.heightM), mid = OFF(bx0, by0, z0 + K.heightM * K.barAt);
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
  // SIN `closePath`: este camino es sólo para RELLENAR, y `fill()` cierra cada subcamino por su cuenta
  // —mismos píxeles—. En Chromium cada `closePath` cuesta proporcional al largo del camino entero, así
  // que con cientos de costados en un solo camino el cierre explícito se vuelve CUADRÁTICO: medido,
  // 1 600 cuadriláteros son 16,6 ms con cierre y 0,29 sin él, y estas sombras eran 4 ms de cuadro
  // en el centro (ver `tools/bench-closepath.mjs`).
  const poly = (pts, dx, dy) => {
    ctx.moveTo(pts[0] + dx, pts[1] + dy);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i] + dx, pts[i + 1] + dy);
  };
  for (const T of S.tiers) {
    // `noShadow`: lo tapa la sombra de otro (los escalones de una grada, que tira su sombra de una vez
    // con un bloque `shadowOnly`): cientos de caras con su barrido cada una costaban milisegundos
    if (T.noShadow) continue;
    if (T.roll && rolledDown() <= 0.002) continue;      // la cortina enrollada en su caja
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
    }
  }
  if (!alpha) return;
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = M.shadow; ctx.fill(); ctx.restore();
}

// las paredes que la cámara ve, arista por arista: la que tiene la cámara del lado de afuera
function visibleEdges(pts, cam) {
  const out = [];
  for (let i = 0; i < pts.length; i += 2) {
    const j = (i + 2) % pts.length, mx = (pts[i] + pts[j]) / 2, my = (pts[i + 1] + pts[j + 1]) / 2;
    if (facingEdges(pts, mx - cam.x, my - cam.y).includes(i)) out.push(i);
  }
  return out;
}

function paintStructure(S, ppm, pill = null) {
  // UN GRUPO DE CUERPOS PEGADOS SE INCLINA JUNTO: quien lo arma le pone a cada uno el MISMO vector
  // por metro (`leanPerM`), así la pared que comparten dos vecinos sube a la par y ninguno le monta
  // el techo al otro ni deja su base al descubierto. Sin él, el vector del centro de este cuerpo.
  const ro = S.leanPerM ? { dx: S.leanPerM.dx * S.zMax, dy: S.leanPerM.dy * S.zMax } : parallaxOffset(state.cam, S.x, S.y, S.zMax, ppm);
  const cam = state.cam;
  if (S.perspective && !S.leanPerM) {
    // la escala alrededor de la cámara, con el MISMO tope que todo lo demás: se mide el corrimiento sin
    // tope en el centro del cuerpo a su altura máxima y, si pasa del tope, se encoge toda la altura
    const H = PAR.cameraHeightM, cap = PAR.maxOffsetPx || 0;
    const raw = Math.hypot(S.x - cam.x, S.y - cam.y) * S.zMax / H, sq = cap > 0 && raw > cap ? cap / raw : 1;
    OFF = (x, y, z) => { const k = z / H * sq; return [(x - cam.x) * k, (y - cam.y) * k]; };
  } else OFF = (x, y, z) => { const k = z / S.zMax; return [ro.dx * k, ro.dy * k]; };
  const sun = sunShadow(S.zMax);
  for (const T of S.tiers) {
    if (T.shadowOnly) continue;          // sólo existe para tirar la sombra (`paintShadow`)
    let z0 = null;
    if (T.roll) {                        // la cortina: su borde de abajo baja desde la caja con el atardecer
      const c = rolledDown();
      if (c <= 0.002) continue;
      z0 = T.z0; T.z0 = T.z1 - (T.z1 - z0) * c;
    }
    // lo que se corre por el CENTRO del bloque (la cúpula, la celosía, las manchas de la tapa)
    let tcx = 0, tcy = 0;
    for (let i = 0; i < T.pts.length; i += 2) { tcx += T.pts[i]; tcy += T.pts[i + 1]; }
    tcx /= T.pts.length / 2; tcy /= T.pts.length / 2;
    const at = (z) => OFF(tcx, tcy, z);
    const vis = S.perspective ? visibleEdges(T.pts, cam) : ro.dx || ro.dy ? facingEdges(T.pts, ro.dx, ro.dy) : [];
    const sunlit = new Set(facingEdges(T.pts, sun.dx, sun.dy));
    paintTier(T, at, vis, sunlit, sun, ppm);
    if (z0 != null) T.z0 = z0;
  }
  const top = OFF(S.x, S.y, S.zMax);
  if (S.label) label(S.x + top[0], S.y0 + top[1] - 9, S.label, M.label.fg, M.label.bg, 9);
  if (pill) label(S.x + top[0], S.y0 + top[1] - (pill.size || 10), pill.text, pill.fg, pill.bg, pill.size || 10);
}


// ───────────────────────────── la cola ─────────────────────────────
const queue = [];

/** Encola un cuerpo ya armado. `vars`: sus tintas `$x`. `pill`: {text, fg, bg} sobre su techo. */
export function queueBody(S, vars = null, pill = null, over = false) { queue.push({ S, vars, pill, over }); remember(S); }

// LO QUE SE LEVANTA, RECORDADO PARA LOS ÁRBOLES. Los cuerpos de receta —la Catedral, el Mercado, la
// UTN, lo del centro cívico— no viven en los tiles: se arman y se encolan cada cuadro. Un árbol que se
// planta junto a uno necesita saber dónde está para no meterle la copa encima (`flora.js →
// buildingFit`), y los árboles se pintan ANTES que la cola. Así que la cola recuerda la planta de cada
// cuerpo que ve (sus pisos de `STAND_MIN_M` metros o más: las maceteras no tapan nada; ojo, `under` NO sirve de filtro, porque `buildBody` se lo copia también al cuerpo principal de una receta que trae `under`) y sube
// `footprintVersion` cuando aparece uno nuevo: el árbol que preguntó antes vuelve a preguntar.
const STANDING = new Map();   // cuerpo → { x0, y0, x1, y1, polys }
let footprintVersion = 0;
const STAND_MIN_M = 2;
function remember(S) {
  if (!S || STANDING.has(S) || !S.tiers) return;
  const polys = [];
  for (const T of S.tiers) if (!T.shadowOnly && (T.z1 ?? 0) >= STAND_MIN_M && T.pts && T.pts.length >= 6) polys.push(T.pts);
  STANDING.set(S, polys.length ? (() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of polys) for (let i = 0; i < p.length; i += 2) {
      if (p[i] < x0) x0 = p[i]; if (p[i] > x1) x1 = p[i]; if (p[i + 1] < y0) y0 = p[i + 1]; if (p[i + 1] > y1) y1 = p[i + 1];
    }
    return { x0, y0, x1, y1, polys, zTop: S.zMax || Math.max(...S.tiers.map((T) => T.z1 || 0)) };
  })() : null);
  if (polys.length) footprintVersion++;
}
/** Las plantas de los cuerpos vistos hasta ahora, y su versión (cambia cuando aparece uno nuevo). */
export function standingFootprints() { return STANDING.values(); }
export function standingVersion() { return footprintVersion; }

// LO QUE VA ENCIMA DEL CARRO. Un quiosco es un toldo bajo el que el carro entra a recoger: su sombra
// se pinta con las demás, pero el cuerpo espera a `flushOverBodies`, que el compositor llama
// DESPUÉS del jugador. Lo demás sigue bajo él (el carro rebota contra un edificio; no pasa debajo).
const overQueue = [];

/** Encola cualquier otra cosa que se pinta con los cuerpos (un asta): `{x, y, paint(ppm)}`. */
export function queueBodyLike(o) { queue.push({ S: o, other: true }); }

/** …y lo mismo, pero ENCIMA del carro: un arco de entrada bajo el que el carro pasa (`gate3d.js`).
 *  Encolado con los cuerpos, el carro le pasaba POR ENCIMA al rótulo de la feria y al del muelle. */
export function queueOverLike(o, top = false) { (top ? overTop : overQueue).push({ S: o, other: true }); }
// …y lo que va encima de TODO lo de encima del carro: las torres de luz de un estadio, paradas sobre su
// gradería. Las graderías 3D entran a `overQueue` recién durante `flushBodies`, o sea DESPUÉS de lo que
// se encoló directo allí, y les pasaban por encima a las torres.
const overTop = [];

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
  // `under`: va con lo bajo aunque sea alto — el mobiliario de la calle que los árboles cubren (las paradas del
  // Mercado), que si entrara por distancia saldría encima de las copas cuando la cámara está del otro lado
  const low = (q) => (!q.other && (q.S.under || q.S.zMax <= M.lowM) ? 0 : 1);
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
  if (!overQueue.length && !overTop.length) return;
  const ppm = W.PX_PER_M;
  ctx.lineJoin = "round";
  // CON EL CARRO DEBAJO, EL TOLDO SE VUELVE TRANSLÚCIDO: el jugador tiene que verse recogiendo
  const p = state.p, pad = M.overUnderPadPx;
  for (const q of overQueue) {
    if (q.other) { q.S.paint(ppm); continue; }
    VARS = q.vars;
    // `noFade`: un cuerpo del tamaño de un estadio no se vuelve translúcido entero porque el carro esté
    // en algún lugar de su caja — eso es para un toldo de quiosco, bajo el que el carro recoge
    const under = !q.S.noFade && p && p.x > q.S.x0 - pad && p.x < q.S.x1 + pad && p.y > q.S.y0 - pad && p.y < q.S.y1 + pad;
    if (under) { ctx.save(); ctx.globalAlpha = M.overUnderAlpha; }
    paintStructure(q.S, ppm, under ? null : q.pill);
    if (under) { ctx.restore(); if (q.pill) { const S = q.S; label(S.x, S.y0 - (q.pill.size || 10), q.pill.text, q.pill.fg, q.pill.bg, q.pill.size || 10); } }
  }
  VARS = null;
  overQueue.length = 0;
  for (const q of overTop) q.S.paint(ppm);
  overTop.length = 0;
}
