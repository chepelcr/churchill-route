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
 *  A bare number is PIXELS; `[k, px]` is `k · half + px`. That is exactly the
 *  arithmetic the hand-written art already did (`-veh.w / 2 + 3` is `[-1, 3]`,
 *  `veh.h * 0.45` is `[0.9, 0]` of the half-height), which is what let the whole
 *  catalog be transcribed without a pixel moving. */
export function evalOn(value, half) {
  return Array.isArray(value) ? value[0] * half + value[1] : value;
}

/** The path verbs a part may compose — the ones BOTH backends agree on.
 *
 *  Each adds to the current path and never fills: the caller decides whether
 *  this is a painted part or one contour of a shadow. `ellipse`, `disc`,
 *  `stripes` and the stroked shapes are Canvas-only and live with the painter;
 *  none of them is ever a silhouette part, which is why the split falls here. */
export const PATHS = {
  rect(g, p, X, Y) {
    g.rect(X(p.x), Y(p.y), X(p.w), Y(p.h));
  },
  roundRect(g, p, X, Y) {
    g.roundRect(X(p.x), Y(p.y), X(p.w), Y(p.h), p.r);
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
