// Vehicle geometry: the shape verbs a `vehicles.json` part may ask for, and the
// body silhouette traced from them.
//
// Backend-agnostic on purpose: only path verbs shared by Canvas2D and Pixi 8
// Graphics appear here (beginPath / moveTo / lineTo / quadraticCurveTo / rect /
// roundRect / closePath — NOT ellipse, whose signatures differ). The caller owns
// the transform (centred at (0,0), facing +x), sets the fill style and calls
// fill(). Used today for the player's ground shadow (canvas2d); the Pixi backend
// adopts it when vehicles land there (Milestone C).
//
// THE SHADOW IS DERIVED FROM THE SPRITE'S OWN PARTS. It used to be a second
// hand-kept if/else chain beside `paintVehicle`'s, which is a shape that can
// drift: a vehicle could be drawn correctly and cast somebody else's shadow,
// and only a screenshot would ever say so. Now a part carries
// `silhouette: true` and joins both, or `silhouette: "only"` and joins just the
// outline — which the two-wheelers need, because a bike's shadow is one slim
// capsule around frame AND rider, not any single painted piece.
import { vehicleParts } from "../game/vehicles.js";

/** Evaluate a part coordinate against the half-extent of its own axis.
 *
 *  Tres formas, y cada una existe porque el arte escrito a mano ya hacía esa
 *  aritmética:
 *
 *  * un número pelado son PÍXELES;
 *  * `[k, px]` es `k · half + px` — que es literalmente lo que decía el código
 *    (`-veh.w / 2 + 3` es `[-1, 3]`, `veh.h * 0.45` es `[0.9, 0]`), y es lo que
 *    permitió transcribir el catálogo entero sin mover un píxel;
 *  * `{k, px, min, max}` es lo mismo ACOTADO, y es la forma que faltaba. Las
 *    escenas de parcela están llenas de `Math.max(3, h * 0.16)` y
 *    `Math.min(18, hh * 0.24)`: un tope no es aritmética que el catálogo invente,
 *    es un tope que el catálogo DECLARA y el motor aplica — el mismo lado de la
 *    línea de §12 donde está `fit`. Sin él, la banda del techo de la Casa de la
 *    Cultura desaparece en una parcela angosta, que es exactamente contra lo que
 *    ese `max(3, …)` protegía.
 *
 *  Sigue siendo AFÍN por tramos, que es lo que los anchos necesitan: se calculan
 *  como diferencias (`X(w) - X(0)`) y un tope aplicado a los dos extremos por
 *  igual no rompe la resta.
 */
export function evalOn(value, half) {
  if (Array.isArray(value)) return value[0] * half + value[1];
  if (value && typeof value === "object") {
    const v = (value.k || 0) * half + (value.px || 0);
    const lo = value.min ?? -Infinity, hi = value.max ?? Infinity;
    return v < lo ? lo : v > hi ? hi : v;
  }
  return value;
}

/** The path verbs a part may compose — the ones BOTH backends agree on.
 *
 *  Each adds to the current path and never fills: the caller decides whether
 *  this is a painted part or one contour of a shadow. `ellipse`, `disc`,
 *  `stripes` and the stroked shapes are Canvas-only and live with the painter;
 *  none of them is ever a silhouette part, which is why the split falls here. */
export const PATHS = {
  // A WIDTH IS A DIFFERENCE, NOT A POSITION. `X(p.w) - X(0)` is the same number
  // as `X(p.w)` in a vehicle's frame (its origin is its own centre, so X(0) is
  // 0) but not in a prop's, where the frame is an OFFSET from a world anchor and
  // a bare `X(p.w)` came out as `anchor + w`. That is a 4 px traffic-light head
  // drawn as a rectangle the size of the block it stands on.
  rect(g, p, X, Y) {
    g.rect(X(p.x), Y(p.y), X(p.w) - X(0), Y(p.h) - Y(0));
  },
  // FOUR `arcTo`s, NOT the native `roundRect`. They are the same rectangle and
  // not the same rasteriser: measured on the traffic-light head (a 4x9 box with
  // r 1.2) the native one lands 11 pixels one channel level away at the corners.
  // Every rounded thing this game has ever drawn came through gfx.js's arcTo
  // composition, so that is the shape of record — the same reasoning that keeps
  // `rect` on `fillRect`.
  roundRect(g, p, X, Y, S) {
    // EL RADIO DE ESQUINA TAMBIÉN ES UN TAMAÑO. Sin `S` una carrocería
    // proporcional escalaría su caja y no sus esquinas, que a la mitad de tamaño
    // se ve como una caja con las puntas mordidas. `S` por omisión es la
    // identidad, así que hoy sale igual que siempre.
    const x = X(p.x), y = Y(p.y), w = X(p.w) - X(0), h = Y(p.h) - Y(0);
    const r = S ? S(p.r) : p.r;
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  },
  poly(g, p, X, Y) {
    p.pts.forEach((pt, i) => {
      if (pt.q) g.quadraticCurveTo(X(pt.q[0]), Y(pt.q[1]), X(pt.to[0]), Y(pt.to[1]));
      else if (i === 0) g.moveTo(X(pt[0]), Y(pt[1]));
      else g.lineTo(X(pt[0]), Y(pt[1]));
    });
    g.closePath();
  },
};

/** Add one part's contour to the current path, in the vehicle's own frame. */
export function tracePart(g, part, veh) {
  const build = PATHS[part.shape];
  if (!build) return false;
  const X = (v) => evalOn(v, veh.w / 2);
  const Y = (v) => evalOn(v, veh.h / 2);
  build(g, part, X, Y);
  return true;
}

/** The body outline: every part of `key` that claims the silhouette, as ONE
 *  path the caller fills. Subpaths wind the same way, so they union under the
 *  default non-zero rule and their order does not matter. */
export function traceVehicleSilhouette(g, key, veh) {
  g.beginPath();
  for (const part of vehicleParts(key)) {
    if (part.silhouette) tracePart(g, part, veh);
  }
}
