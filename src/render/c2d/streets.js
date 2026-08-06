// Street layer: the multi-pass road painter (acera → casing → asphalt → lane
// dashes), per-tile rails/medians, street name pills and the lock barriers.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { t } from "../../i18n/index.js";
import { dashPath, roadPath } from "./cache.js";
import { nearestOnPoly } from "./flora.js";
import { ACERA_PX, aabbInView, ctx, drawParada, flatAABB, flatMultiPath, flatPath, label, parcelFrame, roundRect } from "./gfx.js";

// Estadios are NOT a structure drawn over the ground — they are a COLOUR
// CHOICE inside the acera pass. The build traces each one from the real cuadra
// (S.footprint, organic, following the manzana's true grid angles), and here
// that polygon is simply painted as grass with its pitch markings instead of
// the usual concrete. Drawn between the acera band and the casing/asphalt, so
// (a) it covers the sidewalk band the road pass just laid over the block —
// which is what lets Las Playitas read as ONE green field edge to edge — while
// the asphalt pass repaints anything that reached the roadway, and (b) street
// name pills, buildings and flora still land on top, instead of being buried
// the way they were when the stadium was a later layer.
// Centre, tilt and half-extents of a field, all of them now from the WORLD:
// every parcel and both estadios emit `ang`, `hw` and `hh`. The principal-axis
// fallback this used to carry is gone — these polygons are RASTER-TRACED, so
// their vertices are 4 px staircase steps, and fitting a square-ish one lands
// on the CONTRARY diagonal to the block (Plaza El Carmen fitted to -67°, its
// cuadra actually sits at -4.5°). See `parcelFrame`.
function fieldFrame(S) {
  if (S._frame) return S._frame;
  let { cx, cy, ang, hw, hh } = parcelFrame(S);
  // Long axis = the scoring axis. Lito Pérez and Las Playitas therefore put
  // their goals at the west/east centres; El Carmen's taller parcel takes this
  // quarter turn and puts its smaller goals at the north/south centres.
  if (hh > hw) { ang += Math.PI / 2; const t = hw; hw = hh; hh = t; }
  return (S._frame = { cx, cy, ang, hw, hh });
}

// Poured concrete, the colour the aceras actually are in the port.
const ACERA_GREY = "#b8b6b0";
// …and the caño: the drainage channel at the kerb, cast in the same concrete
// but permanently damp and stained, so it reads a full step darker.
const CANO_GREY = "#807e77";
const CANO_PX = 4;                       // depth of the gutter, per side

const MARK = "rgba(255,255,255,0.75)";   // every line on a field is this one white
// Grass, mow stripes and fútbol markings inside `path`, all drawn in the
// FIELD's OWN frame rather than on screen axes — Las Playitas sits on the
// diagonal street grid and Plaza El Carmen on a slanted manzana, and
// axis-aligned stripes with a square white box on a tilted field read as a
// mistake. Shared by the whole-cuadra estadios and by plaza/stadium parcels, so
// a plaza gets exactly the estadio's field.
function paintField(path, F, sport) {
  ctx.save();
  ctx.clip(path, "evenodd");
  const court = sport === "basketball" || sport === "skateboard";
  // A basketball court is CONCRETE, not grass. Painting 21 of them green with
  // a halfway line and a centre circle is what made them read as stray white
  // rectangles on the map.
  ctx.fillStyle = court ? "#9a9c93" : "#4f9d5b"; ctx.fill(path, "evenodd");
  ctx.translate(F.cx, F.cy); ctx.rotate(F.ang);
  const hw = F.hw, hh = F.hh;
  if (court) { paintCourt(hw, hh); ctx.restore();
    ctx.strokeStyle = "rgba(240,238,230,0.5)"; ctx.lineWidth = 2; ctx.stroke(path); return; }
  ctx.fillStyle = "rgba(30,88,50,0.16)";                   // mow stripes, along the pitch
  for (let sy = -hh; sy < hh; sy += 14) ctx.fillRect(-hw, sy, hw * 2, 7);
  // LEVEL OF DETAIL. 27 of the map's canchas are under 60 px on their short
  // side; a halfway line and a centre circle on a 16x28 px pitch is not a
  // football pitch, it is two white marks and an outline. Below the threshold
  // the grass and the kerb say everything.
  if (Math.min(hw, hh) < 22) {
    ctx.restore();
    ctx.strokeStyle = MARK; ctx.lineWidth = 2; ctx.stroke(path);
    return;
  }
  // THE TOUCHLINE IS THE CUADRA'S OWN EDGE — there is no second boundary. A
  // strokeRect off the frame's extents drew a rectangle INSIDE the traced
  // outline: two white boundaries on every field, and the inner one the wrong
  // shape on an organic or diagonal block. The one line left is the footprint
  // itself, stroked once below.
  //
  // Everything else is drawn at FULL extent and trimmed by the clip, so a
  // marking meets the touchline exactly instead of guessing where the edge is.
  // Level of detail by size: a real penalty area shares its goal line with the
  // touchline, so on a SMALL pitch its stroke lands on top of the boundary (and
  // the goal box on top of that) and the whole end reads as doubled lines. Lito
  // Pérez is 116 px across — below the threshold it keeps the clean set:
  // halfway line and centre circle. La Plaza is nearly twice that.
  const m = Math.max(6, Math.min(hw, hh) * 0.10);          // marking inset
  ctx.strokeStyle = MARK; ctx.lineWidth = 2; ctx.fillStyle = MARK;
  ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(0, hh); ctx.stroke();       // halfway line
  ctx.beginPath(); ctx.arc(0, 0, Math.min(hw, hh) * 0.26, 0, Math.PI * 2); ctx.stroke();
  paintGoals(hw, hh);
  if (hw >= 80 && hh >= 55) {
    ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();          // centre spot
    const bw = Math.min(hw * 0.28, hh * 0.9);              // penalty area depth
    const bh = Math.max(12, Math.min(hh - m - 4, hh * 0.60));
    for (const sd of [-1, 1]) {
      const x0 = sd < 0 ? -hw + m : hw - m - bw;
      ctx.strokeRect(x0, -bh, bw, bh * 2);                                     // penalty area
      const gx = sd < 0 ? -hw + m : hw - m - bw * 0.38;
      ctx.strokeRect(gx, -bh * 0.45, bw * 0.38, bh * 0.9);                     // goal box
      ctx.beginPath(); ctx.arc(sd * (hw - m - bw * 0.72), 0, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  ctx.strokeStyle = MARK; ctx.lineWidth = 2; ctx.stroke(path);   // touchline = kerb = the cuadra
}

// Goal frames sit at the centre of the two scoring ends. Their mouth and depth
// come from the pitch's short side, so El Carmen gets recognisably smaller
// porterías than the two full-size stadiums instead of a copied fixed graphic.
// The frame opens toward the touchline and stays inside the field clip.
function paintGoals(hw, hh) {
  const mouth = Math.max(5, Math.min(18, hh * 0.24));
  const depth = Math.max(3, Math.min(8, mouth * 0.42));
  ctx.strokeStyle = "rgba(255,255,255,0.92)";
  ctx.lineWidth = Math.max(1.4, Math.min(2.4, hh * 0.035));
  ctx.lineJoin = "miter";
  for (const side of [-1, 1]) {
    const x = side * hw;
    const inner = x - side * depth;
    ctx.beginPath();
    ctx.moveTo(x, -mouth);
    ctx.lineTo(inner, -mouth);
    ctx.lineTo(inner, mouth);
    ctx.lineTo(x, mouth);
    ctx.stroke();
  }
}

// A cancha multiuso: the key at each end, the centre circle and the two hoops,
// drawn in the court's own frame (already translated/rotated by the caller).
// Same level-of-detail rule as the pitch — a court too small for its markings
// gets the plain slab.
function paintCourt(hw, hh) {
  if (Math.min(hw, hh) < 14) return;
  ctx.strokeStyle = "rgba(240,238,230,0.72)"; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(0, hh); ctx.stroke();   // halfway
  ctx.beginPath(); ctx.arc(0, 0, Math.min(hw, hh) * 0.26, 0, Math.PI * 2); ctx.stroke();
  const kw = Math.min(hw * 0.30, hh * 0.85), kh = Math.min(hh * 0.52, hw * 0.5);
  for (const sd of [-1, 1]) {
    const x0 = sd < 0 ? -hw + 2 : hw - 2 - kw;
    ctx.strokeRect(x0, -kh, kw, kh * 2);                                  // the key
    ctx.beginPath(); ctx.arc(sd < 0 ? x0 + kw : x0, 0, kh * 0.55, 0, Math.PI * 2); ctx.stroke();
    // the hoop: backboard on the end line with the ring in front of it
    ctx.fillStyle = "rgba(240,238,230,0.9)";
    ctx.fillRect(sd < 0 ? -hw + 1 : hw - 3, -3.2, 2, 6.4);
    ctx.strokeStyle = "#e07a42"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(sd * (hw - 5), 0, 2.4, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(240,238,230,0.72)"; ctx.lineWidth = 1.6;
  }
}

function paintStadiumCuadras(view) {
  const arr = W.STADIUMS;
  if (!arr || !arr.length) return;
  for (const S of arr) {
    if (S.x1 + 40 < view.x0 || S.x0 - 40 > view.x1 || S.y1 + 40 < view.y0 || S.y0 - 40 > view.y1) continue;
    if (!S.footprint) continue;
    // The builder emits two real polygons: `outline` is the entire stadium
    // cuadra and `footprint` is the cancha inset by FIELD_ACERA_CELLS. Paint
    // the full outer shape first; the pitch below covers its centre and leaves
    // precisely the generated acera ring visible around it.
    if (S.outline && S.aceras !== false) {
      const acera = S._acera || (S._acera = flatPath(S.outline, true));
      ctx.fillStyle = S.aceraColor || ACERA_GREY;
      ctx.fill(acera, "evenodd");
    }
    const pitch = S._pitch || (S._pitch = flatPath(S.footprint, true));
    // 4 px of grass dilation first: the traced pitch steps in 4 px raster
    // increments, so its edge and the acera band don't meet exactly and a hair
    // of bare ground shows through at the seam.
    ctx.strokeStyle = "#4f9d5b"; ctx.lineWidth = 8; ctx.lineJoin = "miter"; ctx.stroke(pitch);
    paintField(pitch, fieldFrame(S), S.sport);
  }
}

// Parcel ground. Same reasoning as the estadios: a parcel is a colour choice
// on ground that already exists, painted between the acera band and the
// asphalt — so the asphalt repaints anything that reached the roadway, and
// street pills, buildings and flora still land on top.
// A school's ground is its PATIO, not a lawn: the swept concrete-and-earth
// yard every escuela in the port has, so it reads as a schoolyard beside the
// green of a park rather than as one more park.
const PARCEL_FILL = { plaza: "#4f9d5b", stadium: "#4f9d5b", garden: "#5ba362",
                      park: "#5ba362", church: "#cfc7b4", cathedral: "#cfc7b4",
                      boulevard: "#d9d6cd", civic: "#c9c2b2", lot: "#b9b2a0",
                      school: "#c8bb96", kinder: "#d3b98f", campus: "#bfb894",
                      fuel: "#8e9299" };
function paintParcels(view) {
  const arr = W.PARCELS;
  if (!arr || !arr.length) return;
  for (const P of arr) {
    if (P.x1 + 40 < view.x0 || P.x0 - 40 > view.x1 || P.y1 + 40 < view.y0 || P.y0 - 40 > view.y1) continue;
    // `whole` = a full cuadra already painted by paintStadiumCuadras; `built` =
    // the footprint IS a building. Either way the ground is not ours to paint,
    // only the sponsor slot on top of it.
    if (P.whole || P.built) continue;
    // Preserve the emitted polygon. Raster-owned parcels are vector-straightened
    // by the build (their exact cells still own collision and occupancy), so a
    // diagonal manzana reads as one direct edge instead of 4 px stair steps.
    const hasPolys = P.polys && P.polys.length;
    const path = P._path || (P._path = hasPolys ? flatMultiPath(P.polys) : flatPath(P.poly, true));
    ctx.fillStyle = PARCEL_FILL[P.use] || "#b9b2a0";
    ctx.lineJoin = "miter";
    if (!hasPolys) {
      ctx.lineWidth = 8;
      ctx.strokeStyle = ctx.fillStyle; ctx.stroke(path); // hide the 4px raster steps
    }
    ctx.fill(path, "evenodd");
    // An open field gets the estadio's own painter, in the MANZANA's frame
    // (P.ang) — the markings used to be strokeRect'd off the bbox, which put a
    // square pitch on a slanted block.
    if (P.use === "plaza" || P.use === "stadium") { paintField(path, fieldFrame(P), P.sport); continue; }
    if (P.use === "boulevard") { paintStone(path, P); continue; }
    ctx.strokeStyle = "rgba(232,226,210,0.68)"; ctx.lineWidth = 2; ctx.stroke(path); // curb
  }
}

// A calle peatonal: light-grey paving in a running-bond stone pattern, laid in
// the MANZANA's frame so the courses run with the block, not with the screen.
// It is a colour choice on ground the road pass already laid, exactly like the
// estadio pitches — the surface underneath is Surface.BOULEVARD (transitable),
// and the asphalt pass still repaints anything that reached the roadway.
const STONE = 11;                                  // px per paving stone course
function paintStone(path, P) {
  ctx.save();
  ctx.clip(path, "evenodd");
  const F = parcelFrame(P);
  const R = Math.hypot(F.hw, F.hh) + STONE * 2;
  ctx.translate(F.cx, F.cy); ctx.rotate(F.ang);
  ctx.strokeStyle = "rgba(120,116,106,0.38)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let v = -R; v <= R; v += STONE) {           // courses along the avenidas
    ctx.moveTo(-R, v); ctx.lineTo(R, v);
  }
  // running bond: every other course offset half a stone, so the joints stagger
  let row = 0;
  for (let v = -R; v <= R; v += STONE, row++) {
    const off = row % 2 ? STONE : 0;
    for (let u = -R + off; u <= R; u += STONE * 2) {
      ctx.moveTo(u, v); ctx.lineTo(u, v + STONE);
    }
  }
  ctx.stroke();
  ctx.restore();
  // kerb: a touch darker than the paving so the calle reads as a defined space
  ctx.strokeStyle = "rgba(150,146,136,0.75)"; ctx.lineWidth = 2; ctx.stroke(path);
}

// Multi-pass road styling (acera band → casing → asphalt → lane dashes),
// ported from the corridor renderer but fed per-tile road segments.
function paintRoads(roads, view) {
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // elevated (barro/Ferrocarril) drop-shadow
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  for (const r of roads) { if (!r.elev) continue; ctx.save(); ctx.translate(0, 3.5); ctx.lineWidth = r.w + 2 * ACERA_PX + 3; ctx.stroke(roadPath(r)); ctx.restore(); }
  // acera concrete band. GREY, not the sandy cream it used to be: the aceras in
  // Puntarenas are poured concrete, and a warm band beside warm ground made the
  // whole town read as one colour.
  ctx.strokeStyle = ACERA_GREY;
  for (const r of roads) { if (r.bridge || r.cls === "bridge") continue; ctx.lineWidth = r.w + 2 * ACERA_PX; ctx.stroke(roadPath(r)); }
  // acera joint discs at each piece endpoint: they weld chained pieces so the
  // band has no seam. Inscribed in the junction's plus, so they round NOTHING
  // and leave the cuadras' square corner geometry untouched.
  ctx.fillStyle = ACERA_GREY;
  for (const r of roads) {
    if (r.bridge || r.cls === "bridge") continue;
    const p = r.pts, n = p.length, rad = r.w / 2 + ACERA_PX;
    ctx.beginPath();
    ctx.moveTo(p[0] + rad, p[1]); ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
    ctx.moveTo(p[n - 2] + rad, p[n - 1]); ctx.arc(p[n - 2], p[n - 1], rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // estadios: the same sidewalk, repainted grey after the acera bands and
  // joint discs, before the asphalt so the asphalt wins
  paintStadiumCuadras(view);
  paintParcels(view);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // barro shoulder
  ctx.strokeStyle = "#7d6242";
  for (const r of roads) { if (!r.barro && !r.gravel) continue; ctx.lineWidth = r.w + 2 * ACERA_PX; ctx.stroke(roadPath(r)); }
  // bridge deck
  ctx.strokeStyle = "#cfc3a3";
  for (const r of roads) { if (!r.bridge) continue; ctx.lineWidth = r.w + 10; ctx.stroke(roadPath(r)); }
  // Casing + asphalt use BUTT caps: round caps bulge a half-circle past
  // each piece's endpoint, smearing dark arcs onto the sidewalks at every
  // junction ("little curves in the aceras"). Joins stay round for curves.
  ctx.lineCap = "butt";
  // casing
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  for (const r of roads) { ctx.lineWidth = r.w + 4; ctx.stroke(roadPath(r)); }
  // EL CAÑO: the open gutter between the kerb and the asphalt, which in
  // Puntarenas is a real, visible channel running the length of every calle —
  // it is how the town drains in the aguaceros. Drawn as the outer strip of the
  // acera in a darker concrete, with BUTT caps (inherited above) so it stops at
  // the esquina exactly like the real one does at the tragante, instead of
  // sweeping a dark arc across the junction mouth.
  ctx.strokeStyle = CANO_GREY;
  for (const r of roads) {
    // no caño on an unpaved street: there is no kerb to run one along
    if (r.bridge || r.cls === "bridge" || r.barro || r.gravel) continue;
    ctx.lineWidth = r.w + 2 * CANO_PX; ctx.stroke(roadPath(r));
  }
  // asphalt / barro / paseo surface + SAME-COLOR joint discs at both piece
  // ends: they invisibly weld chained pieces (keeps the León Cortés →
  // Turistas curve smooth) and unify junction mouths, without the visible
  // "mini circles" a contrasting eraser disc would leave.
  for (const r of roads) {
    const col = r.barro ? "#9c7a4f" : r.gravel ? "#a99d8b"
      : r.cls === "paseo" ? "#f4dca3" : "#3a3540";
    ctx.strokeStyle = col; ctx.lineWidth = r.w; ctx.stroke(roadPath(r));
    const p = r.pts, n = p.length, rad = r.w / 2 - 0.4;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(p[0] + rad, p[1]); ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
    ctx.moveTo(p[n - 2] + rad, p[n - 1]); ctx.arc(p[n - 2], p[n - 1], rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // lane markings: yellow dashes on arterials, faint white on locals —
  // drawn on the TRIMMED path so they stop short of the junctions
  for (const r of roads) {
    if (r.barro || r.gravel) continue;   // nobody paints lines on lastre
    const cls = r.cls;
    if (cls === "trunk" || cls === "trunk_link" || cls === "primary" || cls === "primary_link") { ctx.strokeStyle = "#f8d76b"; ctx.lineWidth = 2; ctx.setLineDash([18, 18]); }
    else if (cls === "secondary" || cls === "tertiary" || cls === "tertiary_link" || cls === "residential" || cls === "unclassified") { ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([6, 10]); }
    else continue;
    const dp = dashPath(r);
    if (dp) ctx.stroke(dp);
    ctx.setLineDash([]);
  }
  ctx.lineCap = "butt";
}

// Per-tile Ferrocarril rail pieces: ballast bed + ties + two steel rails.
// Decorative (not drivable), drawn on the ground over the roads.
function paintTileRails(rails, view) {
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const rl of rails) {
    if (!rl.aabb) rl.aabb = flatAABB(rl.pts);
    if (!aabbInView(rl.aabb, view, 12)) continue;
    const p = rl.pts;
    // ballast bed
    ctx.strokeStyle = "rgba(120,104,84,0.5)"; ctx.lineWidth = 9;
    ctx.stroke(rl._path || (rl._path = flatPath(p, false)));
    // ties
    ctx.strokeStyle = "#5a4a38"; ctx.lineWidth = 1.6;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i], y0 = p[i + 1], dx = p[i + 2] - x0, dy = p[i + 3] - y0;
      const len = Math.hypot(dx, dy); if (len < 0.001) continue;
      const nx = -dy / len, ny = dx / len;
      for (let s = 0; s < len; s += 7) {
        const t = s / len, cx = x0 + dx * t, cy = y0 + dy * t;
        if (cx < view.x0 - 8 || cx > view.x1 + 8 || cy < view.y0 - 8 || cy > view.y1 + 8) continue;
        ctx.beginPath();
        ctx.moveTo(cx - nx * 5, cy - ny * 5); ctx.lineTo(cx + nx * 5, cy + ny * 5); ctx.stroke();
      }
    }
    // two steel rails, offset either side of the centerline
    ctx.strokeStyle = "#9aa0a6"; ctx.lineWidth = 1.4;
    for (const sgn of [-3.2, 3.2]) {
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const ii = i + 2 < p.length ? i : (i >= 2 ? i - 2 : i);
        const dx = (p[ii + 2] ?? p[ii]) - p[ii], dy = (p[ii + 3] ?? p[ii + 1]) - p[ii + 1];
        const len = Math.hypot(dx, dy) || 1, nx = -dy / len * sgn, ny = dx / len * sgn;
        if (i === 0) ctx.moveTo(p[i] + nx, p[i + 1] + ny); else ctx.lineTo(p[i] + nx, p[i + 1] + ny);
      }
      ctx.stroke();
    }
  }
  ctx.lineCap = "butt";
}

// Per-tile paseo/León Cortés separator strips: the planted green ground the
// palms/almendros stand on, with a darker soil/curb edge.
//
// TWO STRIPS SIDE BY SIDE ARE ONE MEDIAN. Paseo León Cortés is a dual
// carriageway, so the world emits its separator once per carriageway: two
// parallel strips 11 px apart, each drawn with its own kerb and planted with
// its own row of trees. That reads as two thin medians with a seam down the
// middle, which is not what is there — it is one divider anchored on two rails.
// `medianPairs` finds such a pair and `paintMergedMedian` draws it as a single
// planted band with its two rails marked on it.
//
// This is NOT the Paseo de los Turistas' palm median. That one is a SINGLE
// dashed strip down a single carriageway; it never has a partner within
// PAIR_MAX, so `medianPairs` leaves it alone and it is drawn exactly as before.
//
// WIDTH IS BOUNDED BY THE STAMP. Each strip's collision wall is stamped
// PASEO_MEDIAN_W + 6 (16 px) about its own centreline, so the pair's stamped
// walls overlap into one continuous 27 px wall (11 px apart, ±8 px each). The
// merged band is drawn at sep + m.w (21 px) with a 3 px soil edge — 24 px,
// exactly the union the two 13 px kerbs already covered, and inside the stamp.
// Do not widen it past the stamp: the car would reach drawn-but-unstamped rim
// and the both-ends-blocked snap-back traps it there.
const PAIR_MAX = 26;          // px between the two rails of one divider
const MEDIAN_SOIL = "#4f6f34";
const MEDIAN_GRASS = "#79b45c";
const MEDIAN_RAIL = "rgba(58,84,40,0.62)";

// Pair up a tile's median strips. Cached on the tile's median list, since it is
// pure geometry off emitted data. Returns { pairs, singles }; `pairs` carry the
// merged centreline the flora pass plants on.
function medianPairs(tile) {
  if (tile._medPairs) return tile._medPairs;
  const ms = tile.medians || [];
  const taken = new Set(), pairs = [], singles = [];
  for (let i = 0; i < ms.length; i++) {
    if (taken.has(i)) continue;
    for (let j = i + 1; j < ms.length; j++) {
      if (taken.has(j)) continue;
      const sep = railSeparation(ms[i], ms[j]);
      if (sep === null) continue;
      taken.add(i); taken.add(j);
      pairs.push({ a: ms[i], b: ms[j], sep, w: ms[i].w, centre: midPoly(ms[i].pts, ms[j].pts) });
      break;
    }
    if (!taken.has(i)) singles.push(ms[i]);
  }
  return (tile._medPairs = { pairs, singles });
}

// Two strips are one divider only if they run PARALLEL AND CLOSE the whole way:
// sampled across A, every offset to B must be small AND consistent. A pair of
// unrelated strips that happen to touch at one end fails the consistency test.
function railSeparation(A, B) {
  const pts = A.pts, n = pts.length / 2;
  if (n < 3 || B.pts.length < 6) return null;
  let lo = Infinity, hi = 0, sum = 0, k = 0;
  for (let f = 0; f <= 4; f++) {
    const i = Math.min(n - 1, Math.round((f / 4) * (n - 1))) * 2;
    const d = nearestOnPoly(B.pts, pts[i], pts[i + 1]).d;
    if (d > PAIR_MAX || d < 2) return null;
    lo = Math.min(lo, d); hi = Math.max(hi, d); sum += d; k++;
  }
  return hi - lo > 8 ? null : sum / k;
}

// The centreline between two rails: every vertex of A pushed halfway to B.
function midPoly(a, b) {
  const out = [];
  for (let i = 0; i + 1 < a.length; i += 2) {
    const n = nearestOnPoly(b, a[i], a[i + 1]);
    out.push((a[i] + n.x) / 2, (a[i + 1] + n.y) / 2);
  }
  return out;
}

// One divider: a single planted band between the two rails, with the rails
// themselves marked on it as a double anchor line.
function paintMergedMedian(P, view) {
  if (!P._aabb) P._aabb = flatAABB(P.centre);
  const band = P.sep + P.w;
  if (!aabbInView(P._aabb, view, band + 6)) return;
  const path = P._path || (P._path = flatPath(P.centre, false));
  ctx.strokeStyle = MEDIAN_SOIL; ctx.lineWidth = band + 3; ctx.stroke(path);
  ctx.strokeStyle = MEDIAN_GRASS; ctx.lineWidth = band; ctx.stroke(path);
  // the two anchors, on the carriageway centrelines the world actually emitted
  ctx.strokeStyle = MEDIAN_RAIL; ctx.lineWidth = 2;
  for (const m of [P.a, P.b]) ctx.stroke(m._path || (m._path = flatPath(m.pts, false)));
}

function paintTileMedians(tile, view) {
  const { pairs, singles } = medianPairs(tile);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.strokeStyle = MEDIAN_SOIL; // soil / curb edge
  for (const m of singles) {
    if (!m.aabb) m.aabb = flatAABB(m.pts);
    if (!aabbInView(m.aabb, view, m.w + 6)) continue;
    ctx.lineWidth = m.w + 3;
    ctx.stroke(m._path || (m._path = flatPath(m.pts, false)));
  }
  ctx.strokeStyle = MEDIAN_GRASS; // planted grass
  for (const m of singles) {
    if (!aabbInView(m.aabb, view, m.w + 6)) continue;
    ctx.lineWidth = m.w; ctx.stroke(m._path);
  }
  for (const P of pairs) paintMergedMedian(P, view);
  ctx.lineCap = "butt";
}

// Interpolated point + tangent at arclength s along a prepped world-2d road.
function road2dPointAt(r, s) {
  const pts = r.pts, cum = r.cum;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const s0 = cum[i - 1], seg = (cum[i] - s0) || 1;
  const tt = Math.max(0, Math.min(1, (s - s0) / seg));
  const x0 = pts[(i - 1) * 2], y0 = pts[(i - 1) * 2 + 1];
  const x1 = pts[i * 2], y1 = pts[i * 2 + 1];
  return { x: x0 + (x1 - x0) * tt, y: y0 + (y1 - y0) * tt, ang: Math.atan2(y1 - y0, x1 - x0) };
}
// Street names: a small pill every ~900px of arclength on named roads (the
// main-branch feature). Deduped by name+coarse-cell so tile-duplicated road
// copies don't stack labels.
function drawStreetLabels2D(roads, view) {
  ctx.font = "bold 9px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  const seen = new Set();
  for (const r of roads) {
    const lbl = r.name || r.ref;
    if (!lbl || r.len < 200 || r.cls === "pedestrian") continue;
    for (let s = 220; s < r.len; s += 900) {
      const pt = road2dPointAt(r, s);
      if (pt.x < view.x0 - 40 || pt.x > view.x1 + 40 || pt.y < view.y0 - 20 || pt.y > view.y1 + 20) continue;
      const key = lbl + "|" + ((pt.x / 120) | 0) + "|" + ((pt.y / 120) | 0);
      if (seen.has(key)) continue;
      seen.add(key);
      label(pt.x, pt.y + 2, lbl, "#fff", "rgba(20,16,40,0.78)");
    }
  }
}

// ------------------------------------------------------------ barriers ----
// A CLOSURE IS BARRICADES ACROSS THE ROADWAY, NOT A CURTAIN ACROSS THE WORLD.
//
// This used to paint a striped wall down the whole visible height at the
// barrier's x, with cones the entire length: the stripe ran through buildings,
// sand and open sea alike, and read as a screen-door hung over the map. What a
// closed barrio actually looks like is a barricade at the east end of each
// calle that meets the boundary, and nothing at all in between — you can see
// the ground on the far side, you just cannot drive onto it.
//
// So both barrier SHAPES resolve to the same thing: a set of boundary segments
// (a progression barrier is one LINE at `br.x`; the MVP gate is a BOX, and any
// of its four edges may be the one you drove up to), each intersected with the
// roads in view. One barricade per crossing, turned to the street it blocks.
const CONE = "#ff8b3d";
const TAPE_A = "#f3c969", TAPE_B = "#3a3540";

// Where two segments cross, or null. Used to find the calles that reach the
// boundary; everything else about a barrier is drawn from these points.
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const r1 = bx - ax, r2 = by - ay, s1 = dx - cx, s2 = dy - cy;
  const den = r1 * s2 - r2 * s1;
  if (!den) return null;
  const tt = ((cx - ax) * s2 - (cy - ay) * s1) / den;
  const uu = ((cx - ax) * r2 - (cy - ay) * r1) / den;
  if (tt < 0 || tt > 1 || uu < 0 || uu > 1) return null;
  return { x: ax + r1 * tt, y: ay + r2 * tt };
}

// Every road piece crossing the boundary segment, with the point, the street's
// heading there and its width. Deduped on a coarse cell: a road that straddles
// a tile edge is stored in BOTH tiles, and two barricades stacked on the same
// calle read as a smear.
function roadCrossings(ax, ay, bx, by, view) {
  const out = [], seen = new Set();
  for (const tile of W.visibleTiles(view.x0, view.y0, view.x1, view.y1)) {
    for (const r of tile.roads) {
      if (!aabbInView(r.aabb, view, r.w + 8)) continue;
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const hit = segCross(p[i], p[i + 1], p[i + 2], p[i + 3], ax, ay, bx, by);
        if (!hit) continue;
        const key = ((hit.x / 10) | 0) + "|" + ((hit.y / 10) | 0);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ x: hit.x, y: hit.y, w: r.w,
                   ang: Math.atan2(p[i + 3] - p[i + 1], p[i + 2] - p[i]) });
      }
    }
  }
  return out;
}

// One barricade: the striped bar laid ACROSS the lane it closes (drawn in the
// street's own frame, so it turns with a diagonal avenida) and a cone standing
// off each kerb.
function drawBarricade(c) {
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate(c.ang);                       // +x runs with the street
  const hw = c.w / 2 + 2;                  // just past each kerb
  const segH = 11;
  for (let v = -hw, k = 0; v < hw; v += segH, k++) {
    ctx.fillStyle = k % 2 ? TAPE_A : TAPE_B;
    ctx.fillRect(-4, v, 8, Math.min(segH, hw - v));
  }
  for (const sd of [-1, 1]) {
    const cy = sd * (hw + 4);
    ctx.fillStyle = CONE;
    ctx.beginPath();
    ctx.moveTo(-6, cy + 3 * sd); ctx.lineTo(0, cy - 3 * sd); ctx.lineTo(6, cy + 3 * sd);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillRect(-2, cy - 0.5, 4, 1.4);
  }
  ctx.restore();
}

// The sign — the ONLY thing that tells the player why the calle is shut, so it
// stays. One per barrier, on the barricade nearest the middle of the view (so
// it is readable from whichever street you drove up), standing just short of
// the bar on the approach side.
function drawBarrierSign(br, c, view) {
  const dstr = W.DISTRICTS.find((d) => d.id === br.district);
  const dname = dstr ? dstr.name : br.district.toUpperCase();
  const sw = 138, sh = 40;
  const sx = c.x, sy = c.y - c.w / 2 - 6 - sh / 2;
  ctx.fillStyle = "rgba(20,16,40,0.88)";
  ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, sh);
  ctx.fillStyle = dstr ? dstr.tone : TAPE_A;
  ctx.fillRect(sx - sw / 2, sy - sh / 2, sw, 4);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ff3d80"; ctx.font = "bold 9px 'JetBrains Mono', monospace";
  ctx.fillText(t("sign.blocked"), sx, sy - 6);
  ctx.fillStyle = "#fff"; ctx.font = "bold 8px 'JetBrains Mono', monospace";
  ctx.fillText(dname.slice(0, 20), sx, sy + 5);
  ctx.fillStyle = dstr ? dstr.tone : TAPE_A; ctx.font = "bold 8px 'JetBrains Mono', monospace";
  ctx.fillText(br.mvp ? t("sign.soon") : t("sign.level", { n: br.requiredStage || "—" }), sx, sy + 15);
}

// The boundary of one barrier as segments, clipped to the view.
function barrierEdges(br, view) {
  if (br.x0 === undefined) {                       // a progression LINE
    if (br.x < view.x0 - 30 || br.x > view.x1 + 30) return [];
    return [[br.x, view.y0, br.x, view.y1]];
  }
  if (br.x1 < view.x0 - 30 || br.x0 > view.x1 + 30) return [];
  if (br.y1 < view.y0 - 30 || br.y0 > view.y1 + 30) return [];
  const { x0, y0, x1, y1 } = br;                   // the MVP BOX: all four sides
  return [[x0, y0, x0, y1], [x1, y0, x1, y1], [x0, y0, x1, y0], [x0, y1, x1, y1]];
}

function drawBarriers(view) {
  if (!state.barriers || !state.barriers.length) return;
  const mid = (view.x0 + view.x1) / 2, midY = (view.y0 + view.y1) / 2;
  for (const br of state.barriers) {
    const crossings = [];
    for (const [ax, ay, bx, by] of barrierEdges(br, view)) {
      for (const c of roadCrossings(ax, ay, bx, by, view)) crossings.push(c);
    }
    if (!crossings.length) continue;               // no calle reaches it here
    for (const c of crossings) drawBarricade(c);
    let best = crossings[0], bd = Infinity;
    for (const c of crossings) {
      const d = Math.hypot(c.x - mid, c.y - midY);
      if (d < bd) { bd = d; best = c; }
    }
    drawBarrierSign(br, best, view);
  }
}

export { drawBarriers, drawSigns, medianPairs, paintParcels, drawStreetLabels2D, paintRoads, paintTileMedians, paintTileRails, road2dPointAt };

// ---------------------------------------------------------------- signs ----
// Street furniture, drawn on top of the asphalt. Costa Rica signs to the Manual
// Centroamericano de Dispositivos Uniformes, so these are the real shapes: the
// ALTO is a red OCTAGON carrying the word (not "STOP"), a CEDA EL PASO is an
// inverted white triangle with a red border, and a tope is the yellow-hatched
// hump every calle de barrio has.
//
// Sizes are in world px at the game's framing (~20 cuadrículas across), so a
// sign reads at a glance without swallowing the lane it stands beside.
const SIGN_POST = "#8b8f96";
// A mapped parada has no size of its own (the civic block's does, from the
// build). These are the caseta's, in world px at the game's framing.
const PARADA_W = 34, PARADA_H = 12;
function drawSignPost(x, y, h) {
  ctx.strokeStyle = SIGN_POST; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x, y); ctx.stroke();
}
function polyN(x, y, r, n, rot) {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
}
function drawSign(s) {
  const x = s.x, y = s.y;
  switch (s.kind) {
    case "alto": {
      drawSignPost(x, y, 5);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      polyN(x + 0.8, y + 0.8, 4.6, 8, Math.PI / 8); ctx.fill();
      ctx.fillStyle = "#c0392b";                       // the octagon
      polyN(x, y, 4.6, 8, Math.PI / 8); ctx.fill();
      ctx.strokeStyle = "#f4f1e8"; ctx.lineWidth = 0.7;
      polyN(x, y, 3.5, 8, Math.PI / 8); ctx.stroke();
      ctx.fillStyle = "#f4f1e8";                       // the word, at this size a bar
      ctx.fillRect(x - 2.6, y - 0.7, 5.2, 1.4);
      break;
    }
    case "ceda": {
      drawSignPost(x, y, 5);
      ctx.fillStyle = "#f4f1e8";                       // inverted triangle
      ctx.beginPath();
      ctx.moveTo(x - 4.6, y - 3.6); ctx.lineTo(x + 4.6, y - 3.6); ctx.lineTo(x, y + 4.2);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#c0392b"; ctx.lineWidth = 1.4; ctx.stroke();
      break;
    }
    case "semaforo": {
      drawSignPost(x, y, 7);
      ctx.fillStyle = "#2b2f36";
      roundRect(ctx, x - 2, y - 7, 4, 9, 1.2, true, false);
      ctx.fillStyle = "#e0483a"; ctx.beginPath(); ctx.arc(x, y - 5.2, 1.05, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f0c44a"; ctx.beginPath(); ctx.arc(x, y - 2.6, 1.05, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4fbf6a"; ctx.beginPath(); ctx.arc(x, y + 0.0, 1.05, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case "semaforo_centered":
    case "semaforo_overhead": {
      // Gantry-mounted LATAM signal: pole at the edge, horizontal arm over the
      // street, with the signal head centered above the lanes.
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.ang || 0);
      const span = s.kind === "semaforo_overhead" ? 34 : 24;
      ctx.strokeStyle = "#596066"; ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-span / 2, 7); ctx.lineTo(-span / 2, -9); ctx.lineTo(span / 2, -9);
      ctx.stroke();
      for (const hx of s.kind === "semaforo_overhead" ? [-span * .2, span * .28] : [0]) {
        ctx.fillStyle = "#2b2f36";
        roundRect(ctx, hx - 2, -9, 4, 9, 1.2, true, false);
        for (const [dy, color] of [[2, "#e0483a"], [4.6, "#f0c44a"], [7.2, "#4fbf6a"]]) {
          ctx.fillStyle = color; ctx.beginPath(); ctx.arc(hx, -9 + dy, 1.05, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      break;
    }
    case "speed_limit": {
      // Costa Rican/LatAm pavement marking: white numerals inside a white ring,
      // aligned to the authored lane heading.
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.ang || 0);
      ctx.strokeStyle = "rgba(244,241,232,.82)"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.ellipse(0, 0, 8, 12, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "rgba(244,241,232,.9)";
      ctx.font = "bold 7px 'JetBrains Mono', monospace";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(String(s.value || 40), 0, 0);
      ctx.textBaseline = "alphabetic";
      ctx.restore();
      break;
    }
    case "crossing": {                                 // zebra, across the lane
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.ang || 0);
      ctx.fillStyle = "rgba(244,241,232,0.82)";
      for (let i = -2; i <= 2; i++) ctx.fillRect(i * 3.4 - 1.1, -7, 2.2, 14);
      ctx.restore();
      break;
    }
    case "tope": {                                     // hump, yellow hatching
      ctx.save(); ctx.translate(x, y); ctx.rotate(s.ang || 0);
      ctx.fillStyle = "rgba(240,196,74,0.85)";
      for (let i = -2; i <= 2; i++) ctx.fillRect(i * 3.2 - 1.0, -6, 2.0, 12);
      ctx.restore();
      break;
    }
    case "bus": {
      // LA PARADA — the SAME caseta the civic block's stop uses (`drawParada`
      // in gfx.js). Which list a parada came out of, the hand-authored manzana
      // or the 87 mapped `highway=bus_stop` nodes, is not something the player
      // can see, so it must not change what it looks like; a second drawing of
      // the same object is just an inconsistency with extra steps.
      // The build seats it on the acera and turns it along the kerb
      // (`seat_bus_stops`), and `side` says which way the roadway is — a stop
      // on the far kerb turns a half-circle more so it still opens onto it.
      drawParada(x, y, (s.ang || 0) + ((s.side || 1) < 0 ? Math.PI : 0),
                 PARADA_W, PARADA_H);
      break;
    }
    default: break;                                    // unknown kind: draw nothing
  }
}
// One pass over the furniture in view. `W.SIGNS` is eager in the manifest (it
// is small), so this culls by bbox rather than by tile.
function drawSigns(view) {
  const arr = W.SIGNS;
  if (!arr || !arr.length) return;
  for (const s of arr) {
    if (s.x < view.x0 - 20 || s.x > view.x1 + 20 || s.y < view.y0 - 20 || s.y > view.y1 + 20) continue;
    drawSign(s);
  }
}
