// LA ARBOLEDA — every plant in this world, drawn from ONE idiom.
//
// There are three species and they used to be three unrelated drawings: the
// almendro (`paintTree`) was a stack of hard circles, the palma (`paintPalm`) a
// ring of ellipses, and the mangle (`paintMangrove`, ground.js) a set of ragged
// blobs with a pale ring stroked round it. Side by side they did not read as
// the same hand, and the mangrove's ring read as a white outline round a tree.
//
// So the vocabulary is shared and lives here:
//   * `canopyPath` — a canopy is a SOFT, SLIGHTLY RAGGED BLOB, never a circle
//     and never an outline. Every species builds its crown out of a small stack
//     of them (the mangrove included: ground.js imports this one).
//   * `CANOPY` — one palette, dark → light, so a crown is lit the same way
//     wherever it stands.
//   * `plantShadow` — one shadow ellipse, offset the same way, sized off the
//     same scale.
//   * `hash01` — the ONLY source of variation. No `Math.random` in a draw call:
//     a tree that changes shape every frame is a tree that shimmers.
//
// A palm stays a palm — fronds, a leaning trunk, its own sway — but it takes
// its shadow, its scale and its seed from the same three lines as the rest.
import { WORLD2D as W } from "../../world2d/index.js";
import { SURFACE } from "../../game/surfaces.js";
import { ACERA_PX, ctx, hash01 } from "./gfx.js";

// The one palette. Dark body → mid → highlight, plus the two trunks.
const CANOPY = ["#276b3f", "#358a4d", "#4aa863", "#5fc07a"];
const TRUNK_TREE = "#6a4426";
const TRUNK_PALM = "#7a4f2a";
const PLANT_SHADOW = "rgba(0,0,0,0.24)";

// A SOFT, ragged closed blob, stable for a given seed. Slightly squashed on y
// so it reads as a crown seen from above rather than a disc.
//
// The ragged radii are laid out on a ring and then the outline is drawn as a
// quadratic spline THROUGH THE MIDPOINTS of that ring, each vertex acting as a
// control point. Joining them with straight lines instead — which is what this
// did while it lived in ground.js and only ever drew 26 px mangroves — turns
// into a visible polygon the moment the crown is a 10 px street tree under a
// 5.5× camera: eleven flat facets, which is a gem, not a canopy.
const _bx = [], _by = [];
function canopyPath(cx, cy, R, seed, wob = 0.22, n = 13) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed * 0.7;
    const rr = R * (1 - wob + wob * 2 * hash01(seed * 91.7 + i * 3.13));
    _bx[i] = cx + Math.cos(a) * rr;
    _by[i] = cy + Math.sin(a) * rr * 0.86;
  }
  ctx.beginPath();
  ctx.moveTo((_bx[n - 1] + _bx[0]) / 2, (_by[n - 1] + _by[0]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ctx.quadraticCurveTo(_bx[i], _by[i], (_bx[i] + _bx[j]) / 2, (_by[i] + _by[j]) / 2);
  }
  ctx.closePath();
}

// The one shadow: an ellipse thrown down and to the right, sized off the crown.
function plantShadow(x, y, R) {
  ctx.fillStyle = PLANT_SHADOW;
  ctx.beginPath();
  ctx.ellipse(x + R * 0.5, y + R * 0.42, R * 1.12, R * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
}

// A seed a plant carries for its whole life: its own position, nothing else.
function plantSeed(x, y) { return hash01(x * 0.0173 + y * 0.0131); }

// The crown every species shares: three ragged blobs, dark body under a mid
// tone under a highlight, each offset up and to one side by the seed.
function paintCanopy(x, y, R, seed) {
  const jx = (hash01(seed * 7.7) - 0.5) * R * 0.22;
  const jy = (hash01(seed * 11.3) - 0.5) * R * 0.18;
  ctx.fillStyle = CANOPY[1];
  canopyPath(x + jx, y + jy, R, seed, 0.16, 11); ctx.fill();
  ctx.fillStyle = CANOPY[2];
  canopyPath(x + jx - R * 0.16, y + jy - R * 0.20, R * 0.68, seed + 2.3, 0.18, 10); ctx.fill();
  ctx.fillStyle = CANOPY[3];
  canopyPath(x + jx + R * 0.26, y + jy - R * 0.26, R * 0.36, seed + 5.1, 0.20, 9); ctx.fill();
}

// EL ALMENDRO. Shadow, a short trunk, the shared crown over it.
function paintTree(tr) {
  const s = tr.s || 1, R = 9.5 * s;
  const seed = plantSeed(tr.x, tr.y);
  plantShadow(tr.x, tr.y + 3, R);
  ctx.strokeStyle = TRUNK_TREE; ctx.lineWidth = 2.5 * s; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(tr.x, tr.y + 3); ctx.lineTo(tr.x, tr.y - 7 * s); ctx.stroke();
  paintCanopy(tr.x, tr.y - 11 * s, R, seed);
}

// LA PALMA. Same shadow, same seed, same palette — but a crown of fronds on a
// leaning trunk, because a palm is a different tree and has to stay one.
function paintPalm(pa, t) {
  const s = pa.s || 1, R = 11 * s;
  const seed = plantSeed(pa.x, pa.y);
  const sway = Math.sin(t * 0.001 + (pa.sway || 0)) * 2;
  plantShadow(pa.x, pa.y + 4, R);
  ctx.strokeStyle = TRUNK_PALM; ctx.lineWidth = 3 * s; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(pa.x, pa.y + 4); ctx.lineTo(pa.x + sway, pa.y - 16 * s); ctx.stroke();
  const cx = pa.x + sway, cy = pa.y - 16 * s, n = 6;
  ctx.fillStyle = CANOPY[2];
  for (let i = 0; i < n; i++) {
    // each frond turned a little off its slot by the palm's own seed, so a row
    // of palms is a row of individuals and not one stamp repeated
    const a = (i / n) * Math.PI * 2 + sway * 0.06 + (hash01(seed * 31.1 + i) - 0.5) * 0.22;
    const len = R * (0.86 + hash01(seed * 17.9 + i * 2.7) * 0.28);
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * len, cy + Math.sin(a) * len * 0.46,
                9 * s, 3.2 * s, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = CANOPY[0];
  canopyPath(cx, cy, 2.9 * s, seed + 3.7, 0.2, 8); ctx.fill();
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
  CANOPY, canopyPath, nearestOnPoly, paintPalm, paintRoadsideTrees, paintTree,
  roadsideTrees, tileTrees,
};
