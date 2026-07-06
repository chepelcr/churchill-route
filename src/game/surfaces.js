// Surface classes — pure data (also imported by tools/gen-inventory.mjs).
// Speed multiplier per surface class:
//   0 water, 1 land (solid cuadra interior — blocked in update), 2 beach,
//   3 road, 4 paseo, 5 bridge/pier, 6 acera
export const SURFACE_MUL = { 0: 0.35, 1: 0.78, 2: 0.7, 3: 1.0, 4: 0.55, 5: 1.0, 6: 0.62 };

// Human-readable names, index = surface class id.
export const SURFACE_CLASSES = ["water", "land", "beach", "road", "paseo", "bridge", "acera"];
