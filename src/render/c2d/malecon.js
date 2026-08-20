// EL MALECÓN — the paved sea front of the Paseo de los Turistas.
//
// The world says which ground is promenade (`Surface.MALECON`, class 10) and
// emits its outline rings; this decides what it LOOKS like. Two things it is
// deliberately not:
//
//   * not the centro's bulevar. That one is grey stone in a running bond
//     (`paintStone` in streets.js) — a calle the cars were taken out of. A
//     malecón is warm: sand-toned baldosa laid in a mosaic, the colour of the
//     playa it edges rather than of the town behind it.
//   * not cement only. A promenade is its planting and its furniture as much as
//     its paving, so the world plants palms and almendros along the band and
//     seats bancas facing the sea; this file draws the paving, the kerb and the
//     seat, and `flora.js` draws the trees from the tile's own arrays.
//
// The courses run in the BAND's frame (`ang`, the Paseo's own angle at that
// point), not the screen's — same rule as every parcel: the cuadrícula is not
// square to the screen, and paving that ignores that reads as a rug thrown over
// the coast.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { aabbInView, ctx, flatMultiPath } from "./gfx.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import { paintMaleconPattern } from "./systemShapes.js";

// One baldosa. Big enough to read at play zoom (the camera frames ~20
// cuadrículas), small enough that a 60 px band is four courses deep.
const BALDOSA = 14;

// LA PALETA VIVE EN `materials.json` -> `malecon`, junto a las otras del mundo.
// Dos tablas por clima: la banda cálida a lo largo de la playa y la plazoleta
// gris del Faro, que es el mismo piso en otra piedra.
const M = MATERIALS.malecon;
function maleconColors(band) {
  const table = band && band.style === "esplanade" ? M.esplanade : M.band;
  return table[state.weather] || table.clear;
}

function bandPath(B) {
  if (!B._path) B._path = flatMultiPath(B.polys && B.polys.length ? B.polys : [B.poly]);
  return B._path;
}

function bandAABB(B) {
  if (!B._aabb) B._aabb = { x0: B.x0, y0: B.y0, x1: B.x1, y1: B.y1 };
  return B._aabb;
}

// The mosaic. A malecón's floor in this country is a field of square baldosas
// with a darker one dropped in now and then — a pattern, not a texture, so it
// is drawn as lines and squares rather than as noise. Clipped to the band and
// laid in its frame; the loop is bounded to the VIEW, not to the band, because
// the band is three kilometres long.
function paintBaldosas(B, view, C) {
  paintMaleconPattern(ctx, B, view, C, bandPath(B), BALDOSA);
}

// One pass over the sea front in view. Called straight after the land base and
// BEFORE the roads, so the acera band and the asphalt still paint over anything
// of ours that reached the kerb — the promenade tucks under the street exactly
// like a park's green skirt does.
function drawMalecon(view) {
  const arr = W.MALECON;
  if (!arr || !arr.length) return;
  for (const B of arr) {
    if (!aabbInView(bandAABB(B), view, 8)) continue;
    const C = maleconColors(B);          // sand along the playa, stone at La Punta
    const path = bandPath(B);
    ctx.fillStyle = C.fill;
    ctx.fill(path, "evenodd");
    paintBaldosas(B, view, C);
    // the sea wall: a kerb all the way round, so the promenade reads as a
    // defined space rather than as a differently-coloured stretch of sand
    ctx.strokeStyle = C.kerb; ctx.lineWidth = 2; ctx.lineJoin = "round";
    ctx.stroke(path);
  }
}

export { drawMalecon };
