# World 2-D migration (Milestone D) — handoff / continuation doc

Living doc so this work can resume in a fresh session without re-deriving context.
Companion to the approved plan at `~/.claude/plans/i-need-to-ensure-elegant-tower.md`
and the roadmap entry (ROADMAP.md → "Milestone D").

## Goal
Make the game **traversable over the real Puntarenas as a full 2-D map**, replacing the
corridor-unroll. **Locked decisions (do not re-litigate):**
- **True-scale 2-D layout** — real proportions/positions; real cuadra sizes/shapes appear.
- **Streets & vehicle stay arcade-exaggerated** — real block *layout*, but street widths =
  `real_metres × ARCADE_STREET_MUL × px_per_m` and a vehicle-scale knob, so it still drives
  like an arcade game. Kept modest so junction gores survive.
- **Full OSM bounds** (`docs/map.osm`).
- **PixiJS/WebGL renderer** (Canvas2D won't hit 60 fps at this scale).
- **Junctions/triangles/medians come from real geometry** (via `detect_blocks`) — the
  corridor gore/island/carriageway hacks are **dropped** in planar.
- **Preserve everything** — corridor build stays intact; nothing discarded.

## Git / safety
- **Backup:** tag `corridor-v1`, branch `corridor-stable` (pushed) = the corridor build with
  all the Paseo/León Cortés/Ferrocarril detail. `main` is untouched (still corridor).
- **Working branch:** `world-2d`. All 2-D work lands here until proven, then we decide about
  making it default.

## How to build / test the planar world
```
# full planar Puntarenas (default bbox, ~160s, 26x16=416 tiles):
WORLD_PROJECTION=planar python3 tools/build_world.py
# bounded smoke (fast; a sub-bbox override), lon0,lat0,lon1,lat1:
WORLD_PROJECTION=planar PLANAR_BBOX="-84.845,9.974,-84.825,9.982" python3 tools/build_world.py
# knobs (env): PLANAR_PX_PER_M (default 1.6), ARCADE_STREET_MUL (default 2.2)
```
Planar output → `src/world2d/manifest.json` + `src/world2d/tiles/<tc>_<tr>.json` (NOT
`src/world/data.js`, which stays the untouched corridor build). Eyeball `tools/debug_map.png`
(stride-downsampled raster of the grid). The corridor build is still the default (no env var)
and writes `src/world/data.js` as before.

## Architecture: where the projection lives
The whole build threads a projection object `sp` with `.project(p_m)->(x,y,i,d)`,
`.project_m(p_m)->(s,d,i)`, `.to_px(s,d)->(x,y)`, `.px_per_m`. Two implementations in
`tools/build_world.py`:
- `class Spine` — the corridor unroll (arclength × perpendicular×CROSS_EXAG).
- `class PlanarProjection` — flat real-scale: `px = (metres - min) × px_per_m`.
`main()` picks: `sp = _planar_setup(ways) if PLANAR else build_spine(ways, nodes)`.
`_planar_setup()` computes OSM bounds and **reassigns the world-size globals**
(`CANVAS_W/H`, `GRID_COLS/ROWS`, `CENTER_Y`, `MARGIN_X`) — functions read these at call time.

The engine is coordinate-agnostic: physics/collision use `WORLD.surfaceAt(x,y)` (a grid),
roads are polylines, delivery/spawns are 2-D. Corridor coupling in the engine is only:
`topY/botY/halfWidthAt` (silhouette), `districtAt(x)` (x-band), `CENTER_Y`.

## Status
- [x] **Phase 0** — backup tag/branch.
- [x] **Phase 1 (foundation)** — `PlanarProjection`, planar mode flag, `_planar_setup`,
      `road_width_px` (arcade widths), main() skips corridor hacks, robustness guards.
      **Verified:** bounded centro smoke builds end-to-end; the debug render shows the real
      spit at true scale with the real street grid, real cuadras, beaches, muelle pier.
- [x] **Phase 1 (remaining) — chunked/tiled emit** (`emit_world2d` in `build_world.py`).
      Tiles are `TILE_CUADS=100` → 2000 px. Output: `src/world2d/manifest.json` (meta+tiling,
      districts w/ polys, POIs, backdrop coast/water/beach polys) + `src/world2d/tiles/
      <tc>_<tr>.json` (RLE surface slab + roads/rails/buildings/trees/palms/mangroves/medians/
      plazas/islands whose bbox overlaps the tile; border features duplicated into each tile —
      accessor culls/dedups). **Verified:** tile slabs decode and reassemble to the full grid.
- [x] **Phase 1 (remaining) — 2-D districts.** `emit_world2d` emits `{id,name,short,tone,
      x0,x1,poly}`; `poly` = full-height rectangle from the west→east x-band edges (planar
      arranges the barrios W→E along the spit — a working point-in-poly approx; true 2-D rings
      are a later refinement).
- [x] **World-size fix (plan risk #1).** `docs/map.osm` actually spans ~85×92 km (stray inland
      highways/villages), NOT the documented Puntarenas bbox — projecting it whole gave a
      1.24-billion-cell, 99.96%-water, 37-min build. Planar now defaults to
      `PLANAR_FULL_BBOX="-84.9188,9.8539,-84.6328,10.0304"` (override via `PLANAR_BBOX`), and
      `_planar_setup` drops ways entirely outside the clip so outliers can't inflate bounds or
      pollute edge tiles.
- [x] **Phase 1 (remaining) — POI re-anchor at full scale.** Fixed `resolve()` for planar (the
      corridor `abs(d)<CORRIDOR_HALF_M` gate rejected valid OSM matches since planar `d` is a
      world y-coord, not a perpendicular offset) → planar takes the OSM match nearest the spec
      anchor (or the candidates' centroid when no anchor). Coastal POIs still use
      `nudge_to_land`. `El Ancla` (raw corridor `xy` monument) is skipped in planar. Result:
      34 landmarks / 18 customers resolve, **all 7 stages satisfied, gate 52/52 reachable** —
      the POI/reachability gate is now **fatal in planar too** (was non-fatal while iterating).
- [x] **Land/water flooding fix (the big one).** After un-gutting extraction, the whole
      peninsula + eastern lowland still flooded to water (land was ~1.7k cells). Root causes,
      all corridor-era assumptions wrong in 2-D, now fixed:
  - `raster_coast_barrier` had the **same** `abs(project_m()[1])<=CORRIDOR_HALF_M+600` filter →
    dropped every coast chain off lat 9.977. Guarded off in planar (all coast rasterised).
  - Coastline is many segments with sub-cell joint gaps → `_stamp_barrier` thickens the barrier
    to 3×3 in planar so the 1-cell supercover line can't leak.
  - The Estero de Puntarenas (spit's north shore) is an OSM **area**, not coastline →
    `raster_poly_barrier` rasterises `waters` outlines as flood barriers too.
  - **Seeds:** planar floods ONLY the open outer gulf (the whole west bbox edge + gulf-W probe).
    NOT the estuary/inner water or world corners — those seed the flood inside inland land or
    pour it through the harbour mouth into the whole peninsula. Inner waters (estuary, rivers,
    mangroves) are stamped `CLS_WATER` from their polygons after the flood, so they don't need
    flooding. Result: **land 41.8M cells, 169 cuadras, 1663 plazas** — a real true-scale spit.
    (Benign leftover: the estuary PROBE_SEA point warns "sea probe is LAND" — expected, it's
    stamped water from its polygon, not flooded.)
- [ ] **Phase 2** — `src/world2d/index.js`: tiled accessor mirroring the WORLD API
  (`surfaceAt/roadPointAt/buildingsNear/landmarkById/customerById/reachablePointNear/
  onElevated`); lazy tile load by camera; `districtAt(x,y)` point-in-polygon
  (reuse `pointInPoly` in `src/game/physics.js`); drop `topY/botY`, add `inWater`.
- [ ] **Phase 3** — `pnpm add pixi.js`; `src/render/pixi/` behind `Renderer.js` seam
  (`setupCanvas/render/paintVehicle`); layered containers + tile culling; free 2-D camera
  (remove corridor clamp); port the `canvas2d.js` drawers.
- [ ] **Phase 4** — sim decoupling: `physics.js` drop `topY/botY` peninsula bounds (~117-121,
  299) → water push-back via `inWater`; `spawns.js` gulls/boats sample water not `topY/botY`;
  `districtAt` calls (`delivery.js:12`, `physics.js:155`, `progress.js`) 2-D; barriers 2-D or
  dropped.
- [ ] **Phase 5** — minimap = real 2-D map; re-run POI-reachability gate; full compare vs
  `corridor-stable`.

## Preserving the Paseo detail (no dev regression)
These are **OSM-rule-driven**, so they regenerate under planar (confirmed in the smoke: "46
palms on the paseo median dashes", "26 trees" on the León Cortés strip):
- **Paseo de los Turistas** palm median — `paseo_median_runs` + `stamp_paseo_median` (keys off
  the OSM name; the `paseo de los turistas`/`león cortés` → `primary` override still applies).
- **Paseo León Cortés tree strip** — `continuous_runs` (keys off the name + cuadra corners).
- **End barro street** (León continuation past the Parque Marino corner) — `barro_leon_
  continuation` is now **coordinate-agnostic** (flags the León piece that runs east past the
  Ferrocarril avenue's west end) so it works in BOTH corridor and planar. NOTE: needs the
  Ferrocarril avenue present in the build region (it's east of a centro-only smoke bbox).
- **Ferrocarril barro + elev + cross-street dirt** — flagged by name in `extract_roads`
  (`"rrocarril"`) + `propagate_barro_to_crossings` (both run in planar).

## Gotchas / notes
- Bounded smoke bbox drops out-of-region POIs → "unplaced (water)" warnings (expected).
- `PlanarProjection.project_m` passes metres through as `(s,d)`; corridor-distance callers
  (`way_in_corridor`, the building corridor check) are skipped in planar.
- The `ancla` landmark has a corridor `xy` — it's a corridor-only monument; ignore/skip in
  planar (junction islands come from real geometry).
- Keep `CANVAS_W/H` CUAD-divisible (`_planar_setup` snaps).
