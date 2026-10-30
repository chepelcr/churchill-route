// The DRIVING MODEL of every surface class — pure data (also imported by
// tools/gen-inventory.mjs), browser-free like `vehicles.js`.
//
// Nothing is authored in this file any more, and that is the point. A surface
// has two kinds of truth and they belong in two places:
//
//   IDENTITY  — the wire id, the name, the role sets. That is the world's
//               vocabulary, it lives in churchill/world/enums/surface.py, and it
//               reaches here as src/domain/vocabulary.generated.js.
//   PROPERTIES — how it drives and what it is made of. That is a REGISTRY,
//               src/assets/surfaces.json, keyed by name and shared with the dev
//               viewer, the Python debug renderer and the world editor.
//
// This file used to hold a hand-written copy of the class list AND the speed
// table, and the copies drifted: the debug renderer drew the bulevar `#d8d4c8`
// while every client drew it `#d9d6cd`, and the dev viewer knew 7 of the 11
// classes and painted the rest magenta.
//
// The speeds are measured in the running game, same car, same throttle — a calle
// de barro was drawn brown and driven like asphalt for a year, because the look
// lived in the road vector and the feel lived nowhere.
import { SURFACE, SURFACE_CLASSES } from "../domain/vocabulary.generated.js";
// `with { type: "json" }` is NOT decoration: this module is imported by
// tools/gen-inventory.mjs under plain Node, which refuses a bare JSON import
// (ERR_IMPORT_ATTRIBUTE_MISSING). Vite/Rollup accept the attribute too, so one
// spelling serves the bundle and the script — and this file has to keep working
// under both, which is the same reason it stays free of DOM and `window`.
import REGISTRY from "../assets/surfaces.json" with { type: "json" };

export { SURFACE, SURFACE_CLASSES };

/** The registry row for a class name — `{ speed, day, night }`. */
export const SURFACE_PROPS = Object.freeze(REGISTRY.surfaces);

// Speed multiplier per class, keyed by the WIRE ID so `SURFACE_MUL[surfaceAt(x,y)]`
// stays the one-lookup it has always been. Built from the registry rather than
// retyped: a class with no row would be `undefined` here, and physics.js would
// silently fall back to 0.78 — so the test asserts every class has one.
export const SURFACE_MUL = Object.freeze(Object.fromEntries(
  SURFACE_CLASSES.map((name, id) => [id, REGISTRY.surfaces[name].speed]),
));

/** `#rrggbb` for a class id, in the editor/viewer's day or night palette. */
export function surfaceColor(id, night = false) {
  const row = REGISTRY.surfaces[SURFACE_CLASSES[id]];
  return row ? (night ? row.night : row.day) : null;
}
