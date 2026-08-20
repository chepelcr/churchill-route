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
// ferial's packed earth and that is what the car interacts with; a ride is
// scenery you drive around, like a vendor's cart or a parada.
import { WORLD2D as W } from "../../world2d/index.js";
import { ctx, hash01 } from "./gfx.js";
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
  // la sombra en el suelo, para que nada flote sobre el barro
  g.fillStyle = CH.rideShadow;
  g.beginPath(); g.ellipse(1, r * 0.28, r * 0.95, r * 0.4, 0, 0, TAU); g.fill();
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

function drawAttraction(A, t) {
  const spec = ASSETS[A.kind];
  if (!spec || !spec.parts) return;
  const r = A.r || 24;
  const ph = phaseOf(A);
  ctx.save();
  ctx.translate(A.x, A.y);
  // UNA ATRACCIÓN PUEDE TENER RUMBO. Una rueda o un pulpo giran sobre su eje y
  // no lo necesitan, pero una TARIMA mira a algún lado: el DJ toca de cara a la
  // playa, y el mundo resuelve ese rumbo desde la normal de la calle que da al
  // mar (`_seaward`), no desde un número escrito. Sin `ang` nada cambia.
  if (A.ang) ctx.rotate(A.ang);
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

// ---- el campo ferial: LA CALLE CERRADA ---------------------------------------
// Ya no es tierra estampada sobre el paseo marítimo. El turno CIERRA LA CALZADA
// SUR del Paseo de los Turistas —la calzada norte sigue abierta— así que el
// suelo es la calle y sigue siéndolo: el build no estampa nada. Lo que se pinta
// aquí es lo que hace leer una calle cerrada como un campo ferial, y NADA que
// finja otro suelo: el desgaste del gentío sobre el asfalto y la ristra de
// bombillos alrededor del lote.
function bandPath(F) {
  if (!F._path) {
    const p = new Path2D();
    for (const poly of F.polys || []) {
      if (!poly || poly.length < 6) continue;
      p.moveTo(poly[0], poly[1]);
      for (let i = 2; i < poly.length; i += 2) p.lineTo(poly[i], poly[i + 1]);
      p.closePath();
    }
    F._path = p;
  }
  return F._path;
}

function drawFeriaGround(view, t) {
  const arr = W.FERIA;
  if (!arr || !arr.length) return;
  for (const F of arr) {
    if (F.x1 < view.x0 || F.x0 > view.x1 || F.y1 < view.y0 || F.y0 > view.y1) continue;
    const path = bandPath(F);
    ctx.save();
    ctx.fillStyle = CH.ground;                      // la tierra del campo ferial
    ctx.fill(path, "evenodd");
    // scuffed patches, deterministic so they never crawl
    ctx.save();
    ctx.clip(path, "evenodd");
    ctx.fillStyle = CH.groundMottle;
    for (let i = 0; i < 40; i++) {
      const hx = F.x0 + hash01(i * 1.7 + F.x0) * (F.x1 - F.x0);
      const hy = F.y0 + hash01(i * 2.9 + F.y0) * (F.y1 - F.y0);
      ctx.beginPath();
      ctx.ellipse(hx, hy, 10 + hash01(i * 3.1) * 16, 5 + hash01(i * 4.3) * 8,
        hash01(i * 5.7) * Math.PI, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = CH.groundEdge;
    ctx.lineWidth = 2; ctx.lineJoin = "round";
    ctx.stroke(path);
    ctx.restore();
  }
}

function drawAttractions(view, t) {
  drawFeriaGround(view, t);
  const arr = W.ATTRACTIONS;
  if (!arr || !arr.length) return;
  for (const A of arr) {
    const pad = (A.r || 24) * 2 + 30;
    if (A.x + pad < view.x0 || A.x - pad > view.x1
      || A.y + pad < view.y0 || A.y - pad > view.y1) continue;
    drawAttraction(A, t);
  }
}

export { drawAttractions };
