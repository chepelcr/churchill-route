// Static geometry caches: the backdrop silhouette Path2Ds (built once) and the
// per-tile junction cut tables that make lane dashes stop at intersections.
import { WORLD2D as W } from "../../world2d/index.js";
import { flatAABB, flatMultiPath, flatPath } from "./gfx.js";
import { ROAD_RANK } from "../../domain/vocabulary.generated.js";

// ---- Static geometry cache (Path2D per feature, built once) ----
// Mandatory for 60fps: ~2k roads and ~1.4k buildings get AABB-culled
// against the camera view and stroked/filled from prebuilt paths.
let RC = null;

// PAINTING ORDER, generated from churchill/world/enums/features.py — not a
// second handwritten table. This one had no `living_street` entry, so such a
// calle would fall to `|| 0` in the sort below and paint under the service
// roads — latent, since nothing in the map is tagged that way yet, which is why
// it would have shipped. The editor kept a third copy that collapsed more
// classes still.
const ROAD_ORDER = ROAD_RANK;
// Backdrop silhouette cache: land / inner water / beach polygons are global on
// WORLD2D (few, low-res). Drawn under the streamed surface tiles so unloaded /
// far areas still read as the real Puntarenas shape.
function ensureRenderCache() {
  if (RC) return RC;
  RC = { land: [], beach: [], water: [] };
  for (const poly of W.LAND_POLYS || []) if (poly.length >= 6) RC.land.push({ path: flatPath(poly, true), aabb: flatAABB(poly) });
  for (const poly of W.BEACHES || []) if (poly.length >= 6) RC.beach.push({ path: flatPath(poly, true), aabb: flatAABB(poly) });
  for (const poly of W.WATERS || []) if (poly.length >= 6) RC.water.push({ path: flatPath(poly, true), aabb: flatAABB(poly) });
  // THE SAND IS ONE SHAPE WITH HOLES IN IT, and filling its rings one at a time
  // says the opposite. `sand_outlines` traces the finished raster with
  // `outline_polys`, which returns hole rings alongside outer ones (opposite
  // winding, on purpose) — so 16 of this world's 59 beach rings are holes, and
  // a per-ring non-zero fill paints every one of them SOLID. The largest is
  // 805 000 px² of inland water wearing a coat of sand. One path, even-odd,
  // exactly as the marine park's residual and the malecón's bands already do.
  // The per-ring AABBs stay: they are still the cull.
  RC.sand = flatMultiPath((W.BEACHES || []).filter((p) => p.length >= 6));
  return RC;
}

function roadPath(r) { return r._path || (r._path = flatPath(r.pts, false)); }

// ---- junction-aware lane dashes -----------------------------------------
// Per tile (once): intersect every road pair's segments to find the exact
// crossing arclengths. The dash path then skips a clearance around every
// crossing AND is trimmed at both ends — center lines never enter an
// intersection, with no cover-up discs needed.
function ensureTileCuts(tile) {
  if (tile._cutsDone) return;
  tile._cutsDone = true;
  const roads = tile.roads;
  for (const r of roads) if (!r._cutList) r._cutList = [];
  for (let i = 0; i < roads.length; i++) {
    const A = roads[i];
    for (let j = i + 1; j < roads.length; j++) {
      const B = roads[j];
      const pad = (A.w + B.w) / 2;
      if (A.aabb.x0 > B.aabb.x1 + pad || B.aabb.x0 > A.aabb.x1 + pad ||
          A.aabb.y0 > B.aabb.y1 + pad || B.aabb.y0 > A.aabb.y1 + pad) continue;
      const pa = A.pts, pb = B.pts;
      for (let ia = 0; ia + 3 < pa.length; ia += 2) {
        const ax = pa[ia], ay = pa[ia + 1], adx = pa[ia + 2] - ax, ady = pa[ia + 3] - ay;
        for (let ib = 0; ib + 3 < pb.length; ib += 2) {
          const bx = pb[ib], by = pb[ib + 1], bdx = pb[ib + 2] - bx, bdy = pb[ib + 3] - by;
          const den = adx * bdy - ady * bdx;
          if (Math.abs(den) < 1e-6) continue;                 // parallel
          const t = ((bx - ax) * bdy - (by - ay) * bdx) / den;
          const u = ((bx - ax) * ady - (by - ay) * adx) / den;
          if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) continue;
          A._cutList.push({ s: A.cum[ia / 2] + t * (A.cum[ia / 2 + 1] - A.cum[ia / 2]), c: B.w / 2 + 12 });
          B._cutList.push({ s: B.cum[ib / 2] + u * (B.cum[ib / 2 + 1] - B.cum[ib / 2]), c: A.w / 2 + 12 });
        }
      }
    }
  }
}

// Dash path = the road minus end trims minus a clearance around every
// crossing (from ensureTileCuts). Cached per road.
function dashPath(r) {
  if (r._dash !== undefined) return r._dash;
  const TRIM = Math.max(26, r.w * 0.8);
  if (!r.cum || r.len <= TRIM * 2 + 8) return (r._dash = null);
  const p = r.pts, cum = r.cum;
  const at = (s) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
    return [p[(i - 1) * 2] + (p[i * 2] - p[(i - 1) * 2]) * t,
            p[(i - 1) * 2 + 1] + (p[i * 2 + 1] - p[(i - 1) * 2 + 1]) * t];
  };
  // subtract the cut windows from [TRIM, len-TRIM]
  let spans = [[TRIM, r.len - TRIM]];
  for (const cut of r._cutList || []) {
    const c0 = cut.s - cut.c, c1 = cut.s + cut.c;
    const next = [];
    for (const [s0, s1] of spans) {
      if (c1 <= s0 || c0 >= s1) { next.push([s0, s1]); continue; }
      if (c0 > s0) next.push([s0, c0]);
      if (c1 < s1) next.push([c1, s1]);
    }
    spans = next;
  }
  let path = null;
  for (const [s0, s1] of spans) {
    if (s1 - s0 < 14) continue;                               // too short to read
    path = path || new Path2D();
    const [ax, ay] = at(s0);
    path.moveTo(ax, ay);
    for (let i = 0; i < cum.length; i++) {
      if (cum[i] > s0 && cum[i] < s1) path.lineTo(p[i * 2], p[i * 2 + 1]);
    }
    const [bx, by] = at(s1);
    path.lineTo(bx, by);
  }
  return (r._dash = path);
}

// Multi-pass road styling (acera band → casing → asphalt → lane dashes),
// ported from the corridor renderer but fed per-tile road segments.

export { RC, ROAD_ORDER, dashPath, ensureRenderCache, ensureTileCuts, roadPath };
