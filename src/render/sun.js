// UNA DIRECCIÓN SOLAR PARA TODOS LOS RENDERERS.
//
// Canvas authored its shadows before Three existed. Its apparent sun is
// deliberately anisotropic: `sunVector().y` is fixed at 0.55 and the north-
// south component is shortened again by `squashY`. A geometrically invented
// elevation would therefore disagree with every existing actor and building.
//
// This module turns that exact art contract into a 3-D ray without importing a
// rendering backend. Three coordinates are `(worldX, -worldY, elevationPx)`;
// the vector returned here points FROM the ground TOWARD the sun. A vertical
// object consequently casts along `(-x/z, -y/z)` in Three, which is
// `(-x/z, +y/z)` after converting its Y back to Canvas' downward axis.
import EFFECTS from "../assets/effects.json" with { type: "json" };
import { sunVector } from "../game/daynight.js";

const SUN = EFFECTS.sunShadow;

/**
 * The shared surface-to-sun direction.
 *
 * `x/y/z` is unit length. `elevationRad` is derived from that same ray rather
 * than from `sun.alt`: the latter is an art clock, not physical solar altitude.
 * The object is deliberately a six-field renderer-neutral contract.
 */
export function sunDirection3(sun = sunVector()) {
  const reach = SUN.reachAtNoon + (1 - sun.alt)
    * (SUN.reachAtDusk - SUN.reachAtNoon);
  const rawX = -sun.x * reach;
  const rawY = sun.y * reach * SUN.squashY;
  const invLength = 1 / Math.hypot(rawX, rawY, 1);
  const x = rawX * invLength;
  const y = rawY * invLength;
  const z = invLength;
  return {
    x,
    y,
    z,
    reach,
    shadowAlpha: SUN.alphaAtDusk
      + sun.alt * (SUN.alphaAtNoon - SUN.alphaAtDusk),
    elevationRad: Math.atan2(z, Math.hypot(x, y)),
  };
}

/**
 * Canvas compatibility adapter for the shared ray.
 *
 * Algebraically, Canvas could project `sunDirection3` through `x/z` and `y/z`.
 * Numerically that introduces a normalize/divide round trip and moves a few
 * components by ~1e-14. Art-sheet diffs promise ZERO drift, so this adapter
 * consumes the shared direction's reach/alpha while multiplying the source
 * sample in the exact historical order.
 */
export function sunShadow2(heightM, pxPerM, sun = sunVector()) {
  const direction = sunDirection3(sun);
  const reach = heightM * pxPerM * direction.reach;
  return {
    dx: sun.x * reach,
    dy: sun.y * reach * SUN.squashY,
    alpha: direction.shadowAlpha,
  };
}
