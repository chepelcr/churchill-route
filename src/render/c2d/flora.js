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
import { ACERA_PX, ctx, flatPath, hash01 } from "./gfx.js";
import FLORA from "../../assets/flora.json" with { type: "json" };

// THE SPECIES ARE DATA, THE FORMS ARE CODE. `src/assets/flora.json` says what a
// guanacaste is — palette, crown radius, trunk height, which form draws it — and
// the four `paint*Form` functions below say what a broadleaf, a conifer, a column
// and a bare tree ARE. That split is deliberate: a silhouette is geometry and
// belongs in a renderer; a species is a row somebody should be able to add.
const SPECIES = FLORA.species;
const DEFAULT_SPECIES = "almendro";

// EVERY PLANT IN THIS WORLD IS A ROW, including the two that are not "trees".
// The palma and the mangle used to be drawn from hardcoded numbers and to take
// their greens from `CANOPY` — which is the ALMENDRO's array — so editing one
// tree in the registry silently restyled every frond and every mangrove in the
// world. They have their own rows now, with the same values, so the look is
// unchanged and the coupling is gone.
const CANOPY = SPECIES[DEFAULT_SPECIES].canopy;   // still the almendro's, by name
const TRUNK_TREE = SPECIES[DEFAULT_SPECIES].trunk;
const PLANT_SHADOW = "rgba(0,0,0,0.24)";

/** A species row by name, falling back to the almendro. */
function species(name) { return SPECIES[name] || SPECIES[DEFAULT_SPECIES]; }

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

// The crown of ANY species: the same three-blob stack, in that species' palette
// and about its own centre. `spread` widens it without making it taller, which
// is the whole difference between an almendro and a guanacaste.
function paintCrown(x, y, R, seed, pal, spread = 1) {
  const jx = (hash01(seed * 7.7) - 0.5) * R * 0.22;
  const jy = (hash01(seed * 11.3) - 0.5) * R * 0.18;
  const W3 = R * spread;
  ctx.fillStyle = pal[1];
  canopyPath(x + jx, y + jy, W3, seed, 0.16, 11); ctx.fill();
  ctx.fillStyle = pal[2];
  canopyPath(x + jx - W3 * 0.16, y + jy - R * 0.20, W3 * 0.68, seed + 2.3, 0.18, 10); ctx.fill();
  ctx.fillStyle = pal[3] || pal[2];
  canopyPath(x + jx + W3 * 0.26, y + jy - R * 0.26, W3 * 0.36, seed + 5.1, 0.20, 9); ctx.fill();
}

// ---- the four FORMS. Everything else about a tree is a row in flora.json ----

// BROADLEAF — the almendro, the guanacaste, the cortez in bloom, the cerezo.
function paintBroadleaf(x, y, s, seed, sp) {
  const R = sp.r * s, spread = sp.spread || 1;
  plantShadow(x, y + 3, R * spread);
  ctx.strokeStyle = sp.trunk; ctx.lineWidth = 2.5 * s * (sp.spread || 1); ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x, y - sp.trunkH * s); ctx.stroke();
  paintCrown(x, y - (sp.trunkH + 4) * s, R, seed, sp.canopy, spread);
}

// CONIFER — tiers narrowing upward. A pine from above is not a blob: it is a
// cone, and what says so is that each tier is smaller AND higher than the last.
function paintConifer(x, y, s, seed, sp) {
  const R = sp.r * s, tiers = sp.tiers || 3;
  plantShadow(x, y + 3, R * 0.9);
  ctx.strokeStyle = sp.trunk; ctx.lineWidth = 2.2 * s; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x, y - sp.trunkH * s); ctx.stroke();
  // Bottom skirt first, tip last. The tiers OVERLAP heavily — spaced well under
  // their own radius — because three well-separated blobs read as three blobs,
  // which is what the first attempt looked like. Overlapping them merges the
  // profile into one triangle and the tier edges become the pine's steps.
  for (let i = 0; i < tiers; i++) {
    const k = i / (tiers - 1 || 1);                 // 0 at the skirt, 1 at the tip
    // EVERY TIER ITS OWN SHADE, walking dark → light up the tree. Giving the
    // lower three the same colour is what made the first attempt a pear with a
    // bobble on top: same-coloured overlapping blobs have no internal edges, so
    // the whole skirt read as one ball and only the small top tiers showed.
    const shade = sp.canopy[Math.min(sp.canopy.length - 1,
                                     1 + Math.round(k * (sp.canopy.length - 2)))];
    ctx.fillStyle = shade;
    canopyPath(x, y - (sp.trunkH + 2) * s - k * R * 1.7,
               R * (1 - k * 0.68), seed + i * 3.7, 0.09, 9);
    ctx.fill();
  }
}

// COLUMN — the ciprés. Tall and narrow, drawn as overlapping crowns up a line so
// it keeps the ragged edge instead of becoming a rectangle.
function paintColumn(x, y, s, seed, sp) {
  const R = sp.r * s, H = (sp.height || 2.4) * R;
  plantShadow(x, y + 3, R * 0.8);
  // Many steps, barely narrowing, spaced far closer than their own radius: the
  // crowns fuse into ONE column with a ragged edge. At four steps and a 35 %
  // taper they stayed separate and the tree read as a snowman.
  const steps = 9;
  for (let i = 0; i < steps; i++) {
    const k = i / (steps - 1);
    // one shade for the body, the lighter one only on the top third, so the
    // column has a lit tip instead of a band across its middle
    ctx.fillStyle = k > 0.68 ? sp.canopy[2] : sp.canopy[1];
    canopyPath(x, y - sp.trunkH * s - k * H, R * (1 - k * 0.18), seed + i * 4.1, 0.12, 9);
    ctx.fill();
  }
}

// BARE — the dry season, and the dead tree. No crown: the silhouette IS the
// branches, so they get drawn properly rather than as a stick.
function paintBare(x, y, s, seed, sp) {
  const H = sp.trunkH * s, R = sp.r * s, n = sp.branches || 5;
  plantShadow(x, y + 3, R * 0.5);
  ctx.strokeStyle = sp.trunk; ctx.lineCap = "round";
  ctx.lineWidth = 2.4 * s;
  ctx.beginPath(); ctx.moveTo(x, y + 3); ctx.lineTo(x, y - H); ctx.stroke();
  ctx.lineWidth = 1.4 * s;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (hash01(seed * 13.7 + i * 2.9) - 0.5) * 2.2;
    const len = R * (0.55 + hash01(seed * 23.3 + i) * 0.6);
    const bx = x + Math.cos(a) * len, by = y - H + Math.sin(a) * len * 0.8;
    ctx.moveTo(x, y - H * (0.72 + hash01(seed * 5.1 + i) * 0.26));
    ctx.lineTo(bx, by);
    // one fork, so it reads as a tree and not as a asterisk
    const a2 = a + (hash01(seed * 31.1 + i) - 0.5) * 0.8;
    ctx.lineTo(bx + Math.cos(a2) * len * 0.5, by + Math.sin(a2) * len * 0.4);
  }
  ctx.stroke();
}

const FORMS = {
  broadleaf: paintBroadleaf, conifer: paintConifer,
  column: paintColumn, bare: paintBare,
};

/** Draw one tree of any species. `tr.k` names it; no `k` is the almendro. */
function paintTree(tr) {
  const sp = SPECIES[tr.k] || SPECIES[DEFAULT_SPECIES];
  (FORMS[sp.form] || paintBroadleaf)(tr.x, tr.y, tr.s || 1, plantSeed(tr.x, tr.y), sp);
}

// LA PALMA. Same shadow, same seed, same palette — but a crown of fronds on a
// leaning trunk, because a palm is a different tree and has to stay one.
function paintPalm(pa, t) {
  const sp = species(pa.k || "palma");
  const s = pa.s || 1, R = sp.r * s;
  const seed = plantSeed(pa.x, pa.y);
  const sway = Math.sin(t * 0.001 + (pa.sway || 0)) * 2;
  plantShadow(pa.x, pa.y + 4, R);
  ctx.strokeStyle = sp.trunk; ctx.lineWidth = 3 * s; ctx.lineCap = "butt";
  ctx.beginPath(); ctx.moveTo(pa.x, pa.y + 4); ctx.lineTo(pa.x + sway, pa.y - sp.trunkH * s); ctx.stroke();
  const cx = pa.x + sway, cy = pa.y - sp.trunkH * s, n = sp.fronds || 6;
  ctx.fillStyle = sp.canopy[2];
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
  ctx.fillStyle = sp.canopy[0];
  canopyPath(cx, cy, 2.9 * s, seed + 3.7, 0.2, 8); ctx.fill();
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
  const weights = mix.weights;
  let total = 0;
  for (const [, w] of weights) total += w;
  let roll = hash01(gx * 3.71 + gy * 7.13 + 41.9) * total;
  for (const [name, w] of weights) {
    roll -= w;
    if (roll <= 0) return name;
  }
  return weights[weights.length - 1][0];
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
      ctx.fillStyle = mix.floor || "rgba(72,108,56,0.52)";
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
  CANOPY, canopyPath, nearestOnPoly, paintPalm, paintRoadsideTrees, paintTree,
  species,
  paintWoods,
  roadsideTrees, tileTrees,
};
