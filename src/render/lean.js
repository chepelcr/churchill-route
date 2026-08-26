// LA INCLINACIÓN: UN SOLO NÚMERO, Y UN SOLO DUEÑO.
//
// El juego se ve desde arriba y va a seguir viéndose desde arriba. Lo que esto
// agrega no es una cámara nueva sino una sola pregunta: **cuánto se levanta del
// suelo lo que tiene altura**.
//
// LO QUE NO HACE, y es la mitad del diseño: no toca el suelo. Bajo cámara
// ortográfica una inclinación de verdad achataría el eje norte-sur del terreno
// por `cos(lean)`, y eso llega hasta el volante — `applyTouch` compara un
// ángulo de PANTALLA contra un rumbo de MUNDO, así que un dedo puesto derecho
// arriba dejaría de pedir el norte. Se compensa la proyección para que el plano
// del suelo salga EXACTAMENTE como salía (ver `three/index.js`), y entonces:
//
//     camera_y = Y·cos φ + Z·sin φ        una cámara ortográfica inclinada
//     ÷ cos φ  = Y      + Z·tan φ         …con el suelo devuelto a su sitio
//                ^^^^^^^ intacto   ^^^^^^^ la inclinación
//
// El suelo se mapea igual, la altura se levanta `tan(lean)`, y el volante ni se
// entera. Manejar es idéntico POR CONSTRUCCIÓN, no por compensación.
import { MAX_TILT_RAD, PX_PER_M } from "../domain/units.js";

let leanRad = 0;
let frameRotation = 0;

/**
 * The camera roll every lift this frame is measured against.
 *
 * Screen-up is not world-up in a rolled stage, and a painter deep in the flora
 * scatter has no camera to ask. Reading it off the CTM per tree would mint a
 * DOMMatrix for each of the ~60 candidates a forest offers per frame, so the
 * compositor states it once instead.
 */
export function beginLeanFrame(rotation) {
  frameRotation = Number(rotation) || 0;
}

/** Set the lean, clamped to the angle the top-down art still reads at. */
export function setLean(radians) {
  const wanted = Number(radians);
  leanRad = Number.isFinite(wanted)
    ? Math.max(0, Math.min(MAX_TILT_RAD, wanted)) : 0;
  return leanRad;
}

/** The lean in radians. Zero is the shipped plan view. */
export function lean() { return leanRad; }

/** Is anything leaning at all? The fast path every painter checks first. */
export function leaning() { return leanRad > 0; }

/**
 * How far up the SCREEN something `heightM` tall rises, in world px.
 *
 * Zero when the camera is flat, which is what makes every call site below a
 * no-op in the shipped game and the whole migration provable pixel for pixel.
 */
export function liftPx(heightM) {
  if (!leanRad) return 0;
  return (Number(heightM) || 0) * Math.tan(leanRad) * PX_PER_M;
}

/**
 * That rise as a WORLD vector, for a camera rolled by `rotation`.
 *
 * Screen-up is not world-up in a rotated stage — El Cocal is played on its
 * side — so the lift has to be expressed in the frame the painter is actually
 * drawing in. Inverting the camera's rotation gives `(-sin, -cos)`, which at
 * zero roll is plain world −Y, i.e. north.
 */
export function liftVector(heightM, rotation = frameRotation) {
  const l = liftPx(heightM);
  if (!l) return [0, 0];
  return [-Math.sin(rotation) * l, -Math.cos(rotation) * l];
}

/**
 * A decal's lift.
 *
 * A flat sprite has no top and bottom to separate — translating it moves its
 * feet along with its crown — so a tree or a lamp rises by the height of its
 * VISUAL CENTROID rather than its full height. Half is the honest estimate for
 * the crown-heavy things this applies to, and it is one rule instead of a
 * fraction invented per painter.
 */
export const DECAL_CENTROID = 0.5;
export function decalLiftVector(heightM, rotation = frameRotation) {
  return liftVector((Number(heightM) || 0) * DECAL_CENTROID, rotation);
}
