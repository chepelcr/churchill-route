// EL CENTRO CÍVICO — el Parque Mora y Cañas y la manzana de la Catedral.
//
// El mundo trae las dos cuadras trazadas (`manifest.centro`, autoradas en
// content/world/centro.json y emitidas por tools/shot-centro-preview.mjs): el
// césped, el piso gris que se recorre, las bocas por donde se entra desde la
// calle, y las ESTRUCTURAS — el tanque, el Palacio, la Catedral, la Casa de la
// Cultura, los bustos, las bancas de cemento.
//
// El mundo dice DÓNDE y de qué forma; `materials.json → centro` dice de qué
// está hecho. Acá no hay un solo color ni una sola medida de un edificio: los
// verbos son geometría.
//
// UNA ESTRUCTURA ES UNA PILA DE CUERPOS. Cada cuerpo es una huella levantada de
// `z0` a `z1` metros, y se dibuja con el MISMO pinhole que los edificios del
// mundo (`depth.js`): la tapa se corre hacia afuera según lo lejos que esté del
// centro de la pantalla, y entre la huella y la tapa quedan las paredes. La
// diferencia con `paintBuilding` es que acá hay VARIOS niveles y un techo con
// cumbrera, así que la torre de la Catedral se ve más alta que su nave y el
// tanque se asoma sobre su base. Todos los cuerpos de una estructura comparten
// UN vector —el de la estructura entera— o cada uno se inclinaría por su lado.
//
// Tres pasadas, cada una donde le toca:
//   drawCentro            el suelo, ANTES de las calles: la acera y el asfalto
//                         siguen tapando lo que llegue al cordón;
//   drawCentroStreetside  las bocas, DESPUÉS de las calles: son el pedazo de
//                         acera que se baja para que entre un carro;
//   drawCentroStructures  lo que se levanta, con los demás hitos.
import { WORLD2D as W } from "../../world2d/index.js";
import { aabbInView, ctx, flatPath, hash01, label, mixColor } from "./gfx.js";
import { sunShadow } from "./shadows.js";
import { facingEdges, parallaxOffset } from "./depth.js";
import { paintMaleconPattern } from "./systemShapes.js";
import { state } from "../../game/state.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };

const M = MATERIALS.centro;
const INK = M.inks;
const RAD = Math.PI / 180;
const ink = (key) => INK[key] || M.missing;

function pathOf(o) { return o._path || (o._path = flatPath(o.pts, true)); }

// los pisos de un lugar, agrupados por material: UN camino por material
function floorsOf(place) {
  if (place._floors) return place._floors;
  const by = new Map();
  for (const s of place.paved) {
    if (!by.has(s.floor)) by.set(s.floor, new Path2D());
    by.get(s.floor).addPath(pathOf(s));
  }
  return (place._floors = [...by].map(([floor, path]) => ({
    floor, path, band: { ang: place.ang + (M.floors[floor].angDeg || 0) * RAD, x0: place.x0, y0: place.y0, x1: place.x1, y1: place.y1 },
  })));
}

function drawCentro(view) {
  const C = W.CENTRO;
  if (!C || !aabbInView(C, view, 40)) return;
  const ppm = W.PX_PER_M;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const place of C.places) {
    if (!aabbInView(place, view, 40)) continue;
    // el césped: la cuadra entera, que se mete debajo de sus calles
    if (!place._own) place._own = flatPath(place.own, true);
    ctx.fillStyle = M.lawn[place.lawn] || M.lawn.lawn;
    ctx.fill(place._own);
    // los senderos de jardín: tierra apisonada, no se manejan
    ctx.strokeStyle = M.footpath;
    for (const f of place.footpaths || []) {
      if (!f._path) f._path = flatPath(f.pts, false);
      ctx.lineWidth = f.w; ctx.stroke(f._path);
    }
    // el riachuelo del jardín: orilla, agua y un brillo — y encima el puente por donde cruza el sendero
    for (const rv of place.rivers || []) {
      if (!rv._path) rv._path = flatPath(rv.pts, false);
      const R = M.river;
      ctx.strokeStyle = R.bank; ctx.lineWidth = rv.w + R.bankM * ppm * 2; ctx.stroke(rv._path);
      ctx.strokeStyle = R.water; ctx.lineWidth = rv.w; ctx.stroke(rv._path);
      ctx.strokeStyle = R.shine; ctx.lineWidth = rv.w * 0.22; ctx.setLineDash(R.shineDash); ctx.stroke(rv._path); ctx.setLineDash([]);
    }
    for (const bg of place.bridges || []) paintBridge(bg);
    // el piso gris. Primero TODOS los cordones y después todos los rellenos:
    // donde dos figuras se montan, el relleno de una tapa el cordón de la otra
    // y la unión queda con un solo borde.
    const floors = floorsOf(place);
    ctx.strokeStyle = M.kerb; ctx.lineWidth = M.kerbWidthM * ppm * 2;
    for (const f of floors) ctx.stroke(f.path);
    for (const f of floors) { ctx.fillStyle = M.floors[f.floor].fill; ctx.fill(f.path); }
    for (const f of floors) {
      const F = M.floors[f.floor];
      paintMaleconPattern(ctx, f.band, view, F, f.path, F.tileM * ppm, "nonzero");
    }
    // las gradas: franjas claras y oscuras a lo largo de su fondo
    for (const s of place.steps || []) {
      const p = s.pts;
      for (let k = 0; k < s.n; k++) {
        const a = k / s.n, b = (k + 1) / s.n;
        ctx.fillStyle = k % 2 ? M.steps.dark : M.steps.lite;
        ctx.beginPath();
        ctx.moveTo(p[0] + (p[6] - p[0]) * a, p[1] + (p[7] - p[1]) * a);
        ctx.lineTo(p[2] + (p[4] - p[2]) * a, p[3] + (p[5] - p[3]) * a);
        ctx.lineTo(p[2] + (p[4] - p[2]) * b, p[3] + (p[5] - p[3]) * b);
        ctx.lineTo(p[0] + (p[6] - p[0]) * b, p[1] + (p[7] - p[1]) * b);
        ctx.closePath(); ctx.fill();
      }
    }
    // los arbustos entre asta y asta
    for (const s of place.shrubs || []) {
      ctx.fillStyle = INK.shrubDark; ctx.beginPath(); ctx.arc(s.x + 0.8, s.y + 1, s.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = INK.shrub; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = INK.shrubFlower; ctx.beginPath(); ctx.arc(s.x - s.r * 0.3, s.y - s.r * 0.25, s.r * 0.22, 0, Math.PI * 2); ctx.arc(s.x + s.r * 0.35, s.y + s.r * 0.1, s.r * 0.18, 0, Math.PI * 2); ctx.fill();
    }
  }
}

// el puente del jardín: tablones a lo ancho entre dos barandas. `pts` es su caja: el lado 0→1 es el largo.
function paintBridge(bg) {
  const p = bg.pts, B = M.bridge, n = B.planks;
  const at = (a, b) => [p[0] + (p[2] - p[0]) * a + (p[6] - p[0]) * b, p[1] + (p[3] - p[1]) * a + (p[7] - p[1]) * b];
  ctx.fillStyle = B.shadow; ctx.beginPath(); ctx.moveTo(p[0] + 1.5, p[1] + 2); for (let i = 2; i < 8; i += 2) ctx.lineTo(p[i] + 1.5, p[i + 1] + 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = B.deck; ctx.fill(pathOf(bg));
  ctx.strokeStyle = B.joint; ctx.lineWidth = 0.6; ctx.lineCap = "butt"; ctx.beginPath();
  for (let k = 1; k < n; k++) { const a = at(k / n, 0), b = at(k / n, 1); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  ctx.stroke();
  ctx.strokeStyle = B.rail; ctx.lineWidth = B.railWidth; ctx.lineCap = "round"; ctx.beginPath();
  for (const v of [0, 1]) { const a = at(0, v), b = at(1, v); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  ctx.stroke();
}

// LO QUE VA SOBRE LA ACERA de la calle: la franja pegada a un bulevar, y las bocas.
function drawCentroStreetside(view) {
  const C = W.CENTRO;
  if (!C || !aabbInView(C, view, 40)) return;
  for (const place of C.places) {
    if (!aabbInView(place, view, 40)) continue;
    // la franja pegada a una calle peatonal: la misma piedra de esa calle, sobre su acera y su caño
    for (const fu of place.fused || []) { ctx.fillStyle = MATERIALS.streets.roadway.boulevard; ctx.fill(pathOf(fu)); }
    // LAS BOCAS SON TRANSPARENTES: la acera se queda como es y el carro pasa por encima. `mouth.paint`
    // las vuelve a pintar con el piso del lugar, entre dos cordones, si hace falta verlas.
    if (!M.mouth.paint) continue;
    const first = floorsOf(place)[0];
    if (!first) continue;
    const floor = M.floors[first.floor];
    if (!place._mouths) { place._mouths = new Path2D(); for (const mo of place.mouths || []) place._mouths.addPath(pathOf(mo)); }
    ctx.fillStyle = floor.fill; ctx.fill(place._mouths);
    paintMaleconPattern(ctx, first.band, view, floor, place._mouths, floor.tileM * W.PX_PER_M, "nonzero");
    for (const mo of place.mouths || []) {
      const p = mo.pts;
      ctx.strokeStyle = M.mouth.edge; ctx.lineWidth = M.mouth.edgeWidth; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[6], p[7]); ctx.moveTo(p[2], p[3]); ctx.lineTo(p[4], p[5]); ctx.stroke();
    }
  }
}

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
    ctx.fillStyle = gableEnd ? shade(ink(T.wall), sunlit.has(i)) : mixColor(ink(R.ink2), ink(R.ink), sunlit.has(i) ? 1 : 0.15);
    ctx.beginPath();
    ctx.moveTo(px + eave[0], py + eave[1]); ctx.lineTo(qx + eave[0], qy + eave[1]);
    ctx.lineTo(rx[eb], ry[eb]);
    if (!tri) ctx.lineTo(rx[ea], ry[ea]);
    ctx.closePath(); ctx.fill();
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
    const c = at(T.z1 + R.rise + M.cross.riseM), x = (apex ? ax : bx) + c[0], y = (apex ? ay : by) + c[1], s = M.cross.sizePx;
    ctx.lineCap = "butt";
    for (const [color, w, dx, dy] of [[M.cross.shade, 2.6, 0.8, 1], [ink(R.cross), 1.6, 0, 0]]) {
      ctx.strokeStyle = color; ctx.lineWidth = w; ctx.beginPath();
      ctx.moveTo(x + dx, y - s + dy); ctx.lineTo(x + dx, y + s + dy); ctx.moveTo(x - s * 0.7 + dx, y - s * 0.25 + dy); ctx.lineTo(x + s * 0.7 + dx, y - s * 0.25 + dy); ctx.stroke();
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

function paintStructure(S, ppm) {
  const ro = parallaxOffset(state.cam, S.x, S.y, S.zMax, ppm);
  const at = (z) => { const k = z / S.zMax; return [ro.dx * k, ro.dy * k]; };
  const sun = sunShadow(S.zMax);
  for (const T of S.tiers) {
    const vis = ro.dx || ro.dy ? facingEdges(T.pts, ro.dx, ro.dy) : [];
    const sunlit = new Set(facingEdges(T.pts, sun.dx, sun.dy));
    paintTier(T, at, vis, sunlit, sun, ppm);
  }
  if (S.label) { const top = at(S.zMax); label(S.x + top[0], S.y0 + top[1] - 9, S.label, M.label.fg, M.label.bg, 9); }
}

// un asta: su cubo blanco, el palo y el remate. Sin bandera, como están.
function paintPole(p, ppm) {
  const ro = parallaxOffset(state.cam, p.x, p.y, p.h, ppm), sh = sunShadow(p.h), b = p.base / 2;
  ctx.lineCap = "round";
  if (sh.dx || sh.dy) {
    ctx.save(); ctx.globalAlpha = sh.alpha; ctx.strokeStyle = M.shadow; ctx.lineWidth = M.pole.widthPx;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + sh.dx, p.y + sh.dy); ctx.stroke(); ctx.restore();
  }
  ctx.fillStyle = INK.cementDark; ctx.fillRect(p.x - b + 0.6, p.y - b + 0.8, p.base, p.base);
  ctx.fillStyle = INK.white; ctx.fillRect(p.x - b, p.y - b, p.base, p.base);
  ctx.strokeStyle = M.pole.ink; ctx.lineWidth = M.pole.widthPx;
  ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + ro.dx, p.y + ro.dy); ctx.stroke();
  ctx.fillStyle = M.pole.finial; ctx.beginPath(); ctx.arc(p.x + ro.dx, p.y + ro.dy, M.pole.widthPx * 0.75, 0, 6.283); ctx.fill();
}

function drawCentroStructures(view) {
  const C = W.CENTRO;
  if (!C || !aabbInView(C, view, 60)) return;
  const ppm = W.PX_PER_M, cam = state.cam, list = [];
  for (const place of C.places) {
    if (!aabbInView(place, view, 60)) continue;
    for (const S of place.structures) if (aabbInView(S, view, 60)) list.push(S);
    for (const p of place.poles || []) if (p.x > view.x0 - 40 && p.x < view.x1 + 40 && p.y > view.y0 - 40 && p.y < view.y1 + 40) list.push(p);
  }
  if (!list.length) return;
  // de lejos a cerca, como los edificios: lo excéntrico se inclina más y va debajo
  // …pero lo que apenas se levanta del piso (una plataforma, una banca) va primero: lo que está
  // parado ENCIMA —los bustos sobre su plataforma— no puede quedar debajo por estar más lejos
  const low = (o) => (o.tiers && o.zMax <= M.lowM ? 0 : 1);
  list.sort((a, b) => low(a) - low(b) || Math.hypot(b.x - cam.x, b.y - cam.y) - Math.hypot(a.x - cam.x, a.y - cam.y));
  ctx.lineJoin = "round";
  for (const S of list) if (S.tiers) paintShadow(S);
  for (const S of list) { if (S.tiers) paintStructure(S, ppm); else paintPole(S, ppm); }
  for (const place of C.places) for (const l of place.labels || []) {
    if (l.x > view.x0 && l.x < view.x1 && l.y > view.y0 && l.y < view.y1) label(l.x, l.y, l.text, M.label.fg, M.label.place, 10);
  }
}

// un hito que este registro ya dibuja (la Catedral, la Casa de la Cultura): sólo su rótulo
function centroOwnsLandmark(id) {
  const C = W.CENTRO;
  return !!(C && C.landmarks && C.landmarks.includes(id));
}

export { centroOwnsLandmark, drawCentro, drawCentroStreetside, drawCentroStructures };
