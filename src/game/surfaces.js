// Surface classes — pure data (also imported by tools/gen-inventory.mjs).
// Mirrors churchill/world/enums/surface.py; the VALUES are the wire format
// (they are the bytes in each tile's RLE), so append, never renumber.
// Speed multiplier per surface class:
//   0 water, 1 land (solid cuadra interior — blocked in update), 2 beach,
//   3 road, 4 paseo, 5 bridge/pier, 6 acera, 7 boulevard (calle peatonal:
//   transitable stone paving, slower than the paseo — you crawl over it)
export const SURFACE_MUL = { 0: 0.35, 1: 0.78, 2: 0.7, 3: 1.0, 4: 0.55, 5: 1.0, 6: 0.62, 7: 0.5 };

// Human-readable names, index = surface class id.
export const SURFACE_CLASSES = ["water", "land", "beach", "road", "paseo", "bridge", "acera", "boulevard"];
