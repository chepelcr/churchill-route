// LA COTA DEL SUELO PARA LO QUE SE PARA EN ÉL.
//
// Dos cosas suben el suelo, y las dos en METROS:
//
//   * el NIVEL de su clase de superficie (`effects.json` → `view3d.levels`):
//     la calzada en 0, la acera un escalón arriba, la manzana otro, la arena
//     bajando al agua y el agua abajo. Es lo que hace que la ciudad se lea en
//     pisos y no como un plano pintado;
//   * la COTA REAL del IGN (`W.groundZAt`), por `terrainScale`. En el arenal
//     son centímetros; tierra adentro, los cerros de verdad.
//
// Mientras la capa 3-D no es dueña del suelo (`?own=ground:canvas`), el suelo
// es el plano de Canvas y todo va a h = 0 — si no, una casa se despegaría de su
// propia huella pintada en planta.
import { WORLD2D as W } from "../../world2d/index.js";
import { SURFACE_CLASSES } from "../../game/surfaces.js";
import EFFECTS from "../../assets/effects.json" with { type: "json" };

const V = EFFECTS.view3d;
const LEVELS = V.levels || {};
// nivel por id de clase: la tabla se arma una vez desde los NOMBRES, así un
// nombre que falte en el registro es 0 (la calzada) y no un NaN
const BY_CLASS = new Float32Array(SURFACE_CLASSES.length);
SURFACE_CLASSES.forEach((name, id) => { BY_CLASS[id] = Number(LEVELS[name]) || 0; });
export const ELEVATED_M = Number(LEVELS.elevated) || 0;
const TERRAIN_SCALE = Number(V.terrainScale ?? 1);

let active = false;
export function setGroundActive(v) { active = !!v; }
export function groundActive() { return active; }

/** Nivel de la clase de superficie en (x, y), en metros. */
export function levelM(x, y) { return BY_CLASS[W.surfaceAt(x, y)] || 0; }
export function levelOfClass(c) { return BY_CLASS[c] || 0; }

/** La cota real, escalada, en metros. */
export function reliefM(x, y) {
  return W.groundZAt ? (W.groundZAt(x, y) || 0) * TERRAIN_SCALE : 0;
}

/** Altura del suelo en px de mundo para algo que se para en (x, y). */
export function groundBase(x, y) {
  if (!active || x === undefined) return 0;
  return (levelM(x, y) + reliefM(x, y)) * W.PX_PER_M;
}
