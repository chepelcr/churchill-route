// LAS LUCES — the engine's half of `src/assets/lights.json`.
//
// A light was the clearest case in the game of a family split down the middle:
// its POSITION has been authored in the editor since editor features shipped
// (`W.LIGHTS`), while what it LOOKS like was `lightPalette()`, a four-branch
// if/else with the colours inline, plus its geometry as ternaries on
// `type === "stadium"` spread over six lines. A light could be put anywhere and
// a fifth kind could not be designed at all.
//
// So the identity is a generated enum (`LightType`), the properties are the
// registry, and this file is what is genuinely engine: the clamps, the night
// test, and the radial gradient — which is not a shape the vocabulary has.
import LIGHTS from "../../assets/lights.json" with { type: "json" };
import { state } from "../../game/state.js";
import { ctx } from "./gfx.js";
import { paintAt } from "./shapes.js";

const TYPES = LIGHTS.types;
//: A light with no type, or with one the registry does not know, is a street
//: lamp. Falling back is right here and wrong for a surface class: an unknown
//: lamp is a lamp, an unknown surface is a guess about what you can drive on.
const FALLBACK = "warm";

export const lightSpec = (type) => TYPES[type] || TYPES[FALLBACK];

/** Is the halo lit? Night is BEHAVIOUR, which is why it never left this file. */
const isNight = () => state.weather === "night";

/**
 * Paint one luminaire at (x, y) in world pixels.
 *
 * `radius` and `intensity` may come from the instance — the editor writes
 * `lightRadius` / `lightIntensity` per feature — and fall back to the type's.
 * The clamps are the ENGINE's, not a type's: a light authored with radius 4000
 * is not a design, it is a white screen.
 */
export function paintLight(type, x, y, opts = {}) {
  const spec = lightSpec(type);
  const L = LIGHTS.limits;
  const intensity = Math.max(0, Math.min(L.intensityMax, Number(opts.intensity) || 1));
  const radius = Math.max(L.radiusMin, Math.min(L.radiusMax, Number(opts.radius) || spec.radius));

  // The fixture first, the halo over it — the order the four hand-written
  // lamps drew in, and the one that reads right: the glow is in front of the
  // lamp, not behind the pole.
  paintAt(spec.parts, x, y, { color: (c) => (c === "$core" ? spec.core : c) });

  if (!(opts.night ?? isNight()) || intensity <= 0) return;
  const A = LIGHTS.haloAlpha;
  const [hx, hy] = spec.haloAt;
  const [r, g, b] = spec.halo;
  const cxx = x + hx, cyy = y + hy;
  const glow = ctx.createRadialGradient(cxx, cyy, 0, cxx, cyy, radius);
  glow.addColorStop(0, `rgba(${r},${g},${b},${Math.min(A.max, intensity * A.perUnit)})`);
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cxx, cyy, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** An authored point light from the editor (`W.LIGHTS`). */
export function drawLight(feature) {
  const [x, y] = feature.geometry.point;
  const properties = feature.properties || {};
  // `street-light` features predate the type field, and a bare `light` was the
  // stadium one. Both defaults are kept so no authored light moves.
  const type = properties.lightType || (feature.type === "light" ? "stadium" : "warm");
  paintLight(type, x, y, {
    radius: properties.lightRadius,
    intensity: properties.lightIntensity,
  });
}

/**
 * The vertex of a flat [x,y,…] ring furthest in a diagonal direction, pulled
 * back toward the centre.
 *
 * The polygon's OWN corner, not the bounding box's: a cuadra here is not square
 * to the screen and not even square to itself, so a bbox corner on a skewed
 * block sits off the pitch entirely. Same rule `standEdge` follows for an edge,
 * and the same rule `P.ang` follows for everything drawn on a parcel.
 */
function polyCorner(pts, dx, dy, inset) {
  const n = pts.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
  cx /= n; cy /= n;
  let bx = pts[0], by = pts[1], best = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = pts[i * 2], py = pts[i * 2 + 1];
    const s = px * dx + py * dy;
    if (s > best) { best = s; bx = px; by = py; }
  }
  const vx = cx - bx, vy = cy - by;
  const len = Math.hypot(vx, vy) || 1;
  return [bx + (vx / len) * inset, by + (vy / len) * inset];
}

//: The four corners of a pitch, which is where floodlight masts actually
//: stand — never along a touchline, because a mast there is in the way of the
//: game and of the stand.
const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

/**
 * The towers of a field, from its own emitted `footprint`.
 *
 * Same trick as the gradería and for the same reason: the traced cuadra already
 * follows the real street grid, so naming a corner is enough and the asset
 * needs no geometry of its own. That is what lets one record light two stadiums
 * whose blocks are different shapes and neither square to the screen.
 */
export function drawFieldTowers(lm, spec) {
  const pts = lm.footprint;
  if (!pts || pts.length < 6 || !spec) return;
  // …y las torres igual: el mundo dice cuál cancha las lleva, `lights.json`
  // dice qué es una torre.
  const own = lm.towers;
  if (!own) return;                        // only the fields that have them
  const type = own.type || spec.type;
  const inset = own.inset ?? spec.inset;
  const night = isNight();
  for (const [dx, dy] of CORNERS) {
    const [x, y] = polyCorner(pts, dx, dy, inset);
    paintLight(type, x, y, { radius: own.radius ?? spec.radius, intensity: own.intensity ?? spec.intensity, night });
  }
}
