# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

**La Ruta del Churchill** — a top-down arcade delivery game set on a faithful,
true-scale 2-D recreation of the Puntarenas peninsula, Costa Rica. You drive a
vehicle, pick up a *churchill* (shaved-ice drink) at a kiosk, and deliver it to a
customer before it melts. Three modes: **Historia** (7 stages), **Arcade** (3-min
free roam), **Recorrer** (open world with unlockable districts).

Design doc: `docs/GAME_DESIGN.md`. **`ROADMAP.md` is OPEN WORK ONLY** — it was
pruned on 2026-08-14 after several of its oldest rows turned out to be false (it
claimed the game had no audio, an all-Spanish UI and a pending 2-D map). The
history lives in `docs/ROADMAP-ARCHIVE.md`, and the per-date release notes in
`docs/changelog/YYYY-MM-DD.md`. **Verify a row against the tree before acting on
it, and archive it if it has closed or rotted** — that is how the file stays
worth reading.

## ANTES DE TOCAR CONTENIDO: ¿esto ya es data?

**This is the first question for any change to what the game CONTAINS** — a
place, a colour, a crowd, a price, a piece of copy, a vehicle, a light. The
answer decides the whole shape of the work, and getting it wrong is how this
codebase accumulated ~420 colour literals and a civic centre nobody could edit.

The procedure is three steps and it is not optional:

1. **LOOK IT UP IN THE INDEX BELOW.** If a registry already owns it, edit the
   registry. Do not add a second copy anywhere — `materials.street.majorDash`
   already held the road's dash colour while `paintRoads` re-typed the same hex
   two lines down, so moving the knob changed every dash in the game except the
   ones on the road.
2. **IF IT IS STILL HARDCODED, MIGRATE IT FIRST, THEN MAKE THE CHANGE.** Two
   commits or one, but the migration is proved SEPARATELY — see the gates
   below. Editing a literal in place is how the next person finds three copies.
3. **IF IT SHOULD NOT BE DATA, SAY SO IN THE FILE.** Some things are algorithms
   and stay code (below). Writing down which, and why, is what stops the next
   sweep from converting them.

### Where a thing lives

| what you are changing | file |
|---|---|
| a place: landmark, customer, stage, district, feria ride, beach access | `content/world/{landmarks,customers,stages,geography,attractions}.json` |
| **a hand-made manzana** — the civic block, El Carmen, a stadium/plaza, the Marino's partition, the Balneario | `content/world/blocks.json` (each names its `BlockLayout`) |
| **where the disused railway runs relative to named streets** | `content/world/railway.json` — names and metres only; never world px or geo anchors |
| **the ground of one manzana or one parcel** | `content/world/blocks.json` → `manzanas` (BY GEO) / `parcels` (by id) |
| **who stands on a pitch** | `content/world/blocks.json` → `crowd`; what a type IS → `src/game/npcTypes.json` |
| a muelle's size, width, style | `content/world/piers.json` |
| how an OSM site fits its cuadra (`trace`/`cuadra`/`rect`/`kiosco`) | `content/world/site-decor.json` |
| a surface class's colour and speed | `src/assets/surfaces.json` |
| a length two runtimes must agree about, IN METRES | `src/assets/world-units.json` |
| **un largo que UN registro autora** (un `dx`, un ancho, el radio de un juego) | en METROS y en su propio registro, con sufijo `M` — `content.py` → `METRE_KEYS` lo pasa a px al cargar. **Nunca en píxeles**: sólo son verdad a la escala en que se afinaron, y este mundo lleva cuatro reescalados |
| the player's vehicles (parts, stats, cargo) | `src/assets/vehicles.json` |
| **the traffic, the crowd, boats, coins, the carried cargo** | `src/assets/actors.json` |
| **a light: street lamp, stadium tower, la del muelle** | `src/assets/lights.json` (+ `LightType`). DÓNDE se para la del muelle y de qué tipo es → `materials.json` → `pier.<style>.lamp` |
| **de qué color es un edificio de OSM** | `src/assets/building-styles.json`, por `cat` |
| **la lluvia, sus salpicaduras y la calle encharcada** | `src/assets/hud.json` → `weather.{rain,splash,roadSplash,flood}` |
| **cómo se ve un puesto según lo que vende** | `src/assets/world-props.json` → `landmarks["kiosk:<product>"]` |
| **how a shadow answers the sun; how tall a building is; the terrain shadow-map budget** | `src/assets/effects.json` → `sunShadow` / `buildingHeight` / `terrainShadow` |
| what a vehicle DOES: wake, shadow, turn wind, **headlights** | `src/assets/effects.json` |
| landmarks, signs, parcel props, scenes | `src/assets/world-props.json` |
| the world's palettes: estero, malecón, structures, streets, weather, piers | `src/assets/materials.json` |
| the HUD, the minimap, the crossing card, the tide bar | `src/assets/hud.json` |
| trees and wood mixes | `src/assets/flora.json` |
| the feria's rides and its defaults | `src/render/c2d/feriaAssets.json` (verbs: `c2d/feriaShapes.js`) |
| spawn rates, buses, tides, the day cycle | `src/content/simulation.json` |
| unlocks, the tutorial, **the MVP gate** | `src/content/progression.json` |
| prices, coins, IAP | `src/content/economy.json` |
| ads, analytics, remote content | `src/content/services.json` (**nothing secret** — it ships in the bundle) |
| screens, their slots | `src/ui/screens.json`; copy → `src/i18n/<lang>.json` |
| design tokens | `src/ui/themeTokens.json` |
| any closed vocabulary | `churchill/world/enums/` → `pnpm vocabulary`. **Never retype a generated list.** |

### What stays code, on purpose

The compositor (`canvas2d.js`), the shape interpreter (`shapes.js`), and any
DERIVED geometry: `paintRoads`' casing and dashes, the Marino's
footprint-proximity rule, a pier's ENDS (they grow from the resolved shoreline
or a boat's stern, which is what survives a rescale), a ped's per-instance
motion. The line is `docs/inventory.md` §12: **data composes engine verbs, it
never becomes a worse programming language.** A registry with `Math.` in it has
stopped being one.

### The gates a migration has to pass

* **art** → a synthetic sheet, diffed: `shot-vehicles` · `shot-actors` ·
  `shot-landmarks` · `shot-signs` · `shot-parcels` · `shot-scenes` ·
  `shot-effects` · `shot-stands` · `shot-kiosks` · `shot-lights` · `shot-feria`, vs
  `tools/png-diff.mjs`. **Never diff a world scene** — the noise floor is 2 % to
  86 %. The Vite process on `:8734` is persistent: client modules, JSON and new
  imports are handled by HMR, so **do not kill it or delete
  `node_modules/.vite` as part of the edit loop**. A restart is diagnostic only
  after a reproduced optimizer/config failure; cache deletion is the last step,
  never the first. The sheets' own blank-guards catch a genuinely stale graph —
  believe them before the diff, then diagnose the specific request that failed.
  **But a long-lived HMR server splits the module graph for a tool that imports
  a source module by plain path**, and that is not the same failure. Once a file
  has been invalidated, the page's own graph holds it as
  `/src/game/daynight.js?t=1787029979794` while `import("/src/game/daynight.js")`
  mints a SECOND instance with its own module state. So `smoke:sky` and
  `smoke:shadows` — the only two that reach in and move the clock — set the hour
  on one `cycle` and read `sunShadow`/`weatherColors` off the other: both report
  the sky and the shadows never moving, with the code correct and every art sheet
  clean. `sunVector()` sweeps in the same breath, which is what makes it read as
  a real regression. **LAS SMOKES QUE IMPORTAN MÓDULOS FUENTE VAN CONTRA UN SERVIDOR FRESCO**, en
  otro puerto (`pnpm dev --port 8736 --strictPort`), nunca contra un `:8734` que
  lleve un ciclo de edición encima. Son **seis** y se reconocen porque hacen
  `import("/src/…")`: `smoke:sky`, `smoke:shadows`, `smoke:sceneshadows`,
  `smoke:standshadow`, `smoke:feria` y `smoke:grade`. Las de producción
  (`smoke`, `boat`, `crossing`, `theme`, `sponsor`, `night`) toman
  `vite preview` y no les afecta.

  Esto mordió CUATRO veces en un solo día, y no siempre igual: dos smokes que
  reportan que el cielo y las sombras no se mueven; una hoja de parcelas que sale
  ENTERA en blanco; y las cuatro fallando a la vez después de reconstruir 240
  tiles. El síntoma no se parece a un servidor viejo — se parece a una regresión,
  y por eso cuesta. **La prueba barata es correrlo en un puerto nuevo antes de
  creerle al fallo.** `shot-parcels` esquiva la mitad del problema resolviendo la
  URL VIVA de `gfx.js` desde el fuente de `streets.js`, y `smoke-scene-shadows`
  hace lo mismo con `daynight.js`; es el patrón a copiar cuando una herramienta
  tiene que compartir instancia con el pintor.
* **no sheet?** compare the SET of colours against `git show HEAD:<file>`. A
  mistyped hex does not survive that.
* **anything the builder reads** → `PLANAR_BBOX=… pnpm world:build` (1 min,
  cannot write `src/world2d/`) FIRST, then the full 33-min run, then
  `world_snapshot.py verify` — **byte-identical** for a pure lift, or `save` in
  the same commit for an intended change.
* **the build log is a review surface**: diff two runs. It is character-stable,
  so a `:.0f` matters.
* `pnpm test` · `pnpm inventory` · the smokes · `cd world-editor && npm test`.

**A new registry needs four things or it is not done**: the file, a validator in
the editor (`vite.config.js` — an unvalidated source can corrupt the game's
JSON), a row in `gen-inventory.mjs`, and a test module named in `pnpm test`'s
list — that list is explicit, so a new test file passes by never running.

## Toolchain

Vite + pnpm project. Node 20+; get pnpm via `corepack` (or `~/.local/bin/pnpm`).

```
pnpm install
pnpm dev            # HMR dev server (falls back off :8734 if taken)
./reboot-server.sh  # …o esto: lo relevanta y DEJA EL LOG EN EL REPO
pnpm build          # -> dist/ (static; GitHub Pages publishes this)
pnpm preview        # serve the production build
pnpm inventory      # regenerate inventory.json
pnpm vocabulary     # regenerate src/domain|assets/vocabulary.generated.* from the enums
pnpm test           # python unit tests (vocabulary drift gate, surfaces, editor patch)
pnpm world:build    # rebuild src/world2d/ from docs/map.osm (deterministic)
python3 tools/world_snapshot.py verify   # emitted world unchanged?
```

**EL BUILDER PUEDE ESCRIBIR EN OTRO CHECKOUT.** `CHURCHILL_GAME_ROOT` (el
editor's own variable, not a second name for one concept) redirects every path
the builder aims at the game. The boundary is **eight paths in four files** —
`config.py` (the emitted world + three shared registries), `service/npc.py`
(npcTypes), `gen_vocabulary.py` (the two published artifacts) and
`world_snapshot.py` — and `tests/test_game_root.py` pins that list, so a ninth
crossing has to be a decision rather than an oversight. Unset, everything
behaves exactly as a single checkout. See ROADMAP §6b for the split it is for.

**`./reboot-server.sh` — EL SERVIDOR, Y SU LOG DONDE SE PUEDA LEER.**

```
./reboot-server.sh            # dev en :8734
./reboot-server.sh 8736       # un servidor FRESCO en otro puerto
./reboot-server.sh --clean    # …y además borra la caché de Vite
./reboot-server.sh --stop     # baja el de ese puerto y no levanta nada
```

Tres cosas que hace y que no son cosméticas:

* **El log va a `logs/dev-<puerto>.log`, dentro del repo** (ignorado por git).
  Antes cada quien lo escondía en su propio directorio temporal, así que la
  única forma de saber por qué no arrancó era preguntarle a quien lo hubiera
  levantado. Ahora es un `tail -f` y lo lee cualquiera.
* **Mata al DUEÑO DEL PUERTO, nunca a `node` entero.** En esta máquina puede
  haber a la vez un dev en :8734, un servidor fresco en :8736 y un `vite
  preview` en :8799; llevárselos por delante es peor que el problema.
* **`--clean` es opt-in**, y por lo que ya dice la sección de arte más abajo: el
  proceso de :8734 es PERSISTENTE y borrarle la caché como parte del ciclo de
  edición cuesta un arranque en frío cada vez sin arreglar nada. Reiniciar es
  diagnóstico; borrar la caché es el último paso, nunca el primero.

Y espera a que el puerto RESPONDA en vez de dormir un rato fijo: en frío Vite
tarda más, y un `sleep` a ojo declara éxito antes de tiempo.

Deploy: push to `main` → `.github/workflows/deploy.yml` builds with pnpm and
publishes `dist/` to GitHub Pages (https://churchill.jcampos.dev, `CNAME`).

## Android APK (Capacitor)

The `android/` Gradle project is committed (generated by `npx cap add android`,
then hand-edited: `sensorLandscape` in `AndroidManifest.xml`, sticky-immersive
in `MainActivity.java`). Icons/splash regenerate from `assets/icon.png` +
`assets/splash*.png` (sources: `assets/*.svg`) via
`npx capacitor-assets generate --android`.

One-time prerequisites (macOS):

```
brew install --cask temurin@21            # JDK
brew install --cask android-commandlinetools
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # add to ~/.zshrc
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
```

Build loop:

```
pnpm build && npx cap sync android
cd android && ./gradlew assembleDebug
# -> android/app/build/outputs/apk/debug/app-debug.apk (adb install / share)
```

Release builds need a signing keystore (keep out of git; `*.keystore` is
ignored). In the WebView the service worker is skipped (`!window.Capacitor`
guard in `src/main.jsx`) and `enterImmersive()` no-ops — the native shell
already forces landscape + immersive.

## Architecture (`src/`)

The game is an MVC-ish split. Game logic (the "model") is renderer-agnostic; the
renderer (the "view") lives behind a seam so backends can be swapped.

- `src/main.jsx` — entry: mounts `<App/>`, registers the service worker.
- `src/game/` — simulation + state (renderer-agnostic):
  - `state.js` — the shared mutable `state` singleton + world-entity arrays
    (traffic, pedestrians, gulls, boats, parked, vendors, animals) + `pushFloat`.
  - `vehicles.js`, `surfaces.js`, `boat.js` — **pure data/functions,
    browser-free** (also imported by the inventory script and by Node checks;
    keep them free of `window`/DOM).
  - `input.js` (keyboard/gamepad/touch), `spawns.js`, `delivery.js` (pickup/
    deliver loop + scoring), `physics.js` (`update(dt)`: driving, collisions,
    entity advancement), `progress.js` (localStorage unlocks/barriers),
    `modes.js` (`startArcade`/`startStage`/`startExplore` + setters).
  - `index.js` — **Game facade** + main loop; exports `Game`, mirrors it to
    `window.Game` for the dev tweaks host + console debugging.
- `src/world2d/` — **generated**, do not hand-edit: `manifest.json` + streamed
  `tiles/*.json` from `tools/build_world.py`, plus `index.js` (the `WORLD2D`/`W`
  accessor: per-tile RLE decode + streaming, `surfaceAt`, road arclength
  samplers, building spatial hash, silhouettes).
- `src/render/` — `Renderer.js` is the seam and `camera.js` is the ONE camera
  authority shared by its backends. `canvas2d.js` paints the complete shipped
  world; the transparent `pixi/` layer above carries migrated landmark
  structures (currently none are owned there). **There is no three.js layer**:
  one was built to stages 1-3 (terrain relief + a real mountain shadow map) and
  then to a full 3-D town, and the whole of it was removed on 2026-08-26 — the
  work is preserved at the tag `3d-attempt-2026-08-26` if it is ever wanted
  back. `src/render/camera.js` and `src/render/sun.js` SURVIVED it on purpose:
  they are the single camera and single sun authorities the 2-D game now reads,
  and neither contains any three.js.
  **`c2d/shapes.js` — the shape interpreter — IMPORTS NO PART OF THE GAME, and
  `tests/test_shape_interpreter.py` keeps it that way.** It is the engine's half
  of every art catalog, and the editor loads it to preview the record it is
  editing; `gfx.js` is the BOTTOM of the renderer and would drag the world
  accessor, `state`, the day cycle, `tuning` and `materials.json` along.
  **`c2d/feriaShapes.js` is the SECOND interpreter and stays second on purpose**:
  the feria measures in FRACTIONS OF A RIDE'S RADIUS (with a `Px` suffix for
  absolutes) — a third frame — and only `disc`/`ring` share a name with the 21
  above. The other 26 are not primitives but RECIPES for a fairground stall
  (`counter`, `awning`, `facade`, `prizes`, `goods`). Merging them would move the
  pixels of 71 hand-tuned parts for nothing a player sees. What WAS closed is the
  drift: both interpreters export their verb list, and the editor's validator
  asks instead of keeping the copy of 28 names it used to hold. So the
  four helpers it needed live in `c2d/primitives.js`, which imports **nothing**
  and takes its context as an argument (`label(g, …)`); `gfx.js` re-exports them
  bound to the shared `ctx`, so all ~30 drawers still call `label(x, y, …)` and
  the nine art sheets came out identical. `paintAt` has **no default surface** —
  `opts.g || sharedCtx` let a caller silently draw on the game's canvas instead
  of its own, which is a bug shaped like nothing happening. The editor drawing
  previews with its OWN code is not the alternative: that already shipped once,
  showing a `park` as `#5ba362` while the game painted `#4f9d5b`.
- `src/ui/` — React: `App.jsx` (screen state machine), `screens/*`
  (Title, StageSelect, HUD, Pause, Results, StageBrief), `TouchControls.jsx`,
  `GameTweaks.jsx`, `tweaks/TweaksPanel.jsx` (reusable dev panel + host bridge).

The UI polls `Game.state` on a rAF tick (state is a live mutable singleton, not
React state) — don't try to make the game state flow through React.

## World pipeline

`tools/build_world.py` reads `docs/map.osm` and emits `src/world2d/` — per-tile
RLE surface slabs + `manifest.json`, loaded by `src/world2d/index.js`
(`WORLD2D`/`W`). The projection is **PLANAR**: world px = (metres − origin) ·
`PLANAR_PX_PER_M`, true-scale, with a geo→world affine in `manifest.meta.geo`.
Deterministic (no RNG) — same input → identical output, which
`tools/world_snapshot.py` enforces (`save` / `verify` / `rebuild`): every
refactor must keep every emitted file (`manifest.json` + each `tiles/*.json`;
641 today, per `tools/world_digest.json`) byte-identical, and an INTENDED world
change re-runs `save` in the same commit.

Surface grid classes (see `src/game/surfaces.js`): `0 water, 1 land (solid cuadra
interior — blocked in physics), 2 beach, 3 road, 4 paseo, 5 bridge/pier, 6 acera,
7 boulevard (calle peatonal: stone paving, transitable but slow), 8 barro (packed
earth — the dirt calles, 0.82 of asphalt), 9 gravel (lastre, 0.9), 10 malecón
(the paved sea front of the Paseo de los Turistas: transitable, 0.55 — you crawl
among people)`. The VALUES
are the wire format: append, never renumber. A new drivable class has to join
`DRIVABLE`, `STREET` and usually `CALLE` in `churchill/world/enums/surface.py` —
leaving barro out of the acera seeds silently stripped the sidewalk from 8,204
cells of cuadra frontage, and out of `CALLE` would point every "nearest street"
search past it. `CARRIAGEWAY` includes the muelle decks; `CALLE` does not,
because a deck is something you drive on, not a street to link to.

**THE CLIENT'S COPY IS GENERATED — never hand-write a class list again.**
`pnpm vocabulary` (`tools/gen_vocabulary.py`) reads `churchill/world/enums/` and
writes `src/domain/vocabulary.generated.js` for the game plus
`src/assets/vocabulary.generated.json` for the tools and the editor: `SURFACE`,
`SURFACE_CLASSES`, `SURFACE_BY_NAME`, the five `SURFACE_ROLE` sets, `ROAD_RANK`,
two `ROAD_ROLE` sets, a `FIELD_SPORT_ROLE` set, and **24** token vocabularies
(`SIGN_KIND`, `PIER_STYLE`, `LANDMARK_TYPE`, `PARCEL_USE`, `UI_SCREEN`,
`GAME_MODE`, `COIN_TYPE`, `ESTERO_ENCOUNTER`, …). Generation is ONE-WAY and the artifacts are
committed, because the game builds with Vite and must not need Python. Add the
member to the Python enum, run `pnpm vocabulary`, and `pnpm test`
(`tests/test_vocabulary.py`) is the gate: it fails on a stale artifact, on a
manifest that disagrees with the enum class for class, on an emitted value with
no renderer implementation, and on any `surfaceAt(...) === <number>` anywhere in
`src/`. A surface's PROPERTIES are a
separate thing from its identity and live in **`src/assets/surfaces.json`**: one
versioned registry, keyed by class NAME, holding the speed multiplier and the
day/night material. Five modules used to keep their own copy of that palette and
two were wrong — the Python debug renderer drew the bulevar `#d8d4c8` against
every client's `#d9d6cd`, and `world2d/viewer.js` knew 7 of the 11 classes and
painted the rest magenta. Now `surfaces.js` (`SURFACE_MUL`), `pixi/tileTexture.js`,
`world2d/viewer.js`, `debug_render.py` and the editor (`/api/surfaces`) all read
the one file, and `tests/test_world_surfaces.py` rejects any new class→colour
table anywhere in `src/` or `churchill/`.

`surfaces.js` imports it with `with { type: "json" }` — required, because
`tools/gen-inventory.mjs` loads that module under plain Node, which refuses a bare
JSON import. Same reason it stays free of DOM and `window`.

Two numbers the client used to guess and now asks the accessor for: `W.ACERA_PX`
and `W.CUAD`. There were four fallbacks for the kerb and they disagreed (12 in
the sim and the editor, 8 in both renderers), so a stale manifest would have
moved every NPC one way and drawn the sidewalk the other.

### The `churchill/` package (Python)

The builder is being split out of `tools/build_world.py` into a layered package
at the repo root, shared with the future accounts/sync/management server:

```
churchill/world/
  config.py      every tuning knob + paths  (PLANAR_PX_PER_M, ARCADE_STREET_MUL
                 + ROAD_WIDTH_M, PLANAR_FULL_BBOX — a smaller PLANAR_BBOX gives
                 a fast smoke build — CUAD, ACERA_CELLS / FIELD_ACERA_CELLS,
                 BUILDING_SCALE)
  content.py     the hand-authored map: DISTRICT_DEFS, LANDMARK_DEFS,
                 CUSTOMER_DEFS, STAGES, RAILWAY_DEF, probes  (geo anchors —
                 the build FAILS listing unresolved POIs)
  logging.py     log(tag, msg) / warn / die — the build log is the review
                 surface, so keep a stage's lines factual and countable
  dto/           PYDANTIC v2 models = the emitted JSON's schema (Manifest, Tile,
                 Parcel, Landmark, Stage…). They VALIDATE the emit; they do not
                 serialize it (key order is historical and varies per producer).
                 The same models a FastAPI controller will return.
  enums/         the world's VOCABULARY and the lowest layer: Surface (IntEnum,
                 the bytes in the RLE) + ParcelUse/GreenType/LandmarkType/
                 PathSurface/Weather/RoadClass. The value IS the wire format;
                 each enum names the client file that must agree with it
  context.py     WorldDims (computed, frozen) + WorldContext — the state stages
                 hand each other. Collections are MUTATED IN PLACE, never
                 rebound, or a service holding one stops seeing new entries
  util/          pure functions: geometry.py (incl. principal_axis, whose
                 docstring names its two failure modes) and raster.py (Raster:
                 buffer + dims + fill_poly/stamp_polyline/flood/erode)
  repository/    the ONLY code that touches storage — Protocols in base.py,
                 osm_file.py (in), world_json.py + debug_render.py (out)
  service/       domain ops, each taking what it needs rather than reaching for
                 globals: street (StreetIndex — read its docstring before
                 picking a method), block, field (estadios + parcels + the OSM
                 sites), building,
                 surface (the stamping ORDER matters), network (the gate),
                 placement (why a POI has to be nudged at all), osm, decoration,
                 projection, signs (street furniture + seating the paradas),
                 kerb (the esquinas — read WHY the renderer cannot find them),
                 railway (named-street alignment + build-audited envelopes)
  pipeline/      the stages: extract_world -> … -> verify -> write_world
```

Nothing imports the layer above it. **`tools/build_world.py` is 19 lines** — a
sys.path shim and a call to `churchill.world.pipeline.runner.main`, which reads
as the ordered list of stages it is:

```
extract_world -> rasterise_surface -> resolve_districts -> place_pois
  -> place_kiosks_and_blocks -> seat_town_kiosks -> place_structures
  -> decorate -> verify -> write_world
```

Stages pass results explicitly rather than sharing a scope; where a value is
handed along by name it is because two stages genuinely share it. Two ordering
facts are load-bearing: `acera_fringe` runs before anything that must stay
un-ringed (that is why a whole-cuadra pitch reads as one open surface), and
`decorate` runs last because it reads the FINISHED surface to decide where a
tree may stand.

The other tools are consumers of the same layers: `tools/gen_lotes.py` reads
through `JsonWorldRepository` and emits validated `Lote` models,
`tools/gen-inventory.mjs` reads the manifest + tiles.

**Every step of that refactor must keep the world byte-identical** — verify with
`python3 tools/world_snapshot.py rebuild`, and diff the build log too (it is
character-stable, so a diff of two runs catches a behaviour change the digest
might not).

The **corridor-unroll projection was deleted** (2026-07-25) along with
`src/world/`: the spine, the x-warp, the hand-placed junction gores/islands and
the `data.js` emitter. If you find a doc or comment describing arclength-along-a-
spine coordinates, it predates that.

**EL MONTE: a wood is an AREA and a MIX, never a list of trees.**
`detect_blocks` cannot tell a manzana from the hinterland except by size, and 55
cuadras over 32 ha hold **95 % of all cuadra ground** (the largest is 270 M px²).
Those are countryside, so `service/woods.py` marks them `cuadra.wood = "seco" |
"monte" | "altura"` and the renderer plants them — `paintWoods` in
`c2d/flora.js`. It CANNOT be emitted trees: that ground wants 300 000–950 000 of
them and the whole world is 16.7 MB. The scatter is a global lattice walked over
the VISIBLE RECTANGLE only, so a 270 M px² forest costs the same ~60 candidates
per frame as a small one, and the position hash keeps every tree still.
Containment is `surfaceAt(x,y) === SURFACE.LAND`, one tile lookup, which is both
cheaper and more correct than a 6 392-vertex point-in-polygon: it already
excludes the roads, the sand and the aceras. Which forest is decided by measured
distance to real water — `manifest.hills` is a painted backdrop band, not
elevation, so it cannot answer "is this highland".

**The species are DATA, the forms are CODE** (`src/assets/flora.json`). A row
says palette, crown radius, trunk height and which `form` draws it; the four
forms (`broadleaf`, `conifer`, `column`, `bare`) are geometry and stay in
`flora.js`. Adding a tree is a row plus a mix that names it. Two things learned
drawing them: overlapping tiers in the SAME shade have no internal edges, so a
conifer whose lower tiers share a colour reads as one ball with a bobble on top;
and a column needs many steps barely narrowing, or it is a snowman.
`tests/test_flora.py` checks every species names a form the renderer implements,
every mix names species that exist, and that the builder only assigns mixes the
registry has.

## World structures — recipes (reusable patterns)

**Place a structure on a named street-grid cuadra** (how the two estadios are
positioned — `place_stadium` in `build_world.py`): OSM roads carry their raw
`name` ("Calle 8", "Avenida Centenario") and a flat world-px `pts` list. To
resolve a block from bounding streets, average a named street's samples NEAR an
anchor: a *calle* → mean `pts[0::2]` (x), an *avenida* → mean `pts[1::2]` (y)
(`_street_vals`). Pass a **list of candidate names** per edge — odd calles are
often unnamed (fall back to the flanking even calle) and the central avenue is
"Avenida Centenario", not "Avenida 0". Always `print` the resolved rect + the
nearby-street diagnostic and eyeball the build log; if a name won't resolve,
ask the user for a geo (`ll`) anchor.

**Make a whole cuadra drivable and draw it as its cuad polygon** (stadiums):
1. Resolve/clip: `_clip_roads_rect` removes road polylines crossing the rect so
   interior cross-streets vanish (two cuadras merge cleanly).
2. `occ.add(...)` every cuad cell → no synth/OSM buildings land there.
3. Stamp the interior `CLS_ROAD` with `_stamp_px` → drivable. `acera_fringe`
   ran EARLIER, so nothing re-rings it with sidewalks (that's the "no aceras").
   **INSET the rect < a street half-width (~18px)** so the pitch overlaps the
   bounding streets' asphalt and stays reachable — a bigger inset fences it off
   behind the acera ring. INSET must still be > 0 so bounding centerlines
   aren't clipped.
4. Emit `lm["footprint"]` (flat cuad-aligned polygon) for the renderer's clip,
   plus a `greens` entry `{"pts":…, "type":"stadium"}` for the grass fill, plus
   a bbox into `manifest["stadiums"]` (array → `W.STADIUMS`).

**Green cuadras (parks / plaza / pool / stadium)**: emitted as ONE outline
polygon per block in `manifest.greens` (`_green_poly` →
`_block_raster_cells` + `_outline_poly`). `outline_polys` first traces the exact
cell boundary, then straightens one-cell stair runs into their direct diagonal;
the cells remain authoritative for collision and ownership. It is painted in
`drawLandBase` (first ground paint, global — no sand flash while tiles stream).
Colour + dilation by type in `canvas2d.js` `GREEN_COLORS` / `drawGreenPoly`:
parks dilate 28px (tuck under the acera band); `pool`/`stadium` use `m=0`. To
suppress a block's buildings, set `blocks[bi]["green"]=True` (excluded from
`synth_buildings`).

**Coins + NPCs inside a drivable area**: coins (`maintainArcadeCoins`) spawn on
any class-3/5 cell near the camera, so a `CLS_ROAD` pitch gets them for free in
every mode.

**Aceras are DIRECTIONAL — a ring only where there is a street.** An open field
(estadio, plaza) is two polygons: the *outline*, the whole cuadra stamped
`CLS_ROAD` so the car drives straight in, and the *footprint*, the drawn pitch =
outline eroded by `ACERA_CELLS`. `_erode_cells(cells, depth, facing)` seeds its
distance transform ONLY from boundary cells whose outside neighbour is in
`STREET_CLASSES`, so the pitch pulls back from the asphalt (its white lines stop
at the kerb) and still runs edge to edge everywhere else: Las Playitas out into
the sand on its north, the Carmen plaza flush against the parroquia on its west.
For a parcel the erosion is the BLOCK's (`inner`), so `aceras: True` means
"respect the cuadra's ring" and an internal split line is never eroded; the
drivable stamp always uses the part's UN-eroded cells, so the ring is asphalt you
can drive on, not a wall around the field. `aceras: False` opts out entirely.

**A CUADRA'S ANGLE COMES FROM ITS BOUNDING STREETS — never from a fit.** The
cuadrícula is not square to the screen and is not even square to itself (by El
Carmen the avenidas run at -5.4° and the calles at 82.3°, 3.5° out of square).
`place_parcels` reads `_street_dir(names, ref, "x"|"y")` — the direction of a
named avenida (east) / calle (south) near the block — and cuts **columns with
lines parallel to the CALLES and rows with lines parallel to the AVENIDAS** (each
cell projected on the *normal of the other family*, an affine frame that fits a
parallelogram block). Two ways a principal-axis fit gets this WRONG, both seen on
the Carmen block:
- **degenerate on a square-ish block** — `sxx ≈ syy` makes `0.5·atan2(2sxy,
  sxx−syy)` snap to ±45°, i.e. the CONTRARY diagonal to the manzana;
- **orthogonal by construction** — it can never express the real grid's skew.
`_cell_frame` survives only as the centre + a fallback axis (and `pitchFrame`'s
old vertex fit is worse still: parcel/pitch polys are raster-TRACED, so their
vertices are 4px staircase steps — fitting Plaza El Carmen's gives -67°).
Each parcel therefore emits its block angle as `ang` (radians) into
`manifest.parcels`, and everything the renderer draws ON it turns by that angle:
`fieldFrame(S, ang)` → `paintField` (grass, mow stripes, fútbol markings — shared
with the whole-cuadra estadios), `drawChurch(x, y, s, ang)`, the garden's tree
scatter, the sponsor plate. Anything new drawn on a parcel must use `P.ang`; a
`strokeRect` off `P.x0..P.x1` puts a square pitch on a slanted block.

**A parcel straight from OSM** (`extract_sites` + `FieldService.place_osm_sites`
— 380 of the world's 403 parcels). A closed OSM area tagged as a park, cancha,
escuela, jardín de niños, campus or iglesia is the GROUND a place occupies, and
becomes a parcel on the cuadra under it. The parts that are load-bearing:
- **Keep only `CLS_LAND`/`CLS_ACERA` under the outline.** Testing the SURFACE is
  what keeps a parcel out of the roadway and lets it follow a diagonal avenida
  exactly — the same move `_reclaim` makes, from the other side. A site that
  fails `SITE_MIN_KEPT` is a ribbon along a street, not a place: log it and skip.
- **Ground already handed out is measured CELL BY CELL** (`claimed_cells`), not
  by CUAD: at 20 px two sites either side of the same calle share a cell.
- **THE PARCEL IS A RECTANGLE THAT CANNOT CROSS A STREET.** The mapper's
  outline is regularised with the percentile `fit_block_rect` (2% off each end,
  so one driveway arm cannot stretch the whole site). ACERA is valid parcel
  frontage and keeps that established fit. If the rectangle covers ROAD, PASEO,
  BRIDGE or BOULEVARD, `fit_inscribed_rect` replaces it with the largest
  rectangle in this site's own sidewalk-eroded LAND mask. A bounding
  rectangle is not containment: on a skewed site it can bridge an intervening
  street — Parque Mora y Cañas grew from its ~84 px cuadra width to 162 px and
  covered 540 ROAD cells that way. The inscribed fallback is rechecked at
  raster-cell centres before `rect_poly` emits it; already-safe sites keep their
  established percentile geometry.
- **The acera ring is GRADED** (`ACERA_CELLS` → `FIELD_ACERA_CELLS` → 1 → 0).
  A hard-surface-spilling rect is INSCRIBED in strict LAND from what the erosion
  left; an ACERA-only fit keeps the frontage the site already owns. Judge the
  depth by whether what survives is still a PLOT (`SITE_MIN_SIDE`), never by how
  much AREA it kept.
- **Emit `hw`/`hh`** (half-extents along `ang`). Everything drawn on a parcel
  used to size itself off the axis-aligned bbox, which on a turned parcel is
  bigger than the parcel — so the art spilled over its own kerb. `parcelFrame`
  in `src/render/c2d/gfx.js` is the one place that reads them.
- **`ang` comes from `StreetIndex.angle_at`** — the nearest centreline, folded
  into the avenida family (-45°, 45°]. Its `reach` is measured from the parcel's
  CENTRE, so it must clear half a manzana plus the street (12·CUAD; at 3·CUAD a
  third of the sites fell back to 0.0 and drew square to the screen).
- **`green: False` unless the site owns ≥60% of its cuadra.** The block-green
  flag kills the WHOLE manzana's synth buildings; `occ` already keeps them off
  the parcel's own cells, which is all a small cancha needs.
- A `worship`/`school`/`kinder`/`campus` parcel DRAWS the building, so its OSM
  footprints are cleared (named footprints bypass `occ`), and its duplicate POI
  dot is dropped — but a park keeps its dot, since parks carry no name pill.
- `SITE_DECOR[parcel_id]["trace"]` is the narrow exception for a place whose
  identity is the angled cuadra contour rather than a rectangular lot. It keeps
  the largest source-supported ground component, applies the normal directional
  acera erosion, and emits `outline_poly`; Parque Mora y Cañas uses it so its
  west corner and diagonal north edge survive without restoring the old
  hard-surface spill.

**Lay a whole cuadra out by hand** (`content/world/blocks.json`). Every
hand-authored manzana lives there — the civic superblock, El Carmen, the two
estadios/plazas, the Parque Marino's partitioned cuadra and the Balneario — and
**each one NAMES its strategy** (`BlockLayout`: `bands`, `streets-quad`,
`footprint-lots`, `water-inlet`). The JSON chooses and parameterises; the engine
implements. A `layout` nobody implements does not raise: the manzana simply
stops existing, which is exactly how the civic centre was lost once.
Two things have already happened to a manzana by the time `place_parcels` runs,
and both make `cuadra_cells` return garbage — it looks for LAND/ACERA, and the
block may be neither:
- `stamp_pad` carved a 6-cuadrícula `CLS_ROAD` apron under every kiosk and
  customer. ONE customer seated on the block cuts it in half, and the trace then
  returns the largest surviving fragment (an L of sidewalk → 8x16 px parts);
- `detect_blocks` paved the cuadra to `CLS_ACERA` as a *sliver* if it fits no
  6x6 square of buildable cells. A short, wide manzana qualifies.

`"reclaim": True` fixes both: every cell in the rect that **no road centreline
paints** (`StreetIndex.on_street`, which reads the ROAD LIST, not the raster)
goes back to `CLS_LAND`. Use the road list, never an inset rect — the rect runs
centreline to centreline and a diagonal avenida cuts across any margin you pick.
`"clear_buildings": True` then drops the OSM footprints on the claimed cuad
cells: NAMED buildings are kept at their real outline unconditionally, so
without it the capilla and the curia stand in the middle of the new park.
A part may also carry `"lm": "<id>"` (re-anchor that landmark to the parcel
centre), `"river"/"statue"/"bus"` (civic furniture the renderer draws — the
world says only which parcel has one), and `"use": "boulevard"`, which stamps
`Surface.BOULEVARD` (7): transitable but slow, painted as stone by `paintStone`.

**Organic stadium (four emitted graderías + corner mouths)**: `place_stadium`
builds each estadio as a `quad` that follows the street grid — a diagonal block
resolves its left/right edges from the two calles' *lines* (`_street_line` =
principal-axis fit) intersected with the south avenue (`_iline`), extended
north; an axis block uses `_street_vals`. The pitch remains the inset polygon,
but every authored `stands.side`/`stands.sides` is emitted as its own 12 px-deep
quadrilateral. Those exact quads drive both art and collision: only their bands
are blocked, while four corner mouths remain drivable. `drawStadium(lm)` paints
the emitted quads and derives their northward solar offsets from
`sunShadow(heightM)`; do not restore the former inward fixed three-pixel stroke.
Interior cross-streets are clipped by `_clip_roads_poly`.

**UN EDIFICIO SE PINTA POR LO QUE ES, Y LA LLAVE NO ES `building`.**
`src/assets/building-styles.json`, resuelto en `c2d/buildingStyle.js`. Cada
huella con nombre recibía `BLDG_PALETTE[rng()]` — estable por su id y sin
ninguna relación con el lugar, así que un hotel, una iglesia, una soda y una
bodega salían del mismo bombo. Lo que lo hace posible ya estaba emitido y no lo
usaba nadie: **`cat`**, en 487 edificios del mundo publicado.

La trampa está en cuál etiqueta responde. `building` NO: de las 635 huellas con
nombre de esta ventana, **571 dicen `building=yes`** — no es una categoría, es
la ausencia de una, y la prueba y el validador del editor la rechazan por su
nombre. La categoría real vive en `amenity`/`shop`/`tourism`/`office`, que es lo
que `poi_category` ya resuelve: 80 restaurantes, 71 templos, 28 pulperías, 22
oficinas de gobierno, 18 hoteles. Hoy 366 de 487 (75 %) tienen estilo.

Se resuelve en el **CLIENTE**, no en el build, y eso es la mitad del punto:
`cat` ya viaja en el mundo emitido, así que reteñir el puerto entero cuesta una
recarga y no 33 minutos. El `color` emitido sigue siendo el respaldo, de modo
que un edificio sin categoría se ve exactamente igual que antes — que es lo que
hace la migración demostrable edificio por edificio. Un estilo para una
categoría que el mundo nunca emite es deriva y `tests/test_building_styles.py`
lo falla: ya cobró tres (`amenity=school`, `building=industrial`,
`building=warehouse`).

**UN PUESTO SE PARECE A LO QUE VENDE.** `propFor` (c2d/landmarks.js) prueba
**id → `tipo:producto` → tipo**, y la escalera está exportada como
`landmarkProp` para que una hoja de arte o el inspector del editor resuelva
IGUAL que el juego — escribirse una propia es la deriva que ya se cerró cuando
el editor pintaba un `park` de otro verde. Los 17 kioscos son puntos de recogida
de cinco comidas y los diecisiete se dibujaban como el de churchill, con esa
palabra en el rótulo. Un producto sin arte propio cae al puesto genérico a
propósito: agregar una comida no obliga a dibujarla el mismo día. `pnpm
shot:kiosks` es su hoja, y **falla si dos productos resuelven al MISMO arte** —
el fallo callado de una escalera con niveles, que se ve idéntico a que el arte
no exista.

**UN SITIO PUEDE DECLARAR SU TAMAÑO REAL EN METROS** (`"sizeM": [w, h]` en
`site-decor.json`). El contorno del mapeador es a veces un BOCETO: la cancha del
Paseo viene como 91x31 px (36 x 12 m) cuando una cancha multiuso tiene el doble
de fondo, y `rect` no podía arreglarlo porque sólo recorta FRACCIONES de lo
dibujado. Crece hacia su tamaño y nunca sobre calzada — se prueban tamaños
decrecientes y se queda con el primero que no pisa duro. **Y la prueba de
invasión lee `shore`**: `MALECON` está en `HARD_STREET_CLASSES` (es calzada
lenta), así que a un sitio que ESTÁ sobre el malecón se le contaba su propio
suelo como pisada y no cabía ni al 60 % de sí mismo. Lo que es suelo declarado
de un sitio no es invasión.

**LO QUE UNA ETAPA AJUSTA, EL REGISTRO LO PONE POR DEFECTO.** Las ordas de
gaviotas se leían `state.stage?.hazards?.gullFlocks || 0`, y **Recorrer no tiene
etapa**: en el mundo abierto, que es donde más se anda, no salía ni una — y lo
que se ve volando ahí son las gaviotas sueltas del golfo, que nunca fueron un
estorbo y a simple vista no se distinguen de una orda, así que parecía colisión
rota. El piso vive en `simulation.json` y la etapa manda SOBRE él con `??` y no
con `||`, de modo que una etapa que pide 0 sigue siendo una decisión y no una
omisión.

**LA TRAVESÍA DEL ESTERO: the lane is MEASURED, and the hull has its own model.**
Two separate things were wrong and each one is worth not re-introducing.

*The course.* `water_route` (`service/lancha.py`) was a plain BFS **shortest**
path, which hugs every inside corner: measured on the line it emitted, the
corridor is under 240 px wide for 68 % of the crossing, drops to 80 px off el
Centro, and at four sample points the perpendicular water on one side was ZERO —
the centreline was ON the mangrove. Against that, `crossing.js` marked a channel
of one constant half-width (105 px), so **82 of 170 buoys stood on dry land** and
16 of 22 gates had a mark ashore. It is now a **clearance-biased Dijkstra** over a
bounded distance transform (`_clearance`, `CLEARANCE_WEIGHT`, penalty SQUARED so
a wide reach still takes the short way), and the build **emits the measured
course** (`Ferry.channel`: `pitch`, `hw`, `off`). Everything that places
something in the estero goes through `laneAt(ch, s)`, never a constant.
`_navigable`'s old "…or any 4-neighbour is water" is exactly the licence that let
the line sit on the bank; it now asks for real clearance.

**THE ESTUARY IS OPENED EARLY; THERE IS NO LATE DREDGE.** `open_estuary` runs in
`rasterise_surface` after mapped water and before `trace_land_contours`, turning
shore-connected `CLS_LAND` inside `estero_band` into the basin the player will
actually sail. It keeps a mangrove rim derived from `MANGROVE_R_MAX`, preserves
detached islets, and protects the road+future-acera corridor, OSM sites/parcels,
authored POI aprons and the lancha landings through `estuary_claim_mask`. That
ordering is load-bearing: the traced land silhouette, the route and the channel
soundings all read the SAME finished coast. Do not restore `dredge_channel`,
`DREDGE_HW`, or a compensating contour overlay in `ctx.waters`; those were the
late-stage workaround this opening replaced.

*The hull.* `src/game/boat.js` owns it. Before, the boat existed only as nine
`afloat ? … : …` subtractions scattered through `physics.js`, and two of them
made a genuine DEADLOCK: `pivot` was hard-zeroed where a car gets `+1.5×turn`
below 60 px/s, then what was left was multiplied by `0.25 + 0.75·spdFac`, so
stopped she had a QUARTER of a turn rate already lower than any car's — and the
touch model's `0.35 + 0.65·cos(e)` starved the throttle to 0.35 exactly when the
finger was behind the beam. No speed → no turn → no way to get speed. She now
always answers the helm (floor 0.62, plus prop wash under power), always makes
way (`idleThrust`), planes above `planeAt`, drifts on the brake, and gets a
bank-repulsion ring plus a glancing deflection. **Land stays a wall** — the
surface classes are append-only, so a class added later must be a wall to a hull
by default; forgiveness comes from the cushion, not from softening `isWall`.

*And the tide stopped narrowing the lane.* `navigableFraction` returned
`0.72 + 0.28·level` and drove the drawn band while **physics never read it**, so
on the pleamar and aguacero attempts — which start near high water and fall for
the whole run — the channel visibly closed in on the player from the first second
to the last, unanswerable because it was not real. Deleted. The tide keeps the
job it can do: `bancoExposed`.

**NPC types (`kind` field, extensible)**: peds carry a `kind` and one of several
advancers (branch in `physics.js`): rail-bound city walkers (`pe.road`,
`advancePed`); **surface crowds** (`playero` on the sand, `paseante` on the
malecón/bulevar) which carry `pe.cls` from `npcSurfaceClasses(kind)` and fall
through to the generic `advanceOnSurface` — so where a type may stand is REGISTRY
data and they appear on every playa in the world, not only the Paseo's; the
`jugador` of a beach **mejenga** (`pe.game`, `advanceBeachPlayer`), whose game is
one entity in `beachGames` carrying its own ball; stadium **fans**
(`kind:"fan"`, `pe.field`, `advanceFieldPed`)
wandering the pitch, CONTAINED well inside the footprint; balneario **swimmers**
(`kind:"swimmer"`, `pe.swim`, `advanceSwimmer`) bouncing inside `W.BALNEARIO`;
and bus **passengers** (`kind:"passenger"`, `pe.bus`,
`advancePassenger`), which are the one TEMPORARY kind — `joinTheSidewalk` drops
BOTH the flag and the `kind` when an alighting one reaches the acera, so a person
who got off a bus simply IS a person walking, drawn like one. All drawn by
`drawPed` (branches on `kind`); a new NPC type that skips `kind` silently
inherits the default walker.

**Buses that stop** (`src/game/buses.js`). A bus stays in `traffic` — same
vehicle, same road network, same collision — and all this module adds is what
happens at the kerb: brake, dwell, alight, board. Two things are load-bearing:
- **The paradas come from the world, already seated.** `seat_bus_stops`
  (`service/signs.py`) snaps each of the 87 OSM `bus_stop` nodes to its nearest
  carriageway and pushes it onto the acera with the road's angle and side, so
  the caseta can be drawn in the STREET's frame and the bus has a kerb to pull
  into. A stop drawn where the surveyor stood is often in the roadway.
- **How many buses run is a FLOOR, not a probability.** At the old 9 % roll on
  main-road spawns the paradas went unvisited for minutes at a time.

**La feria del malecón + DJ Urtech** (`ATTRACTION_DEFS` in `content.py`,
`service/attraction.py`, `src/render/c2d/attractions.js`). Rides are geo-anchored
like every other POI and snapped onto whatever promenade the build produced, and
they are **drawn, never stamped**: the band is 60 px deep and it is the only way
the two Paseo kiosks are reached, so a 40 px carrusel stamped blocking would take
a delivery target off the network. The DJ is seated on the FRONTAGE of the real
OSM building he plays outside (`host: "La Takería"`), not on a coordinate. His
sound is a fourth continuous voice in `src/game/audio.js` beside
`fountain`/`pool`/`waves` — and **distance is a FILTER, not a fader**:
`sfx.dj(level)` opens the lowpass from 260 Hz to ~4 kHz as well as the gain, so
from down the Paseo you get the kick and only at the booth the whole set.

**A word on emitted point features**: `signs` stay global because there are only
~470 and the bus logic wants to index them once. Cuadra corners are not emitted
as separate features: the square raster and source polygons are the geometry.

**A crowd on a cancha** (`maintainStadiumPeds` + `advanceFieldPed` in
`spawns.js`). **WHO stands on a given field is authored** — `crowd` on its block
in `content/world/blocks.json`, a list of `npcTypes.json` ids with an optional
count; `[]` means nobody, absent means the default `fan`. It used to have
`"fan"` written into it four times, so every pitch in the world got the same
crowd and there was no way to take it off one — while `supporter` and `mascot`
sat in the registry hosting `parcel:stadium`/`parcel:plaza` and were **never
spawned**. A type's ID is not its ART, either: `npcArt()` resolves that through
the registry, and reading `kind` as the art is why a `supporter` came out drawn
as an ordinary commuter. Every field with a footprint holds a wandering crowd, and the coin rain is a CLOCK: park on a pitch and the fans throw a
silver burst, once per `ACOIN_RAIN_COOLDOWN`. A match sim with players and a
ball lived here for a day and was reverted — it is in the history if it is ever
wanted again. Two things the crowd has to get right:
- **HOW MANY is a function of the field, not a constant.** A cancha de barrio is
  60 px across and Lito Pérez 210; twelve people is a scrum on the first and
  nothing on the second. `crowdSize` gives one person per `FAN_GAP` box of area.
- **SPACING IS ENFORCED TWICE**, and once is not enough. `fieldPoint` rejects a
  spawn within `FAN_GAP` of a neighbour (falling back to a smaller gap, then
  none, so a tiny pitch still gets somebody), and `advanceFieldPed` shoves
  overlapping pairs apart every frame — they are random walks on one pitch, so
  however well they are placed they will meet.


**THE TWO PASEOS ARE ONE WATERFRONT.** Paseo de los Turistas runs the spit from
the faro to x≈19099; **Paseo León Cortés Castro picks up at that exact point and
carries on east past the Muelle de Cruceros to the Parque Marino**, and both
face the PACIFIC. (Comments in this repo claimed León Cortés was the estero
side. It is not — the estuary is the spit's other shore.) `PASEO_NAMES` is the
pair, and anything about the sea front should use it, not `PASEO_TURISTAS`.

**The coast is 20 m wider than the real one, on purpose** (`reclaim_shore`,
`SHORE_RECLAIM_M`). The real playa is 15–40 m and the camera frames twenty
cuadrículas, so at true scale the beach is a stripe you cross rather than a
place. It is the exact inverse of `beach_fringe` and reuses the same estuary
mask (the estero is mangrove to the waterline and gains nothing). Two bounds,
both learned by leaving them out: it is confined to the **corridor** around the
paseos — run world-wide it doubled the world's sand, doubled the beach palms
and stranded 300k drivable cells — and each candidate casts a **ray** in the
growth direction, so it can never close a channel narrower than twice the depth.
`trace_land_contours` must run AFTER it, or the drawn silhouette keeps the
drowned coast.

**The malecón** (`churchill/world/service/malecon.py`, stamped in
`place_kiosks_and_blocks` after `acera_fringe` and before the faro esplanade).
The ground between the paseos and the playa is `Surface.MALECON`.
Rules, each one measured on this coast:
- **the width is METRES** (`MALECON_BAND_M`) — every px constant here broke at
  the 1.6 → 2.0 rescale;
- **the sand has a veto**: per cross-section the take is capped so
  `MALECON_MIN_SAND_PX` of playa survives seaward, and where nothing is left
  worth paving there is simply no malecón;
- **the BAND converts `CLS_BEACH` only**, which is what lets it follow the real
  wandering line without one hand-placed vertex — and what makes the OSM sites
  already on the front (Parque El Planché, the canchas) survive: their cells are
  reserved, so the paving goes AROUND them;
- **…but the band has to REACH THE KERB, so the link crosses solar and acera**
  (`KERB_LINK_CLASSES`, capped by `MALECON_KERB_LINK_M`, never a carriageway).
  Measured over the 1 589 sea-front cross-sections the kerb-to-sand gap is a
  median of 94 px and p99 150; at the old 30 m shoulder only **7 %** of them
  could even SEE the sand, which is why the sea front shipped as 7 disjoint
  bands with a 636 px hole along the whole Muelle de Cruceros frontage. It
  crosses the ACERA on purpose: `CLS_ACERA` is a wall in the collider, so a
  sidewalk left between asphalt and promenade is a fence, and 4 of those 7
  bands touched neither carriageway nor acera — 6 746 cells you could see, not
  reach, and not leave;
- **`_sand_run` walks PAST an inland sand pocket** instead of writing the
  cross-section off. At 30 m the first sand was always the playa; at 70 m it
  often is not;
- **the closing pass closes SEAMS, not just pinholes.** The rays are
  perpendicular to a centreline that bends, so neighbouring rays disagree about
  where the sand starts and leave one- to three-cell stripes between band and
  link. A stripe has promenade on TWO sides, so a "3 of 4 neighbours" pinhole
  rule cannot see it — it shipped 95 rings and 752 outline points on one band,
  and the renderer's even-odd fill drew every hole as a wedge of bare sand.
  Fill on three neighbours OR on two OPPOSITE ones, and iterate;
- **a patch under `MALECON_MIN_PATCH_CELLS` goes back to the sand**, not merely
  out of the emit — a class-10 cell nobody draws is a hole in the beach.
It emits `manifest.malecon` (outline rings + the Paseo's `ang`), painted by
`src/render/c2d/malecon.js` between the land base and the roads so the acera
band and the asphalt still cover anything that reached the kerb.

**The faro's plazoleta is closed to its kerb, not grown to a radius.** The
yellow line the player saw between the grey plaza and the loop road was never
sand and never a matter of `FARO_ESP_R_M`: it is `CLS_LAND` — 52 px at
y 15 340, 60 px at y 15 560 — drawn in the land tan `#cfb27a`, which against
the plaza's `#cbc6ba` and the acera's `#b8b6b0` reads as a stripe down the
middle of one place. The flood follows SAND, so it could never take that
ground, and the old pocket pass could not either (its scan was a `± Rc` box and
it vetoed anything touching the sea). After the flood the esplanade now absorbs
land and beach OUTWARD until the sidewalk, the roadway or the water stops it —
the loop road is a closed ring around La Punta, so it terminates ON the kerb by
construction — bounded by `FARO_ESP_KERB_LINK_M` and still by
`FARO_ESP_MAX_CELLS`. Same move as the malecón's kerb link, other side of the
spit.

**The drawn sand IS the sand.** `beaches` used to ship the raw OSM
`natural=beach` outlines while the raster's sand is those plus nine rings of
`beach_fringe` — so 8.5 % of the beach cells were painted with the land tan and
the seam read as a straight line down the playa. `service.surface.sand_outlines`
traces the FINISHED raster instead (run last, after the malecón, the esplanade,
the pads and the bajadas take their cells).

**Y LA SILUETA DE LA TIERRA SE PUEDE PERDER EN SILENCIO — el mapa de aristas de
`trace_land_contours` es un MULTIMAPA y tiene que serlo.** El trazador encadena
aristas de frontera; un punto de la retícula donde dos celdas de tierra se tocan
ESQUINA CON ESQUINA a través del agua es el inicio de DOS aristas. Guardadas en
un `dict` de `inicio -> fin`, la segunda pisaba a la primera, el paseo que
llegaba a la perdida se salía de la cadena, y la prueba de cierre descartaba **el
lazo entero**. Medido sobre un fixture de dos bloques que se tocan por una
esquina: **0 lazos conservados y 17 cadenas descartadas**, o sea ninguna silueta
para dos bloques macizos.

El 2026-08-23 abrir la cuenca del estero agregó pellizcos nuevos y uno solo
borró el único lazo de **24 200 vértices** que es toda la tierra firme más el
arenal: `landPolys` pasó de 26 a 54 y **ninguno** de cinco puntos del arenal
quedaba dentro de alguno. Como `drawLandBase` pinta el mar en todo el viewport y
encima las tierras, los patios de El Cocal se dibujaban como MAR ABIERTO — con
el ráster diciendo 0 % agua ahí. Se ve en una captura y en ninguna prueba, que es
lo que lo hace peligroso.

Ahora se consume una salida por visita y **una cadena que no cierra AVISA**. No
se exige un número de lazos: atravesar el pellizco traza los dos bloques como un
ocho, y un ocho relleno cubre los dos. Lo que se exige —y lo que habría cazado
esto— es que **la tierra que hay quede DENTRO de alguna silueta**.

**LOS EDIFICIOS SE QUEDAN AL TAMAÑO QUE EL MAPEADOR MIDIÓ**
(`MANZANA_FIT_MIN_SCALE = 1.0`). `fit_manzana_contents` encogía el grupo de cada
cuadra con una mediana de 0.78 — un 28 % de tamaño perdido justo en los
edificios que uno reconoce. Quitarlo **no cuesta nada, y está medido**: sobre la
ventana del centro salen los MISMOS 31 `ghost` y los MISMOS 279 contornos
reales; lo único que sube es el empujón por edificio (139 → 196), que es trabajo
que la cadena ya sabía hacer. La función se queda como red de seguridad y la
perilla es una env var, así que volver a 0.55 es una línea.

Y el suelo que hacía falta se consiguió por el otro lado — subiendo la escala,
ver «EL LÍMITE ES EL CARRO» aquí abajo. En la misma ventana los `ghost` bajaron
de 31 a **21** sin encoger una sola huella. Si algún día se vuelve a 0.55, hay
un número que conviene tener a mano: medido sobre el mundo entero, el encogido
por grupo NO baja la cuenta de `ghost` (62 en ambos) — lo que baja es cuánta
CALZADA pisan los que quedan, de 2 753 celdas a 943. Es una perilla sobre el
ÁREA de solape, no sobre cuántos edificios no caben.

**EL LÍMITE ES EL CARRO — PERO SE MIDE EN PÍXELES, Y AHÍ ESTÁ LA SALIDA.**
Dar más suelo a una cuadra pide calles más angostas, y las calles son anchas
porque los VEHÍCULOS están dibujados sobre lo real. Dos no se cruzan por debajo
de ~34 px. Bajar `ARCADE_STREET_MUL` A SECAS choca contra eso: a 1.90 la
residencial cae a 33 px y los `ghost` sólo bajan de 31 a 25; a 1.60 son 28 px,
el tráfico se traba, y bajan a 21.

**Lo que no choca es bajarlo SUBIENDO LA ESCALA en la misma proporción.** La
restricción es el ancho PINTADO EN PÍXELES —dos cuerpos de 17 px en 41 px de
calzada—, y `road_width_px` es `metros · MUL · ppm`: subir `ppm` y bajar `MUL`
por el mismo factor deja los 41 px CLAVADOS y encoge la calle en METROS, que es
lo único que la manzana necesita. Es exactamente el «achicar los vehículos
primero» que decía esta sección: a 3.125 px/m el tuktuk sigue midiendo 26 px y
pasa a medir 8.3 m en vez de 10.4, sin tocar una línea de arte.

Hecho el 2026-08-27: **2.5 / 2.32 -> 3.125 / 1.856**. Las doce clases de vía
conservan su ancho pintado al píxel (41/52/64/81/93/70/26/29…), la residencial
pasa de 16.4 m a 13.1, y en la ventana del centro los `ghost` bajan de 31 a
**21** — mejor que los 26 que daba el campo de dilatación, y con las calles
rectas. La escalera de escalones válidos es corta, porque `CUAD % GRID_CELL` y
`TILE_PX % CUAD` tienen que seguir dando cero sin mover un metro de
`world-units.json`: 2.55, 3.125, 3.75, 4.375. (La variante A de `RESCALE.md`
pedía 4.0 y NO pasa: 3200 % 30 = 20.) Lo que se paga es el carro en pantalla, y
sólo eso: `docs/RESCALE.md` tiene la tabla.

**THE MANZANA IS A CONTAINER, AND ITS CONTENTS ARE FITTED TO IT.** This is the
answer to "why is anything standing on the acera", and it had been answered five
different wrong ways before it was answered once. The arithmetic: a 7 m calle is
18 px of real width and the game's corridor is 65 — two cars must pass (a car is
19 px across) and it has to read as a street at play zoom. The other 47 px come
out of the manzanas, 24 px per side. Measured over 59 centro blocks the build
keeps 81 % of the ground the street grid implies, 72 % on the small ones. A
footprint at its true size within 24 px of its centreline HAS nowhere to be.
Nothing about the fitting was ever wrong.

A map app does not have this problem: Mapbox/Carto/Google keep geometry TRUE and
draw roads as STROKES over the basemap, so the casing covers the buildings and
nobody minds — the road is paint. That is closed here, because the player drives
on it. And when symbols genuinely collide, cartographic generalisation displaces
them as a GROUP, preserving structure; never as a greedy per-feature shove,
which is exactly why pushing each footprint along its street normal failed on
corners and dense rows.

So `service/building.fit_manzana_contents` takes each manzana's named footprints
as ONE GROUP and fits it inside the block's own land, inside the acera ring —
one isotropic scale about the group's centre, in the manzana's frame (median
0.78 on the blocks that need one). Shapes and relative arrangement are kept, the
block reads right because it all shrank together, and the per-building push is
only the FALLBACK for footprints belonging to no detected block. Result: 130 of
60 304 named-footprint cells touch street or acera, 3 of them road.
The Parque Marino is exempt — its cuadra is partitioned by hand and scaling the
group toward the centre cost one structure the land its lot is cut from.

**The acera is painted AFTER the parcels, and a parcel is never deleted to keep
it clear.** A parcel is a colour choice on ground somebody else painted; painted
over the acera band it put a park's lawn on the pavement the walkers are
rail-bound to. So `paintParcels` moved ahead of the band in `paintRoads` — the
asphalt still wins over both. **`paintStadiumCuadras` stays AFTER it**, and that
is not an inconsistency: a whole-cuadra estadio is stamped drivable over its own
manzana, so it has no acera in the raster at all and that grey ring IS its
sidewalk — moving it up with the parcels is what erased it. For the same reason
the ring is eroded by `ACERA_CELLS` (a manzana's 12 px) and not by
`FIELD_ACERA_CELLS` (a parcel's 8): Lito Pérez shipped with `aceras: True` and
no sidewalk anybody could see. On the build side
`PARCEL_ACERA_MAX` re-fits a plot inside strict LAND when it spills onto the
sidewalk, but **only as an improvement**: a HARD spill that cannot be re-fitted
is dropped (a park over the roadway is worse than no park), an acera one keeps
the fit it had. Dropping them cost four escuelas, four gasolineras, the INA and
a dozen iglesias the first time. Buildings were never the problem —
`_push_off_street` already pushes named footprints off the acera.

**A LANDMARK AND AN OSM SITE ARE RELATED BY CONTAINMENT, NOT BY ID.** Measured:
the 38 landmarks and the 429 sites are DISJOINT sets of places here (the nearest
compatible site to `parquemar`/`estadio`/`cocal_park` is 588–4 593 px away), so
there is nothing to merge today — the link exists so a landmark added on top of
a mapped area LINKS instead of minting a second record. `osmRef` on a landmark
("node/123") is the PROVENANCE of its anchor, not an identity: faro, balneario
and kios_faro share one. The join is a point-in-polygon plus
`FieldService.SITE_TWIN_TYPES`; by id it could never fire, because landmarks
resolve against named nodes and sites are closed ways. `is_twin` also accepts
`osmRef == "way/<site id>"`, which is the one test that reaches the Mercado:
`seat_on_block` moves a landmark onto the nearest cuadra ground, so a market
hall mapped over an esplanade ends up outside its own outline and containment
alone says no.

**A SITE WHOSE OUTLINE *IS* A MANZANA GETS THE WHOLE CUADRA** (`"cuadra": True`
in `SITE_DECOR`, `FieldService._manzana_ground`; implies `trace`). The Mercado
Municipal's mapped way runs calle to calle — Calle 0B to Calle 2A, Avenida 5 to
Avenida 3 Filiberto Sinfontes, its own `addr:street`. Clipping such an outline
to "ground that is not street" asks the wrong question and fails SILENTLY: the
carriageways eat the block centreline to centreline, so ~1 300 cells of market
hall come back as the 266-cell acera fringe they did not reach, and the manzana
seat then does the right thing with the wrong shape — a 110 px strip does not
fit its own block's 59 px interior, so the Mercado was seated 250 px away in the
neighbour's. Two things this recipe gets right that cost a build each:
- **The block list cannot answer it, and that is not a detection bug.**
  `detect_blocks` paves a cuadra holding no 6x6 square of buildable cells as an
  acera SLIVER, which a short wide manzana is — so NO detected block covers the
  Mercado. Ask the ROAD LIST, the move `"reclaim": True` already makes.
- **The test is the CENTRELINES, never the surface.** The asphalt splitting this
  manzana measured 70 px from the nearest centreline: it was the Mercado's own
  `stamp_pad` apron. Adding a `HARD_STREET_CLASSES` surface filter "for safety"
  re-excluded exactly those cells, split the ground 1022 -> 491 and left the
  market on a 44 px ribbon east of its own pad. The surface cannot tell a pad
  from a calle; `on_street` can, and that is why it exists.
The accepted lot is then RECLAIMED to `CLS_LAND` — sliver acera and apron
asphalt both — and only the accepted shape is stamped, so what stays acera is
the ring the market stands back from. A `cuadra` site skips the manzana seat: it
is inside its manzana by construction.

**EVERY ANCHOR IS GEO.** The last two world-px anchors in the build were the
hand-laid `carmen` and `centro` cuadra specs, and the 2.0 -> 2.5 rescale moved
the real manzanas 4 000 px away from them: all four bounding streets resolved to
`None` and the entire civic centre — Catedral, Casa de la Cultura, Biblioteca,
Parque de la Virgen, Parroquia del Carmen, Jardín, Plaza Deportes El Carmen —
stopped existing, with two WARN lines to say so. A hand-laid cuadra that
resolves to nothing now FAILS the build. Same rule for tools: `tools/smoke.mjs`
drove from a hardcoded px too, and after the rescale it "passed" on drift with a
top speed of 0.

**A kiosk must clear the sea by its ART, not its anchor.** The build tests for
water once, at the geo anchor, and never again after a reseat — which left three
stands 14 px from open water after the rescale, drawn half in the gulf.
`placement.nudge_off_water` + `KIOSK_WATER_CLEAR_PX` run after the frontage seat
and before the apron (and keep the kiosk on its OWN surface class), and
`finish.verify` fails the build on any kiosk with water inside that radius.
`kios_faro` is exempt: it stands on the Muelle del Faro's deck on purpose.

**Water cuadra (Balneario)** — `layout: "water-inlet"` in `blocks.json`, so a
SECOND one is a row rather than an edit here. The named landmark's whole block becomes a
SEA inlet — `occ.update(cells)` (no OSM buildings), stamp the interior
`CLS_WATER`, and push its `_green_poly` outline into `waters` so it renders with
the ocean effect (no pool graphic; `case "pool"` is label-only). Emit a
`manifest.balneario` bbox (→ `W.BALNEARIO`) that `maintainBalneario` fills with
swimmers + a penned leisure boat (`b.balneario`, contained in the boats loop).

**Parque Marino is a parcel PARTITION, not a bbox paint** — `layout:
"footprint-lots"`, whose anchor building, lot prefixes and residual are
parameters in `blocks.json` while the RULE stays code. OSM theme-park way
`316422305` decides which eight footprints belong to the aquarium; the resolved
cuadra decides which neighbouring structures also need ground. Existing OSM
sites win first (especially Escuela de Biología Marina–UNA and Iglesia
Cristiana), then every remaining building gets a non-overlapping 8 px lot
(including the ordinary named Plaza Centenario and Max Outlet lots), the
`building=train_station` footprint owns the large eastern remainder, and only
the western residual becomes Parque Marino. Every shared-cuadra building carries
`marineBlock:1`; `finish.verify` requires its OSM ID to have exactly one
`marino_lote_*`/`marino_cuadra_*` parcel, so another structure cannot silently
disappear under the lawn.

The eight aquarium footprints retain stable OSM IDs and receive the externally
verified facility labels in `MARINE_BUILDING_NAMES`; the local OSM ways do not
carry those individual names, so never infer a new footprint/name assignment
from list order or reintroduce “Parque Marino N”. The park residual can have
detached pieces and holes around lots: emit every loop with `outline_polys` in
`polys` (keep largest `poly` for old clients), and fill it with Canvas
`"evenodd"`. Painting only the largest loop loses real ownership; painting its
outer ring solid covers the building parcels. Marine greens must not use the
normal dilation stroke for the same reason.

Tank placement is also a world invariant: all five rendered disks must be
wholly inside those residual cells, at least
`MARINE_POOL_GROUND_CLEAR_PX` from every OSM structure/acera, completely west
of the station footprint, and at least `MARINE_POOL_RAIL_CLEAR_PX` from every
Ferrocarril segment. `MARINE_POOL_SCALE` includes the raster-cell quantisation
margin, and tanks also keep `MARINE_POOL_MIN_SPACING_PX` between centres.
`finish.verify` mirrors the renderer's multi-ring even-odd membership and
rechecks all rules after the full build.

**Cuadra corners stay SQUARE; diagonal runs stay direct.** The raster cells
contain the complete mapped space and remain authoritative. `outline_polys`
may simplify only within one raster cell, joining the endpoints of a 4 px stair
run into the diagonal it represents; it falls back to the exact trace if a tiny
ring would collapse. Do not cut vertices with a render-only rounded path, and
do not overlay derived asphalt fillets at junctions: only some street
classes/junction shapes can be derived, so that approach produced a mix of
round and square corners and painted roadway over solid collision cells.
`paintParcels` and `paintStadiumCuadras` use `flatPath(..., true)` with the
emitted vector. Road endpoint discs still weld adjoining centreline pieces;
they are inscribed in the junction and do not remove cuadra ground. The caño
remains renderer-only: a darker band stroked after the casing and before the
asphalt, with butt caps so it stops square at the intersection mouth.

**Collision-vs-visual alignment gotchas** (piers, medians): `raster_stamp_polyline`
adds a round cap of radius `w/2` PAST the last point — shorten the polyline at a
free end to keep drivable cells flush with the drawn deck. The player wall-probe
samples at 0.8 of the half-extents (~20% overhang forgiveness); raise it toward
1.0 on a specific surface (e.g. bridge deck) to stop edge overhang. A stamped
wall must be **≥ the drawn feature's width** (incl. its round cap) or the car
slips into the drawn-but-unstamped rim and the both-ends-blocked snap-back traps
it — medians stamp `PASEO_MEDIAN_W + 6` while rendering at `PASEO_MEDIAN_W`.
Decorative tree lines need a surface-class guard (skip `CLS_ROAD/PASEO/BRIDGE`)
so they sit beside the lane, not on it.

**EL CIELO ES UN CONTINUO, NO CUATRO ESTADOS** (`src/game/daynight.js`). The
day used to change BETWEEN FRAMES: `apply()` only acted on crossing a phase
boundary, so dusk arrived in one step. `state.weather` is still the four discrete
names — everything reads it, the smokes force it, the tests assert it — but it is
now DERIVED from a continuous sky, and the continuum is what everything visual
asks for:

* `skyBlend()` → the two phases and how far between. `weatherColors()` mixes
  them, so the palette moves. **The blend lives in the last third of a phase**,
  not across all of it: blended end to end, midday is never midday — it is
  always half-dusk, and the day loses its hours. The mix is cached by
  `(from, to, k)` rounded to 1/64 because five modules call it per frame.
* `sunVector()` → **shadows follow the sun.** `plantShadow` had a fixed
  `+0.5R, +0.42R`, i.e. one invented light direction for the whole world at
  every hour, which at midday reads as every tree being off-square with its own
  shadow. What sells it is not the angle but the LENGTH (short and tucked under
  the crown at noon, stretched at dusk) and the OPACITY (a noon shadow is hard,
  a dusk one long and washed out).
* `moonPhase()` / `moonlight()` / `tideRange()` → **the moon moves the tide and
  the night.** Full or new = spring (sun and moon pull ALIGNED — note it is
  alignment, not how much moon you see); quarter = neap. It multiplies the
  existing cosine's AMPLITUDE rather than adding a term, so half tide is still
  half tide and only the swing changes — which alters the SHAPE of la Travesía's
  course rather than its numbers. It also lifts the night tint, so a spring-tide
  night is also a bright one: true, and a hint.
* `stormLevel()` / `lightning()` / `wetGrip()` → **a storm arrives in three
  acts**, at any hour. It was a switch: `state.weather = "storm"` and it was
  already raining. Now the sky closes first, then it thunders, and only then does
  the water come — and `wetGrip()` is the puddle, not the cloud, so the road
  stays treacherous after it clears. The old wet grip was
  `state.weather === "storm" ? 0.92 : 1`: a switch on a NAME, at a value nobody
  could feel, that ended the frame the rain did.
* `lightsOn()` → **one owner** for "are the lamps lit". Night, or a closed sky at
  midday. Two callers ask (the one drawing the lamp and the one opening its
  pool), and written twice a different threshold in each gives lit lamps with no
  light around them — which is the bug the night had the first time.

**LA SOMBRA SIGUE AL SOL, Y SU LARGO ES LA ALTURA** (`c2d/shadows.js`). There
were **19 fixed offsets** in four files — every pedestrian, the boats, the buoy,
the banco, the pier hut, the ferry, a landmark's plate, and every building in the
world at `ctx.translate(4, 4)` — none of which knew what time it was. The trees
had followed the sun since the sky became continuous, which left the scene split:
trees on the right hour, everything else on an invented one.

Three things this had to get right, and two of them cost a mistake:

* **THE LENGTH IS WHAT SELLS THE DEPTH, not the angle.** A pedestrian and a
  warehouse throwing the same shadow is what flattens a scene, so `sunShadow`
  takes a HEIGHT IN METRES. Measured: a five-storey block throws 9.4× a person's.
* **`+1, +5` WAS NEVER A SUN DIRECTION — IT IS THE FEET.** A figure is drawn from
  its centre, so that offset anchors the ellipse at its feet. Replacing it with a
  solar one would have slid every pedestrian's shadow off their feet. A figure's
  shadow is the foot anchor PLUS the sun's offset, and only the second moves.
* **NOTHING IN THE EMITTED WORLD KNOWS ITS HEIGHT.** A building carries `pts`,
  `color`, `roof`, `wnd`. Measured on the shipped world, **10 of 45 218 carry an
  OSM `building` tag and 9 of those say `yes`** — the tag is not there to use. So
  height is inferred from FOOTPRINT AREA (a port house is ~90 m², the market
  11 000) with `wnd` separating a storeyed building from a windowless shed, as a
  band table in the registry. A tag-based height needs the extractor to keep the
  tag, i.e. a rebuild.

**UNA ESCENA TAMBIÉN TIENE ALTURA** (`heightM` / `castsShadow` en
`world-props.json`). Las escenas eran la mitad que faltaba: la catedral llevaba
literalmente una primera parte *«la sombra: el mismo cuerpo corrido +3,+5»* —un
`roundRect` que sólo cubría la NAVE, ignoraba crucero, ábside, cimborrio, torres
y cruz, y no sabía qué hora era—. Ahora cada masa declara METROS y `paintParts`
hace una PRIMERA PASADA sobre las mismas partes. Tres cosas son load-bearing:

* **el sol entra POR EL FRAME** (`frame.shadow`, `frame.shadowInk`), porque
  `shapes.js` no puede importar `shadows.js` —arrastraría `daynight.js` y con él
  el juego— y `tests/test_shape_interpreter.py` fija esa lista. El juego pasa el
  sol real; el editor, uno fijo. **Sin las dos cosas no hay pasada**, y sin ellas
  el cuadro sale idéntico al de antes: eso es lo que hace la migración
  demostrable pixel a pixel. Un color por defecto aquí sería una tinta autorada
  dentro del intérprete, que es exactamente lo que la prueba prohíbe;
* **el offset va en los EVALUADORES `X`/`Y`, no en un `translate`** — la misma
  razón medida que documenta el verbo `group` (207 px): Canvas no rasteriza
  igual un camino absoluto que el mismo camino bajo un `translate` fraccionario.
  Y como todo ancho se calcula `X(w) - X(0)`, un offset constante se cancela;
* **una parte que proyecta se toma ENTERA, subárbol incluido**, y las alturas se
  heredan hacia adentro. Por eso un `group` tira UNA silueta y no una por hijo,
  que es la diferencia entre una catedral con sombra y una catedral con un
  montón de sombras. El detalle —cornisas, puertas, columnas— lleva
  `castsShadow: false` heredado para no tirar una segunda sombra sobre la que ya
  tira lo que lo sostiene.

La única `$shadow` pintada a mano que queda es la de `greenSpace`, y no es una
excepción sino la distinción: es el canto de la LOSA de césped contra el suelo,
no la sombra de un cuerpo. Un parque no se levanta sobre su propia parcela.

`pnpm smoke:sceneshadows` lo mide con el pintor de verdad —y resuelve la URL
VIVA de `daynight.js` desde `shadows.js`, igual que `shot-parcels` resuelve la de
`gfx.js`: con HMR encima, importar la ruta lisa acuña una segunda instancia y el
reloj que se mueve no es el que el pintor lee.

`pnpm smoke:shadows` measures what a screenshot cannot: that the offset SWEEPS
with the hour in small steps (7.03 px across the day, worst step 0.38), that a
block's shadow is many times a person's, and that inferred height rises with
footprint.

`pnpm smoke:sky` walks the clock and measures what a screenshot cannot: that the
ground colour moves in SMALL steps. It samples 480 times because the biggest
transition (dusk→night, 159 units of colour) takes 37 s of a 600 s day — at 48
samples only 2.9 landed in that window and each step measured 54, which looked
like a jump and was the sampling. A ramp steps ~5.5; a switch steps 159. It also
walks a lunar MONTH separately, because one day is an eighth of one and leaves
the moon nearly still.

**LA NOCHE ES UNA CAPA QUE LAS LÁMPARAS PERFORAN** (`c2d/nightlights.js`). The
city was too dark and the cause was structural, not a brightness value: night is
`C.tint`, a flat wash over the WHOLE FRAME, so a lamp drawn in the world pass
sat under the same wash that was darkening it. Now the darkness is filled into
its own half-resolution canvas, each lamp `destination-out`s a soft disc out of
it, the layer goes over the frame, and a warm `lighter` pass adds the lamp's own
colour. Three things make thousands of lamps affordable and none is optional:
**half resolution** (a light pool is soft, so it costs a quarter and nobody
sees), **a pre-rendered sprite blitted** per lamp rather than a
`createRadialGradient` per lamp per frame, and **per-tile streaming** —
`street lamps go in the tiles like trees, never global like signs`, because
there are thousands and a global list would load them all to draw twelve. A
lamp record is `{x, y, ang, type}` and nothing more: what a lamp IS lives in
`lights.json`. **And the GROUND decides where one stands, not the geometry**: the
first version walked each polyline independently and offset to the side, which at
a junction puts the post IN THE MIDDLE OF THE INTERSECTION — two streets' ends
coincide there and each offers its own kerb. Working out "am I near a junction?"
from the road list is exactly the derivation the raster already answers, so
`place_streetlights` asks what is under the post and drops it unless it is acera
or land. 198 of 781 were in the roadway. With no lamps in view the painter paints the same tint as before,
which is what keeps the change honest. `pnpm smoke:night` measures the cost by
interleaving day and night medians — a single before/after comparison measures
warm-up, which is how it first reported 50 ms.

**LA MANZANA ES UN ANILLO DE CASONAS CON UN PATIO ADENTRO** — y sólo en el
puerto viejo. Toda cuadra bajo `SMALL_BLOCK_CUADS` (188 cuadrículas = 1,2 ha) se
llenaba ENTERA, y una manzana normal de 80x80 m son ~100: la excepción era la
regla. Medido sobre 95 cuadras del centro: 25 huellas sueltas de mediana y 54,3 %
de suelo cubierto. Hoy se construye contra la calle (`CASONA_RING_CUADS`) y el
resto es el patio. **Que eso sea una CASONA depende de tres cosas**:
del faro a El Cocal y no más al este (límite GEO — la longitud de La Angostura;
Esparza, Barranca y El Roble son pueblo moderno de edificios sueltos); **sólo
donde OSM dejó la manzana vacía**, porque donde el mapeador puso edificios ésos
mandan; y en tres repartos —`full`, `half`, `corner`— con paleta de pasteles de
puerto, deterministas por posición. Una casona se emite POR CORRIDA (`BLDG_INSET`
separa vecinos «so adjacent roofs don't fuse», y fusionarse es lo que una casona
hace), partida cada 4 cuadrículas.

**El patio** es `ParcelUse.PATIO`, emitido DESPUÉS de las casonas y de los
edificios reales porque es literalmente el resto — `occ` ya conoce parcelas,
huellas y aprons. **No se estampa**: el anillo es continuo, así que no entra a la
red manejable. La FUENTE es autorada por punto geo en `blocks.json` (976 fuentes
idénticas serían el error de la multitud con `fan` escrito cuatro veces), y el
build IMPRIME los patios más grandes con su lat/lon, porque si no la única forma
de encontrar uno es adivinar una coordenada y correr 33 minutos.

**`evalOn` DEVUELVE UN NÚMERO SUELTO TAL CUAL** — es un ABSOLUTO en píxeles. Sólo
la forma `[k, px]` lo lee como fracción del marco. Escrito `cx: -0.66` los cuatro
árboles del patio salieron como discos de medio píxel en el centro de la parcela:
sin error, sin warning, simplemente no había patio.

**EL TURNO CIERRA UNA CALLE, no se estampa sobre el paseo.** El campo ferial se
cortaba del malecón y la arena y se estampaba `Surface.BARRO`, lo que pintaba el
frente del mar de café y se comía la playa. Hoy se asienta en la CALZADA SUR del
Paseo —`_south_carriageway` la encuentra andando hacia el mar hasta que aparece
malecón, arena o agua, y devuelve la última corrida de calzada— y **no estampa
nada**. La calzada norte queda abierta. Los juegos DESBORDAN sobre la mediana y
el labio del malecón a propósito; el suelo no. Y ojo: `_seaward` cuenta cuál de
las dos normales de la calle tiene más SEA_CLASSES debajo para saber dónde está
el mar — apuntar esa constante a la calzada hace que «el mar» sea el lado con más
asfalto, tierra adentro. Son dos preguntas distintas.

**EL RELOJ DEL RENDERER CUENTA EN SEGUNDOS.** `render(t)` recibía el
timestamp de rAF en MILISEGUNDOS —`dt` se dividía entre 1000 para el sim y el
render se quedaba con el crudo— así que cada dibujante decidía por su cuenta qué
unidad creía tener: `water.js` convertía local (`t * 0.001`), el HUD venía
afinado en ms (`t * 0.006`) y muchísimo código en segundos (`t * 0.7`, o el
`spin` de la feria, documentado en VUELTAS POR SEGUNDO). Esos últimos corrían mil
veces rápido: **la rueda de Chicago daba 1200 rpm** y el resto hacía alias, que
se lee como textura y no como error — por eso nadie lo vio en años. Hoy el lazo
pasa `t / 1000` y **la unidad se declara**: lo que necesita milisegundos los pide
por su nombre (`timeMs`, que es el contrato que usan los registros de actores) y
`setLastT` guarda ms a propósito. Al tocar una animación, mirar primero en qué
reloj está.

**LA MANZANA RECUPERA SU SUELO — CON UNA SEMEJANZA, NO CON UN CAMPO.** Las
calles se estampan exageradas porque los VEHÍCULOS están dibujados sobre su
tamaño real (un tuktuk mide 26x17 px y dos no se cruzan por debajo de ~34 px), y
lo que sobra salía de las cuadras. La forma de devolvérselo que FUNCIONA es
subir `PLANAR_PX_PER_M` y bajar `ARCADE_STREET_MUL` en la misma proporción: la
calle conserva su ancho EN PÍXELES —o sea el tráfico, la colisión y el piso de
«dos carros se cruzan» no se enteran— y encoge en METROS, que es el suelo que la
manzana recupera. Hoy 3.125 / 1.856: la residencial pasó de 16.4 m a 13.1 y la
cuadra del Mercado de 36.8 m de suelo a 40.1. Es una SEMEJANZA, así que ninguna
recta se dobla y ningún ángulo cambia. Ver `PLANAR_PX_PER_M` en `config.py` y
`docs/RESCALE.md`.

**UNA PRUEBA SOBRE UN LUGAR TIENE QUE AFIRMAR EL LUGAR — Y ESTO YA ESTABA
ESCRITO AQUÍ.** El reescalado dejó tres smokes en rojo y NINGUNO era una
regresión del juego:

* `smoke.mjs` probaba «las cuatro direcciones» sin volver al punto de partida
  entre una y otra, así que en realidad probaba un recorrido de cuatro tramos.
  Con el spawn en la calle auxiliar que baja al kiosco del Paseo —40 px entre
  dos paredes de malecón— los tres primeros rumbos aparcaban el carro contra la
  pared y el cuarto, que era el bueno, salía de una esquina. Desde el spawn el
  norte recorre **154 px a 266 px/s**; encadenado daba 82. El juego estaba bien
  y la prueba se estorbaba a sí misma.
* `smoke_boat.mjs` volvió a caer en su propio bug documentado: su coordenada «de
  la ciudad» era asfalto a 2.5 px/m y a 3.125 es MAR ABIERTO, así que la pata de
  «la tierra es pared» comparaba mar contra mar. **Dos veces el mismo fallo con
  el mismo arreglo a medias** (mover el píxel) dice que el arreglo era el
  equivocado: hoy los dos sitios se anclan en GEO y además se AFIRMAN, que es lo
  que este archivo llevaba años pidiendo. Hoy da 550 px/s en el agua y **8 px/s
  en tierra**.
* `smoke_crossing.mjs` sí destapó dos bugs de verdad, y los dos del jugador, no
  del mundo — ver `START_OUT_M` y el atracadero en `modes.js`.

La regla, otra vez y ahora con tres cicatrices: **un smoke que afirma algo sobre
un LUGAR tiene que afirmar también el lugar**, y un punto del mundo se ancla en
lat/lon, nunca en píxeles. `smoke.mjs` comprueba hoy la clase de superficie de
su spawn y `smoke_boat` la de sus dos anclas, de modo que un mundo que se mueve
debajo se reporta como lo que es y no como una regresión del casco.

**LO QUE UN REGISTRO AUTORA EN LARGO, LO AUTORA EN METROS — Y CINCO NO LO
HACÍAN.** El reescalado destapó que `content/world/` llevaba desplazamientos y
tamaños EN PÍXELES afinados a 2.5: los `dx`/`dy` de tres kioscos y tres hitos, el
campo ferial (560x200 px), el `at` y el `r` de cada juego de la feria, el ancho
de cada bajada, los focos de la plaza de Playitas y la cubierta de la lancha.
**Ninguno hacía fallar nada**: se quedaban un 20 % cortos EN METROS, con el faro
corrido 44 m donde el autor pidió 55 y el turno un quinto más chico.

La que sí falló fue la cubierta de la lancha, porque `tests/test_world_units.py`
compara la de cada barco contra `world-units.json` — y `[86, 34]` coincidía con
el registro SÓLO a 2.5 px/m. Esa prueba se llama «cada barco es un barco y no
cuatro copias de ella» y ya había cazado cuatro; ésta era la quinta, y tirando
de ella salieron las otras cinco familias. **Una prueba que caza una copia vale
por las que no se han buscado.**

La conversión se hace EN LA CARGA (`content.py` → `METRE_KEYS`), no en cada
lector: los lectores ya piden `dx`, `w`, `at`, y lo que cambia es de dónde sale
el número. Las 52 medidas convertidas reproducen su píxel original EXACTO a
2.5 px/m, que es lo que hace la migración demostrable sin reconstruir.

**Y hay una excepción que casi se pierde**: el `at` del DJ es una LAT/LON, no un
offset — se sienta en la frontera del edificio real que toca, mientras el de un
juego es un desplazamiento desde el centro del campo. La conversión automática
lo tomó por offset y lo dejó en (4, -34), o sea en el golfo. `at` es una llave
SOBRECARGADA y por eso los juegos autoran `atM` y el DJ conserva `at`.

**Y UNA COMPUERTA PUEDE ESTAR HACIENDO DOS PREGUNTAS CON UN SOLO NÚMERO.** Al
apagar el campo, el build falló en su último segundo: «rail 15: 12 pair samples
not between their named carriageways». No lo causó el reescalado — **falla
igual a 2.5 px/m, con 14 en vez de 12**, y el campo lo tapaba moviendo esas
muestras lo justo. La medición se hizo corriendo `align_rails` SOLO, sin el
resto del pipeline: 40 segundos en vez de 30 minutos, y es el patrón a copiar
cuando una compuerta falla al final de una corrida larga.

Lo que decía el mensaje era falso sobre esas doce muestras: `along` valía la
MITAD EXACTA de la separación en las doce, o sea que el riel iba perfectamente
centrado. Lo que fallaba era `across`, que mide una cosa distinta — cuánto se
corrió a lo largo del corredor el pie que la búsqueda encontró en cada calzada
respecto de la muestra. Con las avenidas paralelas es casi cero; donde ABREN, la
cuerda que une los dos pies deja de ser perpendicular al riel y `across` crece
por geometría. En el punto donde salta (x ≈ 16 330 m, la Avenida Alberto Echandi
abriéndose de 45,8 a 53,7 m en 25 m de riel) llega a **4,52 m** contra una
tolerancia de 3.

Así que las dos preguntas se separaron: `pairMidpointToleranceM` **sigue en 3 m**
y decide si el riel va ENTRE las calzadas, y `pairChordToleranceM` (6 m) decide
si los pies quedaron a su altura, con su propio mensaje. Aflojar la cuerda no
afloja la contención, y hay una prueba que lo dice poniendo la cuerda en 1000 m.

**EL CAMPO DE DILATACIÓN (`service/dilation.py`) ESTÁ APAGADO, Y HAY QUE SABER
POR QUÉ ANTES DE VOLVER A ENCENDERLO.** Separaba las manzanas RÍGIDAS y estiraba
lo que quedaba entre ellas — que es la calle. El solucionador hace exactamente
lo que promete (sus 14 pruebas siguen pasando); el problema es geométrico y no
tiene arreglo dentro de ese enfoque: separar cuerpos rígidos es una deformación
NO UNIFORME, y una deformación no uniforme dobla las rectas. Medido sobre el
mundo que emitió (`0eb0eceb`):

* desplazamiento máximo **392 px**, **5 509 celdas del pueblo giradas más de 3°**
  (máximo 46°), divergencia de área hasta 1.15;
* la Calle 35 de atrás del Balneario, recta, con **0.0 -> 55.8 px** de comba
  sobre un tramo de 417; la Calle 39, 116 px;
* el marco de la manzana del **Mercado girado de -9.2° a -28.7°**, y las parcelas
  del centro a más de 20° de la retícula de 2 a 12;
* **370 px de cizalla** a lo largo del Paseo, que es recto: el faro se desplaza
  (-47,-17) y el medio del Paseo (-197,+12), así que el Paseo dejó de encontrarse
  con la calle del faro.

Y lo que compraba: el suelo pisado por huellas con nombre baja 0.87 % -> 0.59 %,
y quince `ghost` de 62. **Sobre las 39 479 huellas del mundo, el 99.8 % del suelo
edificado ya caía dentro de su manzana SIN el campo.** Medido en la ventana del
centro, la semejanza le gana además de frente: **31 `ghost` sin campo a 2.5,
26 con campo, 21 con la semejanza a 3.125** — más edificios encajados Y las
calles rectas.

`docs/RESCALE.md` ya lo había escrito antes de que el campo existiera: «una
proyección NO UNIFORME lo esquiva matemáticamente — eso fue el corridor-unroll,
borrado el 2026-07-25. Costó las distancias verdaderas, las calles rectas y cada
gore de cruce hecho a mano. NO LA REVIVAS.» Se revivió y costó exactamente eso.
El módulo y sus pruebas se conservan; `DILATION=1` lo enciende, para poder
volver a MEDIRLO sin tocar código.

Con el campo apagado la proyección vuelve a ser una AFÍN EXACTA: `meta.geo` la
describe entera, `meta.warp` no se emite y `W.geoToWorld` cae al camino lineal
—que sigue siendo el único dueño de la pregunta, porque el canal de warp sigue
implementado en el cliente para un manifest que lo traiga.

**UNA CANCHA A LA QUE NO SE ENTRA NO ES UNA CANCHA.** El malecón es PARED para
un carro (`isWall`, decisión explícita: «un paseo marítimo es para caminar»), así
que un campo abierto estampado transitable en medio de él es una ISLA. Le pasó a
la Cancha Multiusos al crecer a su tamaño real. Dos cosas: `_open_a_mouth` le
abre una boca hasta la calle más cercana —la misma «calle auxiliar» de los
kioscos de la arena— **antes de estampar la parcela**, porque al revés la
búsqueda encuentra la cancha misma a una celda y enlaza la parcela consigo
misma; y `finish.verify` pregunta si desde el campo se puede SALIR de su propia
huella. **No preguntes «¿llega el spawn?»**: eso marca 61 canchas de Esparza,
Barranca y Caldera que están bien — a esos distritos se llega en lancha.

**LO QUE UNA ETAPA PIDE, TIENE QUE OCURRIR.** `s5` se llama «Tormenta en El
Cocal», hacía `state.weather = "storm"` y nadie arrancaba el ciclo: `cycle.storm`
en 0, o sea la PALETA de tormenta y ni una gota — sin lluvia, sin relámpagos, sin
agarre mojado. `applyWeather` es ahora el único sitio que pone el clima y, si es
tormenta, la ARRANCA; una etapa autorada además la SOSTIENE, porque que escampe
a los noventa segundos convierte su nombre en mentira a media partida. Es el
mismo patrón que ya mordió con las ordas de gaviotas.

**LAS DIECISÉIS PANTALLAS SE ARMAN DESDE `src/ui/screens.json`** (migración
cerrada el 2026-08-28). El contrato no cambió: **el JSON selecciona y ordena, el
motor implementa**. Un slot es un componente de React con nombre — no hay
posiciones, ni estilos, ni anidamiento, ni expresiones —, cada pantalla conserva
su esqueleto y monta `<Slots region>` donde va una lista de bloques, y `when` es
una LLAVE del contexto que la pantalla construye, nunca un predicado que
`Slots.jsx` interprete.

Dos formas de decidir qué NO es un slot, y las dos se usaron:

* **el MARCO no es contenido.** El agua del arranque, la fila de herramientas de
  la portada, las flechas de la carrusela, las pestañas de la tienda y el paso
  de diapositiva del intro están en todos los renders de su pantalla y no hay
  ninguna decisión por pantalla en ellos. Un registro que los listara estaría
  describiendo el marco como si fuera contenido;
* **un encabezado de grupo es esqueleto, y por eso los tres grupos de Ajustes
  son REGIONES** (`app`, `gameplay`, `account`) y no bloques. Un `<h2>` suelto en
  la lista habría que mantenerlo en orden con lo que encabeza — la clase de
  acoplamiento que el registro existe para quitar.

**Y HAY UNA PRUEBA QUE `tests/test_screens.py` NO PUEDE HACER.** Ese archivo
comprueba que los ids del registro y los componentes coinciden, que ningún
`when` está sin proveer y que no entró maquetado; lo que no puede ver es si la
pantalla sigue DIBUJANDO. Un slot que devuelve `null`, una región que nadie monta
o un `import` que falta pintan una pantalla que se ve deliberada, sin excepción y
sin advertencia. En esta misma migración **la tienda quedó ENTERA en blanco por
un `import Slots` que faltaba, y `pnpm build` y las 472 pruebas de Python pasaron
las dos**. `pnpm smoke:screens` recorre las quince pantallas alcanzables y exige
que sus bloques estén en el DOM — y **pulsa por ESTRUCTURA, nunca por texto**,
porque el idioma sale de `localStorage` y un `has-text("Siguiente")` falla al
cambiar de idioma o de una palabra de la copia, dos cosas que no tienen nada que
ver con si la pantalla dibuja. Comprueba además que un bloque condicional está
AUSENTE cuando toca (la columna de mejoras no sale en Historia, que las arma en
el brief): es la única forma de distinguir «el `when` funciona» de «el bloque no
aparece nunca».

**ADIÓS A LO CUADRADO: SE REDONDEA LA ESQUINA, NUNCA EL POLÍGONO**
(`c2d/curves.js`). El camino obvio —y el que pedía `docs/investigacion-2d-avanzado.md`—
es Chaikin, y no sirve aquí: **encoge la figura ENTERA**, aristas incluidas. Sobre
un mapa donde la parcela está pegada a la calle y la calle a la acera, eso abre
una costura por cada borde, que es exactamente el bug de «espacios vacíos» que
ese documento describe y luego intenta tapar con uniones booleanas o solapamiento
intencional. La respuesta barata es no crear el hueco: se camina media arista
hacia cada lado del vértice y se pasa el vértice como control de una cuadrática,
así que **las aristas no se mueven** y una parcela redondeada sigue tocando su
calle en todo el frente. El radio se recorta a media arista o dos esquinas
seguidas se comen el segmento de en medio y el contorno se cruza consigo mismo —
que en un relleno even-odd sale como un AGUJERO, no como un error.

`roundedOutline` devuelve una LISTA DE ÓRDENES y `roundedPath` la vuelve
`Path2D`, por dos razones y ninguna estética: `Path2D` no existe fuera del
navegador, así que una geometría que sólo sabe fabricarlo no se puede medir en
node —y la propiedad a medir es justo la que decide si hay costuras—; y una
lista de órdenes es lo que un backend WebGL podría teselar. `pnpm smoke:curves`
corre sin navegador por eso.

**EL RUIDO SE SIEMBRA EN `hash01`** (`c2d/noise.js`), que ya existía. No es
ahorro: es la misma razón por la que `hash01` es un hash y no un `Math.random`.
Dos fuentes de variación darían dos estabilidades — la costa temblando mientras
los árboles se están quietos. Y **su amplitud la manda el RÁSTER**: la casa ya
decidió que *la arena dibujada ES la arena*, así que una costa ondulada 20 px
diría que hay agua donde el colisionador dice tierra. El tope es menos de una
celda (5 px), o sea por debajo de la resolución con la que el mundo decide qué
es qué.

**CADA BARRIO SE VE COMO ÉL MISMO** (`c2d/districts.js`, `materials.json →
districts`). Los doce distritos viajan en el manifest desde siempre y el renderer
los usaba para un contorno de depuración y la píldora del nombre de calle, así
que el puerto entero se pintaba con una paleta. Tres cosas deliberadas: **no
reimplementa `W.districtAt`** —que hace más de lo que uno escribiría, probando
primero los polígonos autorados y sólo después el centroide—; **cachea la
respuesta en el objeto** como `_path`, porque un edificio no se muda; y **lo que
un edificio ES gana sobre dónde está**, porque una iglesia es una iglesia en El
Cocal y en Esparza, y teñirla del barrio borraría la señal que
`building-styles.json` existe para dar. El barrio sólo tiñe lo que no tiene
categoría: la casa de al lado. Sin anulación un distrito se ve como hoy, que es
lo que hace la migración demostrable barrio por barrio.

**Y LAS HOJAS DE ARTE SE DIFERENCIAN CON UN SERVIDOR FRESCO POR CADA LADO.** La
sección de arte de más arriba ya avisa que un `:8734` de larga vida parte el
grafo de módulos para una herramienta que importa por ruta lisa; **las hojas caen
en lo mismo** y no estaba escrito, porque todas hacen
`import("/src/render/c2d/…")`. Editar `effects.json` entre dos capturas contra el
MISMO servidor dio `scenes` 15,8 %, `lights` 13,5 % y `stands` 7,2 % cambiadas —
todo mentira. Reiniciando por lado: sólo `parcels` cambia (5,07 %) y las otras
cinco salen IDÉNTICAS. **El piso de ruido de estas hojas es CERO** (una hoja
contra sí misma sale idéntica), así que cualquier píxel distinto es real y no
hace falta tolerancia — pero sólo si el servidor no lleva un ciclo de edición
encima.

**Y `smoke:perf` YA EXIGE ALGO.** Medía con cuidado y no afirmaba nada más que
el interruptor del minimapa; hoy topa el render en 4,0 ms y el sim en 2,0, con
el desglose por fase en el mensaje de fallo. El número sale de lo medido —el
cuadro entero son 16,7 ms y el render costaba 1,14— y es holgado a propósito:
lo que hay que cazar no es un milisegundo sino un orden de magnitud, la capa que
se dibuja por entidad en vez de por vista.

**RECORRER SON DOS PUNTARENAS, Y EL REALM DECIDE EL MEDIO.** `ciudad` es la
península en carro; `estero` es el estuario en lancha. No es un quinto
`GameMode` a propósito —el reloj (ninguno), el marcador, el ciclo del día y la
analítica son idénticos, y partirlo habría bifurcado cada una de esas ramas para
decir dos veces lo mismo— sino un `ExploreRealm` que se escoge en una pantalla
propia **ANTES del selector de vehículos**, porque un selector tiene que abrir ya
sabiendo si ofrece carros o cascos.

Y eso era exactamente el bug que se arrastraba. **`pendingStage` no se limpiaba
nunca**: lo ponía `pickStage` y nadie lo quitaba, así que en cuanto se hubiera
escogido la Travesía una vez en la sesión, `briefStage.kind` seguía siendo
`CROSSING` para siempre y **cualquier Arcade o Recorrer posterior abría el
selector en LANCHAS** — para una corrida que se maneja. Se cierra por los dos
lados: `pickMode` limpia la etapa de un modo que no es Historia, y el medio se
deriva POR MODO (`runMedium`), de manera que una etapa que no es de esta corrida
ya no puede llegar a la respuesta. `tests/test_screens.py` fija las dos cosas.

El estero abierto NO es la regata: `startCrossing(…, { level: false })` apaga
portones, contramano, hundirse a las tres y marcador, y deja lo que sí es el
lugar — las boyas como marcas, las pangas, los cardúmenes, las gaviotas y los
remolinos. **Llegar a Pitahaya no lo termina**: cerrar la sesión al tocar el
fondo dejaba al jugador flotando en un estero apagado y sin manera de
devolverse. Se anuncia una vez (`_crossing.arrived`) y la vida sigue. Tampoco
reparte: los clientes están todos en tierra —medido: **cero** al norte de la
mitad de la ruta— así que darle un destino a quien va en lancha es apuntarlo a
una casa a la que su casco no llega.

**EL NORTE DEL MAPA NO ESTÁ CONECTADO POR TIERRA, Y ESTÁ MEDIDO.** Sobre el
mundo emitido, la red manejable tiene **69 componentes**. La península es la #4
(4 228 466 celdas); **Pitahaya y toda la tierra firme de esa orilla son la #3
(162 945 celdas)**, y en 600 px a la redonda se acercan en **UN SOLO PUNTO**: un
corte de 95 px al final de la Calle del Arreo, entre dos vías `unclassified` sin
nombre que terminan en (58000, 8351) y (57951, 8433) —o sea 10.00803,-84.75133 a
10.00779,-84.75148— con ~45 px de `CLS_LAND` macizo y la acera de cada una en
medio. Es una laguna del mapeo aguas arriba, no un fallo del builder. Media isla
que se ve y no se llega.

**LA PUERTA DEL MUELLE ES UNA PUERTA, NO UN BARCO** (`crossTheEstero`). Mientras
ese corte siga ahí, cruzar es la única forma de llegar. No se navega, no se
aborda y no se cambia de vehículo: se entra al muelle, se pregunta, y una
cortina de agua deja al jugador del otro lado con su mismo carro. Sólo Recorrer
y Arcade —en Historia una puerta que salta media península convierte cualquier
objetivo en un atajo— y sólo en tierra, porque quien anda en lancha ya puede
navegar hasta la otra orilla. La ruta de la lancha se usa **sólo por su
geometría**: sus dos extremos son los dos muelles, ya resueltos por el build
contra la costa de verdad. Tres cosas que costaron:

* **la oferta es un FLANCO, no un estado.** Se sale PARADO ENCIMA del muelle de
  destino, así que una prueba de «¿estoy en un muelle?» vuelve a preguntar en el
  cuadro siguiente, para siempre. Se compara contra el muelle del cuadro
  anterior, y eso da gratis la regla de «hay que salirse y volver a entrar» y el
  «ahorita no» sin bandera propia;
* **se desembarca en SUELO MANEJABLE, no en el punto de la ruta.** El extremo de
  la ruta es la ORILLA —la última celda de agua antes de la tierra, que es donde
  un casco se arrima— y dejar ahí un carro lo deja medio dentro de una pared;
* **y hay que ESPERAR AL OTRO LADO, con la cámara ya encima.** Ésta es la que
  muerde. `W.ready()` devuelve una PROMESA y `surfaceAt` contesta **AGUA** para
  todo tile que no ha llegado, así que buscar el desembarcadero sin esperar es
  preguntarle a un mapa en blanco: `reachablePointNear` devolvía el propio punto
  de la ruta y el carro salía del agua dentro del agua. Pero esperar tampoco
  basta — **`W.update(cam)` EVICTA todo tile a más de cinco de la cámara y el
  lazo de dibujo lo llama cada cuadro**, así que con la cámara todavía en
  Puntarenas los tiles recién traídos se los llevaba el cuadro siguiente, entre
  el `await` y la lectura. Es una carrera contra el lazo: fallaba una de cada
  dos, y se lee como «el sitio está mal» y no como «la cámara se movió». Se
  mueve la CÁMARA primero, se espera, y entonces se busca. `null` es una
  respuesta —mejor no cruzar que aparecer flotando en tierra firme— y quien
  llama lo dice. `pnpm smoke:passage` mide las tres, y **afirma el lugar además
  del hecho**: los muelles se preguntan a la ruta que el mundo emite, nunca a un
  píxel escrito a mano. Su propia comprobación previa cayó en la misma carrera
  hasta que se hizo EN PAUSA, porque la cámara tiene dos dueños que la escriben
  cada cuadro (`attractTick` en el menú, el seguimiento en `update`).

**EL HUD TAMBIÉN VIVE EN LA CÁMARA.** `state.cam.rot` lo leían sólo `canvas2d.js`
y `input.js`, así que en El Cocal —la única etapa rotada— el minimapa apuntaba al
norte del MUNDO y la flecha señalaba noventa grados fuera del cliente. Giran el
dial, el rumbo de la brújula, el blip del destino y la flecha del carro; `camRot()`
es el único dueño.

**LOS JUEGOS ESTORBAN SIN ESTAMPARSE.** Cada atracción es un disco en
`physics.js` que REBOTA (un edificio absorbe 0.95 de la componente normal; un
juego devuelve), con `bump`, sacudón y penalidad de derretimiento. Nada de esto
toca el raster, así que la compuerta de red manejable ni ve una atracción y un
carrusel NO PUEDE sacar un destino de la red — por construcción, no por medición.
La tuning vive en `actors.json -> attraction`, del lado del cliente, porque
afinar un rebote no puede costar una reconstrucción. `pnpm smoke:feria`.

**UN EDIFICIO CON NOMBRE NO DESAPARECE.** Había TRES muertes y ninguna avisaba:
la extracción descartaba lo que seguía sobre calzada ANTES de asignar `name`;
`PUSH_MAX = 40 px` está medido sobre una calle de 65 y el Paseo es una avenida
DIVIDIDA de 196; y el snapper borraba lo que no encajaba detrás de un contador.
Hoy hay un segundo empujón cuya tolerancia sale del ancho de la calle de enfrente
(`StreetIndex.nearest_road_normal`), el primero queda intacto, y una huella sin
suelo se queda en su CONTORNO REAL marcada `ghost`: se dibuja y `collideBuilding`
la salta, porque si no los hoteles del Paseo tapiarían su propia calle. Medido en
el centro: de 32 pérdidas a **0**.

**UN LUGAR PUEDE VERSE COMO ÉL MISMO.** `propFor` prueba el ID del hito antes que
su TIPO — sin cambio en el builder, porque el `id` ya viajaba en el manifest — así
que el Tioga es un bloque vinotinto, Las Brisas una esquina blanca y la Capitanía
madera verde bajo zinc rojo, mientras el resto de los hoteles conserva el
genérico. Ids y tipos comparten un namespace y eso es el peligro: un hito llamado
`house` repintaría todas las casas del mundo, así que `test_world_props` falla si
un id iguala a un tipo. `shot-landmarks` los encuentra POR SUSTRACCIÓN, o un arte
con dueño entraría sin hoja y sin diff.

**LA COTA DEL TERRENO ES DEL IGN, NO DE UN DEM** (`service/elevation.py`,
`content/world/contours.json`). Medido: SRTM30m y Mapzen levantan
Carmen/Paseo/Centro/Playitas 6–8 m sobre el faro y eso son TECHOS —son modelos de
SUPERFICIE— contra los 2,49 m que dice el nodo de OSM. FABDEM es justo ese
arreglo y es CC BY-NC-SA, **no comercial**. **Hacen falta los DOS juegos del
IGN**: `curvas_1000` (2 m) hace honesto el arenal pero es cartografía urbana y no
tiene una curva a 3 km de Alto Cascabel; `curvas_5000` (50 m) es el nacional y sí.
Se estampa el grueso y el fino encima. El campo tiene resolución PROPIA
(`ELEV_CELL` 80 px, no los 4 del raster de colisión) y **su RLE es aparte**:
`(cuenta:uint8, valor:uint16 LE)`, emitido sólo donde el tile no es plano, porque
una cota en decímetros no cabe en el byte de una clase de superficie y meterlas
juntas obligaría a renumerar las clases.

## inventory.json

`pnpm inventory` writes a machine-readable index at repo root: world counts
(roads by class, buildings, landmarks by type, customers, districts, stages),
element catalogs (vehicles, surfaces, districts, stages, landmarks, customers),
and a **module map** (`src/` file → exports + line count). Read it to understand
the game's contents without reading the code. Refresh after world/module changes.

## The world editor (private, separate repo)

`world-editor/` is a separate Vite app and Git repository, ignored here. It is
becoming the authoring tool for everything the game shows: world, screens, copy,
translations, assets. Its roadmap **carries its own state** in
`world-editor/docs/ENGINE_PLAN.md` — take the first `NEXT` row and move it in the
same commit; `world-editor/CLAUDE.md` holds the rules for working there.

What it already authors from this repo's side: `src/i18n/<lang>.json` (catalogs
are data; adding a language is a JSON file plus one `LANGUAGES` entry),
`src/ui/themeTokens.json` (the design-token registry the editor builds its form
from), and `content.json`'s `ui` block (`theme` → CSS custom properties,
`strings` → overrides layered over i18n). `pnpm smoke:theme` and
`pnpm smoke:sponsor` guard those paths.

## Conventions

- **Before changing CONTENT, read "¿esto ya es data?" at the top of this file.**
  If a registry owns it, edit the registry; if it is still hardcoded, migrate it
  first and prove the migration separately.
- After changing the world or any module, run `pnpm inventory`.
- After changing anything in `churchill/world/enums/`, run `pnpm vocabulary` and
  `pnpm test` — the client's copy is generated from it and committed.
- Keep `src/game/vehicles.js` and `src/game/surfaces.js` free of DOM/`window` so
  Node (the inventory script) can import them.
- **THE WORLD'S LENGTHS ARE METRES** — `src/assets/world-units.json`, read by
  the builder (`px(m)` in `config.py`) and the game (`src/domain/units.js`).
  A px constant is only true at the scale it was tuned at, and this world has
  been rescaled three times; each time, numbers that meant something silently
  came to mean something else (the civic centre stopped existing once). It
  holds the raster cell, la cuadrícula, the tile, the acera depths, the camera,
  the channel's sounding pitch and each vessel's deck. Add a length there when
  two runtimes must agree about it; a margin inside one drawing recipe is not
  that. `tests/test_world_units.py` checks every derivation against the shipped
  manifest, so a changed metre value that does not match the built world fails.
- The camera zoom is responsive: `computeZoom` in `src/render/camera.js` frames
  `camera.viewWidthM` (160 m) across the viewport, clamped by
  `camera.minScreenPxPerM` (5.5) — the **floor is a magnification and scales
  INVERSELY with the world's scale**, and it binds on every screen under 880 CSS
  px, i.e. every phone. Framing is a RENDERER concern (no world rebuild needed);
  `meta.cuadsPerView` is advisory. It used to be `CUADS_PER_VIEW · CUAD`, which
  let the BUILDER's block-detection grid decide what the player saw.
- **A run has a clock or it does not** (`src/game/timers.js`): `timeLeft ===
  UNTIMED` (null) for Recorrer and the tutorial, and everything that spends or
  scores time goes through `addTime`/`timeRemaining`. Do not re-introduce a
  large sentinel, and do not branch on mode names to decide — that list was
  kept in three places and one of them was already wrong.
- Don't hand-edit `src/world2d/` (manifest or tiles) — regenerate with
  `pnpm world:build`, then `python3 tools/world_snapshot.py verify` (or `save`
  if the change was intended).
- **A full build is ~28 MINUTES, so smoke it first.** `PLANAR_BBOX` exists for
  this: `PLANAR_BBOX="-84.8600,9.9700,-84.8200,9.9820" pnpm world:build` runs
  the WHOLE pipeline over a centro-sized window in about a minute. It always
  ends `[poi] BUILD INCOMPLETE — unresolved: …` because the clip drops every POI
  outside the window, and it never reaches `write_world`, so **it cannot touch
  `src/world2d/`** — which is exactly what makes it safe to run against a dirty
  tree. What you are reading it for is a `Traceback`. A `NameError` in
  `decorate` is 25 minutes into a full build and one minute into a smoke.

  **Y ESE MISMO «never reaches `write_world`» ES SU PUNTO CIEGO.** Nada de lo que
  vive en `write_world` o en `pipeline/emit.py` está cubierto por el smoke: un
  `ctx.dims.W` en vez de `ctx.dims.w` costó una corrida COMPLETA para reventar en
  el último minuto, después de 33 de trabajo bueno. Si el cambio toca el emit,
  pruébalo A MANO antes de pagar la corrida — construir el campo y rebanarlo por
  tile es un script de veinte líneas. Y **no envuelvas el build en
  `cmd > log; echo $?`**: el `echo` sale 0 y tapa el fallo, así que el build
  «terminó bien» y no había mundo.

  **Y LA CORRIDA COMPLETA DURA MÁS QUE CUALQUIER LLAMADA DE HERRAMIENTA: HAY QUE
  LANZARLA DESPRENDIDA.** Bash topa a 600 000 ms (10 min) y `run_in_background`
  no levanta ese tope — sólo evita que uno se quede esperando. El 2026-08-23 una
  corrida murió en la línea 953 de su log, a mitad de pipeline, exactamente a los
  diez minutos. Va en su propia sesión para que nada aguas arriba la coseche:
  `subprocess.Popen([sys.executable, "-u", "tools/build_world.py"], …,
  start_new_session=True)`, el pid a un archivo, y un Monitor que vigile **las
  dos salidas** — `kill -0 $PID` para el final y un grep de
  `Traceback|MemoryError|Killed` para el fallo. Un filtro que sólo casa el éxito
  se queda callado ante un cuelgue, y el silencio se ve igual que «sigue
  corriendo». Ojo también con `pgrep -f build_world.py`: casa además el shell que
  la envuelve, así que mirá en `ps aux` cuál es el proceso que de verdad quema
  CPU antes de concluir que se trabó.

  **Y ANTES DE PAGARLA: PROBÁ EL ARREGLO CONTRA EL MUNDO YA EMITIDO.** Los tiles
  publicados SON el ráster que el build midió, así que una función del builder se
  puede volver a correr encima de ellos con un shim de cuatro métodos
  (`cell`, `cell_of`, `in_bounds`, `at`). Así se probaron los dos arreglos del
  2026-08-23 sin una corrida de más: `measure_channel` (media caña mínima 0 → 36,
  120 estaciones mejores y 0 peores) y `trace_land_contours` (6/6 sondas del
  arenal dentro de la silueta). Convierte «arrancá 50 minutos y esperá» en una
  medición.
- After a world rebuild, refresh BOTH derived artifacts: `pnpm inventory` and
  `python3 tools/gen_lotes.py`. The lote catalog went stale for a week once —
  it listed sponsorable footprints that no longer existed.
- Verify game changes by actually running the app, not just building. The
  render loop is one try-less call chain, so ONE ReferenceError in it kills the
  frame and everything after the throw silently vanishes — car, HUD, debug
  overlay — while the last painted frame stays on screen. It reads as a freeze
  and `pnpm build` cannot see it (Rollup only WARNS about an import of a deleted
  export). `node tools/smoke.mjs http://localhost:8799/` against a
  `vite preview` boots the game, drives it and fails on any page error; it has
  caught this exact class of bug four times — most recently an import of
  `drawFisher` deleted from `estero.js` while a call to it remained.
- **Changing ART is not covered by any smoke — diff the pixels.**
  `node tools/shot-vehicles.mjs <out.png> http://localhost:8734/` (the DEV
  server, so the module under test can be imported directly) draws all nine
  vehicles with BOTH painters — the silhouette as a ground shadow, the sprite on
  top — and `node tools/png-diff.mjs before.png after.png [diff.png]` compares
  them, writing every changed pixel as magenta. This is how `vehicles.json` was
  proved: 310 500 px, 0 changed. Do NOT compare file sizes — the two PNGs of a
  562-pixel regression differed by 10 bytes, which is deflate noise. And a
  delta-1 channel difference is still a difference worth explaining: that one
  was `fillRect` vs `beginPath+rect+fill`, which are not the same rasteriser on
  fractional coordinates.
- The smokes are `smoke` (the loop is alive), `smoke:boat` (the water medium),
  `smoke:crossing` (every buoy is ON WATER, and she can be driven down the
  channel at speed), `smoke:night` (the lit city: it forces the weather AT
  START — writing `state.weather` by hand lasts ONE frame because
  `updateDayCycle` rewrites it from the day clock — waits for it to stick, and
  checks the frame actually has bright spots, because timing a path proves it
  runs and not that it does anything), plus `smoke:theme` / `smoke:sponsor`.
  **A SMOKE TEST CAN GO GREEN FOR THE WRONG REASON.** `smoke_boat`'s "downtown
  street" coordinate went stale in a rescale and became OPEN WATER, so its
  land-is-a-wall leg was testing a boat at sea — and it still passed, because the
  hull was tuned so badly it could not reach a quarter of its top speed on water
  either. Two bugs cancelling, green for months. When a check asserts something
  about a PLACE, assert the place too. For the same reason `smoke_crossing` walks
  the camera down the route and uses `W.tileResident(x, y)`: `surfaceAt` answers
  0 (**water**) for a tile that has not streamed in, so a naive sweep would pass
  on faith over every buoy it had not waited for.
- Changelogs live in `docs/changelog/`, one file per release date, named
  `YYYY-MM-DD.md` (nothing else) — Spanish, ready-to-post copy up top and a
  `## 🧾 Changelog` section below it.
