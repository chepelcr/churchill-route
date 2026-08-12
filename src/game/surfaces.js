// The DRIVING MODEL of every surface class — pure data (also imported by
// tools/gen-inventory.mjs), browser-free like `vehicles.js`.
//
// The class ids and names are NOT authored here any more: they are the wire
// format, so they come from `src/domain/vocabulary.generated.js`, which
// `tools/gen_vocabulary.py` writes from `churchill/world/enums/surface.py`.
// This file used to keep a handwritten mirror of the list, and a mirror is a
// thing that drifts — the audit found the editor still knew 8 of the 11 classes
// and `malecon` missing from two palettes.
//
// What stays authored here is the one thing the world does not know: how each
// surface FEELS to drive on. A calle de barro was drawn brown and driven like
// asphalt for a year — the look lived in the road vector and the feel lived
// nowhere. Numbers measured in the running game, same car, same throttle.
import { SURFACE, SURFACE_CLASSES } from "../domain/vocabulary.generated.js";

export { SURFACE, SURFACE_CLASSES };

// Speed multiplier per class. Keyed by the wire id through its NAME, so a
// reader can see which surface a number belongs to without counting commas.
export const SURFACE_MUL = {
  [SURFACE.WATER]: 0.35,      // a car in the gulf: swamped, barely moving
  [SURFACE.LAND]: 0.78,       // cuadra interior — a WALL in physics; this is
                              // the fallback value, not a surface you drive
  [SURFACE.BEACH]: 0.7,       // sand: slow, and it fights back (see physics.js)
  [SURFACE.ROAD]: 1.0,        // asphalt, the reference
  [SURFACE.PASEO]: 0.55,
  [SURFACE.BRIDGE]: 1.0,      // bridge and pier decks
  [SURFACE.ACERA]: 0.62,      // sidewalk — also a wall; kept for the probe
  [SURFACE.BOULEVARD]: 0.5,   // calle peatonal: stone paving, you crawl
  [SURFACE.BARRO]: 0.82,      // packed earth: 189 px/s against asphalt's 230
  [SURFACE.GRAVEL]: 0.9,      // lastre: firmer than barro, still not asphalt
  [SURFACE.MALECON]: 0.55,    // the sea front: paving full of people
};
