// Street layer: the multi-pass road painter (acera → casing → asphalt → lane
// dashes), per-tile rails/medians, street name pills and the lock barriers.
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import PROPS from "../../assets/world-props.json" with { type: "json" };
import { FIELD_SPORT_ROLE } from "../../domain/vocabulary.generated.js";
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { PX_PER_M } from "../../domain/units.js";
import { t } from "../../i18n/index.js";
import { evalOn } from "../vehicleShapes.js";
import { dashPath, roadPath } from "./cache.js";
import { nearestOnPoly, onFeriaDeck } from "./flora.js";
import { ACERA_PX, aabbInView, ctx, flatAABB, flatMultiPath, flatPath, label, parcelFrame, textureScale, upright } from "./gfx.js";
import { textureFor, overlayTexture } from "./materials.js";
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { roundedMultiPath, roundedPath } from "./curves.js";
import { drawParada, propParts } from "./props.js";
import { paintAt, paintParts } from "./shapes.js";
import { paintRoadNetwork } from "./systemShapes.js";
import { drawBarricade3d, drawBench3d, drawGantrySignal3d, drawPoleSign3d } from "./furniture3d.js";
import { parallaxOffset } from "./depth.js";
import { queueBodyLike } from "./bodies.js";
import { sunShadow } from "./shadows.js";

//: LA SEÑALIZACIÓN, keyed by SignKind — see the note above `drawSign`.
const SIGNS = PROPS.signs;

// Estadios are NOT a structure drawn over the ground — they are a COLOUR
// CHOICE inside the acera pass. The build traces each one from the real cuadra
// (S.footprint, organic, following the manzana's true grid angles), and here
// that polygon is painted inside the visible acera ring instead of the usual
// concrete. Drawn between the acera band and the casing/asphalt, so the asphalt
// pass repaints anything that reached the roadway, while street name pills,
// buildings and flora still land on top. Las Playitas emits a sectioned base:
// its central football parcel, basketball court and eastern park paint above it.
// Centre, tilt and half-extents of a field, all of them now from the WORLD:
// every parcel and both estadios emit `ang`, `hw` and `hh`. The principal-axis
// fallback this used to carry is gone — these polygons are RASTER-TRACED, so
// their vertices are 4 px staircase steps, and fitting a square-ish one lands
// on the CONTRARY diagonal to the block (Plaza El Carmen fitted to -67°, its
// cuadra actually sits at -4.5°). See `parcelFrame`.
function fieldFrame(S) {
  if (S._frame) return S._frame;
  let { cx, cy, ang, hw, hh } = parcelFrame(S);
  // Long axis = the scoring axis. Lito Pérez and Las Playitas therefore put
  // their goals at the west/east centres; El Carmen's taller parcel takes this
  // quarter turn and puts its smaller goals at the north/south centres.
  if (hh > hw) { ang += Math.PI / 2; const t = hw; hw = hh; hh = t; }
  return (S._frame = { cx, cy, ang, hw, hh, boxes: S.boxes, poly: S.poly || S.footprint });
}

// Poured concrete, the colour the aceras actually are in the port.
//: LA PALETA DE LA CALZADA Y DE LO QUE SE PINTA SOBRE UNA CANCHA.
//: `paintRoads` se queda en código y eso no es pereza: el casing, los guiones y
//: el caño son GEOMETRÍA derivada de la clase de vía, no una paleta. De qué
//: color sale cada cosa sí lo es.
const ST = MATERIALS.streets;
const ORGANIC = EFFECTS.organic || {};
const ACERA_GREY = MATERIALS.street.acera;
// …and the caño: the drainage channel at the kerb, cast in the same concrete
// but permanently damp and stained, so it reads a full step darker.
const CANO_GREY = MATERIALS.street.cano;
const CANO_PX = 4;                       // depth of the gutter, per side

const MARK = MATERIALS.street.mark;   // every line on a field is this one white
// Grass, mow stripes and fútbol markings inside `path`, all drawn in the
// FIELD's OWN frame rather than on screen axes — Las Playitas sits on the
// diagonal street grid and Plaza El Carmen on a slanted manzana, and
// axis-aligned stripes with a square white box on a tilted field read as a
// mistake. Shared by the whole-cuadra estadios and by plaza/stadium parcels, so
// a plaza gets exactly the estadio's field.
function paintField(path, F, sport) {
  ctx.save();
  ctx.clip(path, "evenodd");
  // THE COURT SPORTS are a role set in the enum layer, not a pair of
  // literals — `COURT_SPORTS` in churchill/world/enums/features.py.
  const court = FIELD_SPORT_ROLE.COURT.includes(sport);
  // A basketball court is CONCRETE, not grass. Painting 21 of them green with
  // a halfway line and a centre circle is what made them read as stray white
  // rectangles on the map.
  ctx.fillStyle = court ? ST.field.court : ST.field.grass; ctx.fill(path, "evenodd");
  ctx.translate(F.cx, F.cy); ctx.rotate(F.ang);
  const hw = F.hw, hh = F.hh;
  if (court) { paintCourt(hw, hh, F); ctx.restore();
    ctx.strokeStyle = ST.field.lines; ctx.lineWidth = 2; ctx.stroke(path); return; }
  ctx.fillStyle = ST.field.mow;                            // mow stripes, along the pitch
  for (let sy = -hh; sy < hh; sy += 14) ctx.fillRect(-hw, sy, hw * 2, 7);
  // LEVEL OF DETAIL. 27 of the map's canchas are under 60 px on their short
  // side; a halfway line and a centre circle on a 16x28 px pitch is not a
  // football pitch, it is two white marks and an outline. Below the threshold
  // the grass and the kerb say everything.
  if (Math.min(hw, hh) < 22) {
    ctx.restore();
    ctx.strokeStyle = MARK; ctx.lineWidth = 2; ctx.stroke(path);
    return;
  }
  // THE TOUCHLINE IS THE PITCH FOOTPRINT, at the acera's inner edge — there is
  // no second boundary. A strokeRect off the frame's extents drew a rectangle
  // inside the traced outline, the wrong shape on an organic or diagonal block.
  //
  // Everything else is drawn at FULL extent and trimmed by the clip, so a
  // marking meets the touchline exactly instead of guessing where the edge is.
  // Level of detail by size: a real penalty area shares its goal line with the
  // touchline, so on a SMALL pitch its stroke lands on top of the boundary (and
  // the goal box on top of that) and the whole end reads as doubled lines. Lito
  // Pérez is 116 px across — below the threshold it keeps the clean set:
  // halfway line and centre circle. La Plaza is nearly twice that.
  const m = Math.max(6, Math.min(hw, hh) * 0.10);          // marking inset
  ctx.strokeStyle = MARK; ctx.lineWidth = 2; ctx.fillStyle = MARK;
  ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(0, hh); ctx.stroke();       // halfway line
  ctx.beginPath(); ctx.arc(0, 0, Math.min(hw, hh) * 0.26, 0, Math.PI * 2); ctx.stroke();
  const flush = F.boxes === "penalty" && F.poly?.length === 8;
  if (flush) {
    ctx.save();
    ctx.rotate(-F.ang); ctx.translate(-F.cx, -F.cy);
    paintFlushAreasAndGoals(F);
    ctx.restore();
  } else if (F.boxes !== "penalty") paintGoals(hw, hh, F);
  ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();          // centre spot
  if (!flush && F.boxes !== false && hw >= 80 && hh >= 55) {
    const bw = Math.min(hw * 0.28, hh * 0.9);              // penalty area depth
    const bh = Math.max(12, Math.min(hh - m - 4, hh * 0.60));
    const inset = F.boxes === "penalty" ? 0 : m;
    for (const sd of [-1, 1]) {
      const x0 = sd < 0 ? -hw + inset : hw - inset - bw;
      ctx.strokeRect(x0, -bh, bw, bh * 2);                                     // penalty area
      if (F.boxes !== "penalty") {
        const gx = sd < 0 ? -hw + m : hw - m - bw * 0.38;
        ctx.strokeRect(gx, -bh * 0.45, bw * 0.38, bh * 0.9);                   // goal box
      }
      ctx.beginPath(); ctx.arc(sd * (hw - inset - bw * 0.72), 0, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  ctx.strokeStyle = MARK; ctx.lineWidth = F.boxes === false ? 2.6 : 2;
  ctx.stroke(path);                                             // pitch touchline
}

// LA PORTERÍA DE PIE (`materials.json → streets.field.goal3d`). En el suelo queda el marco de atrás (lo
// que ya se pintaba); los dos postes y el travesaño se levantan con el pinhole de la casa y la red baja del
// travesaño al marco, translúcida. `a`, `b`: la boca (donde van los postes); `ba`, `bb`: el fondo de la red.
// Va a la cola de cuerpos: se pinta con los edificios, encima de la gente que juega.
const G3 = ST.field.goal3d;
function queueGoal3d(a, b, ba, bb) {
  if (!G3) return;
  const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2;
  queueBodyLike({ x, y, paint: (ppm) => {
    const up = (p) => { const o = parallaxOffset(state.cam, p[0], p[1], G3.heightM, ppm); return [p[0] + o.dx, p[1] + o.dy]; };
    const at = up(a), bt = up(b), sh = sunShadow(G3.heightM);
    // la sombra de los postes y del travesaño, en el suelo
    ctx.save(); ctx.globalAlpha = sh.alpha; ctx.strokeStyle = G3.postShade; ctx.lineWidth = G3.postPx; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(a[0] + sh.dx, a[1] + sh.dy); ctx.lineTo(b[0] + sh.dx, b[1] + sh.dy); ctx.lineTo(...b); ctx.stroke();
    ctx.restore();
    // la red: el techo (del travesaño al fondo) y los dos costados
    ctx.fillStyle = G3.net; ctx.strokeStyle = G3.netLine; ctx.lineWidth = 0.6;
    for (const poly of [[at, bt, bb, ba], [a, at, ba], [b, bt, bb]]) {
      ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // los postes y el travesaño
    ctx.strokeStyle = G3.post; ctx.lineWidth = G3.postPx; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...at); ctx.lineTo(...bt); ctx.lineTo(...b); ctx.stroke();
  } });
}

// EL ARO DE PIE (`materials.json → streets.field.hoop3d`): poste, brazo, tablero, aro y red, cada punto a su
// altura con el pinhole de la casa, y su sombra en el suelo con el sol de la hora. `sd` es el extremo (-1/1)
const H3 = ST.field.hoop3d;
function queueHoop3d(W2, sd, hw) {
  const m = PX_PER_M, uPole = sd * (hw + H3.poleBackM * m), uBoard = sd * (hw - H3.boardInM * m);
  const uRim = sd * (hw - (H3.boardInM + H3.rimOutM) * m), bw = H3.boardWM / 2 * m, [z0, z1] = H3.boardZM;
  const [x, y] = W2(sd * hw, 0);
  queueBodyLike({ x, y, paint: (ppm) => {
    const P = (u, v, z) => { const [px, py] = W2(u, v), o = parallaxOffset(state.cam, px, py, z, ppm); return [px + o.dx, py + o.dy]; };
    const S = (u, v, z) => { const [px, py] = W2(u, v), o = sunShadow(z); return [px + o.dx, py + o.dy]; };
    const line = (pts) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); };
    const rim = (f, z) => { const out = []; for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2;
      out.push(f(uRim + Math.cos(a) * H3.rimRM * m, Math.sin(a) * H3.rimRM * m, z)); } return out; };
    const zTop = z0 + (z1 - z0) * 0.5;
    // la sombra: el poste, el brazo y el tablero
    ctx.save(); ctx.globalAlpha = sunShadow(z1).alpha; ctx.strokeStyle = H3.shade; ctx.fillStyle = H3.shade;
    ctx.lineWidth = H3.polePx; ctx.lineCap = "round";
    line([W2(uPole, 0), S(uPole, 0, zTop), S(uBoard, 0, zTop)]); ctx.stroke();
    line([S(uBoard, -bw, z0), S(uBoard, bw, z0), S(uBoard, bw, z1), S(uBoard, -bw, z1)]); ctx.closePath(); ctx.fill();
    ctx.restore();
    // el poste y el brazo
    ctx.strokeStyle = H3.pole; ctx.lineWidth = H3.polePx; ctx.lineCap = "round"; ctx.lineJoin = "round";
    line([W2(uPole, 0), P(uPole, 0, zTop), P(uBoard, 0, zTop)]); ctx.stroke();
    // la red, bajo el aro
    ctx.strokeStyle = H3.net; ctx.lineWidth = 0.5;
    const top = rim(P, H3.rimZM), low = rim((u, v, z) => P(uRim + (u - uRim) * 0.6, v * 0.6, z), H3.rimZM - H3.netM);
    ctx.beginPath(); top.forEach((p, i) => { if (i % 2) return; ctx.moveTo(...p); ctx.lineTo(...low[i]); }); ctx.stroke();
    line(low); ctx.closePath(); ctx.stroke();
    // el tablero, con su grosor (`boardDM`): la cara de atrás, el canto de arriba y la cara a la cancha
    const ub2 = uBoard + sd * (H3.boardDM || 0) * m;
    ctx.fillStyle = H3.board; ctx.strokeStyle = H3.pole; ctx.lineWidth = 0.4;
    for (const face of [
      [P(ub2, -bw, z0), P(ub2, bw, z0), P(ub2, bw, z1), P(ub2, -bw, z1)],
      [P(ub2, -bw, z1), P(ub2, bw, z1), P(uBoard, bw, z1), P(uBoard, -bw, z1)],
      [P(uBoard, -bw, z0), P(uBoard, bw, z0), P(uBoard, bw, z1), P(uBoard, -bw, z1)],
    ]) { line(face); ctx.closePath(); ctx.fill(); ctx.stroke(); }
    const q = bw * 0.33, qz0 = H3.rimZM + 0.05, qz1 = qz0 + (z1 - z0) * 0.42;
    ctx.strokeStyle = H3.boardLine; ctx.lineWidth = 0.8;
    line([P(uBoard, -q, qz0), P(uBoard, q, qz0), P(uBoard, q, qz1), P(uBoard, -q, qz1)]); ctx.closePath(); ctx.stroke();
    // el aro
    ctx.strokeStyle = H3.rim; ctx.lineWidth = H3.rimPx || 1;
    line(top); ctx.closePath(); ctx.stroke();
  } });
}

function paintFlushAreasAndGoals(F) {
  const p = F.poly;
  const cx = (p[0] + p[2] + p[4] + p[6]) / 4;
  const cy = (p[1] + p[3] + p[5] + p[7]) / 4;
  const depth = Math.min(F.hw * 0.28, F.hh * 0.9);
  const mouth = Math.max(5, Math.min(18, F.hh * 0.24));
  const goalDepth = Math.max(3, Math.min(8, mouth * 0.42));
  for (const [ai, bi] of [[0, 3], [1, 2]]) {
    const ax = p[ai * 2], ay = p[ai * 2 + 1];
    const bx = p[bi * 2], by = p[bi * 2 + 1];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const tx = dx / len, ty = dy / len;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    let nx = ty, ny = -tx;
    if (nx * (cx - mx) + ny * (cy - my) < 0) { nx = -nx; ny = -ny; }
    const at = (t, inset = 0) => [ax + dx * t + nx * inset, ay + dy * t + ny * inset];
    const a = at(0.2), b = at(0.8);
    const ai2 = at(0.2, depth), bi2 = at(0.8, depth);
    ctx.strokeStyle = MARK; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(...a); ctx.lineTo(...ai2); ctx.lineTo(...bi2); ctx.lineTo(...b);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(mx + nx * depth * 0.72, my + ny * depth * 0.72, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = ST.field.goals;
    ctx.lineWidth = Math.max(1.4, Math.min(2.4, F.hh * 0.035));
    ctx.beginPath();
    ctx.moveTo(mx - tx * mouth, my - ty * mouth);
    ctx.lineTo(mx - tx * mouth + nx * goalDepth, my - ty * mouth + ny * goalDepth);
    ctx.lineTo(mx + tx * mouth + nx * goalDepth, my + ty * mouth + ny * goalDepth);
    ctx.lineTo(mx + tx * mouth, my + ty * mouth);
    ctx.stroke();
    // los postes en la boca —el lado de adentro, hacia la cancha— y la red hacia la línea de fondo
    queueGoal3d([mx - tx * mouth + nx * goalDepth, my - ty * mouth + ny * goalDepth], [mx + tx * mouth + nx * goalDepth, my + ty * mouth + ny * goalDepth],
      [mx - tx * mouth, my - ty * mouth], [mx + tx * mouth, my + ty * mouth]);
  }
}

// Goal frames sit at the centre of the two scoring ends. Their mouth and depth
// come from the pitch's short side, so El Carmen gets recognisably smaller
// porterías than the two full-size stadiums instead of a copied fixed graphic.
// The frame opens toward the touchline and stays inside the field clip.
function paintGoals(hw, hh, F = null) {
  const mouth = Math.max(5, Math.min(18, hh * 0.24));
  // del marco de la cancha al mundo: la portería de pie se arma en píxeles de mundo
  const W2 = F ? ((u, v) => [F.cx + u * Math.cos(F.ang) - v * Math.sin(F.ang), F.cy + u * Math.sin(F.ang) + v * Math.cos(F.ang)]) : null;
  const depth = Math.max(3, Math.min(8, mouth * 0.42));
  ctx.strokeStyle = ST.field.goals;
  ctx.lineWidth = Math.max(1.4, Math.min(2.4, hh * 0.035));
  ctx.lineJoin = "miter";
  for (const side of [-1, 1]) {
    const x = side * hw;
    const inner = x - side * depth;
    ctx.beginPath();
    ctx.moveTo(x, -mouth);
    ctx.lineTo(inner, -mouth);
    ctx.lineTo(inner, mouth);
    ctx.lineTo(x, mouth);
    ctx.stroke();
    if (W2) queueGoal3d(W2(inner, -mouth), W2(inner, mouth), W2(x, -mouth), W2(x, mouth));
  }
}

// A cancha multiuso: the key at each end, the centre circle and the two hoops,
// drawn in the court's own frame (already translated/rotated by the caller).
// Same level-of-detail rule as the pitch — a court too small for its markings
// gets the plain slab.
function paintCourt(hw, hh, F = null) {
  if (Math.min(hw, hh) < 14) return;
  // del marco de la cancha al mundo: el aro de pie se arma en píxeles de mundo
  const W2 = F && H3 ? ((u, v) => [F.cx + u * Math.cos(F.ang) - v * Math.sin(F.ang), F.cy + u * Math.sin(F.ang) + v * Math.cos(F.ang)]) : null;
  const kw = Math.min(hw * 0.30, hh * 0.85), kh = Math.min(hh * 0.52, hw * 0.5);
  for (const sd of [-1, 1]) {
    const x0 = sd < 0 ? -hw + 2 : hw - 2 - kw;
    const freeThrowX = sd < 0 ? x0 + kw : x0;
    ctx.fillStyle = ST.court.end;
    ctx.beginPath(); ctx.arc(freeThrowX, 0, hh * 0.82, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ST.court.key;
    ctx.fillRect(x0, -kh, kw, kh * 2);
  }
  ctx.fillStyle = ST.court.key;
  ctx.beginPath(); ctx.arc(0, 0, Math.min(hw, hh) * 0.26, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = ST.court.lines; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(0, hh); ctx.stroke();   // halfway
  ctx.beginPath(); ctx.arc(0, 0, Math.min(hw, hh) * 0.26, 0, Math.PI * 2); ctx.stroke();
  for (const sd of [-1, 1]) {
    const x0 = sd < 0 ? -hw + 2 : hw - 2 - kw;
    const freeThrowX = sd < 0 ? x0 + kw : x0;
    ctx.strokeRect(x0, -kh, kw, kh * 2);                                  // the key
    ctx.beginPath(); ctx.arc(freeThrowX, 0, kh * 0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.arc(sd * (hw - 5), 0, hh * 0.88,
            sd < 0 ? -Math.PI / 2 : Math.PI / 2,
            sd < 0 ? Math.PI / 2 : Math.PI * 1.5);
    ctx.stroke();
    // the hoop: de pie si el registro lo trae (`streets.field.hoop3d`); si no, el tablero y el aro planos
    if (W2) { queueHoop3d(W2, sd, hw); continue; }
    ctx.fillStyle = ST.court.paint;
    ctx.fillRect(sd < 0 ? -hw + 1 : hw - 3, -3.2, 2, 6.4);
    ctx.strokeStyle = ST.court.hoop; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(sd * (hw - 5), 0, 2.4, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = ST.court.lines; ctx.lineWidth = 1.6;
  }
}

function paintStadiumCuadras(view) {
  const arr = W.STADIUMS;
  if (!arr || !arr.length) return;
  const sectioned = new Set();
  for (const S of arr) {
    if (S.x1 + 40 < view.x0 || S.x0 - 40 > view.x1 || S.y1 + 40 < view.y0 || S.y0 - 40 > view.y1) continue;
    if (!S.footprint) continue;
    // The builder emits two real polygons: `outline` is the entire stadium
    // cuadra and `footprint` is the pitch or sectioned base inset by ACERA_CELLS.
    // Paint the outer shape first, leaving the generated acera ring visible.
    if (S.outline && S.aceras !== false) {
      const acera = S._acera || (S._acera = flatPath(S.outline, true));
      ctx.fillStyle = S.aceraColor || ACERA_GREY;
      ctx.fill(acera, "evenodd");
    }
    const pitch = S._pitch || (S._pitch = flatPath(S.footprint, true));
    if (S.parts?.length) {
      for (const id of S.parts) sectioned.add(id);
      // la base de una plaza seccionada es el GRIS de su cuadra: lo que tiene color son sus partes
      ctx.fillStyle = ST.field.sectionedBase || ST.field.grass;
      ctx.fill(pitch, "evenodd");
    } else {
      // la cancha chica dentro de su anillo de concreto, si el registro la achica
      const key = S._key ?? (S._key = stadiumKey(S) || null);
      const small = S._small !== undefined ? S._small : (S._small = insetPitch(key, S.footprint, fieldFrame(S)));
      if (small) { ctx.fillStyle = RING; ctx.fill(pitch, "evenodd"); paintField(small.path, small.frame, S.sport); }
      else paintField(pitch, fieldFrame(S), S.sport);
    }
  }
  // A sectioned plaza is a base, not one giant football pitch. Its real courts
  // and park paint last so the full-cuadra layer cannot erase their identity.
  if (sectioned.size) paintParcels(view, sectioned);
}

// LA CANCHA, MÁS CHICA QUE SU HUELLA (`world-props.json → stadiums3d.pitchInsets`). Cada lado de un
// cuadrilátero se mete los metros que dice el registro para la dirección hacia la que mira (norte, sur, este,
// oeste), y las esquinas nuevas son los cruces de esas rectas. Devuelve el camino y el marco de la cancha
// chica, o `null` si no hay entrada o la huella no es un cuadrilátero.
const PITCH_INSETS = PROPS.stadiums3d?.pitchInsets || {};
const RING = MATERIALS.street.acera;
function insetPitch(key, pts, F) {
  const I = PITCH_INSETS[key];
  if (!I || !pts || pts.length !== 8) return null;
  let cx = 0, cy = 0;
  for (let i = 0; i < 8; i += 2) { cx += pts[i] / 4; cy += pts[i + 1] / 4; }
  const lines = [];
  for (let i = 0; i < 4; i++) {
    const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[((i + 1) % 4) * 2], by = pts[((i + 1) % 4) * 2 + 1];
    const ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey) || 1;
    let nx = -ey / L, ny = ex / L;
    if (nx * ((ax + bx) / 2 - cx) + ny * ((ay + by) / 2 - cy) < 0) { nx = -nx; ny = -ny; }
    const dir = Math.abs(nx) > Math.abs(ny) ? (nx > 0 ? "east" : "west") : (ny > 0 ? "south" : "north");
    const d = (I[dir] || 0) * PX_PER_M;
    lines.push({ px: ax - nx * d, py: ay - ny * d, ex, ey });
  }
  const out = [];
  for (let i = 0; i < 4; i++) {
    const a = lines[(i + 3) % 4], b = lines[i], den = a.ex * b.ey - a.ey * b.ex;
    const t = ((b.px - a.px) * b.ey - (b.py - a.py) * b.ex) / den;
    out.push(a.px + a.ex * t, a.py + a.ey * t);
  }
  // el marco de la cancha chica: el mismo ángulo, sus medias medidas y su centro sobre ese ángulo
  const ca = Math.cos(F.ang), sa = Math.sin(F.ang);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < 8; i += 2) {
    const u = out[i] * ca + out[i + 1] * sa, v = -out[i] * sa + out[i + 1] * ca;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  const frame = { ...F, cx: um * ca - vm * sa, cy: um * sa + vm * ca, hw: (u1 - u0) / 2, hh: (v1 - v0) / 2, poly: out };
  return { path: flatPath(out, true), frame };
}
const stadiumKey = (S) => (W.LANDMARKS || []).find((l) => l.type === "stadium" && Math.hypot(l.x - S.cx, l.y - S.cy) < 6)?.id;

// Parcel ground. Same reasoning as the estadios: a parcel is a colour choice
// on ground that already exists, painted between the acera band and the
// asphalt — so the asphalt repaints anything that reached the roadway, and
// street pills, buildings and flora still land on top.
//: Ground fill per ParcelUse, from the shared material registry — the editor
//: paints the same table, and `market` being live here and missing there is
//: exactly the drift this file closes.
const PARCEL_FILL = MATERIALS.parcel;
function paintParcels(view, only = null) {
  const arr = W.PARCELS;
  if (!arr || !arr.length) return;
  const deferred = only ? null : new Set((W.STADIUMS || []).flatMap((S) => S.parts || []));
  for (const P of arr) {
    if (only && !only.has(P.id)) continue;
    if (deferred?.has(P.id)) continue;
    // la caja de lo que el lote pinta: la suya y, si trae piso afuera (`floorM.polysM`), la de ese piso — si
    // no, con el lote fuera de cuadro su piso de afuera desaparecía aunque estuviera en pantalla
    const B = P._paintBox || (P._paintBox = paintBox(P));
    if (B.x1 + 40 < view.x0 || B.x0 - 40 > view.x1 || B.y1 + 40 < view.y0 || B.y0 - 40 > view.y1) continue;
    // `whole` = a full cuadra already painted by paintStadiumCuadras; `built` =
    // the footprint IS a building. Either way the ground is not ours to paint,
    // only the sponsor slot on top of it.
    if (P.whole || P.built) continue;
    // un uso apagado en el registro (`parcels.uses.<use>.paint: false` — los patios) no pinta suelo
    if (PROPS.parcels.uses[P.use]?.paint === false) continue;
    // UNA PARCELA QUE ES SU CUERPO (`parcels.byId`) puede traer su PISO (`bodies.<x>.ground`): un
    // rectángulo en metros del marco del lote, en una tinta de la casa — el verde de la UTN, que cubre
    // la cuadra entera y no sólo el lote inscrito
    const own = PROPS.parcels.byId?.[P.id], G = own && PROPS.bodies[own.body]?.ground;
    if (G) { paintOwnGround(P, G); continue; }
    // UNA CANCHA CUADRADA (`parcels.byId.<id>.courtM`): el contorno trazado de un sitio de OSM es a veces
    // un boceto con esquinas biseladas; la cancha se pinta como el rectángulo que dice el registro, en
    // metros del marco del lote, con esquinas vivas. Lo que el contorno tenía de más queda del suelo de
    // abajo (el césped de la plaza)
    // `ground: false`: el lote no pinta suelo — lo cubre el piso de otro (`floorM`) y su borde redondeado
    // caía encima de la cancha
    if (own?.ground === false) continue;
    // `floorM` sin cancha: el piso gris DEBAJO del lote, que asoma alrededor de lo que el lote pinta (el parque
    // de Playitas, corrido de la acera: donde estaba queda la base verde de la plaza si no)
    if (own?.floorM && !own.courtM) paintOwnFloor(P, own.floorM);
    if (own?.courtM) { if (own.floorM) paintOwnFloor(P, own.floorM); paintOwnCourt(P, own.courtM, own.courtTurnDeg || 0); continue; }
    // Preserve the emitted polygon. Raster-owned parcels are vector-straightened
    // by the build (their exact cells still own collision and occupancy), so a
    // diagonal manzana reads as one direct edge instead of 4 px stair steps.
    const hasPolys = P.polys && P.polys.length;
    // …Y REDONDEADA. Se recorta el vértice y NO la arista, así que el frente de
    // la parcela sigue pegado a su calle en todo el largo y sólo se abre en la
    // esquina — donde asoma la acera que `paintRoads` ya dejó pintada debajo,
    // que es lo correcto y además lo que se ve bien. Un contorno de varios
    // anillos (el residual del Parque Marino, las bandas del malecón) mantiene
    // su relleno even-odd: cada anillo se redondea por separado y los agujeros
    // siguen siendo agujeros.
    const path = P._path || (P._path = hasPolys
      ? roundedMultiPath(P.polys, ORGANIC.parcelCornerPx)
      : roundedPath(P.poly, ORGANIC.parcelCornerPx, true));
    // EL COLOR DE ESTA PARCELA, y sólo si no, el de su `use`. Una cancha dura
    // usa cemento tanto en el relleno como en cualquier dilatado del raster.
    const openField = P.use === "plaza" || P.use === "stadium";
    const isCourt = openField && FIELD_SPORT_ROLE.COURT.includes(P.sport);
    // `parcels.byId.<id>.fill`: el lote se pinta con el suelo de OTRO uso (la franja bajo la cancha
    // multiuso de Playitas, que el mundo emite como acera gris y es césped)
    ctx.fillStyle = isCourt ? ST.field.court
      : (own?.fill ? PARCEL_FILL[own.fill] : (P.groundColor || PARCEL_FILL[P.use] || ST.parcel.fallback));
    ctx.lineJoin = "miter";
    if (!hasPolys && !openField) {
      ctx.lineWidth = 8;
      ctx.strokeStyle = ctx.fillStyle; ctx.stroke(path); // hide the 4px raster steps
    }
    // An open field keeps its exact footprint inside the acera; do not dilate
    // its grass or concrete back over the sidewalk to hide raster steps.
    ctx.fill(path, "evenodd");
    // An open field gets the estadio's own painter, in the MANZANA's frame
    // (P.ang) — the markings used to be strokeRect'd off the bbox, which put a
    // square pitch on a slanted block.
    if (P.use === "plaza" || P.use === "stadium") {
      const small = P._small !== undefined ? P._small : (P._small = insetPitch(P.id, P.poly, fieldFrame(P)));
      if (small) { ctx.fillStyle = RING; ctx.fill(path, "evenodd"); paintField(small.path, small.frame, P.sport); }
      else paintField(path, fieldFrame(P), P.sport);
      continue;
    }
    if (P.use === "boulevard") { paintStone(path, P); continue; }
    ctx.strokeStyle = (!own?.fill && P.kerbColor) || ST.parcel.kerb; ctx.lineWidth = 2; ctx.stroke(path); // curb
  }
}

// EL PISO DE UN LOTE (`parcels.byId.<id>.floorM`): un rectángulo en metros de su marco, recortado a la
// huella de la parcela que lo contiene (`within`), en el gris de la acera
// `polysM`: polígonos en metros del marco, SIN recorte — el suelo que queda FUERA de la parcela que lo
// contiene (entre la explanada de la iglesia y la acera de la Calle 6) y que llega hasta el eje de la calle:
// la acera y el asfalto se pintan después y tapan lo que sobre
function paintOwnFloor(P, spec) {
  if (P._floor === undefined) {
    const host = spec.within && (W.PARCELS || []).find((q) => q.id === spec.within);
    const F = parcelFrame(P), ppm = PX_PER_M;
    const c = Math.cos(F.ang), s = Math.sin(F.ang);
    const at = (u, v) => [F.cx + (u * c - v * s) * ppm, F.cy + (u * s + v * c) * ppm];
    let rect = null;
    if (spec.rect && host?.poly) {
      const [u0, v0, u1, v1] = spec.rect;
      rect = { clip: flatPath(host.poly, true), path: flatPath([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)].flat(), true) };
    }
    P._floor = { rect, polys: (spec.polysM || []).map((poly) => flatPath(poly.flatMap(([u, v]) => at(u, v)), true)) };
  }
  ctx.fillStyle = RING;
  for (const poly of P._floor.polys) ctx.fill(poly);
  if (P._floor.rect) { ctx.save(); ctx.clip(P._floor.rect.clip); ctx.fill(P._floor.rect.path); ctx.restore(); }
}

// `turnDeg`: la cancha gira sobre su propio centro respecto del lote — la multiuso de Playitas va al ángulo de
// la acera de la Calle 6, que no es el de la cuadrícula del lote
function paintBox(P) {
  const B = { x0: P.x0, y0: P.y0, x1: P.x1, y1: P.y1 };
  const polys = PROPS.parcels.byId?.[P.id]?.floorM?.polysM;
  if (polys) {
    const F = parcelFrame(P), c = Math.cos(F.ang), s = Math.sin(F.ang), ppm = PX_PER_M;
    for (const poly of polys) for (const [u, v] of poly) {
      const x = F.cx + (u * c - v * s) * ppm, y = F.cy + (u * s + v * c) * ppm;
      B.x0 = Math.min(B.x0, x); B.y0 = Math.min(B.y0, y); B.x1 = Math.max(B.x1, x); B.y1 = Math.max(B.y1, y);
    }
  }
  return B;
}

function paintOwnCourt(P, rectM, turnDeg = 0) {
  if (!P._court) {
    const F = parcelFrame(P), ppm = PX_PER_M, [u0, v0, u1, v1] = rectM;
    const c = Math.cos(F.ang), s = Math.sin(F.ang);
    const [mx, my] = [F.cx + (((u0 + u1) / 2) * c - ((v0 + v1) / 2) * s) * ppm, F.cy + (((u0 + u1) / 2) * s + ((v0 + v1) / 2) * c) * ppm];
    const ang = F.ang + turnDeg * Math.PI / 180, c2 = Math.cos(ang), s2 = Math.sin(ang);
    const hw = (u1 - u0) / 2, hh = (v1 - v0) / 2;
    const at = (u, v) => [mx + (u * c2 - v * s2) * ppm, my + (u * s2 + v * c2) * ppm];
    const pts = [at(-hw, -hh), at(hw, -hh), at(hw, hh), at(-hw, hh)].flat();
    const Q = { cx: mx, cy: my, ang, hw: hw * ppm, hh: hh * ppm, poly: pts };
    P._court = { path: flatPath(pts, true), frame: fieldFrame(Q) };
  }
  paintField(P._court.path, P._court.frame, P.sport);
}

function paintOwnGround(P, G) {
  const F = parcelFrame(P), ppm = PX_PER_M, [u0, v0, u1, v1] = G.rectM;
  ctx.save(); ctx.translate(F.cx, F.cy); ctx.rotate(F.ang);
  ctx.fillStyle = MATERIALS.centro.inks[G.ink] || MATERIALS.centro.missing;
  ctx.fillRect(u0 * ppm, v0 * ppm, (u1 - u0) * ppm, (v1 - v0) * ppm);
  ctx.restore();
}

// A calle peatonal: light-grey paving in a running-bond stone pattern, laid in
// the MANZANA's frame so the courses run with the block, not with the screen.
// It is a colour choice on ground the road pass already laid, exactly like the
// estadio pitches — the surface underneath is Surface.BOULEVARD (transitable),
// and the asphalt pass still repaints anything that reached the roadway.
const STONE = 11;                                  // px per paving stone course
function paintStone(path, P) {
  ctx.save();
  ctx.clip(path, "evenodd");
  const F = parcelFrame(P);
  const R = Math.hypot(F.hw, F.hh) + STONE * 2;
  ctx.translate(F.cx, F.cy); ctx.rotate(F.ang);
  ctx.strokeStyle = ST.stone.joint; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let v = -R; v <= R; v += STONE) {           // courses along the avenidas
    ctx.moveTo(-R, v); ctx.lineTo(R, v);
  }
  // running bond: every other course offset half a stone, so the joints stagger
  let row = 0;
  for (let v = -R; v <= R; v += STONE, row++) {
    const off = row % 2 ? STONE : 0;
    for (let u = -R + off; u <= R; u += STONE * 2) {
      ctx.moveTo(u, v); ctx.lineTo(u, v + STONE);
    }
  }
  ctx.stroke();
  ctx.restore();
  // kerb: a touch darker than the paving so the calle reads as a defined space
  ctx.strokeStyle = ST.stone.kerb; ctx.lineWidth = 2; ctx.stroke(path);
}

// Multi-pass road styling (acera band → casing → asphalt → lane dashes),
// ported from the corridor renderer but fed per-tile road segments.
// LA PROFUNDIDAD DE LA CALLE (`materials.json → street.depth`): cuánto sube la acera y cuánto se hunde
// el caño, en METROS, convertido a la fracción de la altura de la cámara que es lo que el pinhole
// escala.
function roadDepth() {
  const SD = MATERIALS.street.depth, camH = EFFECTS.parallax?.cameraHeightM;
  if (!SD || !camH) return null;
  return { about: [state.cam.x, state.cam.y], aceraK: SD.kerbM / camH, canoK: SD.canoM / camH, face: SD.face, wall: SD.wall };
}

function paintRoads(roads, view) {
  // Parcelas van antes de la acera y los estadios entre acera y asfalto. Esas
  // dos callbacks son geometría mundial; todas las pasadas de la calle viven en
  // el compositor compartido que también ejecuta el fixture del editor.
  // Las texturas se RESUELVEN aquí y se pasan ya hechas: el compositor de la
  // calle vive en `systemShapes.js`, que recibe su `g` por parámetro y no sabe
  // nada de la cámara. `null` es una respuesta y la pasada no ocurre.
  const tex = textureScale();
  paintRoadNetwork(ctx, roads, {
    materials: MATERIALS,
    textures: {
      asphalt: textureFor(ctx, "asphalt", tex),
      acera: textureFor(ctx, "acera", tex),
    },
    sidewalkPx: ACERA_PX,
    canoPx: CANO_PX,
    pathFor: roadPath,
    dashPathFor: dashPath,
    beforeAcera: () => paintParcels(view),
    afterAcera: () => paintStadiumCuadras(view),
    depth: roadDepth(),
  });
}

// Per-tile Ferrocarril rail pieces: ballast bed + ties + two steel rails.
// Decorative (not drivable), drawn on the ground over the roads. Every measure
// is METRES in `materials.json → streets.rails`.
//
// LA VÍA TIENE ALTURA. El balasto se queda plano; el durmiente sube `tieHM` y
// el riel `railHM`, cada punto con su propio paralaje (el pinhole de los
// edificios, `depth.js`), así que la vía se abre hacia afuera del centro de la
// pantalla como todo lo demás. Un riel es un trazo: su costado se pinta como
// capas del piso a la tapa (lo que hace `drawRaisedStroke3d` con la banca
// corrida) y su sombra es el mismo trazo corrido por el sol.
function paintTileRails(rails, view) {
  const R = ST.rails, ppm = PX_PER_M, cam = state.cam;
  const tieHalf = R.tieLenM * ppm / 2, pitch = R.tiePitchM * ppm, gauge = R.gaugeHalfM * ppm;
  const up = (x, y, h) => { if (!(h > 0)) return [x, y]; const o = parallaxOffset(cam, x, y, h, ppm); return [x + o.dx, y + o.dy]; };
  const sun = sunShadow(R.railHM || 0);
  const stroke = (pts, w, ink) => {
    ctx.strokeStyle = ink; ctx.lineWidth = w; ctx.beginPath();
    pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  };
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const rl of rails) {
    if (!rl.aabb) rl.aabb = flatAABB(rl.pts);
    if (!aabbInView(rl.aabb, view, 12)) continue;
    const p = rl.pts;
    // ballast bed
    ctx.strokeStyle = R.ballast; ctx.lineWidth = R.ballastWM * ppm;
    ctx.stroke(rl._path || (rl._path = flatPath(p, false)));
    // los dos rieles, a cada lado del eje: primero los puntos a ras
    const lines = [-gauge, gauge].map((sgn) => {
      const out = [];
      for (let i = 0; i < p.length; i += 2) {
        const ii = i + 2 < p.length ? i : (i >= 2 ? i - 2 : i);
        const dx = (p[ii + 2] ?? p[ii]) - p[ii], dy = (p[ii + 3] ?? p[ii + 1]) - p[ii + 1];
        const len = Math.hypot(dx, dy) || 1, nx = -dy / len * sgn, ny = dx / len * sgn;
        out.push([p[i] + nx, p[i + 1] + ny]);
      }
      return out;
    });
    // la sombra de los rieles, al sol
    if (R.railHM > 0 && sun.alpha > 0) {
      ctx.save(); ctx.globalAlpha = sun.alpha * 0.6;
      for (const ln of lines) stroke(ln.map(([x, y]) => [x + sun.dx, y + sun.dy]), R.railWM * ppm, R.shadow);
      ctx.restore();
    }
    // ties: el costado a ras y la tapa levantada
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i], y0 = p[i + 1], dx = p[i + 2] - x0, dy = p[i + 3] - y0;
      const len = Math.hypot(dx, dy); if (len < 0.001) continue;
      const nx = -dy / len, ny = dx / len;
      for (let s = 0; s < len; s += pitch) {
        const t = s / len, cx = x0 + dx * t, cy = y0 + dy * t;
        if (cx < view.x0 - 8 || cx > view.x1 + 8 || cy < view.y0 - 8 || cy > view.y1 + 8) continue;
        const a = [cx - nx * tieHalf, cy - ny * tieHalf], b = [cx + nx * tieHalf, cy + ny * tieHalf];
        if (R.tieHM > 0) stroke([a, b], R.tieWM * ppm, R.tieSide);
        stroke([up(a[0], a[1], R.tieHM), up(b[0], b[1], R.tieHM)], R.tieWM * ppm, R.ties);
      }
    }
    // two steel rails: el costado en capas, la tapa arriba
    for (const ln of lines) {
      if (R.railHM > 0) for (const f of [0, 0.34, 0.67]) stroke(ln.map(([x, y]) => up(x, y, R.railHM * f)), R.railWM * ppm, R.steelSide);
      stroke(ln.map(([x, y]) => up(x, y, R.railHM)), R.railWM * ppm, R.steel);
    }
  }
}

// Per-tile paseo/León Cortés separator strips: the planted green ground the
// palms/almendros stand on, with a darker soil/curb edge.
//
// TWO STRIPS SIDE BY SIDE ARE ONE MEDIAN. Paseo León Cortés is a dual
// carriageway, so the world emits its separator once per carriageway: two
// parallel strips 11 px apart, each drawn with its own kerb and planted with
// its own row of trees. That reads as two thin medians with a seam down the
// middle, which is not what is there — it is one divider anchored on two rails.
// `medianPairs` finds such a pair and `paintMergedMedian` draws it as a single
// planted band with its two rails marked on it.
//
// This is NOT the Paseo de los Turistas' palm median. That one is a SINGLE
// dashed strip down a single carriageway; it never has a partner within
// PAIR_MAX, so `medianPairs` leaves it alone and it is drawn exactly as before.
//
// WIDTH IS BOUNDED BY THE STAMP. Each strip's collision wall is stamped
// PASEO_MEDIAN_W + 6 (16 px) about its own centreline, so the pair's stamped
// walls overlap into one continuous 27 px wall (11 px apart, ±8 px each). The
// merged band is drawn at sep + m.w (21 px) with a 3 px soil edge — 24 px,
// exactly the union the two 13 px kerbs already covered, and inside the stamp.
// Do not widen it past the stamp: the car would reach drawn-but-unstamped rim
// and the both-ends-blocked snap-back traps it there.
const PAIR_MAX = 26;          // px between the two rails of one divider
const MEDIAN_SOIL = MATERIALS.median.soil;
const MEDIAN_GRASS = MATERIALS.median.grass;
const MEDIAN_RAIL = MATERIALS.median.rail;

// Pair up a tile's median strips. Cached on the tile's median list, since it is
// pure geometry off emitted data. Returns { pairs, singles }; `pairs` carry the
// merged centreline the flora pass plants on.
function medianPairs(tile) {
  if (tile._medPairs) return tile._medPairs;
  const ms = tile.medians || [];
  const taken = new Set(), pairs = [], singles = [];
  for (let i = 0; i < ms.length; i++) {
    if (taken.has(i)) continue;
    for (let j = i + 1; j < ms.length; j++) {
      if (taken.has(j)) continue;
      const sep = railSeparation(ms[i], ms[j]);
      if (sep === null) continue;
      taken.add(i); taken.add(j);
      pairs.push({ a: ms[i], b: ms[j], sep, w: ms[i].w, centre: midPoly(ms[i].pts, ms[j].pts) });
      break;
    }
    if (!taken.has(i)) singles.push(ms[i]);
  }
  return (tile._medPairs = { pairs, singles });
}

// Two strips are one divider only if they run PARALLEL AND CLOSE the whole way:
// sampled across A, every offset to B must be small AND consistent. A pair of
// unrelated strips that happen to touch at one end fails the consistency test.
function railSeparation(A, B) {
  const pts = A.pts, n = pts.length / 2;
  if (n < 3 || B.pts.length < 6) return null;
  let lo = Infinity, hi = 0, sum = 0, k = 0;
  for (let f = 0; f <= 4; f++) {
    const i = Math.min(n - 1, Math.round((f / 4) * (n - 1))) * 2;
    const d = nearestOnPoly(B.pts, pts[i], pts[i + 1]).d;
    if (d > PAIR_MAX || d < 2) return null;
    lo = Math.min(lo, d); hi = Math.max(hi, d); sum += d; k++;
  }
  return hi - lo > 8 ? null : sum / k;
}

// The centreline between two rails: every vertex of A pushed halfway to B.
function midPoly(a, b) {
  const out = [];
  for (let i = 0; i + 1 < a.length; i += 2) {
    const n = nearestOnPoly(b, a[i], a[i + 1]);
    out.push((a[i] + n.x) / 2, (a[i + 1] + n.y) / 2);
  }
  return out;
}

// One divider: a single planted band between the two rails, with the rails
// themselves marked on it as a double anchor line.
function paintMergedMedian(P, view) {
  if (!P._aabb) P._aabb = flatAABB(P.centre);
  const band = P.sep + P.w;
  if (!aabbInView(P._aabb, view, band + 6)) return;
  const path = P._path || (P._path = flatPath(P.centre, false));
  ctx.strokeStyle = MEDIAN_SOIL; ctx.lineWidth = band + 3; ctx.stroke(path);
  ctx.strokeStyle = MEDIAN_GRASS; ctx.lineWidth = band; ctx.stroke(path);
  // the two anchors, on the carriageway centrelines the world actually emitted
  ctx.strokeStyle = MEDIAN_RAIL; ctx.lineWidth = 2;
  for (const m of [P.a, P.b]) ctx.stroke(m._path || (m._path = flatPath(m.pts, false)));
}

function paintTileMedians(tile, view) {
  const { pairs, singles } = medianPairs(tile);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.strokeStyle = MEDIAN_SOIL; // soil / curb edge
  for (const m of singles) {
    if (!m.aabb) m.aabb = flatAABB(m.pts);
    if (!aabbInView(m.aabb, view, m.w + 6)) continue;
    ctx.lineWidth = m.w + 3;
    ctx.stroke(m._path || (m._path = flatPath(m.pts, false)));
  }
  ctx.strokeStyle = MEDIAN_GRASS; // planted grass
  for (const m of singles) {
    if (!aabbInView(m.aabb, view, m.w + 6)) continue;
    ctx.lineWidth = m.w; ctx.stroke(m._path);
  }
  for (const P of pairs) paintMergedMedian(P, view);
  ctx.lineCap = "butt";
}

// Interpolated point + tangent at arclength s along a prepped world-2d road.
function road2dPointAt(r, s) {
  const pts = r.pts, cum = r.cum;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const s0 = cum[i - 1], seg = (cum[i] - s0) || 1;
  const tt = Math.max(0, Math.min(1, (s - s0) / seg));
  const x0 = pts[(i - 1) * 2], y0 = pts[(i - 1) * 2 + 1];
  const x1 = pts[i * 2], y1 = pts[i * 2 + 1];
  return { x: x0 + (x1 - x0) * tt, y: y0 + (y1 - y0) * tt, ang: Math.atan2(y1 - y0, x1 - x0) };
}
// Street names: a small pill every ~900px of arclength on named roads (the
// main-branch feature). Deduped by name+coarse-cell so tile-duplicated road
// copies don't stack labels.
function drawStreetLabels2D(roads, view) {
  ctx.font = "bold 9px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  const seen = new Set();
  for (const r of roads) {
    const lbl = r.name || r.ref;
    if (!lbl || r.len < 200 || r.cls === "pedestrian") continue;
    for (let s = 220; s < r.len; s += 900) {
      const pt = road2dPointAt(r, s);
      if (pt.x < view.x0 - 40 || pt.x > view.x1 + 40 || pt.y < view.y0 - 20 || pt.y > view.y1 + 20) continue;
      const key = lbl + "|" + ((pt.x / 120) | 0) + "|" + ((pt.y / 120) | 0);
      if (seen.has(key)) continue;
      seen.add(key);
      label(pt.x, pt.y + 2, lbl, ST.labels.fg, ST.labels.bg);
    }
  }
}

// ------------------------------------------------------------ barriers ----
// A CLOSURE IS BARRICADES ACROSS THE ROADWAY, NOT A CURTAIN ACROSS THE WORLD.
//
// This used to paint a striped wall down the whole visible height at the
// barrier's x, with cones the entire length: the stripe ran through buildings,
// sand and open sea alike, and read as a screen-door hung over the map. What a
// closed barrio actually looks like is a barricade at the east end of each
// calle that meets the boundary, and nothing at all in between — you can see
// the ground on the far side, you just cannot drive onto it.
//
// So both barrier SHAPES resolve to the same thing: a set of boundary segments
// (a progression barrier is one LINE at `br.x`; the MVP gate is a BOX, and any
// of its four edges may be the one you drove up to), each intersected with the
// roads in view. One barricade per crossing, turned to the street it blocks.
const CONE = ST.barrier.cone;
const TAPE_A = ST.barrier.tapeA, TAPE_B = ST.barrier.tapeB;

// Where two segments cross, or null. Used to find the calles that reach the
// boundary; everything else about a barrier is drawn from these points.
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const r1 = bx - ax, r2 = by - ay, s1 = dx - cx, s2 = dy - cy;
  const den = r1 * s2 - r2 * s1;
  if (!den) return null;
  const tt = ((cx - ax) * s2 - (cy - ay) * s1) / den;
  const uu = ((cx - ax) * r2 - (cy - ay) * r1) / den;
  if (tt < 0 || tt > 1 || uu < 0 || uu > 1) return null;
  return { x: ax + r1 * tt, y: ay + r2 * tt };
}

// Every road piece crossing the boundary segment, with the point, the street's
// heading there and its width. Deduped on a coarse cell: a road that straddles
// a tile edge is stored in BOTH tiles, and two barricades stacked on the same
// calle read as a smear.
function roadCrossings(ax, ay, bx, by, view) {
  const out = [], seen = new Set();
  for (const tile of W.visibleTiles(view.x0, view.y0, view.x1, view.y1)) {
    for (const r of tile.roads) {
      if (!aabbInView(r.aabb, view, r.w + 8)) continue;
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const hit = segCross(p[i], p[i + 1], p[i + 2], p[i + 3], ax, ay, bx, by);
        if (!hit) continue;
        const key = ((hit.x / 10) | 0) + "|" + ((hit.y / 10) | 0);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x: hit.x, y: hit.y, w: r.w,
                   ang: Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]) });
      }
    }
  }
  return out;
}

// One barricade: the striped bar laid ACROSS the lane it closes (drawn in the
// street's own frame, so it turns with a diagonal avenida) and a cone standing
// off each kerb.
function drawBarricade(c) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.ang);                       // +x runs with the street
  const hw = c.w / 2 + 2;                  // just past each kerb
  const segH = 11;
  for (let v = -hw, k = 0; v < hw; v += segH, k++) {
    ctx.fillStyle = k % 2 ? TAPE_A : TAPE_B;
    ctx.fillRect(-4, v, 8, Math.min(segH, hw - v));
  }
  for (const sd of [-1, 1]) {
    const cy = sd * (hw + 4);
    ctx.fillStyle = CONE;
    ctx.beginPath();
    ctx.moveTo(-6, cy + 3 * sd); ctx.lineTo(0, cy - 3 * sd); ctx.lineTo(6, cy + 3 * sd);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = ST.barrier.trestle; ctx.fillRect(-2, cy - 0.5, 4, 1.4);
  }
  ctx.restore();
}

// The sign — the ONLY thing that tells the player why the calle is shut, so it
// stays. One per barrier, on the barricade nearest the middle of the view (so
// it is readable from whichever street you drove up), standing just short of
// the bar on the approach side.
function drawBarrierSign(br, c, view) {
  const dstr = W.DISTRICTS.find((d) => d.id === br.district);
  const dname = dstr ? dstr.name : br.district.toUpperCase();
  const sw = 138, sh = 40;
  const ax = c.x, ay = c.y - c.w / 2 - 6 - sh / 2;
  // The WHOLE sign stands up, board and all — it is a thing hanging in front of
  // you, not a marking on the road, and three lines of rolled text is the
  // clearest way to make a closed street unreadable.
  const stood = upright(ax, ay);
  const sx = stood ? 0 : ax, sy = stood ? 0 : ay;
  ctx.fillStyle = ST.barrier.signBg;
  ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, sh);
  ctx.fillStyle = dstr ? dstr.tone : TAPE_A;
  ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, 4);
  ctx.textAlign = "center";
  ctx.fillStyle = ST.barrier.signTitle; ctx.font = "bold 9px 'JetBrains Mono', monospace";
  ctx.fillText(t("sign.blocked"), sx, sy - 6);
  ctx.fillStyle = ST.barrier.signText; ctx.font = "bold 8px 'JetBrains Mono', monospace";
  ctx.fillText(dname.slice(0, 20), sx, sy + 5);
  ctx.fillStyle = dstr ? dstr.tone : TAPE_A; ctx.font = "bold 8px 'JetBrains Mono', monospace";
  ctx.fillText(br.mvp ? t("sign.soon") : t("sign.level", { n: br.requiredStage || "—" }), sx, sy + 15);
  if (stood) ctx.restore();
}

// The boundary of one barrier as segments, clipped to the view.
function barrierEdges(br, view) {
  if (br.x0 === undefined) {                       // a progression LINE
    if (br.x < view.x0 - 30 || br.x > view.x1 + 30) return [];
    return [[br.x, view.y0, br.x, view.y1]];
  }
  if (br.x1 < view.x0 - 30 || br.x0 > view.x1 + 30) return [];
  if (br.y1 < view.y0 - 30 || br.y0 > view.y1 + 30) return [];
  const { x0, y0, x1, y1 } = br;                   // the MVP BOX: all four sides
  return [[x0, y0, x0, y1], [x1, y0, x1, y1], [x0, y0, x1, y0], [x0, y1, x1, y1]];
}

function drawBarriers(view) {
  if (!state.barriers || !state.barriers.length) return;
  const mid = (view.x0 + view.x1) / 2, midY = (view.y0 + view.y1) / 2;
  for (const br of state.barriers) {
    const crossings = [];
    for (const [ax, ay, bx, by] of barrierEdges(br, view)) {
      for (const c of roadCrossings(ax, ay, bx, by, view)) crossings.push(c);
    }
    if (!crossings.length) continue;               // no calle reaches it here
    // LA VALLA ES UN CUERPO (`furniture3d.js → drawBarricade3d`): tablas, caballetes y conos con altura
    const V3 = ST.barrier.view3d;
    for (const c of crossings) {
      if (V3) drawBarricade3d(c, V3, { tapeA: TAPE_A, tapeB: TAPE_B, cone: CONE });
      else drawBarricade(c);
    }
    let best = crossings[0], bd = Infinity;
    for (const c of crossings) {
      const d = Math.hypot(c.x - mid, c.y - midY);
      if (d < bd) { bd = d; best = c; }
    }
    drawBarrierSign(br, best, view);
  }
}

export { CANO_PX, drawBarriers, drawSigns, medianPairs, paintParcels, drawStreetLabels2D, paintRoads, paintTileMedians, paintTileRails, road2dPointAt };

// ---------------------------------------------------------------- signs ----
// Street furniture, drawn on top of the asphalt. THE ART IS DATA: what used to
// be here was a 10-case `switch` of raw Canvas calls, one per SignKind; what is
// here is a walk over that kind's `parts` in `src/assets/world-props.json`,
// through the same interpreter the vehicle and landmark catalogs use.
//
// This file keeps the one thing a catalog cannot express — THE FRAME. Four of
// the ten sit upright on their post and are drawn in plain pixels around the
// anchor; the other six live inside a rotation by the angle the WORLD measured
// against the kerb (`seat_bus_stops`, the promenade's normal, the lane heading),
// and the parada turns a half-circle more when the roadway is on its far side.
// A bench or a zebra painted square to the screen is one in the wrong street.
function drawSign(s) {
  const rec = SIGNS[s.kind];
  if (!rec) return;                                  // unknown kind: draw nothing
  const vars = { value: String(s.value || 40) };
  // LO QUE TIENE ALTURA, EN 3D (`furniture3d.js`): la señal de poste, la caseta y la banca. La pintura
  // del asfalto (velocidad, cebra, tope) se queda en el piso, que es donde está.
  // el semáforo CUELGA sobre la calle: poste en la acera, brazo y cabezas (`gantry3d`)
  if (rec.gantry3d) return drawGantrySignal3d(rec.gantry3d, s);
  if (!rec.turn && rec.stand3d) return drawPoleSign3d(rec, s.x, s.y, vars);
  if (!rec.turn) { paintAt(rec.parts, s.x, s.y, { g: ctx, pxPerM: PX_PER_M, prop: propParts, vars }); return; }
  const ang = (s.ang || 0) + (rec.flip === "side" && (s.side || 1) < 0 ? Math.PI : 0);
  if (rec.view3d === "parada" && rec.extent) return drawParada(s.x, s.y, ang, rec.extent[0], rec.extent[1]);
  if (rec.view3d && rec.view3d.form === "bench") return drawBench3d(s.x, s.y, ang, rec.view3d);
  ctx.save();
  ctx.translate(s.x, s.y); ctx.rotate(ang);
  const hw = rec.extent ? rec.extent[0] / 2 : 0, hh = rec.extent ? rec.extent[1] / 2 : 0;
  paintParts(ctx, rec.parts, {
    pxPerM: PX_PER_M,
    X: rec.extent ? (v) => evalOn(v, hw) : (v) => v || 0,
    Y: rec.extent ? (v) => evalOn(v, hh) : (v) => v || 0,
    prop: propParts, vars,
  });
  ctx.restore();
}
// One pass over the furniture in view. `W.SIGNS` is eager in the manifest (it
// is small), so this culls by bbox rather than by tile.
function drawSigns(view) {
  const arr = W.SIGNS;
  if (!arr || !arr.length) return;
  for (const s of arr) {
    if (s.x < view.x0 - 20 || s.x > view.x1 + 20 || s.y < view.y0 - 20 || s.y > view.y1 + 20) continue;
    if (s.kind === "banca" && onFeriaDeck(s.x, s.y, 0)) continue;
    drawSign(s);
  }
}
