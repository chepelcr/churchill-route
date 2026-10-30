# El reescalado del mundo — devolverle a la manzana su terreno

Status: **DONE 2026-08-27 at p = 3.125.** Steps 0, 1, 2 and 3 are complete; the
world is built at 3.125 px/m with `ARCADE_STREET_MUL` 1.856. This document is
still the whole context — it can be picked up cold — and what follows is the
original analysis, kept as written, with the outcome recorded at the end of each
section it decided.

Two corrections the execution turned up, both worth reading before trusting a
number below:

* **variant A's p = 4.0 does not build.** `assert TILE_PX % CUAD == 0` fails
  (3200 % 30 = 20). Scanning the ladder for rungs where both quantisation
  asserts hold with the metres in `world-units.json` untouched gives exactly
  **2.55, 3.125, 3.75, 4.375** — and at every one of them the twelve road
  classes keep their painted pixel width to the pixel, which is the invariant
  that makes traffic and collision indifferent to the change.
* **the world does not get bigger in DATA.** The table below worries about
  "raster ×1.14" and "×2.56"; that was computed holding `GRID_CELL` fixed in
  pixels. It is not: it derives from `grid.rasterCellM` = 1.6 m, so it scales
  with the world and the cell COUNT is unchanged. At p = 3.125 the raster is the
  same 19 850 × 12 445 cells in the same 1 000 tiles as at 2.5 — same ground,
  same resolution, same bytes. Only the pixel scale moved.

**Y HABÍA UN CUARTO PASO QUE ESTE DOCUMENTO NO PODÍA PREVER: DESHACER EL CAMPO
DE DILATACIÓN.** Entre que esto se escribió y se ejecutó, se construyó
`service/dilation.py` — un campo de desplazamiento 2-D que separaba las manzanas
localmente. Es exactamente la proyección no uniforme contra la que este
documento advierte más abajo («NO LA REVIVAS»), y costó exactamente lo que dice
que cuesta: 5 509 celdas del pueblo giradas más de 3°, la Calle 35 doblada 55.8
px sobre 417, el marco del Mercado girado 19.5°, 370 px de cizalla a lo largo
del Paseo. Se apagó en la misma corrida. Y la comparación es limpia, sobre la
misma ventana del centro: **31 `ghost` sin campo a 2.5, 26 con campo, 21 con el
reescalado a 3.125.** El reescalado encaja MÁS edificios que el campo, y no
dobla una sola calle.

## The one-paragraph problem

The projection is faithful (planar, true-scale, `world px = (metres − origin) ·
PLANAR_PX_PER_M`) and it is not the problem. The problem is that the **car is a
7.6-metre-wide vehicle**. Two of them must pass on a 7 m calle, so every street
is painted 2.32× its real width, and the 47 px of corridor that buys comes out
of the manzanas — 24 px per side. That is why buildings are fitted (median
scale 0.78), why parcels land on aceras, why the Mercado Municipal's own
manzana is too small to be recognised as a block, and why the same class of bug
keeps coming back under different names.

Nothing about the fitting is wrong; it is the correct response to the geometry
it is given. This document changes the geometry.

## Why this cannot be fixed with a different projection

A projection maps lat/lon → px. It cannot change the ratio between two lengths
that are both measured in metres, and the conflict is exactly such a ratio:

| | game | real | ratio |
|---|---|---|---|
| pickup, across (`vehicles.js` `h`) | 19 px = **7.6 m** | 1.9 m | **4×** |
| residential calle (painted) | 40.6 px = 16.2 m | 7 m | 2.3× |

Two 19 px cars in a 40.6 px calle leave **1.6 px** of total clearance. The
current constants are already at their limit; there is no slack to give back to
the manzanas at this scale.

The car is 7.6 m because the camera frames **160 m** of ground
(`camera.viewWidthM`; it was `CUADS_PER_VIEW · CUAD` = 400 world px until step 0
below). A true-scale car would
be 4.75 px — 1.2 % of the screen, undrivable.

So the irreducible trade, which no projection escapes:

> **To give blocks their true proportions, the car must occupy a smaller
> fraction of the screen, or the screen must show less ground.**

A *non-uniform* projection (locally dilate streets, contract blocks) does evade
it mathematically — that was the corridor-unroll, deleted 2026-07-25. It cost
true distances, straight streets and every hand-placed junction gore. Do not
revive it.

## The lever: the same projection at a higher `px_per_m`

Raise `PLANAR_PX_PER_M` while holding the car's **pixel** size fixed. The car
then shrinks *in metres* without shrinking on screen, and `ARCADE_STREET_MUL`
can fall — which is the only thing that actually returns ground to the manzana.

`mul` is derived, not guessed: `mul ≥ (2·car_px + clearance_px) / (7 · p)`.
At p = 4.0 with 6 px of clearance: `(38 + 6) / 28 = 1.57`.

Measured on the Mercado's manzana (62.8 m short side, centreline to centreline),
land = 62.8 − street − 2·acera:

| variant | p | `GRID_CELL` | `CUAD` | street | acera/side | **land** | view | car on screen | raster |
|---|---|---|---|---|---|---|---|---|---|
| **now** | 2.5 | 4 | 20 | 16.2 m | 4.8 m | **37.0 m** | 160 m | 4.75 % | ×1.00 |
| **A** | 4.0 | 6 | 30 | 11.0 m | 4.5 m | **42.8 m** *(+16 %)* | 150 m | 3.17 % | ×1.14 |
| **B** | 4.0 | 4 | 20 | 11.0 m | 3.0 m | **45.8 m** *(+24 %)* | 100 m | 4.75 % | ×2.56 |
| **C** | 6.0 | 9 | 45 | 7.3 m | 4.5 m | **46.5 m** *(+26 %)* | 150 m | 2.11 % | ×1.14 |

**Read the middle column before anything else: the gain is 16–26 %, not a
multiple.** An earlier draft of this document claimed the manzana would be 2.3×
larger; that was arithmetic done in cuadrículas while the cuadrícula itself was
being resized, and it is wrong. In metres — the only frame that does not move —
a manzana can never regain more than ~26 %, because even with a true-scale car
the street still takes its real 7 m and the aceras take 9 m of the 62.8.

So this project **improves** the squeeze, it does not end it.
`fit_manzana_contents` stays; its median scale moves from 0.78 to roughly 0.88.
If the goal is "no fitting at all", the honest lever is not the scale, it is the
**4.8 m aceras** (real Puntarenas sidewalks are 1.5–2 m) — variant B's gain over
A is almost entirely narrower sidewalks, not the rescale.

### Choosing between them

`assert CUAD % GRID_CELL == 0` holds for all three (30/6, 20/4, 45/9 = 5 cells
per cuadrícula, unchanged, so nothing counting cells per cuadrícula moves).
`TILE_PX = TILE_CUADS · CUAD` grows with `CUAD`; check the tile count stays near
1000 and re-tune `TILE_CUADS` if not.

- **A** is cost-neutral (raster ×1.14, build ~30 min, world ~19 MB) and keeps
  today's framing, but the car drops to 3.2 % of the screen.
- **B** keeps the car exactly as it reads today, and gains the most land, but
  costs ×2.56 raster (~65 min builds, ~40 MB world) and shows only 100 m of
  road ahead instead of 160.
- **C** is the practical ceiling: the car reaches 3.2 m wide and streets are
  nearly true, but at 2.1 % of the screen it is probably too small to drive.

**Decide this on a phone before writing any code.** Everything downstream
depends on it, and it is a feel judgement no measurement settles. The trade is
the one stated above — car legibility, view distance, street width — and no
projection escapes it.

### …but on a phone the zoom FLOOR decides it, not the table

`computeZoom` (`src/render/c2d/gfx.js`) is
`max(MIN_ZOOM, wCss / VIEW_WIDTH_PX) · tuning.zoom`, and `MIN_ZOOM` derives to
2.2 at today's scale (it was written as that bare 2.2 until step 0). The floor
binds on
any screen narrower than 880 CSS px — **every phone in landscape**. Modelled at
wCss = 800:

| | view @ zoom 1.0 | car on screen |
|---|---|---|
| today, phone | 145 m | 5.22 % |
| variant A, phone | **91 m** | **5.22 %** |
| variant B, phone | **91 m** | **5.22 %** |
| today, desktop | 160 m | 4.75 % |
| variant A, desktop | 150 m | 3.17 % |

Three things follow, and they matter more than the variant table:

1. **On a phone the rescale does not shrink the car at all.** The floor pins the
   magnification, so the cost arrives as **37 % less visible road** instead. The
   "the car gets smaller" framing is desktop-only.
2. **A and B are indistinguishable on a phone.** The `CUAD` choice only shows up
   on desktop. Do not agonise over it on the device that ships.
3. **The floor must scale INVERSELY with p** — `2.2 · (2.5 / p)` = 1.375 at
   p = 4.0. It is a magnification (screen px per world px) and world px per
   metre went up. Scaling it *up*, which is the intuitive guess, crops the phone
   view to 57 m.

The floor was converting the whole trade from "smaller car" into "less road
ahead" without anyone having chosen that, and it was a bare `2.2` in one
function. **Fixed in step 0**: it is `camera.minScreenPxPerM` = 5.5 screen px
per METRE, which is scale-free, so point 3 above is now arithmetic the file does
rather than a rule somebody has to remember. Note there is no fixed
`MAX_VIEW_M`: the view the floor allows is `wCss / 5.5` metres, so it depends on
the screen — writing it as metres would have hidden that.

**The zoom slider is the empirical anchor.** `tuning.zoom` runs 0.6–1.4
(`SettingsScreen.jsx:81`), which on a phone already spans **104 m to 242 m** of
view. That is a wider range than any variant here differs by, so every variant
sits inside what players already tolerate — and at the 60 % setting a player is
today looking at a car 3.13 % of the screen, essentially variant A's desktop
figure. The "is the car too small" question is already answered by shipped
behaviour; do not re-litigate it with a build.

## What breaks, and how to find it

Every constant denominated in **px** is calibrated to the current scale and will
silently mean something different. This has happened twice already:

- **1.6 → 2.0** broke the `StreetIndex` search spans; Calle 6 fell just outside a
  700 px span, the Las Playitas estadio fell back to its anchor rect and took
  Kiosco Playitas off the drivable network with it.
- **2.0 → 2.5** moved the real manzanas 4 000 px away from the hand-laid `carmen`
  and `centro` px anchors: all four bounding streets resolved to `None` and the
  **entire civic centre stopped existing** — Catedral, Casa de la Cultura,
  Biblioteca, Parque de la Virgen, Parroquia del Carmen, Jardín, Plaza El
  Carmen — with two WARN lines to say so. `tools/smoke.mjs` drove from a
  hardcoded px too and "passed" on drift at a top speed of 0.

The rule learned from both: **a distance that means something in the world
belongs in metres.** `STREET_SPAN_M`, `SHORE_RECLAIM_M`, `MALECON_BAND_M`,
`FARO_ESP_R_M` were already converted.

**And being metres is not the same as being reachable** — a distinction this
document did not draw until it cost something. Those fifteen sat in `config.py`
as metre literals: safe across a rescale, and invisible to the editor, which
reads `src/assets/world-units.json` and nothing else. Among them are the five
that shape the faro's plazoleta and the malecón, i.e. exactly the ones somebody
designing the sea front would reach for. They moved to the registry on
2026-08-14 (`world.street`, `world.shore`, `world.woods`, `world.blocks`, and
the extended `world.malecon` / `world.faro`), with the build log
character-identical over the smoke window and every derived integer unchanged.
So the audit list below is now about METRES ONLY: a constant on it is still px.

The audit list of what has not been:

```
config.py         POI_NUDGE_PX 750, SERVICE_MIN_PX 150,
                  DP_ROAD_PX 1.0 / DP_BUILDING_PX 2.0 / DP_COAST_PX 2.5 /
                  DP_SAND_PX 12.0  (simplification tolerances — these are
                  arguably px-native: they are about the DRAWN vector, not the
                  world. Decide per constant, do not convert blindly.)
                  MARINE_POOL_GROUND_CLEAR_PX 28, MARINE_POOL_MIN_SPACING_PX 72,
                  MARINE_POOL_RAIL_CLEAR_PX 52, MARINE_STRUCTURE_PARCEL_PAD_PX 8
                  SPIT_MAX_WIDTH_PX 4000, SPIT_SHORE_TOL_PX 200,
                  ESTERO_MAINLAND_PX 4000, MANGROVE_PITCH_PX 56
                  MALECON_MIN_SAND_PX 24, MALECON_MIN_TAKE_PX 12,
                  MALECON_MIN_PATCH_CELLS 120
                  KIOSK_WATER_CLEAR_PX 30
                  FARO_ESP_MAX_CELLS 6000, FARO_POCKET_MAX_CELLS 400
                  ~~ACERA_CELLS 3, FIELD_ACERA_CELLS 2~~ (step 0: derived from
                  kerb.sidewalkM / fieldSidewalkM), BLOCK_MIN_CUADS 6,
                  SLIVER_MAX_CUADS 25.0, SMALL_BLOCK_CUADS 188, OSM_MAX_CUADS 4
                  BLDG_INSET 2, BUILDING_SCALE 1.4, POI pads
service/ferry.py     RIDE_PX 1800   (DECK_L/DECK_W/DOCK_S: metres, step 0)
service/lancha.py    SIMPLIFY_PX 60, SNAP_PX 400, MIN_ACCESS_PX 24
                     (CHANNEL_PITCH and TANGENT_SPAN went to metres in step 0)
service/placement.py snap_into_block(reach_px=160, inset_px=32)
service/field.py     LOT_SIZE (76, 60), _slide_cells_into(reach=44 cells)
```

`ACERA_CELLS` and friends are counted in **raster cells**, so they follow
`GRID_CELL`: at 6 px cells, `ACERA_CELLS = 3` is 18 px = 4.5 m instead of 12 px
= 4.8 m. Near enough to leave — verify, do not assume.

Client side: `src/render/` is full of px sizes tuned to today's zoom. The
framing and the floor were the two that mattered and both are metres now
(`src/assets/world-units.json`, derived in `src/domain/units.js`).
`src/game/vehicles.js` `w`/`h` are the car, and they are still px — deliberately,
since the car's size is a SCREEN decision, which is the trade this whole document
is about.

Speeds are **px/s** (`top: 180…352`), so at the same numbers a delivery takes
the same seconds only if px-per-metre is unchanged — it is not. **Stage timers
must be re-measured, not assumed** (`config.py` says so already).

### Compensating with vehicle speed

Scaling `accel`/`top` by `p` restores both the real speed (m/s) and the
on-screen feel, under one rule: **linear px quantities scale with `p`; angular
and time quantities do not.** `turn` is rad/s, so the turning radius in metres
holds; `melt` is seconds, so the churchill budget is unaffected. (This only
holds where the view in metres is unchanged — under the phone floor it is not,
so re-measure rather than assume.)

It is not free. `physics.js:426` integrates in ONE step (`p.x += p.vx * dt`)
and collision is a box probe at the destination — there is no swept test. The
probe box is ~7.6 px half-height:

| | px/frame @60fps | @30fps |
|---|---|---|
| today, 352 px/s | 5.9 | 11.7 — **already past the probe** |
| p = 4.0, 563 px/s | 9.4 | 18.8 |

So substepping (or a swept probe) is part of this task, not a follow-up. It is
already marginal on a 30 fps phone today.

## Order of work

0. ~~**Retire the cuadrícula as a SCREEN unit and name the world's units in
   metres.**~~ **DONE 2026-08-14**, and the world came out byte-identical
   (`[snapshot] OK — 1001 files byte-identical`), which is the whole reason it
   was worth doing before anything moves.

   The lengths live in **`src/assets/world-units.json`, in metres**, and both
   ends derive their own pixels from it — `px(m) = round(m · PLANAR_PX_PER_M)`
   in `churchill/world/config.py`, and `src/domain/units.js` in the game, off
   `meta.pxPerMeter`. Today every value lands exactly on the integer it used to
   be hard-coded as, and `tests/test_world_units.py` asserts that against the
   shipped manifest, so the conversion moved nothing.

   `CUAD` had three jobs and the camera one is gone:

   | job | where | outcome |
   |---|---|---|
   | camera framing (`CUADS_PER_VIEW · CUAD` = 400 px) | `gfx.js` | **retired** — `camera.viewWidthM` = 160 m |
   | quantisation grid for block detection + synth lots | `detect_blocks`, `b["cells"]`, `SMALL_BLOCK_CUADS`, `OSM_MAX_CUADS`, `FRONTAGE_DEPTH` | kept, and named `grid.lotGridM` = 8 m |
   | tile size (`TILE_PX = TILE_CUADS · CUAD`) | `config.py` | kept, independent: `grid.tileM` = 800 m |

   Two things came out differently from the sketch above, both worth knowing.

   **There is no `MAX_VIEW_M` to write down.** The bare `2.2` is a
   MAGNIFICATION — screen px per world px — so the view it allows is
   `wCss / floor` and therefore depends on the screen, and naming it as a fixed
   number of metres would have hidden exactly that. It is authored as
   **`camera.minScreenPxPerM` = 5.5**, screen px per METRE, which is scale-free:
   5.5 / 2.5 is the 2.2 the game has always used, and at p = 4.0 it derives to
   1.375 without anybody remembering that this one goes *down*. Verified
   against the old formula at eleven widths from 320 to 3840, including the
   crossover at exactly 880: identical at every one.

   **`SIDEWALK_M` is a real width but `ACERA_CELLS` is a COUNT.** The depth is
   `kerb.sidewalkM` = 4.8 m and the cells are derived from it through
   `GRID_CELL`, which is the point: at a 6 px raster cell the bare `3` would
   quietly have become 18 px of sidewalk and nothing in the build would have
   said so.

1. ~~**Decide the framing on a phone.**~~ **DECIDIDO 2026-08-27: p = 3.125**, el
   escalón intermedio. `camera.viewWidthM` se deja en 160 m, así que la vista en
   metros no cambia en ninguna pantalla y lo que se mueve es el carro: 26 px
   dejan de ser 10.4 m y pasan a ser 8.3, o sea 57 -> 46 px de pantalla en un
   teléfono. Es la dirección que este documento pide («achicar los vehículos
   primero») y queda muy dentro de lo que el deslizador de zoom ya permite.

   Ojo con el análisis del piso de arriba: decía que «en un teléfono el
   reescalado no encoge el carro» porque el piso era un `2.2` crudo (px de
   pantalla por px de MUNDO). El paso 0 lo volvió `minScreenPxPerM` = 5.5 —px de
   pantalla por METRO, o sea libre de escala—, así que hoy es al revés: la vista
   en metros se conserva y el carro es lo que encoge. `tests/test_world_units.py`
   fija las dos mitades.
2. ~~Convert the audit list above to metres (or confirm px-native).~~
   **DONE 2026-08-14.** Everything that is a real size on the ground is in
   `src/assets/world-units.json` -> `world`; the rest is listed under
   `_pxNative` WITH ITS REASON, which is as much the deliverable as the
   conversions — a value converted for tidiness breaks at the next rescale in
   the direction nobody expects.

   The proof is the ARITHMETIC, not a rebuild: the build is deterministic, so
   every constant deriving to the integer it was hard-coded as means the emitted
   world is identical by construction. 23 derivations checked, all exact.

   Left in pixels, each for a stated reason: `KIOSK_WATER_CLEAR_PX` (it clears
   the ART, whose 32 px width does not scale with the world), `CHANNEL_HW_CAP`
   and `CHANNEL_HW_MIN` (statements about the SCREEN — the camera frames a fixed
   number of metres, so px is what holds them), `BLDG_INSET` (a hairline is a
   hairline), the four `DP_*` tolerances (they measure the emitted VECTOR and
   trade fidelity against manifest size) and `BUILDING_SCALE` (a ratio).
3. ~~Change `PLANAR_PX_PER_M`, `ARCADE_STREET_MUL`, `GRID_CELL`, `CUAD`
   together.~~ **HECHO**, y resultaron ser DOS y no cuatro: desde el paso 0
   `GRID_CELL`, `CUAD` y `TILE_PX` se derivan de los metros de
   `world-units.json`, así que se mueven solos (4->5, 20->25, 2000->2500) y los
   dos asserts siguen dando cero. La edición es `PLANAR_PX_PER_M` 2.5 -> 3.125 y
   `ARCADE_STREET_MUL` 2.32 -> 1.856.

   Y la auditoría del paso 2 se quedó corta en cuatro sitios, todos por el mismo
   malentendido: «px-native» se había usado para decir «no depende del suelo»,
   cuando lo que decide es si depende de la ESCALA. Los cuatro se convirtieron a
   metros y al 2.5 de siempre reproducen su entero exacto — `CHANNEL_HW_CAP` y
   `CHANNEL_HW_MIN` (cuya razón escrita decía justo lo contrario de lo cierto:
   la cámara encuadra 160 METROS, y cuántos píxeles son esos 160 metros es
   precisamente lo que un reescalado cambia), las cuatro tolerancias `DP_*`,
   `BUILDING_SCALE` (que «se movía con `ARCADE_STREET_MUL`» sólo en un
   comentario) y los `reach_px=160, inset_px=32` de `snap_into_block`, que no
   estaban ni en la lista. Se quedan en píxeles `KIOSK_WATER_CLEAR_PX`,
   `BLDG_INSET` y el `LOT_SIZE` de `field.py`: los tres están dimensionados
   contra ARTE DIBUJADO, que es lo único que un reescalado no mueve.

   Las velocidades son px/s, así que suben por 1.25 en `vehicles.json`
   (`accel`/`top`; `turn` es rad/s, `melt` segundos, `grip`/`drag` razones — no
   se tocan). Distancias y velocidades escalan juntas, así que **los tiempos de
   etapa se conservan por construcción**. Y el sub-paso del integrador de
   `physics.js` entró en la misma tanda, como este documento exige.
4. Build and **read the log end to end** — it is character-stable and it is the
   review surface. Any `WARN` is a stage to fix, not to ship. Specifically
   check: the civic centre resolves, every estadio resolves its bounding
   streets, the drivable-network gate, the kiosk water clearances, the marine
   gate, `[blocks]` counts.
5. `python3 tools/world_snapshot.py save` (INTENDED change), `pnpm inventory`,
   `python3 tools/gen_lotes.py`.
6. `pnpm build && pnpm preview`, then `node tools/smoke.mjs
   http://localhost:8799/` — the render loop is one try-less call chain, so one
   ReferenceError kills the frame silently and `pnpm build` cannot see it.
7. Re-measure stage timers by actually driving each stage.
8. Changelog in `docs/changelog/YYYY-MM-DD.md`, Spanish, ready-to-post copy up
   top and `## 🧾 Changelog` below.

## What this fixes, and what it does not

Improves, by 16–26 % of manzana depth — not solves:

- Buildings fitted below their real size (`fit_manzana_contents`): median scale
  0.78 → ~0.88.
- Parcels with nowhere to sit but the acera: fewer, not none.

Fixes outright, but **for a reason worth understanding**:

- ~~`BLOCK_MIN_CUADS = 6` rejecting real manzanas.~~ **DONE 2026-08-11, without
  this project**, exactly as the note below said to. It is `BLOCK_MIN_M = 32`
  now, and the rebuild measured **416 → 599 cuadras, 566 → 383 green, 1 126
  paved slivers unchanged** — all 183 that moved came out of green, i.e. real
  manzanas that were being given no buildings at all.

  The original finding, kept because the reasoning is the point: **61 % of land
  components bigger than 4 cuadrículas fell below the 6×6 bar** — 417 cuadras
  vs 569 green and 984 paved slivers. A standard Puntarenas manzana yields a
  4.6-cuadrícula inscribed square against a bar of 6, so the bar was set above
  what this town can physically produce.

  It passes after the rescale (variant A: 5.7 cuads against a 6-cuad bar — still
  marginal; variant B: 9.2, comfortable) — but mostly **because the cuadrícula
  shrinks in metres, not because the block gained ground**. `BLOCK_MIN_CUADS` is
  a px-denominated threshold: 6 × `CUAD`. Today that is 48 m; in variant B it is
  30 m, and the same 42–46 m block sails past.

  That means the classification bug did **not** need this project. Expressing
  the threshold in metres (or simply setting it to 4) fixed it today, in one
  line — and being metres is the half that matters for the rescale: whatever
  `PLANAR_PX_PER_M` becomes, 32 m stays 32 m.

Does **not** fix, and is worth doing independently:

- **Blocks are defined as leftover raster blobs.** `detect_blocks` finds
  `CLS_LAND` components after the streets are stamped, so it cannot tell a real
  manzana from an intersection wedge except by size — hence a size threshold at
  all, and hence the Mercado's short wide manzana being paved as a *sliver*.
  The size-independent definition is topological: **a manzana is a face of the
  planar graph of street centrelines**. Four streets bound it, so it is a block,
  at any size; a stroke-width leftover is not a face and needs no size test to
  be rejected. This is what `shapely.ops.polygonize` does — but the builder is
  deliberately pure-stdlib (no `requirements.txt`), so it would be a hand-rolled
  noding + half-edge cycle extraction, or a decision to take the dependency.

If only one of the two is done, **do the rescale first**: it gives the buildings
room, whereas topological blocks fix the classification without changing how
much ground anything actually has.
