# Full 2-D real-Puntarenas map (Milestone D) + backup

## Context

**La Ruta del Churchill** currently renders the world as a **corridor-unroll**: a thin
~900 m band around the Faro→Caldera route, projected via `class Spine` in
`tools/build_world.py` (x = arclength along the spine, y = perpendicular offset ×
`CROSS_EXAG`). It looks great in the centro/spit (the Paseo de los Turistas + León
Cortés detail), but it omits ~2,160 of 2,666 OSM streets (Barranca, El Roble, Chacarita,
Esparza, the north bank) and distorts geography.

**Goal (user):** make the game **traversable over the real Puntarenas as a full 2-D map**.
Decisions locked in with the user:
- **True-scale 2-D layout** — real proportions/positions, so **real cuadra sizes and shapes
  appear** (the spit becomes thin; Paseo detail regenerates from the OSM rules).
- **Streets & vehicle stay exaggerated for arcade feel** — real block *layout*, but street
  widths and the car are scaled up by tunable multipliers so it still drives like an arcade
  game (kept modest so junction gores survive — see "Scale, arcade feel & junctions").
- **Full OSM bounds** (everything in `docs/map.osm`: bbox 9.8539–10.0304 N, −84.9188–−84.6328 E).
- **PixiJS/WebGL renderer from the start** (Canvas2D won't hit 60 fps at this scale).
- **Preserve everything** — nothing discarded. The current corridor build (all the Paseo
  work) is backed up and stays reachable; the Paseo detail regenerates because it's
  produced by OSM-driven rules, not hand coordinates.

### Risk assessment
**Effort: high. Risk to existing work: low** (backup + a separate branch keep the corridor
build fully intact and shippable until 2-D is proven). Why it's tractable:
- The corridor projection is **isolated** in `build_world.py` (`Spine`, `project`,
  `way_in_corridor`, `CROSS_EXAG`). Swapping to a planar projection is small there.
- The engine is **mostly coordinate-agnostic**: physics/collision go through
  `WORLD.surfaceAt(x,y)` (a grid), roads are polylines, delivery/spawns are already 2-D.
- Engine coupling to the corridor is only a **handful of points** to change:
  `topY/botY/halfWidthAt` (peninsula silhouette → real coastline + water class),
  `districtAt(x)` (x-band → 2-D polygon), `CENTER_Y`, and the camera's corridor assumptions.

**Real risks, and mitigations:**
1. **World size / data budget.** Full-OSM true-scale (~40k×25k px at ~1.28 px/m) →
   millions of grid cells and 2,666 road ways; `data.js` (today 1.35 MB) would balloon.
   → **Tile/chunk** the world; load tiles by camera region.
2. **PixiJS is greenfield** (Milestone C not started) — the largest new-code area.
   → Layered containers + culling; port the Canvas2D draw logic incrementally.
3. **True-scale spit is thin** — accepted by the user; the Paseo rules still run.

### Scale, arcade feel & junctions
- **Real block layout/sizes** appear at one uniform `px_per_m` — real cuadra variety and
  real block shapes, not the current uniform tiles.
- **Arcade exaggeration knobs** (the user wants an arcade feel, not a sim): street width =
  `real_width × ARCADE_STREET_MUL`, plus a **vehicle scale**. Real block *layout*, boosted
  street/car so it still drives like an arcade game.
  **Trade-off (a real coupling):** the wider the streets, the more they eat into the
  triangular gores at junctions; keep `ARCADE_STREET_MUL` modest so splits stay clean. We
  pick and tune the multiplier against gore survival.
- **Junctions & separations come from real geometry.** At real (narrow) street footprints,
  forking streets no longer overlap the gore between them, so the leftover land survives and
  the existing `detect_blocks()` classifies it (large → cuadra, thin sliver → paved island)
  — the **intersection triangles, split separations, and divided-avenue medians appear
  automatically**. The corridor workarounds are therefore **dropped in 2-D:**
  `carriageway_gores`, the hand `ISLAND_DEFS`, `divide_cocal_carriageways`, and the gore /
  island stamping were corridor-only patches (the user noted the Cocal result was weak) and
  are not carried over. *Caveats:* where OSM maps a junction as a single centerline there is
  no gore (a plain intersection, which is also real there); the **raised-curb** median look
  stays an optional render-time polish (the *separation/collision* is automatic).

## Phase 0 — Backup & safety net (do first)
- Tag + branch the current corridor build so nothing is ever lost:
  `git tag corridor-v1 && git push origin corridor-v1`; `git branch corridor-stable`.
- Do **all** 2-D work on a new branch `world-2d`; keep `main` = the corridor build
  (shippable) until 2-D is verified. The corridor `src/world/data.js` and
  `tools/build_world.py` stay intact on `main`.

## Phase 1 — Planar world build (`tools/build_world.py`, gated by a mode)
Add a `--planar` mode (or `PROJECTION="planar"` knob) so the corridor build is untouched.
- **Projection:** replace `Spine.project()`/`to_px()` with a direct planar map reusing
  `to_m(lat,lon)` (`build_world.py:277`): `x = (m_x)·px_per_m + margin`,
  `y = (m_y)·px_per_m + margin` (local ENU / Web-Mercator-flat). No arclength, no
  `CROSS_EXAG`.
- **Include all OSM:** drop `way_in_corridor` (`build_world.py:647`) clipping in planar mode.
- **Coastline instead of silhouette:** the corridor `topY/botY` per-column arrays go away;
  water/land come from the already-extracted coastline/`WATERS`/`BEACHES` polygons
  (`extract_coastlines`, the `natural=water/coastline` handling) rasterised into the grid's
  `CLS_WATER`. `halfWidthAt` is dropped.
- **Districts → 2-D polygons:** replace `DISTRICT_BOUNDS_GEO` x-bands with district
  **polygons** (hand geo rings or OSM `admin`/`place` areas); emit `{id,name,tone,poly}`.
- **Keep the OSM-driven detail rules** (they regenerate the Paseo look): palm median
  (`paseo_median_runs`), León Cortés tree strip (`continuous_runs`), barro flags,
  kiosks/customers/landmarks (all keyed off OSM names/`ll`), cuadras/aceras.
- **Street widths = `real_width × ARCADE_STREET_MUL`** (tunable) + a **vehicle-scale** knob
  for the arcade feel; tune the multiplier against gore survival (see "Scale, arcade feel &
  junctions"). Drop the corridor gore/island hacks (`carriageway_gores`, `ISLAND_DEFS`,
  `divide_cocal_carriageways`) — junction triangles now emerge from real geometry via
  `detect_blocks()`.
- **Chunked emit:** tile the world into a grid of tiles (e.g. 2048 px). Emit
  `src/world2d/tiles/<col>_<row>.json` = that tile's RLE surface slab + road/building/
  feature lists, plus a small `manifest.json` (world size, tile size, districts, POIs,
  px_per_m). Keeps any single payload small and streamable.

## Phase 2 — Tiled world accessor (`src/world2d/index.js`)
- New accessor mirroring the current `WORLD` API so the sim/UI don't change shape:
  `surfaceAt`, `roadPointAt`, `buildingsNear`, `landmarkById`, `customerById`,
  `reachablePointNear`, `onElevated`. Loads/caches tiles near the camera; `surfaceAt`
  indexes into the active tile's slab.
- `districtAt(x,y)` → **point-in-polygon** over district polys (reuse the even-odd test in
  `src/game/physics.js:pointInPoly`).
- Drop/stub `topY/botY/halfWidthAt`; expose `inWater(x,y)` from the grid instead.

## Phase 3 — PixiJS renderer (`src/render/pixi/`, swapped in `Renderer.js`)
- `pnpm add pixi.js`. New backend exporting the same seam
  (`setupCanvas`, `render`, `paintVehicle`) from `src/render/Renderer.js:12`.
- Layered `Container`s (water → land → blocks → roads → medians/rails/islands → landmarks →
  entities → weather → overlays); static world tiles cached as textures, culled by camera.
- **Free 2-D camera:** follow `state.p` in all directions (physics already lerps
  `state.cam` to the player); remove the corridor `topY/botY` clamp. `computeZoom` /
  `cuadsPerView` still apply.
- Port the Canvas2D drawers (`drawStreets/drawRails/drawIslands/drawBuildings/…`) to Pixi
  Graphics/Sprites incrementally, matching the current look.

## Phase 4 — Sim decoupling (`src/game/`)
- `physics.js`: remove the `topY/botY` peninsula bounds (117–121, 299) → keep the player on
  land via the water surface class (already blocks nothing; add a soft water push-back using
  `inWater`). Camera clamp becomes world-bounds only.
- `spawns.js` (gulls/boats at 176–177) → sample water from grid/water polys, not `topY/botY`.
- `districtAt` calls (`delivery.js:12`, `physics.js:155`, `progress.js`) now 2-D; explore
  barriers become district-polygon edges or are dropped for free 2-D roam.
- Stages/kiosks/customers re-project automatically (DEFS use `ll`). Re-verify + retune.

## Phase 5 — Content & verification
- Minimap (`canvas2d.js`/pixi) becomes a **real 2-D map** (drop the silhouette code at
  1218–1251).
- Re-run the POI-reachability build gate on the planar network.

## Critical files
- `tools/build_world.py` — projection mode, drop corridor clip, 2-D districts, chunked emit
  (`Spine` 462, `project` 544, `to_m` 277, `way_in_corridor` 647, emit ~2200).
- `src/world2d/` — **new** tiled data + accessor (parallels `src/world/`).
- `src/render/Renderer.js` + **new** `src/render/pixi/` — PixiJS backend.
- `src/game/physics.js`, `spawns.js`, `delivery.js`, `progress.js` — decouple `topY/botY` +
  `districtAt`.
- `package.json` — add `pixi.js`.
- Corridor files on `main` stay untouched; 2-D lives on branch `world-2d`.

## Verification
1. **Bounded smoke first:** run the planar build on a small bbox (the spit only) to validate
   projection + tiling + Pixi cheaply before the full-OSM build.
2. `pnpm world:build --planar` completes; `manifest.json` + tiles emitted; build gate
   (POI reachability) passes on the planar network.
3. `pnpm dev` + browser: drive the real street grid, pan/zoom freely, cross into Barranca/
   Chacarita; confirm 60 fps via the Pixi ticker; Paseo/roads/kiosks render; deliveries work.
4. Compare against `corridor-stable` to confirm nothing on `main` regressed.
5. Only after 2-D is verified and looks right do we consider making it the default; until
   then `main` (corridor) remains the shipped game.
