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
# knobs (env): PLANAR_PX_PER_M (default 1.6), ARCADE_STREET_MUL (default 3.2)
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
- [x] **Phase 2 — tiled accessor** (`src/world2d/index.js`, `WORLD2D`). Manifest loaded eager;
  tiles streamed by camera via `import.meta.glob('./tiles/*.json')` (per-tile RLE grid decode +
  road arclength tables + a local building hash). Lifecycle: `ready(x,y)` (await initial spawn
  window), `update(x,y)` per frame (loads a ±3-tile window, evicts far tiles), `ensureView`,
  `visibleTiles(aabb)` for the renderer. Queries mirror WORLD: `surfaceAt/onRoad/onPaseo/
  inWater/onBeach/onElevated/buildingsNear/landmarkById/customerById/reachablePointNear`.
  `topY/botY/halfWidthAt` are dropped; `inWater` replaces the silhouette.
  **`districtAt(x,y)`**: the manifest polys are x-strips (can't separate Mata Limón / Caldera,
  which stack N–S), so districtAt uses the **nearest district POI-centroid** instead — a proper
  2-D assignment. (True per-barrio polygon rings remain a later refinement.)
  **Verified in-browser** via a dev smoke viewer (`/world2d.html` + `src/world2d/viewer.js`,
  NOT shipped): streams the full 50820×31860 world (110 tiles resident at a whole-map zoom),
  `surfaceAt`/`districtAt`/POIs correct from Faro→Caldera, no console errors.
- [~] **Phase 3/4 groundwork — traversability PROVEN.** The smoke viewer now drives a car with
  the game's real physics model (`src/game/physics.js` port: turn/accel/grip/friction +
  axis-slide collision) against `WORLD2D.surfaceAt`, camera following. Verified in-browser:
  the car drives on the real centro streets, stays **100% on drivable surface**, is blocked by
  water/acera/land walls (water-as-wall replaces the corridor `topY/botY` bounds), and
  `districtAt` updates as it moves. So the full 2-D Puntarenas is drivable end-to-end.
  - **RESOLVED — arcade street width widened.** At `ARCADE_STREET_MUL=2.2`, centro
    cross-streets were only 24–44 px (≤ the 44 px pickup): drivable but tight. Bumped the
    default to **`3.2`** and rebuilt (164s). Gores/cuadras survive (164 cuadras, 176 inscribed
    ≥6×6, 92.1% drivable, 52/52 POIs) and streets widened to **residential 36 px / corridor
    median 72 px** (was 25 px). Re-verified in the smoke viewer: a car drove 411 px along a
    street at full road speed (300), on-road 240/240 frames. Vehicle-scale knob still available
    later if needed, but the width call is settled.
- [x] **Phase 3 (core) — PixiJS renderer.** `pixi.js` 8.19 added. `src/render/pixi/`:
  `World2DRenderer` (WebGL `Application`, one camera-transformed `world` container with layered
  sub-containers surface/building/poi/entity), `tileTexture.js` (per-tile surface grid →
  `CanvasSource` texture, nearest-filtered, 1 texel = `CELL` world px). Per-tile sprite+building
  cache with **exact culling** driven by `WORLD2D.visibleTiles` (48 visible ⇒ 48 tracked at
  zoom 0.05). Shared `src/world2d/drive.js` (car + physics extracted from the canvas viewer).
  Verified in **`world2d-pixi.html`**: surface + buildings + POIs render, drives (527 px
  along-street), whole-peninsula zoom-out. NOT yet behind the `Renderer.js` seam — the shipped
  game still uses canvas2d + corridor `WORLD` (`pixi.js` stays out of the prod bundle since the
  viewer isn't a build entry). **Next for Pixi:** (a) draw the manifest backdrop polys
  (`LAND_POLYS/WATERS/BEACHES`) as an always-visible low-res base so extreme zoom-out isn't
  gapped by the ±3-tile streaming window; (b) port entity drawers (peds/gulls/boats/vendors) and
  weather when wiring into the game.
- [ ] **Phase 4 (full) — wire 2-D into the shipped game.** Swap `WORLD`→`WORLD2D` behind the
  world import, thread the async `ready()/update()` into app/mode init, `physics.js` water
  push-back via `inWater` (done in the viewer port), `spawns.js` gulls/boats sample water not
  `topY/botY`, `districtAt`→2-D (done: nearest-centroid), explore barriers 2-D or dropped.
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
