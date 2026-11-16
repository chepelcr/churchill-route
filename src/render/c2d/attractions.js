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
import { aabbInView, blendPalette, ctx, flatMultiPath, hash01, mixColor } from "./gfx.js";
import { lightLevel, nightLevel } from "../../game/daynight.js";
import { PX_PER_M } from "../../domain/units.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import PROPS from "../../assets/world-props.json" with { type: "json" };
import { bodyAt, queueBody, queueBodyLike } from "./bodies.js";
import { parallaxOffset } from "./depth.js";
import { makeRig } from "./rig3d.js";
import { FERIA_FORMS, bumperCar } from "./feriaRigs.js";
import { state } from "../../game/state.js";
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

// EL CHINAMO ES EL TOLDO DE UN QUIOSCO. Se levanta con el mismo pintor 2.5D que los quioscos del juego
// (`world-props.json → bodies.chinamo`): sólo su techo a rayas, en los colores de su comida, sin rótulo. El arte plano de `feriaAssets.json → chinamo` queda para la hoja de la
// feria y el editor (`paintRide`).
function queueChinamo(A) {
  const food = foodOf(A), spec = PROPS.bodies.chinamo;
  // el arte plano del chinamo mira a +y; el cuerpo pone su frente en +v, que con este giro queda
  // del lado contrario: se le suma media vuelta para que el mostrador dé al pasillo de la feria
  const ang = (A.ang || 0) + FACING_OFFSET[ASSETS.chinamo.facing || "+x"] + Math.PI;
  queueBody(bodyAt(spec, A.x, A.y, ang, `chinamo:${A.food}`),
    { body: KIOSK.chinamoBody, awning: food.accent, awning2: food.ink });
}
function foodOf(A) {
  const foods = ASSETS.chinamo.foods, keys = Object.keys(foods);
  return foods[A.food] || foods[keys[(Number(A.food) || 0) % keys.length]];
}
const KIOSK = PROPS.landmarks.kiosk.chinamo;

function drawAttraction(A, t) {
  const spec = ASSETS[A.kind];
  if (!spec || !spec.parts) return;
  if (A.kind === "chinamo" && PROPS.bodies?.chinamo) { queueChinamo(A); return; }
  const r = A.r || 24;
  const ph = phaseOf(A);
  if (V3 && (!spec.stage || spec.view3d?.form)) { drawRide3d(A, spec, r, t, ph); return; }
  ctx.save();
  ctx.translate(A.x, A.y);
  // UNA ATRACCIÓN PUEDE TENER RUMBO. Una rueda o un pulpo giran sobre su eje y
  // no lo necesitan, pero la TARIMA mira al público: el mundo emite la normal
  // hacia la calle y el arte declara su propio eje con `facing`.
  if (A.ang != null) ctx.rotate(A.ang + FACING_OFFSET[spec.facing || "+x"]);
  paintRide(ctx, A.kind, r, t, ph, A);
  ctx.restore();
}

// ---- LA FERIA EN 2.5D -------------------------------------------------------
// `paintRide` sigue siendo el arte PLANO (la hoja de la feria y el editor lo usan); en el mundo cada
// juego se levanta con la cámara, igual que los edificios. Todo lo que se puede afinar está en
// `feriaAssets.json → $view3d` y en el `liftM`/`baseM` de cada pieza; acá queda la geometría.
const V3 = ASSETS.$view3d;
const isInk = (v) => typeof v === "string" && (v[0] === "#" || v.startsWith("rgb"));
// la misma pieza en otra tinta: cada color que trae se pasa por `fn` (el costado la oscurece, la
// sombra la vuelve una sola tinta). Se agregan `fill`/`stroke` por si el verbo cae a su omisión.
const inkCache = new WeakMap();
function inked(part, key, fn) {
  let m = inkCache.get(part);
  if (!m) inkCache.set(part, (m = new Map()));
  if (m.has(key)) return m.get(key);
  const walk = (v) => isInk(v) ? fn(v) : Array.isArray(v) ? v.map(walk)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v;
  const out = walk(part);
  if (out.fill == null) out.fill = fn(D.box);
  if (out.stroke == null) out.stroke = fn(D.arms);
  m.set(key, out);
  return out;
}
const sideOf = (part) => inked(part, "side", (c) => mixColor(c, V3.sideInk, V3.sideK));
const shadowOf = (part) => inked(part, "shadow", () => V3.shadowInk);

function drawPart(g, part, r, t, ph, A, spec) {
  const draw = SHAPES[part.shape];
  if (!draw) { warnMissingShape(part.shape, A.kind); return; }
  g.save();
  const spinA = part.spin ? t * part.spin * TAU + ph : 0;
  if (spinA) g.rotate(spinA);
  if (part.bob) g.translate(0, Math.sin(t * part.bob.speed * TAU + ph) * part.bob.amp);
  draw(g, part, r, t, ph, A, spec, spinA);
  g.restore();
}

// el lienzo de las sombras: una por juego, opaca, y se compone con alfa de una sola vez
let shadowCanvas = null;
function shadowLayer(w, h) {
  if (!shadowCanvas) shadowCanvas = document.createElement("canvas");
  if (shadowCanvas.width < w) shadowCanvas.width = Math.ceil(w);
  if (shadowCanvas.height < h) shadowCanvas.height = Math.ceil(h);
  return shadowCanvas;
}

// la sombra de un juego: se dibuja OPACA en su propio lienzo (del tamaño del juego en pantalla) y se
// compone con alfa una sola vez, así no se oscurece donde dos piezas se cruzan
function withShadow(A, r, alpha, draw) {
  const m = ctx.getTransform(), sc = Math.hypot(m.a, m.b), c = m.transformPoint({ x: A.x, y: A.y });
  const R = r * (ASSETS[A.kind].view3d?.boundsK ?? V3.boundsK) * sc, bx = Math.floor(c.x - R), by = Math.floor(c.y - R), w = Math.ceil(2 * R), h = w;
  const cv = shadowLayer(w, h), g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
  g.setTransform(m.a, m.b, m.c, m.d, m.e - bx, m.f - by);
  draw(g);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = alpha;
  ctx.drawImage(cv, 0, 0, w, h, bx, by, w, h); ctx.restore();
}

const SHADE = () => ({ ...V3.shade, shadow: V3.shadowInk });

function drawRide3d(A, spec, r, t, ph) {
  const ppm = PX_PER_M, rot = A.ang != null ? A.ang + FACING_OFFSET[spec.facing || "+x"] : 0;
  const ca = Math.cos(-rot), sa = Math.sin(-rot);
  const local = (o) => [o.dx * ca - o.dy * sa, o.dx * sa + o.dy * ca];
  // cuánto se corre algo a `hM` metros: cada altura pasa por `parallaxOffset`, con su TOPE, igual que
  // los edificios (lineal sin tope, la rueda en la orilla de la vista se estiraba cien píxeles)
  const lift = (hM) => local(parallaxOffset(state.cam, A.x, A.y, hM, ppm));
  const sun = sunShadow(1), V = spec.view3d || {}, rM = r / ppm;
  const signs = spec.parts.filter((p) => p.shape === "sign");
  const enter = (g) => { g.translate(A.x, A.y); if (rot) g.rotate(rot); };
  const drawSigns = () => { ctx.save(); enter(ctx); for (const p of signs) drawPart(ctx, p, r, t, ph, A, spec); ctx.restore(); };
  const lit = sun.alpha > 0 && (sun.dx || sun.dy);

  // ── UNA FORMA: la geometría del juego, en metros, la arma `feriaRigs.js` ──
  const form = V.form && FERIA_FORMS[V.form];
  if (form) {
    const run = (g, mode) => { const R = makeRig(g, A.x, A.y, rot, ppm, state.cam, mode, SHADE(), V.topM ?? V3.topM); form(R, { rM, t, ph, V, A }); R.flush(); };
    if (lit) withShadow(A, r, sun.alpha * V3.shadowAlpha, (g) => run(g, "sun"));
    queueBodyLike({ x: A.x, y: A.y, paint: () => { run(ctx, "cam"); drawSigns(); } });
    return;
  }

  // ── POR PIEZAS: cada una es un piso a `liftM`, con costados desde `baseM` ──
  const parts = spec.parts.filter((p) => p.shape !== "sign" && !(V.car && p.shape === "cars"));
  const casters = parts.filter((p) => !V3.noShadow.includes(p.shape));
  const carPart = V.car && spec.parts.find((p) => p.shape === "cars");
  // los carritos chocones: el mismo recorrido que el arte plano (`cars`), cada uno un carrito en 3D
  const drawCars = (g, mode) => {
    if (!carPart) return;
    const R = makeRig(g, A.x, A.y, rot, ppm, state.cam, mode, SHADE(), V3.topM), p = carPart;
    const n = p.n || 6, w = (p.areaW || 1.6) * r, h = (p.areaH || 0.9) * r;
    for (let i = 0; i < n; i++) {
      const s = hash01(i * 3.7 + ph) * TAU;
      const x = Math.cos(t * (p.speed || 0.5) + s) * w * 0.4, y = Math.sin(t * (p.speed || 0.5) * 1.3 + s * 1.7) * h * 0.34;
      bumperCar(R, x / ppm, y / ppm, Math.sin(t * 0.7 + s) * 0.9, p.liftM || 0, p.palette[i % p.palette.length], V.car, i, t);
    }
    R.flush();
  };
  if (lit) withShadow(A, r, sun.alpha * V3.shadowAlpha, (g) => {
    g.save(); enter(g);
    for (const p of casters) {
      const top = p.liftM || 0;
      if (top <= 0) continue;
      const b = p.baseM ?? top, n = b < top ? 3 : 1;
      for (let k = 0; k < n; k++) {
        const hM = n > 1 ? b + (top - b) * k / (n - 1) : top, o = local({ dx: sun.dx * hM, dy: sun.dy * hM });
        g.save(); g.translate(o[0], o[1]); drawPart(g, shadowOf(p), r, t, ph, A, spec); g.restore();
      }
    }
    g.restore();
    drawCars(g, "sun");     // el aparejo lleva su propio marco de mundo
  });

  // ── lo que se levanta va con los cuerpos: encima de la gente que pasa por debajo ──
  const paint = () => {
    ctx.save(); enter(ctx);
    const order = parts.map((p, i) => [p, i]).sort((a, b) => (a[0].liftM || 0) - (b[0].liftM || 0) || a[1] - b[1]);
    for (const [p] of order) {
      const top = p.liftM || 0;
      if (p.baseM != null && p.baseM < top) {
        const n = Math.min(V3.maxSteps, Math.max(2, Math.ceil((top - p.baseM) * V3.extrudePerM)));
        for (let k = 0; k < n; k++) {
          const o = lift(p.baseM + (top - p.baseM) * k / n);
          ctx.save(); ctx.translate(o[0], o[1]); drawPart(ctx, sideOf(p), r, t, ph, A, spec); ctx.restore();
        }
      }
      const o = lift(top);
      ctx.save(); ctx.translate(o[0], o[1]); drawPart(ctx, p, r, t, ph, A, spec); ctx.restore();
    }
    ctx.restore();
    drawCars(ctx, "cam");
    for (const strand of feriaStrings()) if (strand.owner === A.id) drawStrand(strand);
    drawSigns();
  };
  queueBodyLike({ x: A.x, y: A.y, paint });
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

function deckColors() { return blendPalette(DECK, "clear"); }

let foodStrings = [], foodStringsKey = "";

function feriaStrings() {
  const attractions = W.ATTRACTIONS || [];
  const stalls = attractions.filter((A) => A.kind === "chinamo")
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const bumperCars = attractions.filter((A) => A.kind === "chocones");
  const key = [...stalls, ...bumperCars]
    .map((A) => `${A.id}:${A.x},${A.y},${A.r},${A.ang || 0}`).join("|");
  if (key === foodStringsKey) return foodStrings;
  foodStringsKey = key;
  foodStrings = [];

  // UNA GUIRNALDA CUELGA EN EL AIRE: de un poste a otro a `hangM` de alto, con su comba HACIA ABAJO
  // (`sagM`, en metros de alto, no hacia abajo de la pantalla). Se guarda en planta; la cámara la
  // levanta en cada cuadro (`strandAt`). El bombillo, en planta, es donde cae su pozo de luz.
  const addString = (a, b, sagM, spacing, intensity, poolEvery, hangM, owner = null) => {
    const bulbs = [];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(2, Math.round(length / spacing));
    for (let i = 0; i <= n; i++) {
      const q = i / n;
      bulbs.push({ x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, q });
    }
    foodStrings.push({ a, b, sagM, hangM, bulbs, intensity, poolEvery, owner });
  };

  if (stalls.length) {
    const margin = LIGHTING.strandMarginM * PX_PER_M;
    const x0 = Math.min(...stalls.map((A) => A.x)) - margin;
    const x1 = Math.max(...stalls.map((A) => A.x)) + margin;
    const rows = [...new Set(stalls.map((A) => A.y))];
    const strandYs = rows.slice(1).map((y, i) => (rows[i] + y) / 2);
    for (const y of strandYs) addString({ x: x0, y }, { x: x1, y },
      LIGHTING.sagM, LIGHTING.bulbSpacingM * PX_PER_M,
      LIGHTING.foodIntensity, LIGHTING.poolEvery, LIGHTING.hangM);
  }

  const body = ASSETS.chocones.parts.find((p) => p.shape === "box");
  if (body) for (const A of bumperCars) {
    const c = Math.cos(A.ang || 0), s = Math.sin(A.ang || 0), m = LIGHTING.choconesMarginPx;
    const corners = [[body.x - m / A.r, body.y - m / A.r],
      [body.x + body.w + m / A.r, body.y - m / A.r],
      [body.x + body.w + m / A.r, body.y + body.h + m / A.r],
      [body.x - m / A.r, body.y + body.h + m / A.r]]
      .map(([x, y]) => ({ x: A.x + (x * c - y * s) * A.r,
        y: A.y + (x * s + y * c) * A.r }));
    for (let i = 0; i < corners.length; i++) addString(corners[i], corners[(i + 1) % corners.length],
      LIGHTING.choconesSagM, LIGHTING.choconesBulbSpacingM * PX_PER_M,
      LIGHTING.choconesIntensity, LIGHTING.choconesPoolEvery, LIGHTING.choconesHangM, A.id);
  }
  return foodStrings;
}

let areaLights = [], areaLightsKey = "";

function feriaAreaLights() {
  const rides = (W.ATTRACTIONS || []).filter((A) => !["dj", "chinamo", "chocones"].includes(A.kind));
  const key = rides.map((A) => `${A.id}:${A.x},${A.y},${A.r},${A.ang || 0}`).join("|");
  if (key === areaLightsKey) return areaLights;
  areaLightsKey = key;
  areaLights = [];
  const rows = [];
  for (const A of [...rides].sort((a, b) => a.y - b.y)) {
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
  return areaLights;
}

function feriaLightPilings(L) {
  const gate = L.entrance;
  if (!gate) return feriaPilings(L);
  return feriaPilings(L).filter((p) => Math.hypot(p.x - gate.x, p.y - gate.y) >= gate.w / 2 + 1);
}

function feriaLampsIn(view, pad) {
  const out = [];
  const visible = (p) => p.x >= view.x0 - pad && p.x <= view.x1 + pad && p.y >= view.y0 - pad && p.y <= view.y1 + pad;
  for (const strand of feriaStrings()) {
    for (let i = 0; i < strand.bulbs.length; i += strand.poolEvery) {
      const b = strand.bulbs[i];
      if (visible(b)) out.push({ x: b.x, y: b.y, type: "warm", intensity: strand.intensity });
    }
  }
  for (const lamp of feriaAreaLights()) if (visible(lamp)) out.push(lamp);
  for (const L of W.FERIA || []) for (const pile of feriaLightPilings(L)) {
    if (visible(pile)) out.push({ x: pile.x, y: pile.y, type: "pile", intensity: LIGHTING.pileIntensity });
  }
  return out;
}

// un punto de la guirnalda a la fracción `q`, `dropM` por debajo del cable, ya levantado por la cámara
function strandAt(st, q, dropM = 0) {
  const x = st.a.x + (st.b.x - st.a.x) * q, y = st.a.y + (st.b.y - st.a.y) * q;
  const h = st.hangM - st.sagM * 4 * q * (1 - q) - dropM, o = parallaxOffset(state.cam, x, y, h, PX_PER_M);
  return [x + o.dx, y + o.dy];
}

// la guirnalda: sus dos postes, el cable con su comba y los bombillos colgando un poco más abajo
function drawStrand(st) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = LIGHTING.post; ctx.lineWidth = LIGHTING.postPx;
  for (const e of [st.a, st.b]) {
    const o = parallaxOffset(state.cam, e.x, e.y, st.hangM + LIGHTING.postTopM, PX_PER_M);
    ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + o.dx, e.y + o.dy); ctx.stroke();
  }
  ctx.strokeStyle = LIGHTING.cable; ctx.lineWidth = LIGHTING.cablePx;
  ctx.beginPath();
  for (let i = 0; i <= 20; i++) { const p = strandAt(st, i / 20); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); }
  ctx.stroke();
  ctx.fillStyle = LIGHTING.bulbCore;
  for (const b of st.bulbs) {
    const w = strandAt(st, b.q), p = strandAt(st, b.q, LIGHTING.bulbDropM);
    ctx.beginPath(); ctx.moveTo(w[0], w[1]); ctx.lineTo(p[0], p[1]); ctx.stroke();
    ctx.beginPath(); ctx.arc(p[0], p[1], LIGHTING.bulbPx, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

// las guirnaldas de la comida van con los cuerpos (encima de la gente); las de los chocones las pinta
// su propio juego, DESPUÉS de la pista, o la pista las tapaba
function drawFeriaStringLights(view) {
  for (const strand of feriaStrings()) {
    if (strand.owner) continue;
    const x0 = Math.min(strand.a.x, strand.b.x), x1 = Math.max(strand.a.x, strand.b.x);
    if (x1 < view.x0 || x0 > view.x1 || Math.max(strand.a.y, strand.b.y) < view.y0 - 40 || Math.min(strand.a.y, strand.b.y) > view.y1 + 40) continue;
    queueBodyLike({ x: (strand.a.x + strand.b.x) / 2, y: (strand.a.y + strand.b.y) / 2, paint: () => drawStrand(strand) });
  }
}

function drawFeriaAreaLights() {
  for (const lamp of feriaAreaLights()) {
    paintLight(lamp.type, lamp.x, lamp.y, { intensity: lamp.intensity });
  }
  for (const L of W.FERIA || []) for (const pile of feriaLightPilings(L)) {
    paintLight("pile", pile.x, pile.y, { intensity: LIGHTING.pileIntensity });
  }
}

function drawFeriaNightEffects(view, t, toScreen, zoom) {
  const lamps = lightLevel(), night = nightLevel();
  if (lamps <= 0.001) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = lamps;
  for (const strand of feriaStrings()) for (const b of strand.bulbs) {
    if (b.x < view.x0 || b.x > view.x1 || b.y < view.y0 || b.y > view.y1) continue;
    const at = strandAt(strand, b.q, LIGHTING.bulbDropM);
    const [x, y] = toScreen(at[0], at[1]), r = Math.max(1.2, LIGHTING.bulbPx * zoom);
    ctx.fillStyle = LIGHTING.bulbGlow;
    ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, TAU); ctx.fill();
    ctx.fillStyle = LIGHTING.bulbCore;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  if (night > 0.001) {
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
        ctx.globalAlpha = night * 0.15; ctx.lineWidth = laser.haloWidthPx;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.globalAlpha = night * 0.88; ctx.lineWidth = laser.widthPx;
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

const pilingsByLot = new WeakMap();

function feriaPilings(L) {
  const cached = pilingsByLot.get(L);
  if (cached) return cached;
  const piles = [], step = DECK.pileM * PX_PER_M;
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
        piles.push({ x: x + dx / d * DECK.pileOffsetPx, y: y + dy / d * DECK.pileOffsetPx });
      }
    }
  }
  pilingsByLot.set(L, piles);
  return piles;
}

/** LOS PILOTES quedan medio salidos del canto: el piso se pinta después y tapa
 *  su mitad interior, dejando la cabeza y la sombra visibles bajo el tablado. */
function drawFeriaPilings(L, C, sh) {
  const rad = DECK.pilePx;
  for (const { x: px, y: py } of feriaPilings(L)) {
    ctx.fillStyle = C.shadow;
    ctx.beginPath(); ctx.ellipse(px + sh.dx * 0.7, py + sh.dy * 0.7, rad * 1.15, rad * 0.75, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = DECK.pile;
    ctx.beginPath(); ctx.arc(px, py, rad, 0, TAU); ctx.fill();
    ctx.fillStyle = DECK.pileCap;
    ctx.beginPath(); ctx.arc(px - 1, py - 1, rad * 0.55, 0, TAU); ctx.fill();
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
