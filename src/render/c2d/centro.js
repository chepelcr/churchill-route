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
import { parallaxOffset } from "./depth.js";
import { flushBodies, queueBody, queueBodyLike } from "./bodies.js";
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
  if (!C || !aabbInView(C, view, 60)) { flushBodies(); return; }
  const ppm = W.PX_PER_M, cam = state.cam, list = [];
  for (const place of C.places) {
    if (!aabbInView(place, view, 60)) continue;
    for (const S of place.structures) if (aabbInView(S, view, 60)) list.push(S);
    for (const p of place.poles || []) if (p.x > view.x0 - 40 && p.x < view.x1 + 40 && p.y > view.y0 - 40 && p.y < view.y1 + 40) list.push(p);
  }
  // todo a la cola de cuerpos (`bodies.js`): ahí se ordena —lo bajo primero, después de lejos a
  // cerca— y se pinta con las sombras antes que los cuerpos, junto con la Capitanía y los quioscos
  for (const S of list) { if (S.tiers) queueBody(S); else queueBodyLike({ x: S.x, y: S.y, paint: (p) => paintPole(S, p) }); }
  flushBodies();
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
