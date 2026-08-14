// EL GARAJE — the reader for `src/assets/vehicles.json`. Pure data and pure
// functions; no DOM, no `window`, so `tools/gen-inventory.mjs` can import it
// under plain Node, same as `surfaces.js`.
//
// Nothing about a vehicle is authored here any more, and that is the point. A
// vehicle used to be spread across four files that had to be edited together:
// the stats here, the price in `economy.js`, the engine voice in `audio.js`,
// and the art as a branch of a 90-line if/else chain in `c2d/entities.js`.
// Adding one meant touching all four and remembering the fifth thing (a free
// entry for its medium). It is one record now.
//
// What stays ENGINE: the physics, the WebAudio synthesis, and the interpreter
// that walks `parts` (`paintVehicle` in c2d/entities.js, `traceVehicleSilhouette`
// in render/vehicleShapes.js). Data composes a finite set of shapes; it cannot
// invent one.
//
// `medium` IS THE GROUND A VEHICLE IS ALLOWED TO EXIST ON, and it is the only
// concept in the record the collider reads. A land vehicle treats water as a
// wall; a water one treats everything BUT water as a wall (physics.js `isWall`).
// Two consequences worth knowing before adding an entry:
//
//   * it is not cosmetic. A vehicle with the wrong medium is not slow or
//     awkward, it is stuck inside a wall at the spawn point.
//   * the ownership fallback is per-medium (modes.js `resolveVehicle`). Falling
//     back to the scooter on the estero would put a moped in the sea, so every
//     medium needs at least one `"free": true` entry — `tests/test_vehicles.py`
//     is the gate.
//
// `drag` is optional and only boats set it: friction is DIVIDED by the surface
// multiplier, and on open water at mul 1.0 a car's friction stops a hull dead.
// A boat glides, so it drags less and coasts through a turn. Absent = 1.
//
// THE LADDER FOR THE LANCHAS IS GRIP, NOT SPEED. A panga holds her line; a
// deslizador washes wide out of every bend, which is what makes the buoys worth
// reading. `boat.js` owns the handling model and states the one real rule (way
// and prop wash buy you the rudder), which is why these can be honest arcade
// numbers rather than the three stacked suppressions they used to be.
import { VEHICLE_MEDIUM } from "../domain/vocabulary.generated.js";
// `with { type: "json" }` is NOT decoration — see the same note in surfaces.js:
// plain Node refuses a bare JSON import (ERR_IMPORT_ATTRIBUTE_MISSING), and
// this module is imported by tools/gen-inventory.mjs.
import REGISTRY from "../assets/vehicles.json" with { type: "json" };
import EFFECTS from "../assets/effects.json" with { type: "json" };

/** The flat runtime record every consumer already expects: stats hoisted
 *  alongside the palette and the bounds. Built rather than authored, so the
 *  registry can grow fields (`voice`, `parts`, `price`) that physics never
 *  has to know about. */
export const VEHICLES = Object.fromEntries(
  Object.entries(REGISTRY.vehicles).map(([key, v]) => [key, {
    name: v.name,
    ...v.stats,
    color: v.color,
    roof: v.roof,
    w: v.w,
    h: v.h,
    kind: v.kind,
    medium: v.medium,
  }]),
);

/** Vehicles a player owns without buying one. MUTABLE and order-significant:
 *  `freeVehicleFor` takes the FIRST entry of a medium, so this is also the
 *  answer to "which boat does someone who owns no boat sail". */
export const FREE_VEHICLES = Object.entries(REGISTRY.vehicles)
  .filter(([, v]) => v.free)
  .map(([key]) => key);

/** Shop price by key. Mutable on purpose — `editorContent.js` writes
 *  editor-authored vehicles into it at load. */
export const VEHICLE_PRICES = Object.fromEntries(
  Object.entries(REGISTRY.vehicles)
    .filter(([, v]) => v.price)
    .map(([key, v]) => [key, v.price]),
);

/** Engine character per vehicle: oscillator flavour, pitch range (base..base+
 *  span Hz across the speed range), filter opening and loudness.
 *
 *  THE LANCHAS HAVE NO ENTRY, and that is the behaviour as shipped, not an
 *  oversight in the transcription: all three fall back to the scooter's voice,
 *  so an outboard currently sounds like a moped. Left exactly as it was —
 *  giving them a voice is an audio change, not a migration. */
export const ENGINE_VOICES = Object.fromEntries(
  Object.entries(REGISTRY.vehicles)
    .filter(([, v]) => v.voice)
    .map(([key, v]) => [key, v.voice]),
);

//: the medium a vehicle key belongs to, defaulting to land — an editor-authored
//: vehicle that predates the field is a car, which is what it always was.
export function vehicleMedium(key) {
  return VEHICLES[key]?.medium || VEHICLE_MEDIUM.LAND;
}

/** The drawing recipe for a key: its own `parts` with every `{ref}` spliced in,
 *  or the fallback run for its kind.
 *
 *  The fallback is not defensive padding — `editorContent.js` writes vehicles
 *  into `VEHICLES` with no art at all, and before this file they reached the
 *  `else` at the end of each branch of the paint chain. That `else` is now
 *  `defaults[kind]`, which is the same answer written down. */
export function vehicleParts(key) {
  const rec = REGISTRY.vehicles[key];
  const kind = rec?.kind || VEHICLES[key]?.kind || "car";
  const list = rec?.parts
    || (REGISTRY.defaults[kind] || REGISTRY.defaults.car).map((ref) => ({ ref }));
  const out = [];
  for (const part of list) {
    if (part.ref) out.push(...(REGISTRY.templates[part.ref] || []));
    else out.push(part);
  }
  return out;
}

/** The effects a vehicle carries, each merged over the repository's defaults.
 *
 *  SELECTION IS DATA, THE ALGORITHM IS CODE. A boat leaves a wake and heels
 *  into her turns; a car throws swirls and a hard shadow. That used to be
 *  `if (afloat)` inside `drawPlayer`, so an editor-authored boat got the car's
 *  treatment and there was no way to say otherwise. Returns
 *  `[{id, effect, cfg}, …]` in the registry's own order, so the paint order is
 *  the repository's decision and not each vehicle's.
 *
 *  An effect a vehicle names that the repository does not have is DROPPED with
 *  a warning rather than thrown: one bad row in an authored vehicle should cost
 *  that one effect, not the frame. `tests/test_effects.py` is what actually
 *  stops it shipping. */
export function vehicleEffects(key) {
  const chosen = REGISTRY.vehicles[key]?.effects;
  if (!chosen) return [];
  const out = [];
  for (const [id, effect] of Object.entries(EFFECTS.vehicle)) {
    if (id.startsWith("_") || !(id in chosen)) continue;
    out.push({ id, effect, cfg: { ...effect.params, ...(chosen[id] || {}) } });
  }
  for (const id of Object.keys(chosen)) {
    if (!EFFECTS.vehicle[id]) warnOnce(`vehicle "${key}" asks for effect "${id}", which no painter implements`);
  }
  return out;
}

/** How this vehicle carries a churchill: the recipe name and where it rides.
 *
 *  This was `if (key === "pickup") … else if (key === "cart") … else` — the
 *  last place in the renderer that knew a vehicle by its name. */
export function vehicleCargo(key) {
  const rec = REGISTRY.vehicles[key]?.cargo;
  const style = rec?.style || EFFECTS.cargo._fallback;
  const base = EFFECTS.cargo[style] || EFFECTS.cargo[EFFECTS.cargo._fallback];
  return { style, mount: { ...base.mount, ...(rec?.mount || {}) } };
}

const _warned = new Set();
function warnOnce(msg) {
  if (_warned.has(msg)) return;
  _warned.add(msg);
  console.warn(`[vehicles] ${msg}`);
}

/** The colour a part asks for: `$color`/`$roof` resolve against this vehicle's
 *  own palette (which is what makes a bought paint swatch repaint the body and
 *  leave the boot-top red), anything else is the literal it already is. */
export function partColor(spec, veh) {
  if (spec === "$color") return veh.color;
  if (spec === "$roof") return veh.roof;
  return spec;
}
