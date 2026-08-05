// La Ruta del Churchill — tiled 2-D world adapter (Milestone D, planar).
//
// tools/build_world.py --planar emits src/world2d/manifest.json (world size,
// tiling, districts, POIs, backdrop coast/water/beach polys) + a grid of
// src/world2d/tiles/<tc>_<tr>.json, each an RLE surface slab plus the vector
// features (roads/buildings/trees/palms/medians/plazas/…) overlapping that tile.
//
// This adapter mirrors the corridor `WORLD` API (src/world/index.js) so the
// sim/renderer keep the same shape, but the surface grid + features are STREAMED
// by camera region instead of held whole (the full planar grid is ~101M cells).
// Call `WORLD2D.ready(x, y)` once before the sim starts, and `WORLD2D.update(x,
// y)` each frame to keep the tiles around the camera resident.
import manifest from "./manifest.json";

// () => Promise<{default: tileJson}> per tile, keyed by module path. Vite turns
// each tile into an on-demand chunk; nothing is fetched until first referenced.
const TILE_LOADERS = import.meta.glob("./tiles/*.json");

export const WORLD2D = (function () {
  const META = manifest.meta;
  const W = META.W, H = META.H, CELL = META.cell;
  const TILE_PX = META.tilePx, TILE_CELLS = META.tileCells;
  const TCOLS = META.tileCols, TROWS = META.tileRows;
  const COLS = manifest.grid.cols, ROWS = manifest.grid.rows;
  const CLASSES = manifest.grid.classes; // ["water","land","beach",...]

  // ----- backdrop + POIs (small, eager from the manifest) --------------------
  const LANDMARKS = manifest.landmarks;
  const EDITOR_FEATURES = manifest.editorFeatures || []; // authored gameplay/world entities
  const EDITOR_UI = manifest.editorUI || {}; // screen copy/theme authored in the editor
  const EDITOR_CONTENT = manifest.editorContent || {}; // shop/catalog content authored in the editor
  const editorPoint = (feature) => feature.geometry?.kind === "point" ? feature.geometry.point : [0, 0];
  const pointInEditorPolygon = (x, y, points) => {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i], [xj, yj] = points[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
    }
    return inside;
  };
  const AUTHORED_DISTRICTS = EDITOR_FEATURES
    .filter((feature) => feature.type === "district" && feature.geometry?.kind === "polygon")
    .map((feature) => {
      const points = feature.geometry.points;
      const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
      const properties = feature.properties || {};
      return {
        id: properties.districtId || feature.id,
        name: feature.name || feature.id,
        short: properties.short || feature.name || feature.id,
        tone: feature.style?.color || properties.tone || "#f3c969",
        x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys),
        poly: points.flat(),
        editorPoly: points,
        editorId: feature.id,
      };
    });
  const DISTRICTS = [...manifest.districts, ...AUTHORED_DISTRICTS]; // generated + exact editor polygons
  const CUSTOMERS = [
    ...manifest.customers,
    ...EDITOR_FEATURES.filter((feature) => feature.type === "delivery").map((feature) => {
      const [x, y] = editorPoint(feature), properties = feature.properties || {};
      return {
        id: properties.customerId || feature.id,
        name: feature.name || feature.id,
        x, y,
        district: properties.district || "paseo",
        line: properties.deliveryLine || "",
        editorId: feature.id,
      };
    }),
  ];
  const STAGES = [
    ...manifest.stages,
    ...EDITOR_FEATURES.filter((feature) => feature.type === "stage").map((feature, index) => {
      const properties = feature.properties || {};
      return {
        num: properties.stageNumber || manifest.stages.length + index + 1,
        id: properties.stageId || feature.id,
        name: feature.name || feature.id,
        district: properties.district || "paseo",
        weather: properties.weather || "sunny",
        targetDeliveries: Number(properties.targetDeliveries) || 1,
        timeLimit: Number(properties.timeLimit) || 180,
        unlock: properties.unlock || null,
        kiosks: properties.kioskIds || ["kios_paseo1"],
        customers: properties.customerIds || CUSTOMERS.filter((item) => item.editorId).map((item) => item.id),
        editorId: feature.id,
      };
    }),
  ];
  const WATERS = manifest.waters || [];
  const BEACHES = manifest.beaches || [];
  const LAND_POLYS = manifest.landPolys || [];
  const HILLS = manifest.hills || [];
  const BRIDGE = manifest.bridge || null;
  const ESTUARY = manifest.estuary || null;
  // Every muelle, each a polyline deck over the water {id,name,pts,w,style}.
  const PIERS = manifest.piers || [];
  const STADIUMS = manifest.stadiums || []; // drivable pitch bboxes {x0,y0,x1,y1,cx,cy}
  const BALNEARIO = manifest.balneario || null; // sea-water inlet bbox {x0,y0,x1,y1,cx,cy}
  const KIOSK_PATHS = manifest.kioskPaths || []; // sand access paths to beach kiosks
  const PLAZAS = manifest.plazas || [];   // [x,y,w,h,type] ground rects (esplanade)
  const GREENS = manifest.greens || [];   // {pts:[x,y,...], type} park/plaza outline polys
  const CUADRAS = manifest.cuadras || []; // selectable generated block interiors
  const SURFACE_STYLES = manifest.surfaceStyles || []; // per-region ground/acera materials
  // Every named real-world POI OSM knows about {x,y,name,cat}. Debug overlay
  // only for now — 1160 pills at play zoom would be a wall of text.
  const POIS = manifest.pois || [];
  const AUTHORED_SIGNS = EDITOR_FEATURES
    .filter((feature) => (
      ["sign", "traffic-sign", "traffic-light", "road-marking"].includes(feature.type)
      && feature.geometry?.kind === "point"
    ))
    .map((feature) => {
      const properties = feature.properties || {};
      const [x, y] = feature.geometry.point;
      let kind = properties.signKind || "alto";
      if (feature.type === "traffic-light") {
        const signalStyle = properties.signalStyle || "roadside";
        kind = signalStyle === "roadside" ? "semaforo" : `semaforo_${signalStyle}`;
      } else if (feature.type === "road-marking") {
        kind = properties.markingKind || "speed_limit";
      }
      return {
        id: feature.id, name: feature.name, x, y, kind,
        ang: (Number(properties.angle) || 0) * Math.PI / 180,
        value: properties.speedLimit || properties.value || properties.actionValue || "",
        signalStyle: properties.signalStyle || "roadside",
        editorId: feature.id,
      };
    });
  const SIGNS = [...(manifest.signs || []), ...AUTHORED_SIGNS];
  const LIGHTS = EDITOR_FEATURES.filter((feature) => (
    ["light", "street-light"].includes(feature.type) && feature.geometry?.kind === "point"
  ));
  const ROOFS = EDITOR_FEATURES.filter((feature) => (
    ["roof", "covered-lane", "grandstand"].includes(feature.type)
    && feature.geometry?.kind === "polygon" && feature.properties?.roof
  ));
  const NPCS = EDITOR_FEATURES.filter((feature) => feature.type === "npc" && feature.geometry?.kind === "point");
  const COIN_SPAWNS = EDITOR_FEATURES.filter((feature) => (
    feature.type === "coin-spawn" && ["point", "polygon"].includes(feature.geometry?.kind)
  ));
  const WEATHER_ZONES = EDITOR_FEATURES.filter((feature) => (
    feature.type === "weather-zone" && feature.geometry?.kind === "polygon"
  ));
  // Named cuadra parts {id,name,use,poly,cx,cy,slot}. `slot` is a rect a
  // sponsor entry can claim, so its art has a real footprint in the world
  // instead of a floating pin.
  const PARCELS = manifest.parcels || [];
  // The two ferry berths + the truncated real sailing routes (OSM
  // amenity=ferry_terminal and route=ferry). src/game/ferries.js turns these
  // into the only MOVING ground in the game.
  const FERRIES = manifest.ferries || [];
  // Open fields = stadium pitches AND plaza parcels, normalised to one shape
  // {x0,y0,x1,y1,cx,cy,footprint}. The crowd and the coin rain read THIS, so a
  // new plaza gets both for free instead of needing to be a "stadium".
  // `ang`/`hw`/`hh`/`sport` ride along: the match sim places the goals off the
  // field's own frame, and the renderer draws the markings in it — neither
  // should be re-deriving a frame from a raster-traced polygon.
  const FIELDS = [
    ...STADIUMS,
    ...PARCELS.filter((p) => (p.use === "plaza" || p.use === "stadium") && !p.whole).map((p) => ({
      x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1,
      cx: (p.x0 + p.x1) / 2, cy: (p.y0 + p.y1) / 2,
      ang: p.ang || 0, hw: p.hw, hh: p.hh, sport: p.sport,
      footprint: p.poly, outline: p.poly,      // plazas have no acera ring
    })),
  ];

  // ----- tile cache ----------------------------------------------------------
  // key = tr * TCOLS + tc. Value: { grid:Uint8Array, cols, rows, x, y, roads,
  // buildings, trees, palms, mangroves, medians, plazas, bhash } once decoded, or the
  // in-flight Promise while loading.
  const tiles = new Map();
  const tileKey = (tc, tr) => tr * TCOLS + tc;

  function flatAABB(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      const px = pts[i], py = pts[i + 1];
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
    }
    return { x0, y0, x1, y1 };
  }

  function decodeRLE(b64, n) {
    const bin = atob(b64);
    const out = new Uint8Array(n);
    let o = 0;
    for (let i = 0; i + 1 < bin.length; i += 2) {
      const cnt = bin.charCodeAt(i), cls = bin.charCodeAt(i + 1);
      out.fill(cls, o, o + cnt);
      o += cnt;
    }
    return out;
  }

  // per-tile road arclength tables (roadPointAt / spawns need cum lengths)
  function prepRoads(rawRoads) {
    return (rawRoads || []).map((r) => {
      const pts = r.pts, cum = [0];
      for (let i = 2; i < pts.length; i += 2) {
        const dx = pts[i] - pts[i - 2], dy = pts[i + 1] - pts[i - 1];
        cum.push(cum[cum.length - 1] + Math.hypot(dx, dy));
      }
      return {
        cls: r.cls, w: r.w, name: r.name, ref: r.ref, bridge: r.bridge || 0,
        barro: r.barro || 0, elev: r.elev || 0,
        pts, cum, len: cum[cum.length - 1], aabb: flatAABB(pts),
      };
    });
  }

  function decodeTile(tc, tr, raw) {
    const grid = decodeRLE(raw.rle, raw.cols * raw.rows);
    const buildings = (raw.buildings || []).map((b) => ({
      pts: b.pts, aabb: flatAABB(b.pts), color: b.color, roof: b.roof, wnd: b.wnd,
    }));
    // 64px building hash local to the tile (buildingsNear hits only same tile;
    // border buildings are duplicated into each overlapping tile by the emit)
    const bhash = new Map();
    const HC = 64, HP = 12;
    for (const b of buildings) {
      const gx0 = Math.max(0, ((b.aabb.x0 - HP) / HC) | 0);
      const gx1 = Math.max(0, ((b.aabb.x1 + HP) / HC) | 0);
      const gy0 = Math.max(0, ((b.aabb.y0 - HP) / HC) | 0);
      const gy1 = Math.max(0, ((b.aabb.y1 + HP) / HC) | 0);
      for (let gx = gx0; gx <= gx1; gx++)
        for (let gy = gy0; gy <= gy1; gy++) {
          const k = gx * 65536 + gy;
          let l = bhash.get(k); if (!l) { l = []; bhash.set(k, l); }
          l.push(b);
        }
    }
    return {
      tc, tr, x: raw.x, y: raw.y, cols: raw.cols, rows: raw.rows, grid,
      roads: prepRoads(raw.roads), rails: raw.rails || [],
      buildings, bhash,
      // mangroves are {x,y,r} clumps along the estero waterline — the builder
      // has emitted them into the tiles all along; nothing decoded them, so
      // nothing could draw them.
      trees: raw.trees || [], palms: raw.palms || [], mangroves: raw.mangroves || [],
      medians: raw.medians || [], plazas: raw.plazas || [],
      islands: raw.islands || [],
    };
  }

  function loadTile(tc, tr) {
    if (tc < 0 || tr < 0 || tc >= TCOLS || tr >= TROWS) return null;
    const key = tileKey(tc, tr);
    const cached = tiles.get(key);
    if (cached) return cached instanceof Promise ? cached : cached;
    const loader = TILE_LOADERS[`./tiles/${tc}_${tr}.json`];
    if (!loader) return null; // no tile emitted at this cell
    const p = loader().then((mod) => {
      const t = decodeTile(tc, tr, mod.default || mod);
      tiles.set(key, t);
      return t;
    }).catch((e) => {
      tiles.delete(key);
      console.warn(`[world2d] tile ${tc}_${tr} failed`, e);
      return null;
    });
    tiles.set(key, p);
    return p;
  }

  function decodedTile(tc, tr) {
    const t = tiles.get(tileKey(tc, tr));
    return t && !(t instanceof Promise) ? t : null;
  }

  // Ensure every tile overlapping [x0..x1]×[y0..y1] (+margin tiles) is loading;
  // resolve once all are decoded. Used for the initial spawn window.
  function ensureView(x0, y0, x1, y1, marginTiles = 1) {
    const c0 = Math.max(0, ((x0 / TILE_PX) | 0) - marginTiles);
    const c1 = Math.min(TCOLS - 1, ((x1 / TILE_PX) | 0) + marginTiles);
    const r0 = Math.max(0, ((y0 / TILE_PX) | 0) - marginTiles);
    const r1 = Math.min(TROWS - 1, ((y1 / TILE_PX) | 0) + marginTiles);
    const ps = [];
    for (let tr = r0; tr <= r1; tr++)
      for (let tc = c0; tc <= c1; tc++) {
        const t = loadTile(tc, tr);
        if (t instanceof Promise) ps.push(t);
      }
    return Promise.all(ps);
  }

  // Kick off loads for the window around a camera point (fire-and-forget), and
  // evict decoded tiles far outside it to cap memory. Call once per frame.
  const KEEP_RADIUS = 3; // tiles kept resident around the camera (each 2000px)
  function update(camX, camY) {
    const cc = (camX / TILE_PX) | 0, cr = (camY / TILE_PX) | 0;
    for (let tr = cr - KEEP_RADIUS; tr <= cr + KEEP_RADIUS; tr++)
      for (let tc = cc - KEEP_RADIUS; tc <= cc + KEEP_RADIUS; tc++)
        loadTile(tc, tr);
    // evict tiles well outside the window
    const EVICT = KEEP_RADIUS + 2;
    for (const [key, t] of tiles) {
      if (t instanceof Promise) continue;
      if (Math.abs(t.tc - cc) > EVICT || Math.abs(t.tr - cr) > EVICT) tiles.delete(key);
    }
  }

  function ready(x, y, viewW = TILE_PX, viewH = TILE_PX) {
    return ensureView(x - viewW / 2, y - viewH / 2, x + viewW / 2, y + viewH / 2, 1);
  }

  // ----- surface grid --------------------------------------------------------
  // 0 water, 1 land, 2 beach, 3 road, 4 paseo, 5 bridge, 6 acera, 7 boulevard.
  function surfaceAt(x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return 0;
    const tc = (x / TILE_PX) | 0, tr = (y / TILE_PX) | 0;
    const t = decodedTile(tc, tr);
    if (!t) return 0; // tile not resident yet → treat as open water
    const lc = ((x - t.x) / CELL) | 0, lr = ((y - t.y) / CELL) | 0;
    if (lc < 0 || lr < 0 || lc >= t.cols || lr >= t.rows) return 0;
    return t.grid[lr * t.cols + lc];
  }
  function onRoad(x, y) { const c = surfaceAt(x, y); return c === 3 || c === 5; }
  function onPaseo(x, y) { return surfaceAt(x, y) === 4; }
  function inWater(x, y) { return surfaceAt(x, y) === 0; }
  function onBeach(x, y) { return surfaceAt(x, y) === 2; }
  function driveUnderAt(x, y) {
    for (const feature of ROOFS) {
      const properties = feature.properties || {};
      if (!properties.driveUnder && properties.collisionMode !== "drivable") continue;
      if (pointInEditorPolygon(x, y, feature.geometry.points)) return true;
    }
    return false;
  }

  function onElevated(x, y) {
    const t = decodedTile((x / TILE_PX) | 0, (y / TILE_PX) | 0);
    if (!t) return false;
    for (const r of t.roads) {
      if (!r.elev) continue;
      const p = r.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3];
        const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
        let s = l2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / l2 : 0;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
        const qx = x0 + dx * s, qy = y0 + dy * s;
        const hw2 = (r.w / 2 + 4) ** 2;
        if ((x - qx) ** 2 + (y - qy) ** 2 <= hw2) return true;
      }
    }
    return false;
  }

  // ----- buildings -----------------------------------------------------------
  const NO_BUILDINGS = [];
  function buildingsNear(x, y) {
    if (x < 0 || y < 0) return NO_BUILDINGS;
    const t = decodedTile((x / TILE_PX) | 0, (y / TILE_PX) | 0);
    if (!t) return NO_BUILDINGS;
    const key = ((x / 64) | 0) * 65536 + ((y / 64) | 0);
    return t.bhash.get(key) || NO_BUILDINGS;
  }

  // ----- districts -----------------------------------------------------------
  // The manifest polys are full-height x-strips (a coarse approximation), which
  // can't separate barrios stacked N–S (Mata Limón sits north of Caldera at the
  // same x). So districtAt uses the NEAREST district POI-centroid — a proper 2-D
  // assignment that uses the (correctly hand-tagged) POI district fields. The
  // strip polys stay for rendering / a coarse fallback.
  const DIST_CENTROID = (function () {
    const acc = new Map(); // id -> {sx,sy,n}
    for (const p of [...LANDMARKS, ...CUSTOMERS]) {
      const a = acc.get(p.district) || { sx: 0, sy: 0, n: 0 };
      a.sx += p.x; a.sy += p.y; a.n++; acc.set(p.district, a);
    }
    return DISTRICTS.map((d) => {
      const a = acc.get(d.id);
      return { d, cx: a ? a.sx / a.n : (d.x0 + d.x1) / 2, cy: a ? a.sy / a.n : H / 2 };
    });
  })();
  function districtAt(x, y) {
    // Exact authored neighborhood polygons take priority over the generated
    // nearest-centroid fallback and may overlap a broader generated district.
    for (let i = AUTHORED_DISTRICTS.length - 1; i >= 0; i--) {
      const district = AUTHORED_DISTRICTS[i];
      if (pointInEditorPolygon(x, y, district.editorPoly)) return district;
    }
    let best = DISTRICTS[0], bd = Infinity;
    for (const { d, cx, cy } of DIST_CENTROID) {
      const dd = (x - cx) ** 2 + (y - cy) ** 2;
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }
  // Real lat/lon → world px via the manifest's geo affine (planar projection
  // is linear in lon/lat). Lets remote content be authored in real coords.
  function geoToWorld(lat, lon) {
    const g = META.geo;
    if (!g) return null;
    return { x: g.ax * lon + g.bx, y: g.ay * lat + g.by };
  }
  function landmarkById(id) { return LANDMARKS.find((l) => l.id === id); }
  function customerById(id) { return CUSTOMERS.find((c) => c.id === id); }

  // A drivable point near (x,y) among currently-resident tiles.
  // `accept(px,py)` (optional) further constrains candidates — e.g. delivery
  // keeps orders west of the locked-area wall so NPCs never spawn past the gate.
  function reachablePointNear(x, y, radius = 480, accept = null) {
    const ok = (px, py) => {
      const c = surfaceAt(px, py);
      return (c === 3 || c === 5) && (!accept || accept(px, py));
    };
    const cands = [];
    for (let k = 0; k < 220; k++) {
      const ang = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * radius;
      const px = x + Math.cos(ang) * rad, py = y + Math.sin(ang) * rad;
      if (ok(px, py)) cands.push({ x: px, y: py });
    }
    if (cands.length) return cands[(Math.random() * cands.length) | 0];
    for (let r = 24; r <= 2000; r += 24)
      for (let a = 0; a < 360; a += 12) {
        const px = x + Math.cos((a * Math.PI) / 180) * r, py = y + Math.sin((a * Math.PI) / 180) * r;
        if (ok(px, py)) return { x: px, y: py };
      }
    // nothing satisfied the filter near here — fall back to the nearest drivable
    // point (still better than dropping the order); ignore the accept filter.
    if (accept) return reachablePointNear(x, y, radius, null);
    return { x, y };
  }

  // ----- feature access for the renderer (visible, resident tiles) -----------
  // Returns the decoded tiles overlapping the view AABB (loads are driven by
  // update()/ensureView(); this only returns what's already resident).
  function visibleTiles(x0, y0, x1, y1) {
    const c0 = Math.max(0, (x0 / TILE_PX) | 0), c1 = Math.min(TCOLS - 1, (x1 / TILE_PX) | 0);
    const r0 = Math.max(0, (y0 / TILE_PX) | 0), r1 = Math.min(TROWS - 1, (y1 / TILE_PX) | 0);
    const out = [];
    for (let tr = r0; tr <= r1; tr++)
      for (let tc = c0; tc <= c1; tc++) {
        const t = decodedTile(tc, tr);
        if (t) out.push(t);
      }
    return out;
  }

  return {
    W, H, META, CELL, TILE_PX, TCOLS, TROWS, CLASSES,
    DISTRICTS, LANDMARKS, CUSTOMERS, STAGES, EDITOR_UI, EDITOR_CONTENT,
    WATERS, BEACHES, LAND_POLYS, HILLS, BRIDGE, ESTUARY, PIERS, STADIUMS, BALNEARIO, KIOSK_PATHS, PLAZAS, GREENS, CUADRAS, SURFACE_STYLES, EDITOR_FEATURES, POIS, PARCELS, FERRIES, FIELDS, SIGNS, LIGHTS, ROOFS, NPCS, COIN_SPAWNS, WEATHER_ZONES,
    // streaming lifecycle
    ready, update, ensureView, visibleTiles, loadTile,
    // queries
    surfaceAt, onRoad, onPaseo, inWater, onBeach, onElevated, driveUnderAt,
    buildingsNear, districtAt, landmarkById, customerById, reachablePointNear,
    geoToWorld,
  };
})();

if (typeof window !== "undefined") window.WORLD2D = WORLD2D;
