// LA FERIA DEL PASEO — drawn from a catalog, not from thirteen functions.
//
// The world says WHERE each ride stands (`manifest.attractions`, seated inside
// the campo ferial by `service/attraction.py`); `feriaAssets.json` says WHAT IT
// LOOKS LIKE; and this file is the small interpreter between them. That split
// is the point, and it is the same one the repo already makes for the design
// tokens and the i18n catalogs: the art is the part a person is going to want
// to change, and changing it should not mean editing a render function. An
// engine or the world editor can read the JSON, build a form from it, draw a
// preview and write it back — none of which is possible against a switch
// statement full of `ctx.arc`.
//
// A kind is a list of PARTS, drawn from the ride's centre outward in order, in
// the ride's own frame. Lengths are fractions of `r` unless the field ends in
// `Px`. A part may carry ONE animation — `spin` (turns/sec), `swing` (a
// pendulum about the centre) or `bob` — because a ride that does two things at
// once reads as a glitch at this scale.
//
// Everything here is DRAWN, NEVER STAMPED. The ground under it is the campo
// ferial's raised wooden deck and that is what the car interacts with; a ride
// is scenery you drive around, like a vendor's cart or a parada.
import { WORLD2D as W } from "../../world2d/index.js";
import { aabbInView, ctx, flatMultiPath, hash01 } from "./gfx.js";
import { state } from "../../game/state.js";
import { PX_PER_M } from "../../domain/units.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import { sunShadow } from "./shadows.js";
import { upright } from "./primitives.js";
import { registerLampSource } from "./nightlights.js";
import { paintLight } from "./lights.js";
import { FERIA_SHAPES } from "./feriaShapes.js";
import ASSETS from "./feriaAssets.json";

// LOS VALORES POR OMISIÓN Y EL DECORADO DEL CAMPO. Distinto del resto de las
// paletas del juego, y vale decir por qué: acá los JUEGOS ya eran data desde
// que existe el campo ferial. Lo que seguía en código era lo que dibuja un
// verbo cuando la receta NO trae ese campo (`p.fill || "#dfe5ec"`), así que se
// podía pintar una rueda y no el gris de la que se olvidaron de pintar; y el
// decorado que no es de ningún juego — las guirnaldas, las sombras y la tierra.
const D = ASSETS.$defaults, CH = ASSETS.$chrome;

const TAU = Math.PI * 2;

// Deterministic per-ride phase, so two chocones do not pulse in lockstep and
// nothing shimmers between frames.
function phaseOf(A) { return hash01(A.x * 0.013 + A.y * 0.017) * TAU; }

// ---- the shapes ------------------------------------------------------------
// LOS 28 VERBOS SE MUDARON a `feriaShapes.js`, parametrizados en su superficie.
// Este archivo se queda con lo que de verdad es suyo: DÓNDE va cada juego, con
// qué fase, y el suelo del campo ferial. La tabla se fue porque un catálogo de
// arte que sólo sabe pintar sobre el canvas del juego no se puede meter en una
// hoja sintética ni en la vista previa del editor — y porque escribía en `ctx`
// mientras `paintRide` escribía en `g`, que es cómo la hoja nueva salió con
// 66 164 px de tinta que eran sólo las sombras.
const SHAPES = FERIA_SHAPES;

// ---- one attraction --------------------------------------------------------
/**
 * UN JUEGO, EN EL ORIGEN Y EN LA SUPERFICIE QUE LE DEN.
 *
 * Es el mismo cuerpo que `drawAttraction` corría con el `ctx` compartido, sacado
 * a una función con costura por dos razones concretas: `tools/shot-feria.mjs`
 * necesita dibujar los 16 juegos en una hoja sintética —el campo ferial era el
 * ÚNICO catálogo de arte sin hoja, o sea lo único que no se podía refactorizar
 * con prueba— y el editor necesita previsualizar el juego que está editando con
 * ESTE dibujante y no con uno paralelo.
 *
 * El reloj y la fase entran como parámetros en vez de derivarse acá, que es lo
 * que permite congelarlos: una hoja que se mueve no se puede diffear.
 *
 * `A` es la INSTANCIA, y casi ninguna forma la mira: las cuatro que sí leen
 * `A.food`, que es cuál de sus comidas vende ese chinamo. Por eso el defecto es
 * `{ food: 0 }` y no `null` — con `null` las cuatro reventaban, y un dibujante
 * que sólo funciona dentro de la escena real no sirve ni para una hoja ni para
 * una vista previa.
 */
export function paintRide(g, kind, r, t = 0, ph = 0, A = { food: 0 }) {
  const spec = ASSETS[kind];
  if (!spec || !spec.parts) return;
  if (spec.stage) {
    const S = spec.stage, sh = sunShadow(S.heightM);
    const rotation = (A.ang || 0) + FACING_OFFSET[spec.facing || "+x"];
    const dx = Math.cos(rotation) * sh.dx + Math.sin(rotation) * sh.dy;
    const dy = -Math.sin(rotation) * sh.dx + Math.cos(rotation) * sh.dy;
    g.save();
    g.globalAlpha = sh.alpha;
    g.fillStyle = CH.stageShadow;
    g.fillRect(S.x * r + dx, S.y * r + dy, S.w * r, S.h * r);
    g.restore();
  } else {
    g.fillStyle = CH.rideShadow;
    g.beginPath(); g.ellipse(1, r * 0.28, r * 0.95, r * 0.4, 0, 0, TAU); g.fill();
  }
  for (const part of spec.parts) {
    const draw = SHAPES[part.shape];
    if (!draw) {
      warnMissingShape(part.shape, kind);
      continue;
    }
    g.save();
    const spinA = part.spin ? t * part.spin * TAU + ph : 0;
    if (spinA) g.rotate(spinA);
    if (part.bob) g.translate(0, Math.sin(t * part.bob.speed * TAU + ph) * part.bob.amp);
    draw(g, part, r, t, ph, A, spec, spinA);
    g.restore();
  }
}

//: Cuánto hay que corregir el `ang` del mundo según el eje al que mira el arte.
const FACING_OFFSET = Object.freeze({ "+x": 0, "+y": -Math.PI / 2,
  "-x": Math.PI, "-y": Math.PI / 2 });

function drawAttraction(A, t) {
  const spec = ASSETS[A.kind];
  if (!spec || !spec.parts) return;
  const r = A.r || 24;
  const ph = phaseOf(A);
  ctx.save();
  ctx.translate(A.x, A.y);
  // UNA ATRACCIÓN PUEDE TENER RUMBO. Una rueda o un pulpo giran sobre su eje y
  // no lo necesitan, pero la TARIMA mira al público: el mundo emite la normal
  // hacia la calle y el arte declara su propio eje con `facing`.
  if (A.ang != null) ctx.rotate(A.ang + FACING_OFFSET[spec.facing || "+x"]);
  paintRide(ctx, A.kind, r, t, ph, A);
  ctx.restore();
}

// A catalog this file cannot draw is the failure mode of making the art data:
// someone adds a shape to the JSON (or the editor writes one) and it silently
// does not appear. Say so, once per shape, and carry on drawing the rest of the
// ride. The editor now catches this BEFORE it ships — its validator asks the
// interpreter which verbs exist instead of keeping a copy of the list.
const warnedShapes = new Set();
function warnMissingShape(shape, kind) {
  if (warnedShapes.has(shape)) return;
  warnedShapes.add(shape);
  console.warn(`[feria] no drawer for shape "${shape}" (kind ${kind})`);
}

// EL SUELO DEL TURNO ES UN TABLADO, JUNTO A LA CALLE.
//
// Esto ya pintó dos suelos que no debía: una losa de barro opaca (cuando el
// build estampaba `Surface.BARRO` sobre el paseo y la arena) y un lavado café
// con un canto (cuando el turno cerraba la calzada sur y el suelo ERA la
// calle). Los dos pintaban encima de algo que ya existía.
//
// Ahora sí hay un suelo propio que pintar: `W.FERIA` es el lote que el build
// corta del malecón y estampa como cubierta, pegado al cordón. Se pinta
// DESPUÉS de las calles —su contorno no incluye una sola celda de calzada, así
// que no tapa asfalto— y antes de todo lo que se para encima. La receta es de
// `materials.json -> feria.deck`; aquí sólo va el orden de las pasadas.
const DECK = MATERIALS.feria.deck;
const LIGHTING = MATERIALS.feria.lighting;

function deckColors() { return DECK[state.weather] || DECK.clear; }

let foodStrings = [], foodStringsKey = "";

function feriaStrings() {
  const stalls = (W.ATTRACTIONS || []).filter((A) => A.kind === "chinamo")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const key = stalls.map((A) => `${A.id}:${A.x},${A.y}`).join("|");
  if (key === foodStringsKey) return foodStrings;
  foodStringsKey = key;
  foodStrings = [];
  if (!stalls.length) return foodStrings;
  const margin = LIGHTING.strandMarginM * PX_PER_M;
  const x0 = Math.min(...stalls.map((A) => A.x)) - margin;
  const x1 = Math.max(...stalls.map((A) => A.x)) + margin;
  const rows = [...new Set(stalls.map((A) => A.y))];
  const strandYs = rows.slice(1).map((y, i) => (rows[i] + y) / 2);
  const spacing = LIGHTING.bulbSpacingM * PX_PER_M;
  for (const y of strandYs) {
    const cable = [], bulbs = [];
    for (let i = 0; i <= 20; i++) {
      const q = i / 20;
      cable.push({ x: x0 + (x1 - x0) * q, y: y + LIGHTING.sagPx * 4 * q * (1 - q) });
    }
    const n = Math.max(2, Math.round((x1 - x0) / spacing));
    for (let i = 0; i <= n; i++) {
      const q = i / n, x = x0 + (x1 - x0) * q;
      const wire = { x, y: y + LIGHTING.sagPx * 4 * q * (1 - q) };
      bulbs.push({ x, y: wire.y + 2.4, wire });
    }
    foodStrings.push({ cable, bulbs });
  }
  return foodStrings;
}

let areaLights = [], areaLightsKey = "";

function feriaAreaLights() {
  const rides = (W.ATTRACTIONS || []).filter((A) => A.kind !== "dj" && A.kind !== "chinamo");
  const key = rides.map((A) => `${A.id}:${A.x},${A.y},${A.r},${A.ang || 0}`).join("|");
  if (key === areaLightsKey) return areaLights;
  areaLightsKey = key;
  areaLights = [];
  const grid = rides.filter((A) => A.kind !== "chocones");
  const rows = [];
  for (const A of [...grid].sort((a, b) => a.y - b.y)) {
    const row = rows[rows.length - 1];
    if (row && A.y - row[row.length - 1].y < LIGHTING.rowClusterM * PX_PER_M) row.push(A);
    else rows.push([A]);
  }
  const dj = (W.ATTRACTIONS || []).find((A) => A.kind === "dj");
  const entrance = (W.FERIA || [])[0]?.entrance;
  const clearance = LIGHTING.rowClusterM * PX_PER_M / 2;
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 0; i < row.length - 1; i++) {
      const a = row[i], b = row[i + 1];
      const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
      if (x - a.x < a.r + clearance || b.x - x < b.r + clearance) continue;
      if (dj && Math.hypot(x - dj.x, y - dj.y) < dj.r + clearance * 2) continue;
      if (entrance && Math.abs(x - entrance.x) < entrance.w / 2 + clearance
        && Math.abs(y - entrance.y) < clearance * 2) continue;
      areaLights.push({ x, y, type: "warm", intensity: LIGHTING.areaIntensity });
    }
  }
  const body = ASSETS.chocones.parts.find((p) => p.shape === "box");
  for (const A of rides.filter((ride) => ride.kind === "chocones")) {
    if (!body) continue;
    const c = Math.cos(A.ang || 0), s = Math.sin(A.ang || 0);
    for (const dx of [0, 1]) for (const dy of [0, 1]) {
      const lx = (body.x + body.w * dx) * A.r, ly = (body.y + body.h * dy) * A.r;
      areaLights.push({ x: A.x + lx * c - ly * s, y: A.y + lx * s + ly * c,
        type: "warm", intensity: LIGHTING.areaIntensity });
    }
  }
  return areaLights;
}

function feriaLampsIn(view, pad) {
  const out = [];
  const visible = (p) => p.x >= view.x0 - pad && p.x <= view.x1 + pad && p.y >= view.y0 - pad && p.y <= view.y1 + pad;
  for (const strand of feriaStrings()) {
    for (let i = 0; i < strand.bulbs.length; i += LIGHTING.poolEvery) {
      const b = strand.bulbs[i];
      if (visible(b)) out.push({ x: b.x, y: b.y, type: "warm", intensity: LIGHTING.foodIntensity });
    }
  }
  for (const lamp of feriaAreaLights()) if (visible(lamp)) out.push(lamp);
  return out;
}

function drawFeriaStringLights(view) {
  ctx.save();
  ctx.strokeStyle = LIGHTING.cable;
  ctx.lineWidth = LIGHTING.cablePx;
  ctx.lineCap = "round";
  for (const strand of feriaStrings()) {
    ctx.beginPath();
    strand.cable.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke();
    for (const b of strand.bulbs) {
      if (b.x < view.x0 || b.x > view.x1 || b.y < view.y0 || b.y > view.y1) continue;
      ctx.beginPath(); ctx.moveTo(b.wire.x, b.wire.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.fillStyle = LIGHTING.bulbCore;
      ctx.beginPath(); ctx.arc(b.x, b.y, LIGHTING.bulbPx, 0, TAU); ctx.fill();
    }
  }
  ctx.restore();
}

function drawFeriaAreaLights() {
  for (const lamp of feriaAreaLights()) {
    paintLight(lamp.type, lamp.x, lamp.y, { intensity: lamp.intensity });
  }
}

function drawFeriaNightEffects(view, t, toScreen, zoom) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const strand of feriaStrings()) for (const b of strand.bulbs) {
    if (b.x < view.x0 || b.x > view.x1 || b.y < view.y0 || b.y > view.y1) continue;
    const [x, y] = toScreen(b.x, b.y), r = Math.max(1.2, LIGHTING.bulbPx * zoom);
    ctx.fillStyle = LIGHTING.bulbGlow;
    ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, TAU); ctx.fill();
    ctx.fillStyle = LIGHTING.bulbCore;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  if (state.weather === "night") {
    const laser = LIGHTING.lasers;
    for (const A of W.ATTRACTIONS || []) {
      if (A.kind !== "dj") continue;
      const reach = laser.lengthM * PX_PER_M;
      if (A.x + reach < view.x0 || A.x - reach > view.x1 || A.y + reach < view.y0 || A.y - reach > view.y1) continue;
      const facing = A.ang || 0, sideAxis = facing + Math.PI / 2;
      for (let i = 0; i < laser.count; i++) {
        const side = i % 2 ? 1 : -1, band = Math.floor(i / 2);
        const spread = laser.spread * (band / Math.max(1, laser.count / 2 - 1) - 0.5);
        const a = facing + spread + Math.sin(t * laser.speed * TAU + i * 0.83) * laser.sweep;
        const sx = A.x + Math.cos(sideAxis) * side * A.r * 0.68 - Math.cos(facing) * A.r * 0.35;
        const sy = A.y + Math.sin(sideAxis) * side * A.r * 0.68 - Math.sin(facing) * A.r * 0.35;
        const len = reach * (0.86 + 0.14 * Math.sin(t * 0.7 + i));
        const [x0, y0] = toScreen(sx, sy);
        const [x1, y1] = toScreen(sx + Math.cos(a) * len, sy + Math.sin(a) * len);
        ctx.strokeStyle = laser.colors[i % laser.colors.length];
        ctx.lineCap = "round";
        ctx.globalAlpha = 0.15; ctx.lineWidth = laser.haloWidthPx;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.globalAlpha = 0.88; ctx.lineWidth = laser.widthPx;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.fillStyle = laser.colors[i % laser.colors.length];
        ctx.beginPath(); ctx.arc(x1, y1, 2.2, 0, TAU); ctx.fill();
      }
    }
  }
  ctx.restore();
}

/** La baranda de un anillo del contorno: tramos entre postes, con un HUECO en
 *  la boca de la entrada. Devuelve los postes; los tramos se trazan en `g`. */
function railRing(g, ring, gate, step) {
  const posts = [];
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2], ay = ring[i * 2 + 1];
    const bx = ring[((i + 1) % n) * 2], by = ring[((i + 1) % n) * 2 + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) continue;
    const k = Math.max(1, Math.round(len / step));
    let pen = false;
    for (let j = 0; j <= k; j++) {
      const x = ax + (bx - ax) * (j / k), y = ay + (by - ay) * (j / k);
      const open = gate && Math.hypot(x - gate.x, y - gate.y) < gate.w / 2 + 1;
      if (open) { pen = false; continue; }
      if (pen) g.lineTo(x, y); else g.moveTo(x, y);
      pen = true;
      posts.push(x, y);
    }
  }
  return posts;
}

/** LOS PILOTES quedan medio salidos del canto: el piso se pinta después y tapa
 *  su mitad interior, dejando la cabeza y la sombra visibles bajo el tablado. */
function drawFeriaPilings(L, C, sh) {
  const step = DECK.pileM * PX_PER_M, rad = DECK.pilePx;
  for (const ring of L.polys) {
    const n = ring.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = ring[i * 2], ay = ring[i * 2 + 1];
      const bx = ring[((i + 1) % n) * 2], by = ring[((i + 1) % n) * 2 + 1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1) continue;
      const k = Math.max(1, Math.round(len / step));
      for (let j = 0; j < k; j++) {
        const x = ax + (bx - ax) * (j / k), y = ay + (by - ay) * (j / k);
        const dx = x - L.cx, dy = y - L.cy, d = Math.hypot(dx, dy) || 1;
        const px = x + dx / d * DECK.pileOffsetPx, py = y + dy / d * DECK.pileOffsetPx;
        ctx.fillStyle = C.shadow;
        ctx.beginPath(); ctx.ellipse(px + sh.dx * 0.7, py + sh.dy * 0.7, rad * 1.15, rad * 0.75, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = DECK.pile;
        ctx.beginPath(); ctx.arc(px, py, rad, 0, TAU); ctx.fill();
        ctx.fillStyle = DECK.pileCap;
        ctx.beginPath(); ctx.arc(px - 1, py - 1, rad * 0.55, 0, TAU); ctx.fill();
      }
    }
  }
}

function drawFeriaDeck(view) {
  const lots = W.FERIA;
  if (!lots || !lots.length) return;
  for (const L of lots) {
    if (!L.polys || !L.polys.length) continue;
    if (!L._aabb) L._aabb = { x0: L.x0, y0: L.y0, x1: L.x1, y1: L.y1 };
    if (!aabbInView(L._aabb, view, 60)) continue;
    if (!L._path) L._path = flatMultiPath(L.polys);
    if (!L._ramp && L.ramp && L.ramp.length) L._ramp = flatMultiPath(L.ramp);
    const C = deckColors();
    const plank = DECK.plankM * PX_PER_M, joist = DECK.joistM * PX_PER_M;
    // ESTÁ EN EL AIRE: la sombra cae al paseo, con el sol y con su altura. Es lo
    // que lo despega del suelo — sin ella es un rectángulo café sobre el malecón.
    const sh = sunShadow(DECK.heightM);
    ctx.save();
    ctx.translate(sh.dx, sh.dy);
    ctx.fillStyle = C.shadow;
    ctx.fill(L._path, "evenodd");
    if (L._ramp) ctx.fill(L._ramp, "evenodd");
    ctx.restore();
    drawFeriaPilings(L, C, sh);
    ctx.save();
    ctx.translate(0, DECK.facePx);
    ctx.fillStyle = C.fascia;
    ctx.fill(L._path, "evenodd");
    ctx.restore();
    // la rampa: tablas más claras, del cordón a la boca
    if (L._ramp) { ctx.fillStyle = C.ramp; ctx.fill(L._ramp, "evenodd"); }
    ctx.fillStyle = C.plank;
    ctx.fill(L._path, "evenodd");
    ctx.save();
    ctx.clip(L._path, "evenodd");
    // en el marco del lote: u a lo largo de la calle, v mar adentro
    ctx.translate(L.cx, L.cy); ctx.rotate(L.ang || 0);
    const hu = (L.x1 - L.x0) * 0.6 + 40, hv = (L.y1 - L.y0) * 0.6 + 40;
    const n = Math.ceil(hu / plank);
    ctx.fillStyle = C.plankAlt;
    for (let i = -n; i <= n; i += 2) ctx.fillRect(i * plank, -hv, plank, hv * 2);
    ctx.strokeStyle = C.seam; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -n; i <= n; i++) { ctx.moveTo(i * plank, -hv); ctx.lineTo(i * plank, hv); }
    ctx.stroke();
    ctx.strokeStyle = C.joist; ctx.lineWidth = 2;
    ctx.beginPath();
    for (let v = -Math.ceil(hv / joist) * joist; v <= hv; v += joist) { ctx.moveTo(-hu, v); ctx.lineTo(hu, v); }
    ctx.stroke();
    ctx.restore();
    // el canto: la tabla de frente que tapa la estructura
    ctx.strokeStyle = C.fascia; ctx.lineWidth = DECK.fasciaPx; ctx.lineJoin = "round";
    ctx.stroke(L._path);
    // LA BARANDA, alrededor de todo menos de la boca. Sigue el contorno que el
    // mundo emitió, que es también donde el carro deja de poder pasar: lo que
    // se ve como baranda ES la pared.
    const gate = L.entrance || null;
    ctx.beginPath();
    let posts = [];
    for (const ring of L.polys) posts = posts.concat(railRing(ctx, ring, gate, DECK.postM * PX_PER_M));
    if (gate) {
      // los dos pasamanos de la rampa, de la boca hacia la calle
      const tx = Math.cos(L.ang || 0), ty = Math.sin(L.ang || 0);
      const [sx, sy] = L.sea || [0, 1];
      for (const side of [-1, 1]) {
        const x = gate.x + tx * side * gate.w / 2, y = gate.y + ty * side * gate.w / 2;
        ctx.moveTo(x, y); ctx.lineTo(x - sx * gate.len * 0.7, y - sy * gate.len * 0.7);
        posts.push(x, y, x - sx * gate.len * 0.7, y - sy * gate.len * 0.7);
      }
    }
    ctx.lineCap = "round";
    ctx.save();
    ctx.translate(sh.dx * 0.35, sh.dy * 0.35);
    ctx.strokeStyle = C.shadow; ctx.lineWidth = DECK.railPx + 1; ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = C.rail; ctx.lineWidth = DECK.railPx; ctx.stroke();
    ctx.fillStyle = C.post;
    const ps = DECK.postPx;
    for (let i = 0; i < posts.length; i += 2) ctx.fillRect(posts[i] - ps / 2, posts[i + 1] - ps / 2, ps, ps);
  }
}

/** EL CARTEL, SOBRE EL TRAMO DE LA RAMPA QUE DA A LA CALLE. `rampFraction`
 *  lo acerca a la boca sin devolverlo al interior: desde el Paseo se lee el
 *  nombre antes de subir. El carro pasa por DEBAJO del rótulo, que se endereza
 *  contra la cámara como todo texto. */
function drawFeriaSign(L, view) {
  const gate = L.entrance;
  if (!gate || !L.sign) return;
  const [sx, sy] = L.sea || [0, 1];
  const C = deckColors(), S = DECK.sign;
  const along = S.rampFraction ?? 1;
  const x = gate.x - sx * gate.len * along, y = gate.y - sy * gate.len * along;
  if (x < view.x0 - 200 || x > view.x1 + 200 || y < view.y0 - 200 || y > view.y1 + 200) return;
  const tx = Math.cos(L.ang || 0), ty = Math.sin(L.ang || 0);
  const H = S.postHeightM * PX_PER_M, B = S.boardM * PX_PER_M;
  const ax = x - tx * gate.w / 2, ay = y - ty * gate.w / 2;
  const bx = x + tx * gate.w / 2, by = y + ty * gate.w / 2;
  const sh = sunShadow(S.postHeightM);
  // la sombra del arco, tirada en el suelo
  ctx.strokeStyle = C.shadow; ctx.lineWidth = S.postPx; ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(ax + sh.dx, ay + sh.dy);
  ctx.lineTo(bx + sh.dx, by + sh.dy); ctx.lineTo(bx, by);
  ctx.stroke();
  // los postes, en alzado
  ctx.strokeStyle = C.signPost;
  ctx.beginPath();
  ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - H);
  ctx.moveTo(bx, by); ctx.lineTo(bx, by - H);
  ctx.stroke();
  // el rótulo, entre las dos puntas
  ctx.beginPath();
  const ox = tx * S.overhangM * PX_PER_M, oy = ty * S.overhangM * PX_PER_M;
  ctx.moveTo(ax - ox, ay - oy - H); ctx.lineTo(bx + ox, by + oy - H);
  ctx.lineTo(bx + ox, by + oy - H + B); ctx.lineTo(ax - ox, ay - oy - H + B);
  ctx.closePath();
  ctx.fillStyle = C.signBoard; ctx.fill();
  ctx.strokeStyle = C.signTrim; ctx.lineWidth = 1.2; ctx.lineJoin = "round"; ctx.stroke();
  const mx = (ax + bx) / 2, my = (ay + by) / 2 - H + B / 2;
  const stood = upright(ctx, mx, my);
  ctx.font = `${(S.fontM * PX_PER_M).toFixed(2)}px '${S.font}', sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillStyle = C.signInk;
  ctx.fillText(L.sign, stood ? 0 : mx, (stood ? 0 : my) + 0.4);
  ctx.textBaseline = "alphabetic";
  if (stood) ctx.restore();
}

function drawAttractions(view, t) {
  const arr = W.ATTRACTIONS;
  drawFeriaStringLights(view);
  for (const L of W.FERIA || []) drawFeriaSign(L, view);
  if (!arr || !arr.length) return;
  for (const A of arr) {
    const pad = (A.r || 24) * 2 + 30;
    if (A.x + pad < view.x0 || A.x - pad > view.x1
      || A.y + pad < view.y0 || A.y - pad > view.y1) continue;
    drawAttraction(A, t);
  }
  drawFeriaAreaLights();
}

registerLampSource(feriaLampsIn);

export { drawAttractions, drawFeriaDeck, drawFeriaNightEffects };
