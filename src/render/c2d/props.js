// PIEZAS COMPARTIDAS — the props more than one thing in the world is made of.
//
// `src/assets/world-props.json`'s `props` block says what each one looks like;
// this is the one place that puts a prop somewhere. Its whole job is the FRAME,
// which is the part the interpreter deliberately does not own (see shapes.js):
// translate to the anchor, turn by the world's angle, scale to the lot, and
// switch between plain pixels and half-extents.
//
// It exists as its own module because of an import cycle: `gfx.js` is the bottom
// of the renderer (the shared `ctx`, `label`, `roundRect`) and `shapes.js` sits
// on top of it, so a catalog-driven prop cannot live in gfx. `drawParada` used
// to, and both its callers reached down there for it.
import PROPS from "../../assets/world-props.json" with { type: "json" };
import { evalOn } from "../vehicleShapes.js";
import { ctx } from "./gfx.js";
import { paintParts } from "./shapes.js";

/** A named prop's parts — the resolver the `prop` part inlines through. */
export function propParts(name) {
  return PROPS.props[name]?.parts;
}

/**
 * Draw a catalog prop anchored at world (x, y).
 *
 * @param {string} name    a key of world-props.json `props`
 * @param {number} x,y     the anchor, in world px
 * @param {object} [opts]
 *   @param {number} [opts.ang]     turn by this many radians (0 = square to the screen)
 *   @param {number} [opts.scale]   isotropic scale about the anchor
 *   @param {number[]} [opts.extent] `[w, h]`: measure parts in HALF-EXTENTS of
 *      this box instead of pixels, so `[k, px]` reads as `k · half + px`
 *   @param {object} [opts.vars]    `$name` substitutions
 */
export function paintProp(name, x, y, opts = {}) {
  const parts = propParts(name);
  if (!parts) return;
  const { ang = 0, scale, extent, vars } = opts;
  const g = ctx;
  g.save();
  g.translate(x, y);
  if (ang) g.rotate(ang);
  if (scale !== undefined) g.scale(scale, scale);
  const hw = extent ? extent[0] / 2 : 0, hh = extent ? extent[1] / 2 : 0;
  paintParts(g, parts, {
    X: extent ? (v) => evalOn(v, hw) : (v) => v || 0,
    Y: extent ? (v) => evalOn(v, hh) : (v) => v || 0,
    prop: propParts,
    vars,
  });
  g.restore();
}

// LA PARADITA — one caseta, drawn the same wherever a bus stops.
//
// There are two INDEPENDENT sources of bus stops in this world and they used to
// be two independent drawings: the civic block hands its own out as a rect on a
// parcel (`P.bus`, the one on the Parque de la Virgen beside the catedral),
// while the 87 mapped `highway=bus_stop` nodes arrive as street furniture the
// build seats on the acera. A parada is a parada — the source it came from is
// not something the player can see, so it must not change what it looks like.
// Only the SIZE differs, and only because the civic block supplies one.
//
// `ang` is the street's angle: the shelter's back is uphill of the bench, so a
// stop on the far kerb passes `ang + PI` and still opens onto the roadway.
export function drawParada(cx, cy, ang, w, h) {
  paintProp("parada", cx, cy, { ang, extent: [w, h] });
}
