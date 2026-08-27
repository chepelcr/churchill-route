// LA ARBOLEDA — every plant in this world, drawn from ONE idiom.
//
// The first world had three unrelated drawings: almendro, palma and a generic
// mangle. The regional catalog now carries taxons, conditions and placeholders
// with distinct JSON recipes, but every one still speaks this shared idiom.
//
// So the vocabulary is shared and lives in `floraShapes.js`:
//   * `floraCanopyPath` — one soft ragged crown primitive;
//   * a finite generator/root vocabulary whose authored knobs live in JSON;
//   * one deterministic seed and one solar-shadow recipe.
//   * `hash01` — the ONLY source of variation. No `Math.random` in a draw call:
//     a tree that changes shape every frame is a tree that shimmers.
//
// A palm stays a palm — fronds, a leaning trunk, its own sway — but it takes
// its shadow, its scale and its seed from the same three lines as the rest.
import { WORLD2D as W } from "../../world2d/index.js";
import { SURFACE } from "../../game/surfaces.js";
import { ACERA_PX, ctx, flatPath, hash01 } from "./gfx.js";
import FLORA from "../../assets/flora.json" with { type: "json" };
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { sunVector } from "../../game/daynight.js";
import {
  floraSeed, paintFloraSpecies, resolveFloraMixSpecies,
} from "./floraShapes.js";

// THE SPECIES AND FORM RECIPES ARE DATA; the finite maths vocabulary is code.
// This file owns placement/culling and hands one resolved row to the shared
// interpreter. The editor calls that same interpreter with its unsaved document.
const SPECIES = FLORA.species;
const DEFAULT_SPECIES = FLORA.defaults.treeSpecies;
const DEFAULT_PALM = FLORA.defaults.palmSpecies;

// EVERY PLANT IN THIS WORLD IS A ROW, including the two that are not "trees".
// The palma and the mangle used to be drawn from hardcoded numbers and to take
// their greens from `CANOPY` — which is the ALMENDRO's array — so editing one
// tree in the registry silently restyled every frond and every mangrove in the
// world. They have their own rows now, with the same values, so the look is
// unchanged and the coupling is gone.
/** Missing `k` is the wire-format default; an unknown explicit id is an error. */
function species(name) {
  if (name == null || name === "") return SPECIES[DEFAULT_SPECIES];
  const record = SPECIES[name];
  if (!record) throw new Error(`unknown flora species: ${name}`);
  return record;
}

export function floraSolar() {
  return { sun: sunVector(), model: EFFECTS.sunShadow };
}

/** Draw one tree of any species. `tr.k` names it; no `k` is the almendro. */
function paintTree(tr) {
  const sp = species(tr.k);
  paintFloraSpecies(ctx, sp, FLORA.forms[sp.form], {
    x: tr.x,
    y: tr.y,
    s: tr.s || 1,
    seed: floraSeed(tr.x, tr.y),
    solar: floraSolar(),
  });
}

// A palm keeps its clock/instance phase in this placement module; the authored
// trunk/frond silhouette is executed by the same shared family interpreter.
function paintPalm(pa, t) {
  const sp = species(pa.k || DEFAULT_PALM);
  paintFloraSpecies(ctx, sp, FLORA.forms[sp.form], {
    x: pa.x,
    y: pa.y,
    s: pa.s || 1,
    seed: floraSeed(pa.x, pa.y),
    tMs: t,
    phase: pa.sway || 0,
    solar: floraSolar(),
  });
}

// --------------------------------------------------------------- monte ----
// EL MONTE. A wood is an AREA and a MIX, and the trees in it are computed here,
// per frame, from the ground itself — the build emits none of them.
//
// It has to be that way: 95 % of this world's cuadra ground is 55 rural blobs
// (the largest 270 M px²), and a forest over that is 300 000 to 950 000 trees.
// The whole world is 16.7 MB. So `cuadra.wood` names a mix and the scatter
// happens here, which costs a few hundred bytes of manifest and nothing per
// tree.
//
// The cost per FRAME is bounded by the VIEW, not by the wood: the lattice is
// walked over the visible rectangle only, so a 270 M px² forest and a small one
// cost the same ~60 candidates. And the position hash is the same one the
// roadside planting uses, so a tree stands in the same place every frame — the
// one thing a draw-time scatter must never get wrong.
const MIXES = FLORA.mixes;

/** Species for a lattice point, by the mix's weights. Deterministic in (gx,gy). */
function woodSpecies(mix, gx, gy) {
  return resolveFloraMixSpecies(
    mix.weights,
    hash01(gx * 3.71 + gy * 7.13 + 41.9),
  );
}

/** Plant every wood that reaches the view. */
function paintWoods(view) {
  const woods = W.CUADRAS;
  if (!woods || !woods.length) return;
  for (const cu of woods) {
    if (!cu.wood) continue;
    if (cu.x1 < view.x0 - 40 || cu.x0 > view.x1 + 40 ||
        cu.y1 < view.y0 - 40 || cu.y0 > view.y1 + 40) continue;
    const mix = MIXES[cu.wood];
    if (!mix) continue;
    // THE FOREST FLOOR. Bare land tan under a wood reads as trees standing on a
    // beach; a wash of the mix's own shade under them reads as woodland. The
    // path is built once per wood and kept on the record, the same way a road
    // keeps its roadside planting — the biggest of these is 6 392 vertices and
    // rebuilding it per frame would be the one expensive thing here.
    if (cu._woodPath === undefined) {
      cu._woodPath = cu.poly && cu.poly.length >= 6 ? flatPath(cu.poly, true) : null;
    }
    if (cu._woodPath) {
      ctx.fillStyle = mix.floor;
      ctx.fill(cu._woodPath);
    }
    const step = Math.sqrt(mix.d);
    // the lattice is GLOBAL, so a tree does not move when the camera does
    const gx0 = Math.floor(Math.max(cu.x0, view.x0 - 40) / step);
    const gx1 = Math.ceil(Math.min(cu.x1, view.x1 + 40) / step);
    const gy0 = Math.floor(Math.max(cu.y0, view.y0 - 40) / step);
    const gy1 = Math.ceil(Math.min(cu.y1, view.y1 + 40) / step);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const h = hash01(gx * 1.93 + gy * 5.17);
        if (h < 0.18) continue;                       // clearings, and they matter:
        // a tree in EVERY lattice cell reads as an orchard. The jitter is nearly
        // a whole cell for the same reason — at ±0.4 the rows were still visible.
        const x = (gx + 0.5 + (hash01(gx * 11.7 + gy * 2.3) - 0.5) * 0.96) * step;
        const y = (gy + 0.5 + (hash01(gx * 4.1 + gy * 13.9) - 0.5) * 0.96) * step;
        // THE GROUND DECIDES, not the polygon. `surfaceAt` is one tile lookup and
        // it is the exact question — solid cuadra interior is the countryside,
        // and it already excludes the roads, the sand, the water and the aceras
        // that a 6 000-vertex point-in-polygon test would have cost a frame to
        // answer less well.
        if (W.surfaceAt(x, y) !== SURFACE.LAND) continue;
        paintTree({ x, y, k: woodSpecies(mix, gx, gy),
                    s: 0.85 + hash01(gx * 8.3 + gy * 3.7) * 0.4 });
      }
    }
  }
}

// ----------------------------------------------------------- roadside ----
// LOS ÁRBOLES DE LA CALLE. The world plants the cuadra interiors, the parks and
// the medians; the acera between them was bare, so an ordinary calle read as
// two kerbs and nothing else.
//
// Three rules, and all three are load-bearing:
//   * NEVER ON THE CARRIAGEWAY. The only surface a street tree may stand on is
//     the ACERA (6) — the class is tested at the tree's own point, so road (3),
//     paseo (4) and bridge/pier (5) are excluded by construction, and so are
//     water, sand and the cuadra interior.
//   * DETERMINISTIC. Every offset, gap and size comes from `hash01` of the
//     ROAD'S OWN GEOMETRY, so the same street is planted the same way in every
//     session and the row never crawls between frames.
//   * TASTEFUL. A street lined edge to edge is as wrong as a bare one, so the
//     spacing varies, each kerb is decided on its own, and whole stretches are
//     deliberately left blank (`RUN` slots at a time).
const ROADSIDE_PITCH = 46;    // nominal px between slots
const RUN = 5;                // slots per planted / blank stretch

function roadsideTrees(r) {
  // an empty list is also "not resolved yet" — a kerb whose tile had not
  // streamed in reads as water, so a road that yielded nothing is retried
  // rather than cached bare for the rest of the session
  if (r._roadside && r._roadside.length) return r._roadside;
  const out = [];
  // no street trees on a deck over the water, on the paseo's own promenade (it
  // has its palm median) or on a piece too short to hold a row
  if (r.bridge || r.cls === "bridge" || r.cls === "paseo" || r.len < 70) {
    return (r._roadside = out);
  }
  const pts = r.pts, cum = r.cum;
  const base = hash01(pts[0] * 0.013 + pts[1] * 0.0071 + r.w);
  const off = r.w / 2 + ACERA_PX * 0.55;
  let i = 1;
  let s = 12 + base * ROADSIDE_PITCH;
  for (let slot = 0; s < r.len - 12; slot++) {
    const h = hash01(base * 97.3 + slot * 1.37);
    s += ROADSIDE_PITCH * (0.72 + h * 0.7);
    if (s >= r.len - 12) break;
    if (((slot / RUN) | 0) % 2 === 1) continue;   // the blank stretch
    while (i < cum.length - 1 && cum[i] < s) i++;
    const s0 = cum[i - 1], seg = (cum[i] - s0) || 1;
    const tt = Math.max(0, Math.min(1, (s - s0) / seg));
    const x0 = pts[(i - 1) * 2], y0 = pts[(i - 1) * 2 + 1];
    const x1 = pts[i * 2], y1 = pts[i * 2 + 1];
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
    const px = x0 + dx * tt, py = y0 + dy * tt;
    const nx = -dy / L, ny = dx / L;
    for (const side of [-1, 1]) {
      const hs = hash01(base * 53.9 + slot * 3.11 + (side > 0 ? 0.41 : 0));
      if (hs < 0.42) continue;                     // this kerb stays empty here
      const d = off + hs * 3.5;
      const x = px + nx * side * d, y = py + ny * side * d;
      if (W.surfaceAt(x, y) !== SURFACE.ACERA) continue;   // acera or nothing
      out.push({ x, y, s: 0.62 + hash01(base * 71.3 + slot * 5.7 + side) * 0.34 });
    }
  }
  return (r._roadside = out);
}

// One pass over the streets in view, before the world's own flora.
function paintRoadsideTrees(roads, view) {
  for (const r of roads) {
    for (const tr of roadsideTrees(r)) {
      if (tr.x < view.x0 - 30 || tr.x > view.x1 + 30
        || tr.y < view.y0 - 30 || tr.y > view.y1 + 30) continue;
      paintTree(tr);
    }
  }
}

// ------------------------------------------------------------ medians ----
// A DOUBLE-ANCHOR MEDIAN CARRIES ONE ROW OF TREES, NOT TWO. Paseo León Cortés
// is a dual carriageway, so the world emits its separator as two parallel
// strips and plants a row of almendros along EACH — two rows 11 px apart, which
// is not what a divider looks like. `paintTileMedians` draws that pair as ONE
// divider between two rails; this puts its trees down the middle of it, and
// thins the two interleaved rows back to a single row at the spacing one of
// them had.
//
// The Paseo de los Turistas is NOT this feature: its separator is a single
// dashed palm median and `medianPairs` never pairs it, so nothing here touches
// it.
const MERGE_GAP = 24;         // min px between two trees on a merged median

// Nearest point on a flat polyline, and how far off it we are.
function nearestOnPoly(pts, x, y) {
  let bd = Infinity, bx = 0, by = 0;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const x0 = pts[i], y0 = pts[i + 1];
    const dx = pts[i + 2] - x0, dy = pts[i + 3] - y0;
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2)) : 0;
    const cx = x0 + dx * t, cy = y0 + dy * t;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bd) { bd = d; bx = cx; by = cy; }
  }
  return { d: bd, x: bx, y: by };
}

// The tile's trees, with any standing on a merged median moved onto its centre
// and thinned. Computed ONCE per tile — it is pure geometry off emitted data,
// so it can never differ between two frames.
function tileTrees(tile, pairs) {
  if (tile._flora) return tile._flora;
  if (!pairs || !pairs.length) return (tile._flora = tile.trees);
  const rest = [], onMed = [];
  for (const tr of tile.trees) {
    let hit = null;
    for (const P of pairs) {
      const n = nearestOnPoly(P.centre, tr.x, tr.y);
      if (n.d <= P.sep / 2 + P.w / 2 + 4 && (!hit || n.d < hit.d)) hit = n;
    }
    if (hit) onMed.push({ x: hit.x, y: hit.y, s: tr.s });
    else rest.push(tr);
  }
  // thin: walk the merged row in order and drop anything crowding its neighbour
  onMed.sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const kept = [];
  for (const tr of onMed) {
    const last = kept[kept.length - 1];
    if (last && Math.hypot(tr.x - last.x, tr.y - last.y) < MERGE_GAP) continue;
    kept.push(tr);
  }
  return (tile._flora = rest.concat(kept));
}

export {
  nearestOnPoly, paintPalm, paintRoadsideTrees, paintTree, species,
  paintWoods, roadsideTrees, tileTrees,
};
