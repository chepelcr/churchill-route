// La Ruta del Churchill — world adapter over generated OSM data.
//
// src/world/data.js is produced by tools/build_world.py from docs/map.osm and
// exports WORLD_DATA (real Puntarenas peninsula, corridor-unrolled: x =
// arclength along the Faro→Caldera spine, y = exaggerated perp offset). This
// file adapts that raw data into the runtime API the engine consumes: grid
// surface queries, silhouette functions, road arclength samplers and a
// building spatial hash. Coordinates are world-space pixels.
import { WORLD_DATA } from "./data.js";

export const WORLD = (function () {
  const DATA = WORLD_DATA;
  if (!DATA) throw new Error("world/data.js missing — run tools/build_world.py");

  const META = DATA.meta;
  const W = META.W;
  const H = META.H;
  const CELL = META.cell;

  // ----- Surface grid -------------------------------------------------------
  // Class ids: 0 water, 1 land, 2 beach, 3 road, 4 paseo, 5 bridge, 6 acera.
  // Stored RLE (count, class byte pairs) + base64 in world/data.js.
  const COLS = DATA.grid.cols;
  const ROWS = DATA.grid.rows;
  const GRID = (function decodeGrid() {
    const bin = atob(DATA.grid.rle);
    const out = new Uint8Array(COLS * ROWS);
    let o = 0;
    for (let i = 0; i + 1 < bin.length; i += 2) {
      const n = bin.charCodeAt(i);
      const cls = bin.charCodeAt(i + 1);
      out.fill(cls, o, o + n);
      o += n;
    }
    return out;
  })();

  function surfaceAt(x, y) {
    if (x < 0 || y < 0) return 0; // out of bounds = open water
    const cx = (x / CELL) | 0, cy = (y / CELL) | 0;
    if (cx >= COLS || cy >= ROWS) return 0;
    return GRID[cy * COLS + cx];
  }
  function onRoad(x, y) { const c = surfaceAt(x, y); return c === 3 || c === 5; }
  function onPaseo(x, y) { return surfaceAt(x, y) === 4; }
  function inWater(x, y) { return surfaceAt(x, y) === 0; }
  function onBeach(x, y) { return surfaceAt(x, y) === 2; }

  // ----- Peninsula silhouette (per-column land extents) ----------------------
  const TOPY = DATA.topY;
  const BOTY = DATA.botY;
  function colLerp(arr, x) {
    const fx = x / CELL;
    let i = Math.floor(fx);
    if (i < 0) i = 0;
    if (i > COLS - 2) i = COLS - 2;
    let t = fx - i;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    return arr[i] + (arr[i + 1] - arr[i]) * t;
  }
  function topY(x) { return colLerp(TOPY, x); }
  function botY(x) { return colLerp(BOTY, x); }
  function halfWidthAt(x) { return (botY(x) - topY(x)) / 2; }

  // ----- Roads (polylines with arclength tables) ------------------------------
  function flatAABB(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < x0) x0 = pts[i];
      if (pts[i] > x1) x1 = pts[i];
      if (pts[i + 1] < y0) y0 = pts[i + 1];
      if (pts[i + 1] > y1) y1 = pts[i + 1];
    }
    return { x0, y0, x1, y1 };
  }
  const ROADS = DATA.roads.map((r) => {
    const pts = r.pts;
    const cum = [0];
    for (let i = 2; i < pts.length; i += 2) {
      const dx = pts[i] - pts[i - 2], dy = pts[i + 1] - pts[i - 1];
      cum.push(cum[cum.length - 1] + Math.hypot(dx, dy));
    }
    return {
      cls: r.cls, w: r.w, name: r.name, ref: r.ref, bridge: r.bridge || 0,
      pts, cum, len: cum[cum.length - 1], aabb: flatAABB(pts),
    };
  });
  function roadLength(i) { return ROADS[i].len; }
  function roadPointAt(i, s) {
    const r = ROADS[i];
    const pts = r.pts, cum = r.cum;
    if (cum.length < 2) return { x: pts[0] || 0, y: pts[1] || 0, ang: 0 };
    if (s < 0) s = 0;
    if (s > r.len) s = r.len;
    // binary search for the segment containing s
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const segLen = cum[hi] - cum[lo];
    const t = segLen > 0 ? (s - cum[lo]) / segLen : 0;
    const x0 = pts[lo * 2], y0 = pts[lo * 2 + 1];
    const x1 = pts[hi * 2], y1 = pts[hi * 2 + 1];
    return {
      x: x0 + (x1 - x0) * t,
      y: y0 + (y1 - y0) * t,
      ang: Math.atan2(y1 - y0, x1 - x0),
    };
  }

  // ----- Buildings (polygons + 64px spatial hash) -----------------------------
  const BUILDINGS = DATA.buildings.map((b) => ({
    pts: b.pts, aabb: flatAABB(b.pts), color: b.color, roof: b.roof, wnd: b.wnd,
  }));
  const HASH_CELL = 64;
  const HASH_PAD = 12; // inflate so a single-cell lookup covers the 9px hit radius
  const BHASH = new Map();
  (function buildHash() {
    for (const b of BUILDINGS) {
      const gx0 = Math.max(0, ((b.aabb.x0 - HASH_PAD) / HASH_CELL) | 0);
      const gx1 = Math.max(0, ((b.aabb.x1 + HASH_PAD) / HASH_CELL) | 0);
      const gy0 = Math.max(0, ((b.aabb.y0 - HASH_PAD) / HASH_CELL) | 0);
      const gy1 = Math.max(0, ((b.aabb.y1 + HASH_PAD) / HASH_CELL) | 0);
      for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) {
          const key = gx * 4096 + gy;
          let list = BHASH.get(key);
          if (!list) { list = []; BHASH.set(key, list); }
          list.push(b);
        }
      }
    }
  })();
  const NO_BUILDINGS = [];
  function buildingsNear(x, y) {
    if (x < 0 || y < 0) return NO_BUILDINGS;
    const key = ((x / HASH_CELL) | 0) * 4096 + ((y / HASH_CELL) | 0);
    return BHASH.get(key) || NO_BUILDINGS;
  }

  // ----- Static features (passed through from the build) ----------------------
  const LAND_POLYS = DATA.landPolys;
  const WATERS = DATA.waters;
  const BEACHES = DATA.beaches;
  const DISTRICTS = DATA.districts;   // order = barrier/stage index, do not reorder
  const LANDMARKS = DATA.landmarks;
  const CUSTOMERS = DATA.customers;
  const STAGES = DATA.stages;
  const PALMS = DATA.palms;
  const MEDIANS = DATA.medians || []; // paseo planted-median dash polylines
  const PLAZAS = DATA.plazas || [];   // paved-sliver rects [x,y,w,h] (cuadrícula)
  const MANGROVES = DATA.mangroves;
  const HILLS = DATA.hills;
  const ESTUARY = DATA.estuary;
  const BRIDGE = DATA.bridge;
  const PIER = DATA.pier || null; // {x, y0, y1, w} — Muelle deck, optional

  // ----- Helpers used by engine ----------------------------------------------
  function districtAt(x) {
    for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1) return d;
    return DISTRICTS[0];
  }
  function landmarkById(id) { return LANDMARKS.find(l => l.id === id); }
  function customerById(id) { return CUSTOMERS.find(c => c.id === id); }

  return {
    W, H, META,
    DISTRICTS, LANDMARKS, CUSTOMERS, STAGES,
    PALMS, MEDIANS, PLAZAS, MANGROVES, HILLS, ESTUARY, BRIDGE, PIER,
    ROADS, BUILDINGS, LAND_POLYS, WATERS, BEACHES,
    topY, botY, halfWidthAt,
    surfaceAt, onRoad, onPaseo, inWater, onBeach,
    roadLength, roadPointAt, buildingsNear,
    districtAt, landmarkById, customerById,
  };
})();

// Compat shim for the dev tweaks/deck host and console debugging.
if (typeof window !== "undefined") window.WORLD = WORLD;
