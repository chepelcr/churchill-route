// Vehicle stats — pure data (also imported by tools/gen-inventory.mjs).
// accel/top in px/s, turn in rad/s, grip 0..1, melt = churchill melt-rate mult.
// Relaxed cruise tuning: slower top speeds + higher grip than the original
// arcade values, so driving the puerto feels smooth and unhurried rather than
// frenetic. accel/top in px/s, turn in rad/s, grip 0..1, melt = melt-rate mult.
//
// `medium` IS THE GROUND A VEHICLE IS ALLOWED TO EXIST ON, and it is the only
// concept here the collider reads. A land vehicle treats water as a wall; a
// water one treats everything BUT water as a wall (physics.js `isWall`). Two
// consequences worth knowing before adding an entry:
//
//   * it is not cosmetic. A vehicle with the wrong medium is not slow or
//     awkward, it is stuck inside a wall at the spawn point.
//   * the ownership fallback is per-medium (modes.js `resolveVehicle`). Falling
//     back to the scooter on the estero would put a moped in the sea, so every
//     medium needs at least one entry in economy.js FREE_VEHICLES.
//
// `drag` is optional and only boats set it: friction is DIVIDED by the surface
// multiplier, and on open water at mul 1.0 a car's friction stops a hull dead.
// A boat glides, so it drags less and coasts through a turn. Absent = 1.
export const VEHICLES = {
  bici:    { name: "Bicicleta repartidora", accel: 170, top: 180, turn: 3.4, grip: 0.90, melt: 0.7, color: "#2e8bd6", roof: "#ffe6b3", w: 20, h: 13, kind: "bike", medium: "land" },
  scooter: { name: "Scooter retro",        accel: 225, top: 230, turn: 3.05, grip: 0.85, melt: 1.0, color: "#e85d75", roof: "#fff",   w: 22, h: 13, kind: "bike", medium: "land" },
  tuktuk:  { name: "Tuk-tuk porteño",      accel: 202, top: 212, turn: 2.8, grip: 0.82, melt: 0.9, color: "#f3c969", roof: "#3a3a48", w: 26, h: 17, kind: "car", medium: "land"  },
  cart:    { name: "Mini carrito helado",  accel: 184, top: 194, turn: 2.55, grip: 0.80, melt: 0.55, color: "#fff",  roof: "#e85d75", w: 27, h: 17, kind: "car", medium: "land"  },
  pickup:  { name: "Pickup pescador",      accel: 253, top: 270, turn: 2.45, grip: 0.78, melt: 1.1, color: "#6fbf99", roof: "#4a3a2a", w: 31, h: 19, kind: "car", medium: "land"  },
  turbo:   { name: "Turbo Churchill Kart", accel: 330, top: 352, turn: 3.05, grip: 0.72, melt: 1.3, color: "#ff3d80", roof: "#fff36b", w: 25, h: 14, kind: "car", medium: "land"  },

  // ---- Las lanchas ---------------------------------------------------------
  // The estero boats. They are ordinary entries on purpose: the picker, the
  // shop, the paint swatches and applyOwnedShopEffects all work on them with no
  // special case, because the only thing that makes them boats is `medium`.
  //
  // The ladder is grip, not speed. A panga is slow and holds her line; a
  // deslizador is fast and washes wide out of every bend, which is what makes
  // the buoys worth reading. Their `turn` is LOW next to a car's — nothing on
  // water pivots — and physics.js suppresses the pivot-in-place term for them,
  // which is the single thing that would otherwise make a hull feel like a kart.
  panga:      { name: "Panga de trabajo", accel: 150, top: 190, turn: 1.9, grip: 0.55, melt: 1.0, drag: 0.45, color: "#f6f2e8", roof: "#3a6f8a", w: 34, h: 14, kind: "boat", medium: "water" },
  lanchataxi: { name: "Lancha taxi",      accel: 205, top: 260, turn: 2.2, grip: 0.42, melt: 1.0, drag: 0.38, color: "#4fb0d6", roof: "#f6f2e8", w: 32, h: 12, kind: "boat", medium: "water" },
  deslizador: { name: "Deslizador",       accel: 280, top: 340, turn: 2.5, grip: 0.30, melt: 1.0, drag: 0.30, color: "#ff3d80", roof: "#26222c", w: 30, h: 11, kind: "boat", medium: "water" },
};

//: the medium a vehicle key belongs to, defaulting to land — an editor-authored
//: vehicle that predates the field is a car, which is what it always was.
export function vehicleMedium(key) {
  return VEHICLES[key]?.medium || "land";
}
