// LA PUNTA — El Faro y el Balneario, como el lugar que son.
//
// Hasta ahora la cuadra entera del Balneario era una ensenada de mar. El mundo
// trae ahora las figuras de verdad (`manifest.punta`, autoradas en
// content/world/punta.json): el terreno, el deck, la piscina en forma de coma
// con sus tres zonas y la piscina redonda.
//
// EL MALECÓN NO SE PINTA ACÁ, Y ES A PROPÓSITO: es la plazoleta del Faro de
// siempre, piedra gris y mosaico, y la sigue pintando `malecon.js` desde
// `manifest.malecon`. Lo único que este archivo le pone encima son sus
// figuras — abanicos al norte del Faro, olas al sur — en un rojo apagado, el
// de las comas de antes pasado por gris. Un solo piso, con el dibujo nuevo.
//
// El mundo dice DÓNDE; `materials.json → punta` dice de qué está hecho. Los
// verbos de acá son tres y son geometría: `sector` (el abanico), `outline`
// (la ola, desde su contorno unitario) y la escollera sembrada por hash.
// Edificios, toldos, palmas y árboles NO se pintan acá: van en los tiles como
// todos los demás, y los dibuja quien ya los dibuja.
//
// Se pinta después del malecón y ANTES de las calles, así que la banda de
// acera y el asfalto siguen tapando lo que llegue al cordón.
import { WORLD2D as W } from "../../world2d/index.js";
import { aabbInView, blendPalette, ctx, flatAABB, flatPath, hash01, textureScale, upright, weatherColors } from "./gfx.js";
import { overlayTexture } from "./materials.js";
import { sunShadow } from "./shadows.js";
import { drawWaterAll } from "./ground.js";
import { CANO_PX } from "./streets.js";
import { paintMaleconPattern } from "./systemShapes.js";
import { BALDOSA_PX } from "./malecon.js";
import { bodyAt, queueBody, queueBodyLike } from "./bodies.js";
import { liftPoint, parallaxOffset } from "./depth.js";
import { fillRigShadow, makeRig } from "./rig3d.js";
import { drawGate3d } from "./gate3d.js";
import { drawBlock3d, drawLounger3d, drawRaisedStroke3d, drawTent3d } from "./furniture3d.js";
import { state } from "../../game/state.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import PROPS from "../../assets/world-props.json" with { type: "json" };

const M = MATERIALS.punta;
const ROCKS = MATERIALS.coast.rocks;
// LA PISCINA SE PINTA COMO LAS DEL PARQUE MARINO: la misma paleta de la escena
// `pool` (deck, brocal, agua, hondo, bajo, brillo), sobre la forma de verdad.
// Se LEE de esa escena; acá no hay copia.
const POOL = PROPS.scenes.pool.palette;
const INK = M.figures.ink;
const RAD = Math.PI / 180;
const BENCH3D = PROPS.signs.banca.view3d;

function shape(s) {
  if (!s._path) { s._path = flatPath(s.pts, true); s._aabb = flatAABB(s.pts); }
  return s._path;
}

function fanPath(f, half) {
  if (f._path) return f._path;
  const p = new Path2D();
  p.moveTo(f.x, f.y);
  p.arc(f.x, f.y, f.r, f.ang - half, f.ang + half);
  p.closePath();
  return (f._path = p);
}

// la ola: su contorno unitario llevado al eje de cada una
function wavePath(w, outline) {
  if (w._path) return w._path;
  const dx = Math.cos(w.ang), dy = Math.sin(w.ang), L = w.len;
  const pts = outline.map(([u, v]) => [
    w.x + dx * (u - 0.5) * L + dy * v * L,
    w.y + dy * (u - 0.5) * L - dx * v * L,
  ]);
  // esquinas redondeadas sin mover las colas: cuadráticas por los puntos medios
  const p = new Path2D(), n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const tails = new Set([0, outline.findIndex(([u]) => u === 1)]);
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i <= n; i++) {
    const c = pts[i % n], nx = pts[(i + 1) % n];
    if (tails.has(i % n)) { p.lineTo(c[0], c[1]); continue; }
    const m = tails.has((i + 1) % n) ? nx : mid(c, nx);
    p.quadraticCurveTo(c[0], c[1], m[0], m[1]);
  }
  p.closePath();
  return (w._path = p);
}

// LA ESCOLLERA EN 3D. Es UNA línea larga y hace dos trabajos distintos según lo que tenga del lado de
// tierra, y eso se pregunta a las bandas del malecón (`W.MALECON`):
//   * junto a la EXPLANADA del faro (banda `style: "esplanade"`) la sostiene: un TALUD que baja del
//     canto de la explanada hacia la arena (`slopeM`);
//   * junto al MALECÓN amarillo es una PARED de piedra que sube del malecón (`wallM`), más alta al
//     centro, entre el paseo y la playa.
// El lecho se pinta en tiras a lo ancho (`acrossN`), cada una levantada —o hundida— a su altura con el
// pinhole de los edificios; encima van las piedras, cada una un cuerpo corto de su costado a su copa,
// de lo bajo a lo alto. La clasificación de cada vértice se hace la primera vez que entra en cuadro.
const RR = M.riprap;
let _bands = null;
function maleconBands() {
  if (_bands) return _bands;
  return (_bands = (W.MALECON || []).map((b) => ({ esp: b.style === "esplanade", polys: b.polys, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1 })));
}
function insidePoly(pts, x, y) {
  let c = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const yi = pts[i + 1], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < pts[i] + (pts[j] - pts[i]) * (y - yi) / (yj - yi)) c = !c;
  }
  return c;
}
// qué banda hay en (x, y): "esp" (explanada), "band" (malecón) o null
function bandAt(x, y) {
  for (const b of maleconBands()) {
    if (x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) continue;
    for (const pl of b.polys) if (insidePoly(pl, x, y)) return b.esp ? "esp" : "band";
  }
  return null;
}
const lifted = (x, y, z) => liftPoint(state.cam, x, y, z);
// la altura de la escollera a través: u = -1 en el canto de tierra, +1 en el del mar
function riprapZ(mode, u) {
  return mode === "slope" ? -RR.slopeM * (u + 1) / 2 : RR.wallM * (1 - u * u);
}
function riprapGeom(line) {
  if (line._v) return line._v;
  const p = line.pts, n = p.length / 2, nx = new Float32Array(n), ny = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    const dx = p[b * 2] - p[a * 2], dy = p[b * 2 + 1] - p[a * 2 + 1], L = Math.hypot(dx, dy) || 1;
    nx[k] = -dy / L; ny[k] = dx / L;
  }
  // por vértice: de qué lado está la tierra (±1 sobre la normal) y qué hace la piedra ahí; 0 = sin clasificar
  return (line._v = { nx, ny, side: new Int8Array(n), mode: new Array(n) });
}
function classify(line, k) {
  const V = riprapGeom(line);
  if (V.side[k]) return;
  const x = line.pts[k * 2], y = line.pts[k * 2 + 1], d = line.w * 0.9;
  const a = bandAt(x + V.nx[k] * d, y + V.ny[k] * d), b = bandAt(x - V.nx[k] * d, y - V.ny[k] * d);
  const side = a ? 1 : b ? -1 : 1, land = a || b;
  V.side[k] = side; V.mode[k] = land === "esp" ? "slope" : "wall";
}
function paintRiprap(line, view) {
  if (!line._rocks) {
    const rocks = [], segStart = [], step = RR.stepM * W.PX_PER_M, [r0, r1] = RR.rockM;
    for (let i = 0; i + 3 < line.pts.length; i += 2) {
      segStart.push(rocks.length);
      const ax = line.pts[i], ay = line.pts[i + 1], bx = line.pts[i + 2], by = line.pts[i + 3];
      const len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len, ny = (bx - ax) / len;
      for (let s = 0; s < len; s += step) {
        for (let k = 0; k < 3; k++) {
          const h = hash01(ax * 7.13 + ay * 3.71 + s * 1.37 + k * 91.7), h2 = hash01(h * 977 + k);
          const off = (h - 0.5) * line.w;
          // [x, y, radio px, tinta, vértice, a través (+1 hacia la normal), radio m]
          const rM = (r0 + (r1 - r0) * h2) / 2;
          rocks.push([ax + (bx - ax) * s / len + nx * off, ay + (by - ay) * s / len + ny * off,
            rM * W.PX_PER_M, ROCKS[(h2 * ROCKS.length) | 0], i / 2, (h - 0.5) * 2, rM]);
        }
      }
    }
    segStart.push(rocks.length);
    line._rocks = rocks; line._segStart = segStart; line._path = flatPath(line.pts, false); line._aabb = flatAABB(line.pts);
  }
  const V = riprapGeom(line), p = line.pts, n = p.length / 2, hw = line.w / 2;
  const x0 = view.x0 - 30, x1 = view.x1 + 30, y0 = view.y0 - 30, y1 = view.y1 + 30;
  const seen = (k) => { const x = p[k * 2], y = p[k * 2 + 1]; return x > x0 && x < x1 && y > y0 && y < y1; };
  // su sombra al sol, sobre la arena: la línea entera corrida por el sol a la altura de la pared
  const sh = sunShadow(RR.wallM);
  if (sh.alpha > 0) {
    ctx.save(); ctx.globalAlpha = sh.alpha * RR.shadowAlpha; ctx.translate(sh.dx, sh.dy);
    ctx.strokeStyle = RR.shadow; ctx.lineWidth = line.w; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.stroke(line._path);
    ctx.restore();
  }
  // el lecho, a ras: lo que el talud deja ver debajo
  ctx.strokeStyle = RR.bed; ctx.lineWidth = line.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.stroke(line._path);
  // el lecho con su altura, en tiras a lo ancho (de lo bajo a lo alto)
  const N = RR.acrossN, us = Array.from({ length: N + 1 }, (_, j) => -1 + 2 * j / N);
  const at = (k, u) => {
    const m = V.mode[k], s = V.side[k], x = p[k * 2] - V.nx[k] * s * u * hw, y = p[k * 2 + 1] - V.ny[k] * s * u * hw;
    return lifted(x, y, riprapZ(m, u));
  };
  const strips = [];
  for (let k = 0; k + 1 < n; k++) {
    if (!seen(k) && !seen(k + 1)) continue;
    classify(line, k); classify(line, k + 1);
    for (let j = 0; j < N; j++) {
      const zm = (riprapZ(V.mode[k], us[j]) + riprapZ(V.mode[k], us[j + 1])) / 2;
      strips.push([zm, k, j]);
    }
  }
  // UN RELLENO POR ALTURA Y TINTA, no uno por tira: la altura de una tira sólo depende de su modo y de
  // su lugar a lo ancho, así que hay a lo sumo 2·N alturas distintas y el orden de lo bajo a lo alto
  // se conserva entero. Antes era un `fill` por tira, cientos por cuadro.
  strips.sort((A, B) => A[0] - B[0]);
  let g = 0;
  while (g < strips.length) {
    const zm = strips[g][0], fills = new Map();
    for (; g < strips.length && strips[g][0] === zm; g++) {
      const [, k, j] = strips[g];
      const u0 = us[j], u1 = us[j + 1], a = at(k, u0), b = at(k + 1, u0), c = at(k + 1, u1), d = at(k, u1);
      // la cara que mira al mar (u creciente, bajando) en la tinta del costado; la de tierra, en la del lecho
      const ink = riprapZ(V.mode[k], u1) < riprapZ(V.mode[k], u0) ? RR.bedSide : RR.bed;
      let P2 = fills.get(ink); if (!P2) fills.set(ink, (P2 = new Path2D()));
      P2.moveTo(a[0], a[1]); P2.lineTo(b[0], b[1]); P2.lineTo(c[0], c[1]); P2.lineTo(d[0], d[1]);   // sin cierre: sólo se rellena
    }
    for (const [ink, P2] of fills) { ctx.fillStyle = ink; ctx.fill(P2); }
  }
  // las piedras: cada una de su asiento a su copa, de lo bajo a lo alto
  // …y sólo las de los TRAMOS a la vista: recorrer las miles de la escollera entera por cuadro para
  // quedarse con seiscientas era la mitad de lo que costaba (`_segStart`: dónde empieza cada tramo)
  const vis = [], ss = line._segStart, m = line.w;
  for (let k = 0; k + 1 < n; k++) {
    const ax = p[k * 2], ay = p[k * 2 + 1], bx = p[k * 2 + 2], by = p[k * 2 + 3];
    if (Math.max(ax, bx) + m < x0 || Math.min(ax, bx) - m > x1 || Math.max(ay, by) + m < y0 || Math.min(ay, by) - m > y1) continue;
    for (let q = ss[k]; q < ss[k + 1]; q++) {
      const r = line._rocks[q], [x, y, , , kk, t] = r;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      classify(line, kk);
      const u = -V.side[kk] * t, zb = riprapZ(V.mode[kk], u);
      vis.push([zb + r[6] * RR.rockRiseK, zb, r]);
    }
  }
  vis.sort((A, B) => A[0] - B[0]);
  // LAS PIEDRAS VAN EN CAPAS DE ALTURA, NO UNA POR UNA. Cada piedra eran dos llamadas —el costado como
  // un trazo y la copa como un disco— y en el Paseo hay ~600 a la vista: 1 200 llamadas por cuadro, 1,9
  // ms en escritorio y el cuádruple en un teléfono. Ahora se juntan las de una misma capa de
  // `ROCK_BAND_M`: todos sus costados en UN relleno (la cápsula del trazo, como polígono + disco del pie)
  // y sus copas en uno por tinta. Entre capas el orden sigue siendo de lo bajo a lo alto; dentro de una
  // capa las copas van sobre los costados, que es lo que se ve de una escollera desde arriba.
  let i = 0;
  while (i < vis.length) {
    const band = Math.floor(vis[i][0] / ROCK_BAND_M);
    let j = i;
    while (j < vis.length && Math.floor(vis[j][0] / ROCK_BAND_M) === band) j++;
    const tops = new Map();
    ctx.beginPath();
    for (let k = i; k < j; k++) {
      const [zt, zb, r] = vis[k], [x, y, rp, ink] = r, b0 = lifted(x, y, zb), t0 = lifted(x, y, zt);
      rockSide(b0, t0, rp);
      let list = tops.get(ink); if (!list) tops.set(ink, (list = []));
      list.push(t0[0], t0[1], rp);
    }
    ctx.fillStyle = RR.rockSide; ctx.fill();
    for (const [ink, list] of tops) {
      ctx.beginPath();
      for (let k = 0; k < list.length; k += 3) { ctx.moveTo(list[k] + list[k + 2], list[k + 1]); ctx.arc(list[k], list[k + 1], list[k + 2], 0, Math.PI * 2); }
      ctx.fillStyle = ink; ctx.fill();
    }
    i = j;
  }
}
const ROCK_BAND_M = 0.12;   // el grueso de una capa: menos que la piedra más chica, para que no se note
// el costado de una piedra —el trazo redondo de su pie a su copa— como RELLENO: el disco del pie y el
// rectángulo hasta la copa (la copa misma tapa el otro extremo). Todo con el MISMO giro que `arc`, o en
// un relleno `nonzero` lo que se monta con giros contrarios abre un hueco.
function rockSide(b, t, r) {
  ctx.moveTo(b[0] + r, b[1]); ctx.arc(b[0], b[1], r, 0, Math.PI * 2);
  const dx = t[0] - b[0], dy = t[1] - b[1], L = Math.hypot(dx, dy);
  if (L < 0.01) return;
  const nx = -dy / L * r, ny = dx / L * r;
  // b-n → t-n → t+n → b+n gira como `arc` (horario en pantalla)
  ctx.moveTo(b[0] - nx, b[1] - ny); ctx.lineTo(t[0] - nx, t[1] - ny); ctx.lineTo(t[0] + nx, t[1] + ny); ctx.lineTo(b[0] + nx, b[1] + ny);
}

// EL TOLDO Y LA PÉRGOLA: techo, no edificio. El toldo es lona con sus limatesas del
// borde al centro; la pérgola, viguetas a lo ancho sobre el piso que deja ver.
function paintRoof(rf, ppm) {
  const R = M.roofs, path = shape(rf), a = rf._aabb, cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
  ctx.save(); ctx.translate(3, 4); ctx.fillStyle = R.shadow; ctx.fill(path); ctx.restore();
  if (rf.kind === "pergola") {
    ctx.save(); ctx.clip(path);
    ctx.fillStyle = R.pergola; ctx.fill(path);
    ctx.strokeStyle = R.pergolaBeam; ctx.lineWidth = 0.35 * ppm;
    const step = R.beamEveryM * ppm;
    ctx.beginPath();
    for (let k = a.x0 + a.y0 - a.y1; k < a.x1; k += step) { ctx.moveTo(k, a.y0); ctx.lineTo(k + (a.y1 - a.y0), a.y1); }
    ctx.stroke(); ctx.restore();
    return;
  }
  ctx.fillStyle = R.canopy; ctx.fill(path);
  ctx.strokeStyle = R.canopyRidge; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < rf.pts.length; i += 2) { ctx.moveTo(rf.pts[i], rf.pts[i + 1]); ctx.lineTo(cx, cy); }
  ctx.stroke();
  ctx.strokeStyle = R.canopyEdge; ctx.lineWidth = 1.6; ctx.stroke(path);
}

// LAS PIEZAS DEL BALNEARIO, desde arriba: sombrilla, camas de sol, flotador, tobogán, barco.
function paintFun(f, ppm, t) {
  const F = M.fun;
  if (f.kind === "slide") {
    if (!f._path) f._path = flatPath(f.pts, false);
    const w = F.slideM * ppm, tw = F.slideTowerM * ppm;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.save(); ctx.translate(3, 4); ctx.strokeStyle = F.shadow; ctx.lineWidth = w; ctx.stroke(f._path); ctx.restore();
    ctx.strokeStyle = f.color; ctx.lineWidth = w; ctx.stroke(f._path);
    ctx.strokeStyle = F.slideRail; ctx.lineWidth = w * 0.3; ctx.stroke(f._path);
    ctx.fillStyle = F.slideTower; ctx.fillRect(f.pts[0] - tw / 2, f.pts[1] - tw / 2, tw, tw);
    ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.strokeRect(f.pts[0] - tw / 2, f.pts[1] - tw / 2, tw, tw);
    return;
  }
  ctx.save(); ctx.translate(f.x, f.y);
  if (f.kind === "umbrella") {
    // la sombrilla en 3D: su sombra al sol, el palo y la copa arriba, a `fun._3d.umbrellaM`
    const r = F.umbrellaM * ppm / 2, H = F._3d.umbrellaM, sh = sunShadow(H), top = parallaxOffset(state.cam, f.x, f.y, H, ppm);
    ctx.fillStyle = F.shadow; ctx.beginPath(); ctx.arc(sh.dx, sh.dy, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = F._3d.pole; ctx.lineWidth = 0.12 * ppm; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(top.dx, top.dy); ctx.stroke();
    ctx.translate(top.dx, top.dy);
    ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = F.umbrellaRib; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k < F.umbrellaRibs; k++) { const a = k * Math.PI * 2 / F.umbrellaRibs; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.stroke();
    ctx.fillStyle = F.umbrellaTip; ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2); ctx.fill();
  } else if (f.kind === "loungers") {
    // dos tumbonas en 3D (`fun._3d`): bastidor bajo y respaldo levantado con el cojín de su color
    const [lM, wM] = F.loungerM, w = wM * ppm;
    ctx.restore();
    for (const side of [-1, 1]) drawLounger3d(f.x + side * w * 0.75, f.y, -Math.PI / 2, lM, wM, { frame: F.lounger, side: F._3d.loungerSide, pad: f.color }, { ...BENCH3D, seatM: F._3d.seatM, backM: F._3d.backM });
    return;
  } else if (f.kind === "float") {
    const r = F.floatM * ppm / 2, bob = F.floatBobM * ppm, ph = f.x * 0.013 + f.y * 0.007;
    ctx.translate(Math.sin(t * F.floatSpeed + ph) * bob, Math.cos(t * F.floatSpeed * 0.8 + ph) * bob);
    ctx.strokeStyle = f.color; ctx.lineWidth = r * (1 - F.floatHole) * 1.3;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2); ctx.stroke();
  } else if (f.kind === "ship") {
    const S = F.ship, L = S.lengthM * ppm, B = S.beamM * ppm;
    ctx.rotate(-0.5);
    ctx.fillStyle = F.shadow; ctx.beginPath(); ctx.ellipse(3, 4, L / 2, B / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = S.hull; ctx.beginPath(); ctx.moveTo(L / 2, 0); ctx.quadraticCurveTo(L * 0.2, -B * 0.62, -L / 2, -B * 0.38); ctx.lineTo(-L / 2, B * 0.38); ctx.quadraticCurveTo(L * 0.2, B * 0.62, L / 2, 0); ctx.fill();
    ctx.fillStyle = S.deck; ctx.beginPath(); ctx.ellipse(-L * 0.04, 0, L * 0.36, B * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    for (const mx of [-L * 0.18, L * 0.12]) {
      ctx.fillStyle = S.sail; ctx.fillRect(mx - 1.5, -B * 0.52, 3, B * 1.04);
      ctx.fillStyle = S.mast; ctx.beginPath(); ctx.arc(mx, 0, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = S.flag; ctx.fillRect(-L * 0.46, -2.5, 7, 5);
  }
  ctx.restore();
}

// EL PARQUE DEL MUELLERO. Las piedras son puntos a lo largo de una curva; el
// esqueleto de ballena, un espinazo con costillas hacia la calle.
function stonesAlong(pts, step, r, ink) {
  ctx.fillStyle = ink;
  let run = step / 2;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k], ay = pts[k + 1], bx = pts[k + 2], by = pts[k + 3], L = Math.hypot(bx - ax, by - ay);
    for (let d = run; d < L; d += step) { ctx.beginPath(); ctx.arc(ax + (bx - ax) * d / L, ay + (by - ay) * d / L, r, 0, Math.PI * 2); ctx.fill(); }
    run = (run - L) % step; if (run < 0) run += step;
  }
}
function arcPts(x, y, r, a0, a1, n = 24) { const out = []; for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; out.push(x + Math.cos(a) * r, y + Math.sin(a) * r); } return out; }
// UNA BANCA FUERA DE LA VISTA NO SE DIBUJA. Las medialunas y los abanicos se recorrían enteros cada
// cuadro —ochenta bancas, cada una con su sombra y su cuerpo en la cola de `flushBodies`— aunque en
// pantalla hubiera cuatro. El margen cubre lo que la sombra y el pinhole corren una banca.
const BLOCK_MARGIN_PX = 80;
const inViewPt = (v, x, y, m) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m;

// EL CONJUNTO SE PINTA POR PIEZAS, NO ENTERO. `W.PUNTA` mide 10 000 x 1 400 px —todo el frente, del
// Faro al Parque Marino— y `drawPunta` sólo preguntaba UNA vez si esa caja tocaba la vista: con ver
// una esquina se pintaba el conjunto completo, la Concha incluida a tres mil píxeles. Medido con la
// CPU frenada 4×, en la feria eran ~4 ms por cuadro de piezas fuera de pantalla. Cada pieza se pregunta
// por su propia caja (cacheada en `_box`), con `PIECE_MARGIN_PX` para lo que la sombra y la altura
// corren fuera de ella.
const PIECE_MARGIN_PX = 120;
function boxOf(o, pts) {
  if (o._box) return o._box;
  if (!pts || !pts.length) return (o._box = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity });   // sin puntos: siempre a la vista
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); y0 = Math.min(y0, pts[i + 1]); y1 = Math.max(y1, pts[i + 1]); }
  return (o._box = { x0, y0, x1, y1 });
}
const seenBox = (v, b, m = PIECE_MARGIN_PX) => b.x1 > v.x0 - m && b.x0 < v.x1 + m && b.y1 > v.y0 - m && b.y0 < v.y1 + m;
const seenPts = (v, o, pts, m) => seenBox(v, boxOf(o, pts), m);
const seenDisc = (v, x, y, r, m = PIECE_MARGIN_PX) => inViewPt(v, x, y, r + m);

function paintMuellero(Q, ppm, view = null) {
  const C = M.muellero, stoneR = C.stoneM * ppm / 2, stoneStep = C.stoneEveryM * ppm;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const near = (x, y, r) => !view || seenDisc(view, x, y, r);
  if (Q.plaza && near(Q.plaza.x, Q.plaza.y, Q.plaza.r)) { const p = Q.plaza; ctx.fillStyle = C.plaza; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, p.ang - Math.PI / 2, p.ang + Math.PI / 2); ctx.closePath(); ctx.fill(); }
  for (const c of Q.circles) {
    if (!near(c.x, c.y, c.r)) continue;
    if (c.kind === "boulder") { ctx.fillStyle = C.boulder; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill(); continue; }
    stonesAlong(arcPts(c.x, c.y, c.r, 0, Math.PI * 2, 40), stoneStep, stoneR, C.stone);
  }
  for (const a of Q.arcs) {
    if (!near(a.x, a.y, a.r)) continue;
    const a0 = a.ang + a.a0 * RAD, a1 = a.ang + a.a1 * RAD;
    if (a.planter) { ctx.fillStyle = C.planter; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, a0, a1); ctx.closePath(); ctx.fill(); }
    stonesAlong(arcPts(a.x, a.y, a.r, a0, a1), stoneStep, stoneR, C.stone);
  }
  // la banca corrida y la pérgola, con su altura (`muellero._3d`): la banca su cuerpo hasta la tapa, la
  // pérgola sus postes y la viga arriba
  const C3 = C._3d;
  for (const b of Q.benches) {
    if (view && !seenPts(view, b, b.pts)) continue;
    if (b.kind === "pergola") drawRaisedStroke3d(b.pts, b.w, C3.pergolaM, { top: C.pergola, side: C3.pergolaSide, shadow: C.shadow }, { everyM: C3.postEveryM, wM: C3.postWM });
    else drawRaisedStroke3d(b.pts, b.w, C3.benchM, { top: C.bench, side: C3.benchSide, shadow: C.shadow });
  }
  // los esqueletos de ballena: costillas primero (con su sombra), el espinazo encima
  for (const w of Q.whales) {
    if (view && !seenPts(view, w, w.pts)) continue;
    if (!w._ribs) {
      const ribs = [], [sx, sy] = w.toStreet; let run = 0;
      for (let k = 0; k + 3 < w.pts.length; k += 2) {
        const ax = w.pts[k], ay = w.pts[k + 1], bx = w.pts[k + 2], by = w.pts[k + 3], L = Math.hypot(bx - ax, by - ay) || 1;
        let nx = -(by - ay) / L, ny = (bx - ax) / L; if (nx * sx + ny * sy < 0) { nx = -nx; ny = -ny; }
        for (let d = run; d < L; d += Q.ribEveryPx) { const x = ax + (bx - ax) * d / L, y = ay + (by - ay) * d / L; ribs.push([x, y, x + nx * Q.ribPx, y + ny * Q.ribPx]); }
        run = (run - L) % Q.ribEveryPx; if (run < 0) run += Q.ribEveryPx;
      }
      w._ribs = ribs; w._path = flatPath(w.pts, false);
    }
    // LA BALLENA ES UNA BANCA: costillas y espinazo con su altura (`_3d.benchM`), la sombra al sol en el
    // piso y el cuerpo con los cuerpos —de lo bajo a lo alto, las costillas y después el espinazo—
    const H = C3.benchM, sh = sunShadow(H);
    if (sh.alpha > 0) {
      ctx.save(); ctx.globalAlpha = sh.alpha; ctx.translate(sh.dx, sh.dy);
      ctx.lineWidth = C.ribM * ppm; ctx.strokeStyle = C.ribShadow; ctx.beginPath(); for (const [x0, y0, x1, y1] of w._ribs) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); } ctx.stroke();
      ctx.lineWidth = C.spineM * ppm; ctx.strokeStyle = C.shadow; ctx.stroke(w._path);
      ctx.restore();
    }
    const ribs = w._ribs;
    queueBodyLike({ x: w.pts[0], y: w.pts[1], paint: () => {
      const up = (x, y, z) => { const o = parallaxOffset(state.cam, x, y, z, ppm); return [x + o.dx, y + o.dy]; };
      const pass = (z, ink, wM, withSpine) => {
        ctx.lineCap = "round"; ctx.strokeStyle = ink; ctx.lineWidth = C.ribM * ppm; ctx.beginPath();
        for (const [x0, y0, x1, y1] of ribs) { const a = up(x0, y0, z), b = up(x1, y1, z); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
        ctx.stroke();
        if (!withSpine) return;
        ctx.lineWidth = wM; ctx.beginPath();
        for (let k = 0; k + 1 < w.pts.length; k += 2) { const q = up(w.pts[k], w.pts[k + 1], z); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
        ctx.stroke();
      };
      for (const f of [0, 0.5]) pass(H * f, C3.ribSide, C.spineM * ppm, true);
      pass(H, C.rib, 0, false);
      ctx.strokeStyle = C.spine; ctx.lineWidth = C.spineM * ppm; ctx.beginPath();
      for (let k = 0; k + 1 < w.pts.length; k += 2) { const q = up(w.pts[k], w.pts[k + 1], H); k ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
      ctx.stroke();
    } });
  }
  // las bancas de las medialunas: bloques blancos en su arco, girados con él
  for (const q of Q.pancitas) for (const [x, y, a] of q.benches || []) {
    if (view && !inViewPt(view, x, y, BLOCK_MARGIN_PX)) continue;   // fuera de la vista no se encola nada
    drawBlock3d(x, y, a, C.benchM[0], C.benchM[1], C3.benchM, { top: C.bench, side: C3.benchSide }, BENCH3D);
  }
}

// LOS MONUMENTOS, desde arriba y girados con la calle: local +y es hacia el mar.
// ── LO QUE SE LEVANTA DE LOS MONUMENTOS ──
// `lift(h)`: cuánto se corre algo a `h` metros, con el mismo pinhole que los edificios, ya en el marco
// girado del monumento. Las letras y las hojas de la Concha se pintan con los cuerpos (`bodies.js`),
// después de la gente: están en el aire, y lo que camina debajo queda debajo.
function liftOf(mo, ppm) {
  const ca = Math.cos(-(mo.ang || 0)), sa = Math.sin(-(mo.ang || 0));
  return (h) => {
    if (!h) return [0, 0];
    const o = parallaxOffset(state.cam, mo.x, mo.y, h, ppm);
    return [o.dx * ca - o.dy * sa, o.dx * sa + o.dy * ca];
  };
}

// la fila de letras en arco. `part`: "base" pinta sólo la losa de concreto, "glyphs" sólo las letras,
// y sin él las dos (la sombra la pide entera, de un color). Las letras se SIENTAN en la losa: su pie
// cae `seatK` de su alto dentro de la banda gris, no flotan centradas sobre ella.
function letterGeom(mo, C, ppm) {
  const text = mo.text || "", n = text.length, step = C.stepM * ppm, H = C.heightM * ppm, half = (n - 1) * step / 2, sag = step * 1.1;
  const yAt = (u) => (1 - (2 * u - 1) ** 2) * sag * 0.52 - sag * 0.12;
  return { text, n, step, H, half, sag, yAt };
}
function paintLetterRow(mo, C, ppm, base, ink, part) {
  const { text, n, step, H, half, sag, yAt } = letterGeom(mo, C, ppm), bw = H * (C.baseK || 0.5);
  if (part !== "glyphs") {
    ctx.strokeStyle = base; ctx.lineWidth = bw; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-half - step * 0.6, -sag * 0.2); ctx.quadraticCurveTo(0, sag, half + step * 0.6, -sag * 0.2); ctx.stroke();
  }
  if (part === "base") return;
  ctx.font = `${H.toFixed(1)}px '${C.font}', sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const foot = bw * (C.seatK ?? 0);
  for (let i = 0; i < n; i++) {
    const u = n > 1 ? i / (n - 1) : 0.5;
    ctx.fillStyle = typeof ink === "string" ? ink : ink[i % ink.length];
    ctx.fillText(text[i], -half + i * step, yAt(u) + foot);
  }
}

// LAS LETRAS DE PUNTARENAS, de cuerpo entero y POSADAS: primero la losa gris (baja, `baseLiftM`),
// después cada letra sube de la losa a `liftM` —el canto oscuro repetido y la cara de color arriba—,
// con el pie metido en la banda, así la losa las sostiene en vez de asomarse por debajo.
function paintLettersRaised(mo, C, ppm) {
  const lift = liftOf(mo, ppm), b0 = C.baseLiftM || 0, steps = Math.max(2, Math.round((C.liftM - b0) * C.extrudePerM));
  ctx.save(); ctx.translate(mo.x, mo.y); ctx.rotate(mo.ang);
  const bs = Math.max(1, Math.round(b0 * C.extrudePerM));
  for (let k = 0; k < bs; k++) { const o = lift(b0 * k / bs); ctx.save(); ctx.translate(o[0], o[1]); paintLetterRow(mo, C, ppm, C.baseEdge, null, "base"); ctx.restore(); }
  { const o = lift(b0); ctx.save(); ctx.translate(o[0], o[1]); paintLetterRow(mo, C, ppm, C.base, null, "base"); ctx.restore(); }
  for (let k = 0; k < steps; k++) {
    const o = lift(b0 + (C.liftM - b0) * k / steps);
    ctx.save(); ctx.translate(o[0], o[1]); paintLetterRow(mo, C, ppm, null, C.side, "glyphs"); ctx.restore();
  }
  const top = lift(C.liftM);
  ctx.translate(top[0], top[1]);
  paintLetterRow(mo, C, ppm, null, C.inks, "glyphs");
  ctx.restore();
}

// LAS GRADAS Y EL ESCENARIO DE LA CONCHA, en 3D sobre el aparejo (`rig3d.js`, metros, marco del
// monumento: +v hacia el mar). Cada grada es un anillo un escalón más alto que el de adentro: su
// CONTRAHUELLA (la pared que mira al escenario), su huella arriba y sus dos cantos en las puntas; atrás
// de la última, el muro. El escenario es una media luna con su costado curvo, su frente recto y los
// escalones blancos en la tapa.
function shellForm(Rg, Rm, C) {
  const t0 = Rm * 0.62, step = Rm * 0.34 / C.tiers, a0 = Math.PI * 1.02, a1 = Math.PI * 1.98, N = 28;
  const arc = (r, z, from, to, cx = 0, cy = 0) => Array.from({ length: N + 1 }, (_, i) => {
    const a = from + (to - from) * i / N; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
  });
  for (let k = 1; k <= C.tiers; k++) {
    const r0 = t0 + step * (k - 1), r1 = t0 + step * k, zl = C.tierRiseM * (k - 1), zh = C.tierRiseM * k;
    Rg.at(zh - 0.002, () => {
      Rg.poly([...arc(r0, zl, a0, a1), ...arc(r0, zh, a1, a0)], C.riser);
      for (const a of [a0, a1]) {
        const c = Math.cos(a), s = Math.sin(a);
        Rg.poly([[c * r0, s * r0, 0], [c * r1, s * r1, 0], [c * r1, s * r1, zh], [c * r0, s * r0, zh]], C.riser);
      }
    });
    Rg.at(zh, () => {
      Rg.poly([...arc(r1, zh, a0, a1), ...arc(r0, zh, a1, a0)], C.tier);
      if (!Rg.shadow) Rg.line(arc(r0, zh, a0, a1), 0.1, C.tierEdge);
    });
  }
  const rN = t0 + step * C.tiers, zN = C.tierRiseM * C.tiers;
  Rg.at(zN - 0.003, () => Rg.poly([...arc(rN, 0, a0, a1), ...arc(rN, zN, a1, a0)], C.riser));
  // el escenario CALZA con el aro amarillo de la plaza: mismo centro y mismo radio (0,9 del pie de las
  // gradas, que es como se traza el aro en el suelo), así los dos forman un solo círculo
  const cy = 0, sr = Rm * 0.62 * 0.9, zs = C.stageM;
  Rg.at(zs - 0.002, () => {
    Rg.poly([...arc(sr, 0, 0, Math.PI, 0, cy), ...arc(sr, zs, Math.PI, 0, 0, cy)], C.stageSide);
    Rg.poly([[-sr, cy, 0], [sr, cy, 0], [sr, cy, zs], [-sr, cy, zs]], C.stageSide);
  });
  Rg.at(zs, () => {
    Rg.poly(arc(sr, zs, 0, Math.PI, 0, cy), C.stage);
    if (Rg.shadow) return;
    for (const f of [0.82, 0.66]) Rg.line(arc(sr * f, zs + 0.01, 0.08, Math.PI - 0.08, 0, cy), 0.28, C.stageStep);
    Rg.line([[-sr, cy, zs + 0.01], [sr, cy, zs + 0.01]], 0.28, C.stageStep);
  });
  shellLeaves(Rg, Rm, C, cy);
}

// LAS HOJAS DE LA CONCHA, según la foto: abanicos turquesa translúcidos que nacen ANGOSTOS sobre un
// pilar corto en el borde de atrás —del lado del mar, a `leafFromK` del radio— y se abren hacia
// adentro y hacia arriba, sobre el escenario, como la concha acústica que son. Cada una apunta al
// centro (las bases no miran todas al mismo lado), se traslapa con las vecinas, y no son iguales:
// las del centro, más grandes (`leafSizeK`). La superficie sube hasta `leafTopM` y se ahueca de lado
// a lado (`leafCupM`); sus nervios salen del pie como los de una concha. En 3D sobre el aparejo.
function shellLeaves(Rg, Rm, C, cy) {
  const n = C.leaves, arc = C.leafArcDeg * RAD, [kSide, kMid] = C.leafSizeK;
  const rb = Rm * C.leafFromK, zb = C.leafBaseM, H = C.leafTopM - zb, cup = C.leafCupM, tipK = 0.75;
  const order = Array.from({ length: n }, (_, k) => k).sort((p, q) => Math.abs(p - (n - 1) / 2) < Math.abs(q - (n - 1) / 2) ? 1 : -1);
  order.forEach((k, idx) => {
    const a = Math.PI / 2 - arc / 2 + arc * k / (n - 1), off = Math.cos(a - Math.PI / 2), size = kSide + (kMid - kSide) * off * off;
    const dx = Math.cos(a), dy = Math.sin(a), tx = -dy, ty = dx;
    const L = Rm * C.leafLen * size, W = Rm * C.leafW * size, bx = dx * rb, by = cy + dy * rb;
    const w = (q) => W * (q <= tipK ? Math.pow(Math.sin(Math.PI / 2 * q / tipK), 0.7) : Math.sqrt(Math.max(0, 1 - ((q - tipK) / (1 - tipK)) ** 2)));
    const pt = (q, t) => {
      const r = -q * L, side = w(q) * t;   // del pie (afuera, del lado del mar) hacia el escenario
      return [bx + dx * r + tx * side, by + dy * r + ty * side, zb + H * Math.sin(q * Math.PI * 0.6) / Math.sin(Math.PI * 0.6) - cup * t * t * q];
    };
    Rg.at(zb, () => Rg.box(bx, by, 0, zb, C.pillarM, C.pillarM, { top: C.pillar, side: C.pillar }, a));
    Rg.at(C.leafTopM + 0.01 * idx, () => {
      const N = 18, rim = [];
      for (let i = 0; i <= N; i++) rim.push(pt(i / N, 1));
      for (let i = N; i >= 0; i--) rim.push(pt(i / N, -1));
      Rg.poly(rim, C.leaf, Rg.shadow ? null : C.leafEdge, 0.12);
      if (Rg.shadow) return;
      // los nervios: del pie al borde, en abanico
      for (const f of [-1, -0.66, -0.33, 0.33, 0.66, 1]) {
        const e = Math.abs(f), q1 = tipK + (1 - tipK) * Math.cos(e * Math.PI / 2), t1 = Math.sign(f) * Math.sin(e * Math.PI / 2) * 0.96;
        Rg.line(Array.from({ length: 7 }, (_, i) => pt(0.04 + (q1 - 0.04) * i / 6, t1 * i / 6)), 0.07, C.vein);
      }
      Rg.line(Array.from({ length: 7 }, (_, i) => pt(0.02 + 0.96 * i / 6, 0)), 0.16, C.rib);
    });
  });
}

function paintMonument(mo, ppm, view = null) {
  const K = M.monuments, C = K[mo.kind];
  if (!C) return;
  // la Concha mide `size` de radio y sus hojas se levantan otro tanto: se pregunta con eso de margen
  if (view && !seenDisc(view, mo.x, mo.y, (mo.size || C.rM * ppm || 0) * 1.6)) return;
  ctx.save(); ctx.translate(mo.x, mo.y); ctx.rotate(mo.ang);
  if (mo.kind === "cannons") {
    // LOS CAÑONES SE LEVANTAN COMO LOS EDIFICIOS NUEVOS: su receta es un cuerpo 2.5D
    // (`world-props.json → bodies.cannons`) y lo pinta la cola de cuerpos, con su sombra.
    ctx.restore();
    const spec = PROPS.bodies.cannons;
    queueBody(bodyAt(spec, mo.x, mo.y, (mo.ang || 0) + (spec.turnDeg || 0) * RAD, "cannons"));
    return;
  }
  if (mo.kind === "shell") {
    // local: +y hacia el mar (la calle detrás de las gradas), el radio total es R
    const R = mo.size || C.rM * ppm;
    // el piso gris que llena el círculo entero de la Concha, gradas y hojas incluidas
    ctx.beginPath(); ctx.arc(0, 0, R * 1.04, 0, Math.PI * 2); ctx.fillStyle = C.floor; ctx.fill(); ctx.strokeStyle = C.floorEdge; ctx.lineWidth = 1.5; ctx.stroke();
    // la plaza de adoquín con su aro amarillo (en el suelo; las gradas y el escenario se levantan en 3D)
    const t0 = R * 0.62;
    ctx.beginPath(); ctx.arc(0, 0, t0, 0, Math.PI * 2); ctx.fillStyle = C.plaza; ctx.fill();
    ctx.beginPath(); ctx.arc(0, 0, t0 * 0.9, Math.PI * 1.05, Math.PI * 1.95); ctx.strokeStyle = C.ring; ctx.lineWidth = Math.max(1, 0.25 * ppm); ctx.stroke();
    ctx.restore();
    // LAS GRADAS, EL ESCENARIO Y LAS HOJAS EN 3D (`shellForm`): su sombra de una vez, en el suelo; ellos, con los cuerpos
    const Rm = R / ppm, topM = Math.max(C.tierRiseM * C.tiers, C.leafTopM) + 0.5;
    const rig = (g, mode) => { const S = makeRig(g, mo.x, mo.y, mo.ang || 0, ppm, state.cam, mode, C.shade, topM); shellForm(S, Rm, C); S.flush(); return S; };
    const sun = sunShadow(1);
    // la sombra en UN relleno, sin lienzo aparte (`rig3d.js → fillRigShadow`)
    if (sun.alpha > 0) fillRigShadow(ctx, sun.alpha * C.shadowAlpha, C.shade.shadow, (m) => rig(ctx, m));
    queueBodyLike({ x: mo.x, y: mo.y, paint: () => rig(ctx, "cam") });
    return;
  }
  if (mo.kind === "letters") {
    // la plazoleta, en el suelo; las letras se levantan y van con los cuerpos
    if (mo.oval) { ctx.beginPath(); ctx.ellipse(0, 0, mo.oval[0], mo.oval[1], 0, 0, Math.PI * 2); ctx.fillStyle = C.plaza; ctx.fill(); ctx.strokeStyle = C.plazaEdge; ctx.lineWidth = 2; ctx.stroke(); }
    else if (mo.r) { ctx.beginPath(); ctx.arc(0, 0, mo.r, 0, Math.PI * 2); ctx.fillStyle = C.plaza; ctx.fill(); ctx.strokeStyle = C.plazaEdge; ctx.lineWidth = 2; ctx.stroke(); }
    // su sombra en la plazoleta: la misma silueta, corrida por el sol
    const sh = sunShadow(C.liftM), ca = Math.cos(-(mo.ang || 0)), sa = Math.sin(-(mo.ang || 0));
    if (sh.alpha > 0) {
      ctx.save(); ctx.translate(sh.dx * ca - sh.dy * sa, sh.dx * sa + sh.dy * ca); ctx.globalAlpha = sh.alpha;
      paintLetterRow(mo, C, ppm, K.shadow, K.shadow); ctx.restore();
    }
    ctx.restore();
    queueBodyLike({ x: mo.x, y: mo.y, paint: (pp) => paintLettersRaised(mo, C, pp) });
    return;
  }
  ctx.restore();
}

function drawPunta(view, t = 0) {
  const P = W.PUNTA;
  if (!P || !aabbInView(P, view, 40)) return;
  const ppm = W.PX_PER_M;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // el verde del Paseo. Se pinta ACÁ y no con los verdes del mundo porque aquéllos van
  // antes que las aguas interiores, y sobre este frente hay agua vieja que lo taparía
  for (const gr of P.greens || []) { if (!seenPts(view, gr, gr.pts)) continue; ctx.fillStyle = MATERIALS.green[gr.type]; ctx.fill(shape(gr)); }
  // el patio de la terminal de ferris: asfalto redondeado y sus toldos
  if (P.yard && seenPts(view, P.yard, P.yard.pts)) {
    const Y = M.yard; ctx.fillStyle = Y.asphalt; ctx.fill(shape(P.yard));
    // LOS TOLDOS SON CUERPOS (`furniture3d.js → drawTent3d`): postes y techo de cuatro faldones
    if (Y.view3d) for (const tn of P.yard.tents) drawTent3d(tn.x, tn.y, tn.s, Y.view3d, Y.tent);
    else for (const tn of P.yard.tents) {
      ctx.fillStyle = Y.tentShadow; ctx.fillRect(tn.x - tn.s / 2 + 3, tn.y - tn.s / 2 + 4, tn.s, tn.s);
      ctx.fillStyle = Y.tent; ctx.fillRect(tn.x - tn.s / 2, tn.y - tn.s / 2, tn.s, tn.s);
      ctx.strokeStyle = Y.tentRidge; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(tn.x - tn.s / 2, tn.y - tn.s / 2); ctx.lineTo(tn.x + tn.s / 2, tn.y + tn.s / 2); ctx.moveTo(tn.x + tn.s / 2, tn.y - tn.s / 2); ctx.lineTo(tn.x - tn.s / 2, tn.y + tn.s / 2); ctx.stroke();
    }
  }  // los lechos rojos de las medialunas van ANTES de la escollera: la piedra tapa su orilla
  const band = (W.MALECON || []).find((b) => b.id === "punta_parque");
  for (const q of (P.muellero && P.muellero.pancitas) || []) {
    if (!q.bed || q.bed.length < 6 || !seenPts(view, q, q.ring || q.bed)) continue;
    // el parqueo: la acera de la calle que rodea la bahía y el segmento que cuelga de ella, del mismo
    // concreto; encima la lente roja. La bahía y su caño van después de las calles (drawPuntaStreetside)
    if (q.ring) { if (!q._ringP) q._ringP = flatPath(q.ring, true); ctx.fillStyle = MATERIALS.street.acera; ctx.fill(q._ringP); }
    // el rojo lleva el MISMO mosaico que el malecón que lo rodea: la misma retícula de baldosas, en el
    // marco de esa banda, para que las juntas sigan de un piso al otro
    if (!q._bed) q._bed = flatPath(q.bed, true);
    ctx.fillStyle = M.figures.ink; ctx.fill(q._bed);
    if (band) paintMaleconPattern(ctx, band, view, M.figures.mosaic, q._bed, BALDOSA_PX);
  }
  // la acera que rodea las bahías sueltas (la del Faro), antes de la calle como la del parqueo
  for (const q of P.bays || []) { if (!q.ring || !seenPts(view, q, q.ring)) continue; if (!q._ringP) q._ringP = flatPath(q.ring, true); ctx.fillStyle = MATERIALS.street.acera; ctx.fill(q._ringP); }
  for (const line of P.riprap || []) if (seenPts(view, line, line.pts, line.w + PIECE_MARGIN_PX)) paintRiprap(line, view);


  // el suelo, en el orden en que el mundo lo trae: terreno, deck, malecones…
  for (const g of P.grounds || []) {
    if (!seenPts(view, g, g.pts)) continue;
    const ink = g.use === "deck" ? POOL.deck : (M.ground[g.use] || M.ground.park);
    ctx.fillStyle = ink; ctx.fill(shape(g));
    // `dilate`: el suelo se mete debajo de las calles que lo rodean (que lo tapan), sin cordón propio
    if (g.dilate) { ctx.strokeStyle = ink; ctx.lineWidth = g.dilate * 2; ctx.stroke(g._path); continue; }
    ctx.strokeStyle = M.kerb; ctx.lineWidth = 1.5; ctx.stroke(g._path);
  }
  // los dos pisos: recortados a SU malecón, para que nada se salga a la calle
  const half = M.fan.halfAngleDeg * RAD;
  // el círculo del Faro: relleno, del color de las figuras
  for (const dsc of P.discs || []) {
    if (!seenDisc(view, dsc.x, dsc.y, dsc.r)) continue;
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(dsc.x, dsc.y, dsc.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = M.fan.edge; ctx.lineWidth = 1.5; ctx.stroke();
  }
  for (const f of P.fans || []) {
    if (!seenDisc(view, f.x, f.y, f.r)) continue;
    ctx.fillStyle = INK; ctx.fill(fanPath(f, half));
    ctx.strokeStyle = M.fan.edge; ctx.lineWidth = 1.2; ctx.stroke(f._path);
    // DOS bancas por abanico, una a cada lado: afuera de cada canto recto,
    // a media vara, y alineada con él
    const [bl, bw] = M.fan.benchM, off = M.fan.benchOffsetM * ppm;
    for (const side of [-1, 1]) {
      const e = f.ang + side * half, ex = Math.cos(e), ey = Math.sin(e);
      const bx = f.x + ex * f.r * M.fan.benchAlong - ey * side * off;
      const by = f.y + ey * f.r * M.fan.benchAlong + ex * side * off;
      // un bloque de concreto blanco con su altura (`fan.benchHM`), a lo largo del canto
      if (!inViewPt(view, bx, by, BLOCK_MARGIN_PX)) continue;
      drawBlock3d(bx, by, e, bl, bw, M.fan.benchHM, { top: M.fan.bench, side: M.fan.benchSide }, BENCH3D);
    }
  }
  for (const w of P.waves || []) {
    if (!seenDisc(view, w.x, w.y, w.len || 0)) continue;
    ctx.fillStyle = INK; ctx.fill(wavePath(w, M.wave.outline));
    ctx.strokeStyle = M.wave.edge; ctx.lineWidth = 1.2; ctx.stroke(w._path);
  }
  for (const r of P.rotondas || []) {
    if (!seenDisc(view, r.x, r.y, r.r)) continue;
    ctx.strokeStyle = INK; ctx.lineWidth = M.wave.rotondaWidthM * ppm;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
  }
  // el agua, con el estilo de las piscinas del Parque Marino sobre su forma
  // de verdad: brocal, lámina, la zona honda y la baja, y el brillo que se mueve
  const whole = (P.pools || []).filter((pool) => !pool.zone && seenPts(view, pool, pool.pts));
  for (const pool of whole) {
    ctx.strokeStyle = POOL.coping; ctx.lineWidth = M.pool.rimWidthM * ppm * 2; ctx.stroke(shape(pool));
    ctx.fillStyle = POOL.water; ctx.fill(pool._path);
  }
  for (const pool of P.pools || []) if (pool.zone && seenPts(view, pool, pool.pts)) { ctx.fillStyle = POOL[M.pool.zones[pool.use]]; ctx.fill(shape(pool)); }
  const S = M.pool.shimmer, gap = S.gapM * ppm, amp = S.ampM * ppm;
  ctx.strokeStyle = POOL.shimmer; ctx.lineWidth = S.widthM * ppm;
  for (const pool of whole) {
    const a = pool._aabb;
    ctx.save(); ctx.clip(pool._path);
    for (let y = a.y0 + gap / 2, n = 0; y < a.y1; y += gap, n++) {
      const drift = (t * S.speed * ppm + n * 37) % (S.dashM * ppm * 2);
      ctx.setLineDash([S.dashM * ppm, S.dashM * ppm]); ctx.lineDashOffset = -drift;
      ctx.beginPath();
      for (let x = a.x0; x <= a.x1; x += 6) {
        const yy = y + Math.sin((x + n * 50) * S.freq + t * S.wobble) * amp;
        if (x === a.x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = POOL.coping; ctx.lineWidth = M.pool.wallWidthM * ppm;
  for (const wall of P.walls || []) {
    if (!seenPts(view, wall, wall.pts)) continue;
    if (!wall._path) wall._path = flatPath(wall.pts, false);
    ctx.stroke(wall._path);
  }
  // la isla y lo que flota: van DESPUÉS del agua
  for (const g of P.islands || []) {
    if (!seenPts(view, g, g.pts)) continue;
    ctx.strokeStyle = POOL.coping; ctx.lineWidth = M.pool.rimWidthM * ppm * 2; ctx.stroke(shape(g));
    ctx.fillStyle = M.ground.planter; ctx.fill(g._path);
  }
  for (const pr of P.props || []) {
    if (!inViewPt(view, pr.x, pr.y, PIECE_MARGIN_PX)) continue;
    const s = M.props.cabanaM * ppm;
    ctx.fillStyle = M.props.shadow; ctx.fillRect(pr.x - s / 2 + 2, pr.y - s / 2 + 3, s, s);
    ctx.fillStyle = M.props.cabana; ctx.fillRect(pr.x - s / 2, pr.y - s / 2, s, s);
  }
  // los techos sin paredes y los monumentos van con el suelo, bajo los árboles
  for (const f of P.fun || []) if (inViewPt(view, f.x, f.y, PIECE_MARGIN_PX)) paintFun(f, ppm, t);
  for (const rf of P.roofs || []) if (seenPts(view, rf, rf.pts)) paintRoof(rf, ppm);
  for (const mo of P.monuments || []) paintMonument(mo, ppm, view);
  if (P.muellero) paintMuellero(P.muellero, ppm, view);
  // la hora: UN velo sobre todo el suelo del lugar, en un solo relleno para
  // que donde dos figuras se montan no oscurezca dos veces
  // (el deck y el parqueo van DENTRO de otra figura: sumarlos abriría un hueco
  // donde el sentido de su contorno es el contrario)
  if (!P._all) {
    P._all = new Path2D();
    for (const g of P.grounds || []) if (g.use !== "deck" && g.use !== "parking") P._all.addPath(shape(g));
  }
  ctx.fillStyle = blendPalette(M.sky, "clear").veil;
  ctx.fill(P._all);
}

// LOS ARCOS DE ENTRADA, por encima de calles y muelles: el carro pasa por DEBAJO del rótulo. Es la
// misma pieza 3D que el cartel de la feria (`gate3d.js`), con su propia tinta.
function drawPuntaGates(view, t = 0) {
  const P = W.PUNTA;
  if (!P || !P.gates) return;
  // LAS BANDERAS DEL MUELLE, en 2.5D: el asta sube con el pinhole como un poste de luz, y el paño es una
  // tira VERTICAL que vuela con el viento (`windDeg`) y flamea de lado (`flapM`) — desde arriba se ve su
  // canto ondeando y, al alejarse de la cámara, la cara con sus franjas. Su sombra y la del asta van al
  // suelo ya; lo que se levanta se pinta con los cuerpos, encima de la gente.
  const FL = M.flag, fp = W.PX_PER_M, [fwM, fhM] = FL.sizeM, wind = (FL.windDeg || 0) * RAD, wx = Math.cos(wind), wy = Math.sin(wind);
  const N = FL.segments || 8, n = FL.stripes.length;
  for (const fl of P.flags || []) {
    if (fl.x < view.x0 - 60 || fl.x > view.x1 + 60 || fl.y < view.y0 - 60 || fl.y > view.y1 + 60) continue;
    const ph = t * (FL.flapHz || 1.4) * Math.PI * 2 + fl.y * 0.01 + fl.x * 0.007;
    // un punto del paño: `u` a lo largo (0 el asta, 1 la punta libre) y `hM` de alto; `lift` dice si
    // se levanta con la cámara (el paño) o se tumba con el sol (su sombra)
    const at = (u, hM, lift) => {
      const flap = Math.sin(ph - u * 3.2) * FL.flapM * fp * u, droop = u * u * (FL.droopM || 0);
      const px = fl.x + wx * fwM * fp * u - wy * flap, py = fl.y + wy * fwM * fp * u + wx * flap, h = hM - droop;
      const o = lift(px, py, h);
      return [px + o.dx, py + o.dy];
    };
    const sun = (px, py, h) => sunShadow(h), cam = (px, py, h) => parallaxOffset(state.cam, px, py, h, fp);
    const strip = (k, lift) => {
      const h0 = FL.poleM - fhM * k / n, h1 = FL.poleM - fhM * (k + 1) / n;
      ctx.beginPath();
      for (let i = 0; i <= N; i++) { const q = at(i / N, h0, lift); i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]); }
      for (let i = N; i >= 0; i--) { const q = at(i / N, h1, lift); ctx.lineTo(q[0], q[1]); }
      ctx.closePath();
    };
    const fsh = sunShadow(FL.poleM);
    if (fsh.alpha > 0) {
      ctx.save(); ctx.globalAlpha = fsh.alpha; ctx.strokeStyle = FL.shadow; ctx.fillStyle = FL.shadow; ctx.lineCap = "round"; ctx.lineWidth = FL.polePx || 1.6;
      ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fl.x + fsh.dx, fl.y + fsh.dy); ctx.stroke();
      for (let k = 0; k < n; k++) { strip(k, sun); ctx.fill(); }
      ctx.restore();
    }
    queueBodyLike({ x: fl.x, y: fl.y, paint: () => {
      const top = cam(fl.x, fl.y, FL.poleM + (FL.finialM || 0.3));
      ctx.lineCap = "round"; ctx.lineWidth = FL.polePx || 1.6; ctx.strokeStyle = FL.pole;
      ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fl.x + top.dx, fl.y + top.dy); ctx.stroke();
      for (let k = 0; k < n; k++) { ctx.fillStyle = FL.stripes[k]; strip(k, cam); ctx.fill(); }
      // el canto del paño, para que se lea aunque la cámara lo vea de filo
      ctx.strokeStyle = FL.edge; ctx.lineWidth = 0.8; strip(0, cam); ctx.stroke(); strip(n - 1, cam); ctx.stroke();
      ctx.fillStyle = FL.finial; ctx.beginPath(); ctx.arc(fl.x + top.dx, fl.y + top.dy, (FL.polePx || 1.6) * 0.9, 0, Math.PI * 2); ctx.fill();
    } });
  }
  // LOS ARCOS, EN 3D (`gate3d.js`): postes y tablero con su grosor, el letrero sobre la cara que mira a
  // la cámara y su sombra al sol
  const G = M.gate;
  for (const gate of P.gates) {
    if (gate.x < view.x0 - 200 || gate.x > view.x1 + 200 || gate.y < view.y0 - 200 || gate.y > view.y1 + 200) continue;
    drawGate3d(gate.x, gate.y, gate.ang || 0, gate.w, gate.text, G, { post: G.post, board: G.board, trim: G.trim, ink: G.ink });
  }
}

// EL HAZ DEL FARO. Es luz: se pinta en pantalla, DESPUÉS de la oscuridad y sumando
// —igual que los láseres de la feria—, o quedaría debajo del velo de la noche.
function drawPuntaNight(view, t, toScreen, zoom, night) {
  const P = W.PUNTA;
  if (!P || !P.beams || night <= 0.001) return;
  const B = M.beam, ppm = W.PX_PER_M, reach = B.lengthM * ppm, half = B.halfAngleDeg * RAD;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const bm of P.beams) {
    if (bm.x + reach < view.x0 || bm.x - reach > view.x1 || bm.y + reach < view.y0 || bm.y - reach > view.y1) continue;
    const [sx, sy] = toScreen(bm.x, bm.y), L = reach * zoom, turn = t * B.turnsPerSec * Math.PI * 2;
    for (const flip of [0, Math.PI]) {
      const a = turn + flip, grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, L);
      grad.addColorStop(0, `rgba(${B.rgb},${(B.alpha * night).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${B.rgb},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, L, a - half, a + half); ctx.closePath(); ctx.fill();
    }
    const g = B.glowM * ppm * zoom, glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, g);
    glow.addColorStop(0, `rgba(${B.rgb},${(0.9 * night).toFixed(3)})`); glow.addColorStop(1, `rgba(${B.rgb},0)`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, g, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// EL MAR QUE TAPA LA COSTA VIEJA: el MISMO pintor del golfo, recortado. Va justo
// después del suelo base y antes del malecón, como el mar de verdad.
function drawPuntaSea(view, t) {
  const P = W.PUNTA;
  if (!P || !aabbInView(P, view, 900)) return;
  // EL MAR SÓLO DONDE HAY UN PARCHE A LA VISTA. Esto vuelve a pintar el mar ENTERO —oleaje incluido,
  // de lo más caro del suelo— recortado a los parches; el recorte no ahorra el trabajo, así que se
  // pintaba dos veces por cuadro con sólo estar a 900 px del conjunto. Ahora se arma el recorte con los
  // parches que tocan la vista, y si ninguno la toca, no se pinta.
  const rings = (P.seaPatch || []).map((ring, i) => (P._seaRings || (P._seaRings = []))[i] || (P._seaRings[i] = { ring, path: flatPath(ring, true) }));
  const sea = rings.filter((r) => seenPts(view, r, r.ring, 0));
  if (sea.length) {
    const clip = new Path2D(); for (const r of sea) clip.addPath(r.path);
    ctx.save(); ctx.clip(clip, "nonzero"); drawWaterAll(view, t); ctx.restore();
  }
  // la playa —entre lengua y lengua, al frente del Paseo y al norte— va ANTES del malecón,
  // así las lenguas de piedra la tapan donde se montan y no queda rendija de agua entre las dos
  const sands = (P.sands || []).filter((sd) => seenPts(view, sd, sd.pts));
  ctx.fillStyle = weatherColors().sand;
  for (const sd of sands) ctx.fill(shape(sd));
  // el MISMO grano que la playa del mundo, para que no haya dos arenas
  { const tex = textureScale(); for (const sd of sands) overlayTexture(ctx, "sand", tex, () => ctx.fill(sd._path)); }
}

// LO QUE VA SOBRE LA ACERA DE LA CALLE, pintado DESPUÉS de las calles: la bahía de parqueo en batería
// pegada al asfalto, con la acera de la calle rodeándola y su caño por el canto
function drawPuntaStreetside(view) {
  const P = W.PUNTA;
  if (!P || !P.muellero || !aabbInView(P, view, 400)) return;
  const C = M.muellero;
  // las bahías: la del parqueo del Parque Marino y la del Faro, la misma receta
  for (const q of [...(P.muellero.pancitas || []), ...(P.bays || [])]) {
    if (!q.bay || !seenPts(view, q, q.ring || q.bay)) continue;
    if (!q._bayP) { q._bayP = flatPath(q.bay, true); q._canoP = flatPath(q.cano, false); q._canoClip = flatPath(q.canoClip, true); }
    // el caño de la calle sigue el canto de la bahía, como en cualquier cordón: una banda más oscura
    // trazada antes del asfalto, con topes rectos
    ctx.save(); ctx.clip(q._canoClip); ctx.lineCap = "butt"; ctx.lineJoin = "miter"; ctx.strokeStyle = MATERIALS.street.cano; ctx.lineWidth = 2 * CANO_PX; ctx.stroke(q._canoP); ctx.restore();
    ctx.fillStyle = MATERIALS.street.asphalt; ctx.fill(q._bayP);
    ctx.strokeStyle = C.stall; ctx.lineWidth = 1.2; ctx.beginPath();
    for (const [x0, y0, x1, y1] of q.stallLines || []) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); }
    ctx.stroke();
  }
}

export { drawPunta, drawPuntaGates, drawPuntaNight, drawPuntaSea, drawPuntaStreetside };
