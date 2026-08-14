# La Ruta del Churchill — complete application and asset inventory

Audit date: 2026-08-11

Scope: the completed current working tree

Companion machine inventory: `inventory.json`. It was cross-checked read-only
against the current manifest and streamed tiles during this audit; it was not
regenerated or modified.

Companion scale proposal: [`RESCALE.md`](RESCALE.md). The renderer migration in
this inventory must be coordinated with that proposal; scale and renderer
ownership must not be changed as unrelated cleanups.

## 1. Purpose

This document maps everything the game currently builds, loads, simulates, draws,
plays, or packages. Its main purpose is to make a future game engine possible
without losing content that currently exists only as JavaScript or Python
literals.

In this document, **hard-coded asset** means authored content embedded in code:
colors, shapes, dimensions, placements, catalogs, prices, timing, copy, audio
recipes, or draw dispatch. It does **not** mean that every numeric constant is a
problem. Algorithms need constants too. The migration test is:

> Would a designer reasonably expect to add or change this without changing the
> engine?

If yes, it should eventually be schema-validated data. If it defines physics,
render primitives, streaming, collision, sanitization, or an interpreter, it
belongs in engine code.

### Authority labels

| Label | Meaning | Current examples |
|---|---|---|
| **A — runtime data** | Loaded by the game without rebuilding the world | `public/content.json`, `src/content/default.json`, i18n JSON |
| **B — build data** | Consumed by the deterministic Python world builder | `docs/map.osm`, editor patch, `churchill/world/content.py` |
| **G — generated data** | Build output; never hand-edit | `src/world2d/manifest.json`, `src/world2d/tiles/*.json`, `inventory.json` |
| **C — code authority** | Content or tuning still embedded in JS/Python/JSX/CSS | renderer shapes, vehicles, economy, audio, stages |
| **E — engine code** | Algorithms that should remain code | physics integrators, RLE decoder, geometry, draw/shape interpreter |
| **D — derived/package output** | Reproducible copies generated from another source | `dist/`, Capacitor web assets, Android icon/splash variants |

## 2. System map

```text
docs/map.osm + churchill/world/content.py + editor patch/settings
                               |
                               v
                 deterministic Python builder
                               |
              +----------------+----------------+
              v                                 v
 src/world2d/manifest.json            src/world2d/tiles/*.json
              |                                 |
              +----------------+----------------+
                               v
                  src/world2d/index.js streamer
                               |
          +--------------------+--------------------+
          v                    v                    v
      game model          Canvas2D view       Pixi overlay/experiment
      src/game/*         src/render/c2d/*      src/render/pixi/*
          |                    |                    |
          +--------------------+--------------------+
                               v
                        React UI / HUD

public/content.json ----> remote content layer ----> supporters/NPCs/lotes/UI
JSON catalogs ----------> registries/interpreters --> NPCs/theme/feria/i18n
```

The shipped gameplay renderer is Canvas2D for the world and entities plus a
transparent Pixi layer. At this audit date both Pixi landmark migration sets are
empty, so the gameplay Pixi canvas is initialized but has no migrated landmark
content. Pixi is nevertheless active and visible in the production boot screen,
where it draws the animated water shimmer. `?canvas` or
`localStorage.churchill_renderer = "canvas"` disables the gameplay overlay; it
is a compatibility fallback, not a decision to remove Pixi from the project.

## 3. Build and product surfaces

| Surface | Entry point | Output/use | Authority |
|---|---|---|---|
| Web game | `src/main.jsx`, `index.html` | Vite SPA in `dist/` | source + G/D |
| Game simulation | `src/game/index.js` | mutable singleton state and rAF loop | E/C |
| World builder | `tools/build_world.py` | manifest + 1,000 streamed tiles | B → G |
| Canvas renderer | `src/render/Renderer.js` → `canvas2d.js` | painterly world, entities, HUD | E/C |
| Pixi renderer | `src/render/pixi/` | empty gameplay overlay today; retained full backend and streamed-world prototype | E/C |
| Pixi boot water | `src/ui/screens/BootScreen.jsx` | visible animated boot-screen sea | E/C |
| React UI | `src/ui/App.jsx` | menus, briefs, HUD, shop, settings | C + A |
| Remote content | `src/content/remote.js` | cached content from `churchill.jcampos.dev/content.json` | A |
| PWA | `public/manifest.webmanifest`, `public/sw.js` | install/offline shell | C/A |
| Android | `android/`, `capacitor.config.json` | landscape immersive Capacitor APK | C/D |
| Private world editor | `world-editor/` | semantic project, JSON registry, patch/export/MCP | A/B tooling |
| Inventory generator | `tools/gen-inventory.mjs` | `inventory.json` | derived |
| Lote generator | `tools/gen_lotes.py` | `docs/lotes_catalog.json` | derived admin data |

### Package dependencies

Runtime: React 18, React DOM, PixiJS 8, Capacitor 8, AdMob, Cordova Purchase,
Bungee, Space Grotesk, and JetBrains Mono. Development: Vite 6, Playwright,
Capacitor CLI/assets, and the React Vite plugin. Python world DTO validation uses
Pydantic v2.

## 4. Current shipped world

### Dimensions and storage

| Item | Current value |
|---|---:|
| World size | 79,400 × 49,780 world px |
| Scale | 2.5 px/metre |
| Raster cell | 4 px |
| Raster grid | 19,850 × 12,445 cells |
| Cuadrícula | 20 px |
| Tile | 2,000 px / 500 cells |
| Tile grid | 40 × 25 |
| Tile files | 1,000 |
| `src/world2d/` size at audit | about 18 MB |
| Source OSM size at audit | about 12 MB |

### Generated feature counts

These numbers were read directly from the current manifest and tiles. Tile
features are deduplicated with the inventory generator's identity rules because
a feature crossing a tile edge is emitted into every intersecting tile.

Refreshed 2026-08-11 after `BLOCK_MIN_M` (see ROADMAP §4). Buildings did NOT
change — `SYNTH_MAX_TOTAL` is saturated at 80,000, so 183 more manzanas
redistributed the same footprints rather than adding any; trees and palms fell
because `decorate` reads the finished surface and will not plant where a house
now stands. The manifest's `cuadras` count is the editor's selectable-block
catalog and is unrelated to the classifier's census.

| Family | Count | Breakdown |
|---|---:|---|
| Roads | 2,211 | residential 1,444; service 450; unclassified 88; trunk 76; trunk link 53; primary 43; tertiary 37; secondary 7; primary link 6; pedestrian 5; bridge 1; tertiary link 1 |
| Buildings | 44,884 | OSM + deterministic synthesized footprints |
| Trees | 14,610 | streamed tile points |
| Palms | 4,914 | streamed tile points |
| Mangroves | 1,260 | streamed tile points |
| Cuadras | 976 | semantic block polygons; **55 carry `wood`** and are planted by the renderer, not emitted as trees |
| Parcels | 483 | park 193; stadium 82; church 64; school 56; lot 39; campus 17; kinder 12; fuel 11; boulevard 3; civic 2; market 2; cathedral 1; garden 1 |
| OSM POIs | 987 | 133 source tag categories; full breakdown is in `inventory.json` |
| Signs/furniture | 496 | ALTO 281; banca 114; bus 82; crossing 12; semáforo 5; tope 2 |
| Plazas/field rects | 81 | build-emitted ground rectangles |
| Land polygons | 27 | eager backdrop geometry |
| Beaches | 67 | manifest polygon records |
| Water bodies | 112 | manifest polygon records |
| Malecón | 7 bands / 54,623 cells | contiguous multi-ring manifest records |
| Greens | 3 | typed exact polygons |
| Hills | 2 | backdrop silhouettes |
| Stadium landmarks | 2 | exact field/outline records |
| Feria attractions | 16 records / 14 kinds | 3 chinamos; one each of rueda, pulpo, martillo, sillas, terror, carrusel, tagada, chocones, barco, gusano, argollas, tómbola, and DJ |
| Ferries | 3 | deck, berth, route; one route may carry a measured channel |
| Landmarks | 38 | 24 landmark types |
| Customers | 24 | delivery target definitions |
| Districts | 12 | polygon plus legacy x band |
| Story stages | 8 | seven delivery stages plus the estero crossing |
| Editor features in current build | 0 | supported but no patch additions emitted |
| Surface styles in current build | 0 | supported but no per-cuadra overrides emitted |

### Surface wire format

Values are permanent serialized IDs. Append; never renumber.

| ID | Name | Player speed multiplier | Semantic role |
|---:|---|---:|---|
| 0 | water | 0.35 | boat medium; wall for land vehicles |
| 1 | land | 0.78 | solid cuadra interior; wall |
| 2 | beach | 0.70 | slow but drivable sand |
| 3 | road | 1.00 | asphalt carriageway |
| 4 | paseo | 0.55 | special promenade road |
| 5 | bridge | 1.00 | bridges and pier decks |
| 6 | acera | 0.62 | sidewalk; wall in land physics |
| 7 | boulevard | 0.50 | transitable pedestrian stone street |
| 8 | barro | 0.82 | packed-earth street |
| 9 | gravel | 0.90 | lastre street |
| 10 | malecon | 0.55 | promenade surface; deliberately not in `DRIVABLE` |

Mirrors that must agree: `churchill/world/enums/surface.py`,
`src/game/surfaces.js`, manifest `grid.classes`, Pixi `CLASS_RGB`, NPC host
vocabulary, editor surface lists, minimap colors, and world-build class sets.

## 5. Authored game catalog

### Vehicles

Vehicle stats are currently C authority in `src/game/vehicles.js`. Vehicle
drawings are C authority in `src/render/c2d/entities.js` and
`src/render/vehicleShapes.js`.

| Key | Name | Medium/family | Accel | Top | Turn | Grip | Melt |
|---|---|---|---:|---:|---:|---:|---:|
| `bici` | Bicicleta repartidora | land/bike | 170 | 180 | 3.40 | 0.90 | 0.70 |
| `scooter` | Scooter retro | land/bike | 225 | 230 | 3.05 | 0.85 | 1.00 |
| `tuktuk` | Tuk-tuk porteño | land/car | 202 | 212 | 2.80 | 0.82 | 0.90 |
| `cart` | Mini carrito helado | land/car | 184 | 194 | 2.55 | 0.80 | 0.55 |
| `pickup` | Pickup pescador | land/car | 253 | 270 | 2.45 | 0.78 | 1.10 |
| `turbo` | Turbo Churchill Kart | land/car | 330 | 352 | 3.05 | 0.72 | 1.30 |
| `panga` | Panga de trabajo | water/boat | 210 | 235 | 2.40 | 0.62 | 1.00 |
| `lanchataxi` | Lancha taxi | water/boat | 265 | 305 | 2.70 | 0.52 | 1.00 |
| `deslizador` | Deslizador | water/boat | 345 | 400 | 3.00 | 0.42 | 1.00 |

The vehicle object also carries size, body/accent colors, and optional
water-hull drag. A complete portable definition would additionally have to
account for the brake/boost handling rules held in physics and the per-key
details and cargo mounts in `paintVehicle`, so the table above is not yet a
complete vehicle asset.

### Districts

| ID | Display name | Tone | Current x band |
|---|---|---|---:|
| `faro` | EL FARO | `#f4d77a` | 0–19,548 |
| `carmen` | CARMEN | `#e0b478` | 19,548–21,960 |
| `paseo` | PASEO DE LOS TURISTAS | `#f0a37a` | 21,960–24,339 |
| `centro` | CENTRO PUNTARENAS | `#e6c388` | 24,339–25,112 |
| `playitas` | BARRIO LAS PLAYITAS | `#caa089` | 25,112–26,176 |
| `cocal` | BARRIO EL COCAL | `#a8b88a` | 26,176–34,999 |
| `mata` | MATA DE LIMÓN | `#a0c894` | 34,999–57,044 |
| `caldera` | CALDERA BULEVAR | `#9bc4d4` | 57,044–79,400 |
| `chacarita` | CHACARITA | `#b0b483` | 35,802–44,573 |
| `elroble` | EL ROBLE | `#9ec4a0` | 45,121–53,618 |
| `barranca` | BARRANCA | `#c7b98a` | 53,618–61,567 |
| `esparza` | ESPARZA | `#d6a97e` | 64,307–75,819 |

The generated manifest also carries `short`, `y0`, `y1`, and exact polygon.
The polygon must become the only gameplay authority; the x bands are legacy
convenience and overlap inland districts.

### Story stages

| # | ID | Name | Kind | Weather | Goal / time | Unlock |
|---:|---|---|---|---|---|---|
| 1 | `s1` | El Faro | delivery | sunny | 3 / 115s | paseo |
| 2 | `s2` | Paseo de los Turistas | delivery | sunny | 4 / 150s | centro |
| 3 | `s3` | Mercado y Catedral | delivery | sunny | 4 / 165s | playitas |
| 4 | `s8` | Travesía del Estero | crossing | condition-selected | crossing / 150s | — |
| 5 | `s4` | Atardecer en Las Playitas | delivery | sunset | 5 / 175s | cocal |
| 6 | `s5` | Tormenta en El Cocal | delivery | storm | 5 / 200s | mata |
| 7 | `s6` | Puente · Mata de Limón | delivery | night | 4 / 150s | mata |
| 8 | `s7` | Caldera · Final | delivery | sunny | 4 / 215s | caldera |

Canonical build input is still `churchill/world/content.py`; translated stage
names/briefs also exist in `src/i18n/stages.json`. The manifest is the runtime
copy. This is a B/C split that should become one stage schema.

### Landmarks

All 38 generated landmark records are listed below. Placement is world-build
data; the visual type dispatch is hard-coded in `c2d/landmarks.js`.

| District | Landmarks (`id`: type — name) |
|---|---|
| faro | `faro`: lighthouse — El Faro; `balneario`: pool — Balneario Municipal; `kios_faro`: kiosk — Churchill La Punta |
| carmen | `ferrycr`: ferry — Terminal de Ferry; `playa`: beachsign — Playa Puntarenas; `carmenig`: church — Iglesia del Carmen; `estadio`: stadium — Estadio Lito Pérez; `yatch`: marina — Yacht Club |
| paseo | `muellecruc`: cruise — Muelle de Cruceros; `tioga`: hotel — Hotel Tioga; `kios_paseo1`: kiosk — Kiosco Doña Lela; `kios_paseo2`: kiosk — Churchill El Mariachi; `casafait`: house — Casa Fait |
| centro | `mercado`: market — Mercado Central; `pali`: super — Supermercado Palí; `catedral`: cathedral — Catedral de Puntarenas; `cultura`: civic — Casa de la Cultura; `kios_centro`: kiosk — Kiosco La Porteña |
| playitas | `parquemar`: park — Parque Marino del Pacífico; `estadio_playitas`: stadium — Plaza Las Playitas; `kios_play`: kiosk — Kiosco Playitas |
| cocal | `cocal_park`: park — Parque El Cocal; `kios_cocal`: kiosk — Kiosco El Cocal; `kios_cocal2`: kiosk — Soda Ruta 17 |
| mata | `puente`: bridge — Puente de Mata de Limón; `kios_mata`: kiosk — Kiosco Mata de Limón; `leda`: restaurant — Marisquería Leda; `matalimon`: estuary — Estero Mata de Limón |
| caldera | `caldera_blvd`: sign — Caldera Bulevar; `kios_caldera`: kiosk — Soda del Puerto; `tren`: trainstation — Estación Tren Caldera; `puerto`: port — Puerto de Caldera; `villach`: village — Villa Champán; `ruta27`: highway — Ruta 27 · Autopista |
| chacarita | `kios_chac`: kiosk — Soda Chacarita |
| elroble | `kios_roble`: kiosk — Churchill El Roble |
| barranca | `kios_barr`: kiosk — Kiosco Barranca |
| esparza | `kios_esp`: kiosk — Churchill Esparza |

### Customers

| District | Customer IDs and names |
|---|---|
| carmen | `c1` Don Beto, pescador; `c2` Crucerista alemana; `c12` Yatista gringo; `c19` Marinero del muelle; `c20` Capitán del ferry; `c21` Casera del barrio |
| paseo | `c3` Carnaval troupe; `c4` Familia tica; `c5` Surfista canadiense; `c22` Bailarina de comparsa; `c23` Mesero del Kalúa; `c24` Surfista italiano |
| centro | `c6` Padre Ramírez; `c7` Vendedor de ceviche; `c8` Doña del mercado |
| playitas | `c9` Niño con bici; `c10` Equipo de fútbol; `c11` Doña del rocking chair |
| cocal | `c13` Pareja en mirador; `c14` Camionero de Ruta 17 |
| mata | `c15` Pescadores del estero; `c16` Cocineros de Leda |
| caldera | `c17` Maquinista del tren; `c18` Estibador del Puerto |

Each generated record also contains coordinates and a delivery line. A nonempty
remote `content.npcs` array replaces this pool at runtime.

## 6. Runtime game systems

### Modes and UI flow

Game modes are `story`, `arcade`, `explore`, and `tutorial`; story stages can be
land delivery or water crossing. The React screen machine currently uses:

`boot`, `intro`, `title`, `stagepick`, `brief`, `modebrief`, `tutbrief`,
`vehpick`, `lanchapick`, `playing`, `paused`, `over`, `settings`, `supporters`,
and `shop`.

Menu screens run the live world in attract mode. The UI polls the live mutable
`Game.state`; it is intentionally not a React state store.

### Stateful entity pools

| Pool/system | Current content |
|---|---|
| `traffic` | moving cars, buses, trucks |
| `pedestrians` | walkers, passengers, beach people, fans, authored NPCs |
| `gulls` | airborne ambient gulls |
| `boats` | ferries, pangas, balneario boat |
| `parked` | static curb vehicles |
| `vendors` | street carts |
| `animals` | dogs/cats |
| `trains` | locomotive and wagons on rails |
| `schools` | tuna school plus working pangas as one event |
| `beachGames` | ball plus beach players as one event |
| `esteroThings` | pangas, fish, gull encounters, roots, whirlpools, fishers, yacht, exposed banks |
| `arcadeCoins` | gold/silver/bonus/frozen collectible instances |
| `ferries()` | route-driven ferry simulation and deck carry |

### NPC registry already in data

`src/game/npcTypes.json` is a good model for future catalogs: schema version,
human note, movement vocabulary, host vocabulary, and 15 types. Built-in types
are walker, fan, swimmer, passenger, playero, jugador, paseante, fisher, and
muellero. Authorable types are resident, tourist, vendor, worker, supporter,
and mascot. It owns density, speed range, art family, spacing, and allowed
hosts; movement algorithms remain code.

### Economy and progression still in code

| Family | Current catalog |
|---|---|
| Free vehicles | bici, scooter, tuktuk, panga |
| Paid vehicles | cart ₡350; pickup ₡900; turbo ₡1,500; lancha taxi ₡600; deslizador ₡1,400 |
| Upgrades | Cooler Pro (melt levels/prices); Turbo Tank (boost cap levels/prices) |
| Boosts | Ice Pack ₡60; Head Start ₡40 |
| Paints | six colors, each ₡80 |
| Coin packs | 500/$0.99; 2,000/$2.99; 4,000/$4.99 |
| Rewards | ₡50 delivery; ₡25 perfect bonus; ₡10 pickup |
| Locks | `MVP_LOCKED`, district barriers, stage unlock links |
| Persistence | progress, tuning, mute/volume, content cache, tutorial, ads, IAP in versioned localStorage keys |

The editor can inject shop tabs/items through `editorContent`, but the bundled
baseline above remains code and must be migrated to a complete economy JSON.

### Weather, day/night, tide, and crossing

Weather vocabulary is sunny, sunset, storm, and night. Day cycle duration,
storm scheduling, tide period/surge, water palettes, weather tints, grip/melt
effects, and rain are spread across game and render modules. Crossing conditions
are hard-coded as bajamar, atardecer, pleamar, and aguacero. Gate spacing,
boost rewards, hazards, encounter distribution, and water-channel gameplay are
also embedded in `crossing.js`.

### Audio

There are no runtime MP3/WAV/OGG assets. Audio is synthesized with Web Audio.

| Family | Code-owned content |
|---|---|
| One-shots | menu move/select/denied, pickup, delivery, perfect, ferry horn, coin, combo, melt fail |
| Continuous | engine, drift, ice-cream-cart melody, fountain, pool, waves, DJ Urtech |
| Vehicle voices | bici, scooter, tuktuk, cart, pickup, turbo oscillator recipes |
| Missing portable definitions | boat engine voices, recipe schema, buses/trains/ambient sound catalog |

The oscillator/noise scheduler is engine code. Frequencies, envelopes, phrases,
gain, filters, and per-vehicle voice assignment are authored content and should
be data.

## 7. Renderer and visual asset inventory

### Canvas2D compositor order

1. Water backdrop and offshore boats/schools.
2. Streamed painterly world: land, malecón, roads, surfaces, rails, medians,
   kiosk paths, piers, buildings, trees/palms, street labels.
3. Mangroves, crossing channel, piers, bridge, ferries, estero encounters.
4. Barriers, street furniture, editor element layer, parcels, feria, landmarks,
   sponsored lotes.
5. Pedestrians, beach games, parked vehicles, vendors, animals, traffic,
   trains, coins, particles, target, player.
6. Editor roof layer, gulls, score floats.
7. Weather tint/rain/night, gull blind, minimap, compass, crossing HUD, speed
   streaks.

Draw order is engine behavior and should remain code or become an explicit
layer graph. The appearance of each family should become assets.

### Visual families and current authority

| Family | Source | Current visual inventory | Status |
|---|---|---|---|
| Terrain/water base | `ground.js`, `water.js` | land, sea, beaches, green presets, waves, currents, shore break, pool caustics, mangroves | C; migrate palettes/effect presets |
| Roads/fields | `streets.js` | road classes, acera, caño, lane dashes, dirt/gravel, rails, medians, fields/courts, labels | C; geometry is G, materials are C |
| Malecón | `malecon.js` | baldosa courses and esplanade palettes | C |
| Buildings | `structures.js` | generic roof/body/windows; concrete/timber/apron piers; bridge; ferry/berth | C |
| Parcels | `landmarks.js`, `streets.js` | park, stadium, school, kinder, campus, fuel, market, church/cathedral/civic, sponsor slot | C |
| Landmark props | `landmarks.js` | lighthouse, kiosk, ferry/cruise marker, church, market, super, hotel, park, stadium, museum fallback, civic, marina, pool, house, estuary, restaurant, beach sign, train station, port, sign, village, highway, anchor, bridge | C dispatch and shapes |
| Feria | `feriaAssets.json` + `attractions.js` | 14 catalog kinds; all 14 are placed now across 16 records; shape-part interpreter | **data-driven exemplar** |
| Flora | `flora.js` | tree canopy, palm, roadside trees, median merge | C palette/shape; G placement |
| People | `entities.js` | walker, playero, jugador, passenger, fisher, muellero, swimmer, authored person/vendor/worker/mascot | C |
| Vehicles | `entities.js`, `vehicleShapes.js` | 9 player vehicles, ambient cars/trucks/buses, train, boats/ferries | C |
| Animals/air | `entities.js` | dog/cat, gulls | C |
| Delivery/collectibles | `entities.js` | gold/silver/bonus/frozen coins, target, cargo bags/coolers/freezer load, wind/wake | C |
| Estero encounters | `estero.js` | buoy, panga, fish, gull flock, roots, whirlpool, bank, fisher, yacht | C |
| Editor runtime features | `editorWorld.js` | roofs, grandstands, entrances, lights | mixed: placement data, renderer C |
| HUD | `hud.js` | POI tags/names, grid, compass, rain, vignette, minimap, crossing race/tide gauge | C |
| UI icons | `Icon.jsx`, `CoinIcon.jsx` | code-native SVG primitives and coin mark | C |
| Pixi gameplay layer | `pixi/scene.js`, `pixi/index.js` | retained full-scene drawers; shipped `landmarksOnly` path currently receives no migrated landmarks | **retain**; dormant migration infrastructure, not deletion-ready |
| Pixi boot water | `ui/screens/BootScreen.jsx` | animated sine-wave water shimmer | active production Pixi asset |
| Pixi streamed viewer | `pixi/World2DRenderer.js`, `tileTexture.js`, `world2d/viewer-pixi.js` | surface tiles, buildings, POIs, simple vehicle; development viewer | **retain** as rescale/migration test bed |

### Feria shape DSL already in JSON

`src/render/c2d/feriaAssets.json` contains rueda, tagada, martillo, pulpo,
sillas, carrusel, chocones, barco, gusano, terror, argollas, tombola, chinamo,
and DJ. It describes ordered parts, palettes, labels, and animation. The
interpreter supports primitives such as discs, rings, spokes, arms, cabins,
boxes, legs, masts, pendulums, dishes, canopies, boats, tracks, bulbs, facades,
counters, signs, prizes, cars, speakers, zinc, banners, goods, frames, neon,
tarp, and banderines.

This is the best current template for the future renderer: schema-validated
asset definitions plus a finite code-owned primitive vocabulary.

### Hard-code concentration

A literal scan shows where authored appearance is concentrated. Color counts
are direct hex and `rgb()`/`rgba()` occurrences; primitive counts are direct
`ctx` path, rectangle, and text calls. Repeated occurrences are counted, while
helper-mediated drawing is not. This is a directional audit, not a quality
metric:

| File | Approx. hard-coded color literals | Canvas path/text primitive calls |
|---|---:|---:|
| `c2d/landmarks.js` | 214 | 244 |
| `c2d/entities.js` | 133 | 279 |
| `c2d/streets.js` | 80 | 96 |
| `c2d/hud.js` | 75 | 79 |
| `c2d/structures.js` | 56 | 90 |
| `c2d/estero.js` | 53 | 80 |
| `c2d/attractions.js` | 46 | 91, but most authored parts are JSON |
| `c2d/gfx.js` + ground/malecón/water/flora | 116 | shared materials/effects |
| `world-editor/src/main.js` | 236 | 101 |
| `src/styles.css` | 146 | UI theme/layout CSS |

The editor currently duplicates many game colors and simplified draw paths.
Moving game art into shared JSON should make both renderers consume the same
definitions instead of migrating the duplication.

### Pixi preservation, water restoration, and rescale plan

#### Decision

Pixi stays in the game. There must be no blanket deletion of `src/render/pixi/`
or of PixiJS during cleanup. The goal is to remove duplicate *authority*, not to
remove the renderer that will carry suitable visual families during and after
the scale migration in [`RESCALE.md`](RESCALE.md).

The current state must be described precisely:

- The boot-screen sea is live Pixi and must be kept.
- The transparent Pixi gameplay canvas is created by default, but its shipped
  `landmarksOnly` scene has no migrated landmark entries, so it currently draws
  no gameplay art.
- `scene.js` still contains a dormant full-world/entity implementation. It is
  migration material, not proof that those families are currently drawn twice.
- `World2DRenderer.js`, `tileTexture.js`, and the standalone Pixi world viewer
  are development assets that can measure tile appearance and GPU behavior at
  the proposed scales.
- `vehicleShapes.js` is shared by Canvas entities and React previews; its Pixi
  adjacency does not make it removable.

#### Why gameplay water is Canvas2D now

Repository history shows a renderer-wide product decision on 2026-07-18, not a
water-specific technical failure. Commit `c20519d` introduced the full hybrid
Pixi renderer, `49ecae2` made it the default and added boot water, and `9c51b28`
restored the painterly Canvas2D world and entities while retaining Pixi as a
transparent landmark layer. Later landmark pilots were reverted, leaving the
current migration sets empty.

The old gameplay Pixi sea was primarily the backdrop and streamed surface-tile
representation. The current Canvas water has since accumulated weather
palettes, swell, cross-chop, currents, ripples, shore break/swash, balneario
caustics, swimmers, and wake interactions. Restoring Pixi water must preserve or
intentionally reinterpret these effects; it should not silently fall back to a
flat color just because that was the older implementation.

#### Ordered migration plan

1. **Freeze deletion.** Do not delete the Pixi dependency, boot animation,
   dormant scene, tile texture builder, viewer, or Canvas water while the
   renderer/rescale decision is in progress.
2. **Create one ownership registry.** Declare each visual family as `canvas`,
   `pixi`, or an explicit fallback. Renderer selection must replace the current
   empty migration sets and comments as the source of truth. One family may be
   rendered by only one gameplay backend in a frame.
3. **Extract shared water data.** Move sea/weather palettes and effect presets
   into a schema-validated material/effect asset consumed by both renderers.
   Animation algorithms and shader/draw implementations remain code.
4. **Make gameplay water the first Pixi migration.** Add a Pixi water layer and
   define its DOM/compositor order explicitly. It must sit behind land,
   structures, entities, and HUD; when Pixi owns water, the Canvas compositor
   must skip its water pass so the two seas are never overdrawn.
5. **Reach current visual parity before rescaling.** Compare calm, rain, storm,
   night, shore, estero, balneario, boat wake, and crossing scenes at the
   current world scale. Keep the Canvas path as the fallback until the Pixi
   version is accepted visually and passes runtime smoke tests on web and the
   Android WebView.
6. **Use Pixi water in the rescale trials.** Evaluate the `RESCALE.md` variants
   with the same camera framing and content. Measure frame time, GPU texture
   memory, tile upload/churn, culling, seam artifacts, and effect density rather
   than judging scale from a static screenshot alone.
7. **Migrate one family at a time.** Landmarks, structures, flora, vehicles, or
   other families may move to Pixi only through the same ownership/parity gate.
   A backend migration must not also redesign the asset without recording that
   as a separate visual change.
8. **Delete only after acceptance.** Once a family has one shared asset
   definition, Pixi parity, device verification, and an accepted fallback
   policy, remove only the superseded implementation for that family. Refresh
   the machine inventory after every accepted migration.

#### Rescale requirements for water and render assets

Every extracted value must identify whether it is measured in metres, world
pixels, screen pixels, normalized fractions, or time. Water wavelength,
shore-break width, ripple radius, wake length, caustic density, stroke width,
tile resolution, culling margin, and animation speed must not all scale by the
same factor. Camera framing is a renderer decision; geography and simulation
speeds remain metre-based. The rescale validation sequence is:

```text
shared water/material schema -> Pixi parity at current scale
  -> choose rescale candidate -> rebuild deterministic world
  -> snapshot/inventory/lotes -> build + runtime smoke
  -> visual and performance review on web + Android
```

#### Cleanup gates

| Item | Decision now | Earliest deletion condition |
|---|---|---|
| PixiJS and boot water | keep | only after an explicit product decision to abandon Pixi |
| Gameplay Pixi scene | keep and adapt | family-by-family replacement; never delete wholesale during rescale |
| Pixi streamed viewer/tile textures | keep | after the migration and rescale measurements no longer use them |
| Canvas water | keep as reference/fallback | Pixi visual acceptance, smoke/device parity, and fallback policy resolved |
| Dormant Pixi entity/world drawers | quarantine, do not expand casually | corresponding family is either formally adopted or rejected and shared assets exist |
| Uninitialized crowd/coin landmark branches | audit during ownership-registry work | confirmed unreachable and not part of the accepted Pixi landmark design |
| Duplicate renderer palettes | migrate, then remove literals | both backends consume the validated shared material registry |
| `vehicleShapes.js` | keep | replaced by a validated shared vehicle asset/interpreter used by all consumers |

## 8. JSON and structured-data inventory

### Runtime and authoring JSON

| File | Owner | Loaded by | Contents | Edit rule |
|---|---|---|---|---|
| `src/content/default.json` | app | `remote.js` | offline supporters/NPCs/lotes/UI fallback | edit through content/editor flow |
| `public/content.json` | deployment | fetched at runtime | online copy of same schema | must stay schema-aligned with default |
| `src/game/npcTypes.json` | game/editor | NPC runtime + builder/editor validation | NPC behavior/art/host registry | editable data |
| `src/render/c2d/feriaAssets.json` | renderer | attraction interpreter | feria visual assets | editable data; add schema validation |
| `src/i18n/es.json` | UI | i18n | 259 Spanish strings | base language |
| `src/i18n/en.json` | UI | i18n | 259 English strings | placeholder-compatible translation |
| `src/i18n/stages.json` | UI | i18n | English overlays for all 8 stages | merge with stage schema later |
| `src/ui/themeTokens.json` | UI/editor | theme system | 9 token definitions/defaults | editable data |
| `capacitor.config.json` | package | Capacitor | app id/name/web directory/Android policy | packaging data |
| `public/manifest.webmanifest` | PWA | browser | install metadata/icons/colors | packaging data |

### Generated and derived JSON

| File | Producer | Contents | Rule |
|---|---|---|---|
| `src/world2d/manifest.json` | world builder | eager semantic/backdrop world | never hand-edit |
| `src/world2d/tiles/*.json` | world builder | RLE surfaces + streamed vectors | never hand-edit |
| `inventory.json` | `pnpm inventory` | counts, catalogs, JS module exports/lines | regenerate after modules/world |
| `docs/lotes_catalog.json` | `tools/gen_lotes.py` | sponsorable positions | regenerate after world |
| `tools/world_digest.json` | `world_snapshot.py save` | byte-level baseline | update only for intended world change |
| Android `assets/*.json` | Capacitor sync | bundled config/plugin metadata | derived |

### World manifest schema families

`meta`, `grid`, `districts`, `landmarks`, `customers`, `stages`, `bridge`,
`estuary`, `hills`, `beaches`, `waters`, `landPolys`, `plazas`, `greens`,
`malecon`, `attractions`, `stadiums`, `balneario`, `kioskPaths`, `piers`,
`pois`, `parcels`, `signs`, `ferries`, `cuadras`, `surfaceStyles`, and optional
editor patch/UI/content/features. Pydantic contracts live in
`churchill/world/dto/` and allow extra fields by design.

A tile contains identity and dimensions, a base64 RLE surface slab, and when
present: roads, rails, medians, buildings, trees, palms, mangroves, and islands.

## 9. Physical file assets

### Source branding assets

| File | Dimensions/type | Role |
|---|---|---|
| `assets/icon.svg` | SVG | editable app-icon source |
| `assets/icon.png` | 1024×1024 RGBA PNG | Capacitor asset input |
| `assets/splash.svg` | SVG | editable splash source |
| `assets/splash.png` | 2732×2732 RGBA PNG | light splash input |
| `assets/splash-dark.png` | 2732×2732 RGBA PNG | dark splash input |

### Shipped web images

| File | Dimensions | Used by |
|---|---:|---|
| `public/branding/pacific-code-labs.png` | 1000×384 | boot logo and service-worker shell |
| `public/branding/ruta-churchill-loading.png` | 1280×720 | boot/loading art and shell |
| `public/icons/apple-touch-icon.png` | 180×180 | HTML/PWA |
| `public/icons/icon-192.png` | 192×192 | favicon/PWA |
| `public/icons/icon-512.png` | 512×512 | maskable/PWA |

### Android derived images

`android/app/src/main/res/` contains 50 generated PNGs: 26 splash variants and
24 launcher/background/foreground/round icon variants across density,
orientation, and night resource buckets. Their authority is the five files in
`assets/`; do not treat the Android variants as independent art.

The synced `android/app/src/main/assets/public/` tree is also derived from the
Vite build and includes hashed JS/CSS/font chunks. It must not become an
authoring source.

### Reference-only images

`how-look-puntarenas/` contains 11 visual references: six Puntarenas/game
photos or screenshots plus `faro.jpg`, `mata-limon.jpg`, `muelle-nacional.jpg`,
`chinamos.webp`, and one generated long-form reference image. No runtime module
loads them. `uploads/` currently contains four pasted PNG working references,
also not loaded by the game.

### Fonts

Fonts are package assets rather than repository image files. The build imports
Bungee 400; Space Grotesk 400/500/600/700; and JetBrains Mono 400/600. Their
generated WOFF/WOFF2 files appear in `dist/` and the synced Android web bundle.

### Other shipped static files

| File | Role |
|---|---|
| `public/CNAME` | custom GitHub Pages domain |
| `public/ads.txt` | advertising seller declaration |
| `public/privacy/index.html` | privacy-policy page |
| `public/sw.js` | offline/runtime cache and analytics/ad bypass rules |
| `public/manifest.webmanifest` | PWA identity, landscape orientation, theme, icons |
| `index.html` | web application document and icon links |

### Documentation and reference data

| Group | Files/purpose |
|---|---|
| Product truth | `docs/GAME_DESIGN.md`, `ROADMAP.md` |
| World architecture/history | `2d-investigation.md`, `RESCALE.md`, `WORLD_2D_MIGRATION.md`, `WORLD_EDITOR_PIPELINE.md` |
| Visual research | `Librería Gráfica para Juego 2D (1).md`, `i-need-to-ensure-elegant-tower.md`, `how-look-puntarenas/` |
| Business/operations | `ANALYTICS.md`, `FUNDING_TIERS.md`, `MONETIZATION.md`, `REMOTE_CONTENT.md` |
| Collaboration note | `docs/collab/2026-08-04-travesia.md` |
| World source/admin data | `docs/map.osm`, `docs/lotes_catalog.json` |
| Release copy | 14 Markdown files currently under `docs/changelog/`, dated 2026-07-24 through 2026-08-11, including historical date-suffixed files |
| Agent guidance | root `AGENTS.md` and `CLAUDE.md` |

### Explicit absence

There are no sprite sheets, texture atlases, 3-D models, video files, or sampled
audio files in the runtime source. Almost all in-world art is procedurally drawn
from code and generated vector/world data.

## 10. Source module inventory

### Game model (`src/game/`)

| Module | Responsibility | Content still embedded? |
|---|---|---|
| `state.js` | singleton state and entity arrays | defaults, pool vocabulary |
| `index.js` | game facade, loop, renderer/input attachment | no major asset content |
| `modes.js` | start story/arcade/explore/tutorial, land/boat exchange | timings, fallback starts, mode rules |
| `physics.js` | driving/collision/delivery/environment/entity update | many balance constants and coin rain |
| `boat.js` | hull-specific driving model | hull tuning table |
| `input.js` | keyboard/gamepad/touch | throttle thresholds/bindings |
| `delivery.js` | kiosk/customer loop, score/combo/melt | reward/selection tuning and float colors |
| `progress.js` | local progress, district/stage locks/barriers | lock list and barrier policy |
| `spawns.js` | traffic/NPC/animal/train/boat/beach streaming | target counts, palettes, actor recipes |
| `buses.js` | stop approach/dwell/board/alight | bus timings/capacity |
| `ferries.js` | route/deck/carry simulation | fallback deck constants |
| `crossing.js` | estero race, gates, boost, encounters | large stage/hazard/tuning catalog |
| `daynight.js` | day phases and random storms | phase/timing presets |
| `tides.js` | tide and surge | timing/surge presets |
| `npcs.js` | registry adapter/host checks | interpreter; content is JSON |
| `tutorial.js` | seven-step tutorial | step order/thresholds |
| `economy.js` | wallet/shop baseline/upgrades | full bundled economy catalog |
| `editorContent.js` | merges editor shop/vehicle content | interpreter and shop-tab defaults |
| `editorGameplay.js` | triggers/weather/checkpoint actions | trigger action dispatch |
| `audio.js` | procedural WebAudio | full sound catalog |
| `attract.js` | menu camera cruise | cruise route/stops/speed |
| `tuning.js` | player preferences | defaults and allowed ranges |
| `vehicles.js` | vehicle registry | full vehicle stats/colors/sizes |
| `surfaces.js` | wire-format client mirror | intentional mirrored data |

### Renderer (`src/render/`)

| Module | Responsibility |
|---|---|
| `Renderer.js` | backend seam and Pixi fallback |
| `canvas2d.js` | camera, culling, composition order |
| `vehicleShapes.js` | backend-neutral vehicle silhouette paths |
| `c2d/gfx.js` | canvas binding, zoom, paths, labels, weather colors |
| `c2d/cache.js` | road/path/tile render caches |
| `c2d/world.js` | streamed-world painter orchestration |
| `c2d/ground.js` | land/water/greens/mangroves/surface styles/access paths |
| `c2d/water.js` | swell/current/ripple/shore/pool effects |
| `c2d/malecon.js` | paving material |
| `c2d/streets.js` | roads, fields, parcels, rails, medians, labels, signs, barriers |
| `c2d/structures.js` | generic buildings, piers, bridge, ferries |
| `c2d/landmarks.js` | parcel and landmark art/sponsor lots |
| `c2d/attractions.js` | feria asset DSL interpreter |
| `c2d/feriaAssets.json` | feria asset definitions |
| `c2d/flora.js` | trees/palms/roadside flora |
| `c2d/entities.js` | people, animals, vehicles, boats, train, coins, player/cargo |
| `c2d/estero.js` | crossing channel and encounters |
| `c2d/editorWorld.js` | editor-authored elements and roofs |
| `c2d/hud.js` | debug labels, weather overlays, minimap, compass, crossing HUD |
| `pixi/index.js` | Pixi lifecycle/failure bridge |
| `pixi/scene.js` | retained full Pixi scene plus current landmark-only mode |
| `pixi/tileTexture.js` | surface-class raster-to-texture palette |
| `pixi/World2DRenderer.js` | older/standalone streamed Pixi renderer |

### UI, content, localization, monetization

| Area | Modules |
|---|---|
| App shell | `main.jsx`, `ui/App.jsx`, `styles.css` |
| Screen components | Boot, Intro, Title, StageSelect, StageBrief, ModeBrief, TutorialBrief, VehiclePicker, HUD, Pause, Results, Settings, Shop, Supporters |
| Reusable UI | `FitScale`, `Icon`, `CoinIcon`, `TouchControls`, `TutorialOverlay`, `VehiclePreview`, `DriveTuning`, `useMenuNav`, immersive helpers |
| Dev UI | `GameTweaks`, `tweaks/TweaksPanel` |
| Theme | `ui/theme.js`, `ui/themeTokens.json`; content/editor overrides become CSS custom properties |
| Localization | `i18n/index.js`, `es.json`, `en.json`, `stages.json`; language registration is still code |
| Remote content | `content/remote.js`, default/public content JSON |
| Monetization | `monetize/ads.js`, `analytics.js`, `iap.js` |

Important packaging constants still in code/config include the remote content
URL, analytics ID placeholder, AdMob app/unit IDs, IAP product IDs, ad cadence,
PWA cache name/shell list, application id, and package version.

### World runtime (`src/world2d/`)

`index.js` owns tile import/stream/decode, surface lookup, building spatial
hashing, road arclength sampling, district lookup, and editor content exposure.
`drive.js` is a standalone drive helper. `viewer.js` and `viewer-pixi.js` are
world inspection entry points. `manifest.json` and `tiles/` are generated.

### Python world package (`churchill/world/`)

| Layer | Files and responsibility |
|---|---|
| Configuration | `config.py`: projection, raster/tile sizes, road widths, surface aliases, placement/build/decor tuning |
| Authored content | `content.py`: districts, landmarks, customers, stages, site decor, crossings, lanchas, feria/attractions, beach access, building palettes |
| Context | `context.py`: mutable-in-place pipeline state and dimensions |
| DTOs | `dto/geo.py`, `world.py`, `manifest.py`, `lote.py`: validated emitted contracts |
| Enums | `enums/surface.py`, `features.py`: serialized vocabulary |
| Pipeline | `extract.py`, `surface_stage.py`, `poi_stage.py`, `build_stage.py`, `finish.py`, `emit.py`, `runner.py` |
| Repositories | OSM input, world JSON output/input, debug PNG/SVG output |
| Services | projection, OSM extraction, streets, blocks, fields, buildings, surfaces, network, placement, editor patch, decoration, signs, ferries, lanchas, piers, malecón, attractions, NPC validation |
| Utilities | geometry and raster primitives |
| Logging | stable factual build log used as review surface |

The algorithms belong in E. `content.py` and many aesthetic/policy constants in
`config.py` are migration candidates for B JSON. Any migration must preserve
byte-identical world output until a deliberate world change is accepted.

### Tools and tests

| File/family | Role |
|---|---|
| `tools/build_world.py` | 19-line builder entry shim |
| `tools/world_snapshot.py` | verify/rebuild/save deterministic digest |
| `tools/gen-inventory.mjs` | builds `inventory.json` |
| `tools/gen_lotes.py` | builds sponsor lot catalog |
| `tools/smoke.mjs` | required real-app boot/drive/page-error smoke |
| `smoke_boat`, `smoke_crossing`, `smoke_sea`, `smoke_theme`, `smoke-sponsor` | focused runtime probes |
| `headless-check.js` | Node import/headless checks |
| `_dbg`, `_probe_flora`, `_shot`, `_soon`, root `_probe.mjs` | development probes; not product assets |
| `debug_map.png`, `debug_features.svg` | generated world-review artifacts |
| `tests/test_world_surfaces.py` | surface/world rules |
| `tests/test_world_editor_patch.py` | patch import/validation behavior |

## 11. Private world editor inventory

`world-editor/` is a separate, gitignored application. It is not part of the
shipped game repository history unless managed separately, but it is central to
the data-driven engine plan.

### Editor data model and assets

| Artifact | Role |
|---|---|
| `projects/churchill.editor.json` | semantic authoring project: settings, content, UI, deletions, features, viewport |
| `exports/world-editor.patch.json` | reproducible world patch consumed by builder |
| `exports/generator-settings.json` | world scale, palettes, roads, vegetation settings |
| `prefabs/catalog.json` | seven reusable semantic prefabs |
| `agent-api.json` | HTTP/CLI/MCP contract |
| `backups/` | timestamped recovery copies; not independent authority |

Prefabs currently cover tree-lined paseo, kiosk access, route vehicle,
checkpoint trigger, LatAm controlled intersection, covered drivable bay, and
NPC coin route.

### Editor source modules

| Module | Responsibility |
|---|---|
| `src/main.js` | canvas/editor state, generated feature normalization, rendering, hit testing, tools, inspector, shop, validation/build/play integration |
| `src/dataWorkspace.js` | visual/raw JSON editor, diff, validation, revision-safe save |
| `src/screens.js` | screen copy/color editing |
| `src/translations.js` | paged multilingual editor and placeholder checks |
| `src/theme.js` | theme token editor |
| `src/npcs.js` | NPC registry/placement panel |
| `src/parcels.js` | parcel/slot/building/sponsor controls |
| `src/piers.js` | pier controls and validation |
| `src/ferries.js` | ferry berth/deck/route controls and validation |
| `src/hosts.js` | semantic host lookup and assignment |
| `src/shell.js` | responsive editor chrome |
| `vite.config.js` | API server, source index, validation, export, build, live bridge, data-source registry |
| `bin/churchill-editor.mjs` | CLI |
| `bin/churchill-editor-mcp.mjs` | MCP server |

Editor tests cover data-source APIs, ferries, ground types, NPC types, parcels,
and piers. The editor also has its own package/lock/workspace/Vite configuration
and an example MCP host configuration.

### Editor coverage and gaps

Already editable: generated source overrides/hides; geometry; surfaces; roads;
trees; parcels; piers; ferries; NPC placement/types; gameplay points/routes/
triggers; districts/weather zones; roofs/lights/signs; shop items; content;
translations; limited screens/theme; prefabs; build/play loop.

The editor roadmap identifies the same remaining engine work as this audit:
complete vehicle assets, parameterized props, new shape assets, stages/spawns/
audio, and schema/version/hot-reload plumbing.

## 12. Hard-coded content migration register

Priority uses P0 = required to prevent data/renderer mismatch, P1 = next engine
foundation, P2 = later authoring surface.

| Priority | Current code authority | What must move to data | Proposed authority | What remains engine code |
|---|---|---|---|---|
| P0 | ~~`vehicles.js`, `entities.js`, `vehicleShapes.js`, `audio.js`, economy/editor vehicle merge~~ **DONE 2026-08-13** | complete vehicle definition: stats, medium, bounds/collision, body parts, colors, cargo mounts, sound voice, price/unlock | `src/assets/vehicles.json` with versioned schema — proved pixel-identical over all nine (`tools/shot-vehicles.mjs` + `tools/png-diff.mjs`, 310 500 px, 0 changed) | vehicle physics, part/silhouette interpreter, WebAudio synthesis |
| P0 | surface mirrors across Python/JS/Pixi/editor | one canonical surface registry with wire ID, labels, roles, speed, materials | versioned shared surface JSON consumed/generated into both runtimes | raster algorithms and collision category evaluation |
| P0 | ~~loose string vocabularies in DTOs, simulation, renderer, UI, and editor~~ **DONE 2026-08-11 / 08-13** | stage/sign/pier/vehicle/host/geometry/mode identities and validation | Python enum layer plus deterministic generated JS/JSON vocabulary — 17 enums, `enums/{features,game,editing,surface}.py` | state transitions, rendering, geometry, validation algorithms |
| P0 | ~~landmark~~/parcel/sign switches — **landmarks DONE 2026-08-13** | asset kind registry and mapping from semantic type to asset | `src/assets/world-props.json` — 23 of 26 landmark types; `lighthouse`/`stadium`/marine `park` stay in code because they are SCENES, which is this table's own "what should not be converted" rule. Parcels and signs still open | finite shape DSL and draw dispatch by schema — now ONE interpreter (`c2d/shapes.js`) shared with the vehicle catalog |
| P0 | ~~duplicated Canvas/Pixi/editor colors~~ **DONE 2026-08-13** | shared material/theme registry for terrain, roads, structures, minimap/editor preview | `src/assets/materials.json` — measured first: canvas ∩ pixi was already **0**, canvas ∩ editor was 40, and the ones that only *share a number* were deliberately left alone | backend adapters |
| P0 | Canvas gameplay water plus older Pixi water paths | water palettes/effect presets, explicit backend owner, units, layers, and parity fixtures | `src/assets/water.json` plus renderer ownership registry | Canvas draw algorithms, Pixi shaders/draw algorithms, simulation interactions |
| P1 | `churchill/world/content.py` | districts, landmarks, customers, stages, site decor, crossings, lanchas, attractions/access definitions | `content/world/*.json` validated into existing DTOs | projection, placement/resolution, verification |
| P1 | `economy.js` | free/paid vehicles, upgrades, boosts, colors, packs, rewards | `src/content/economy.json` or runtime content block | wallet transactions and entitlement logic |
| P1 | `audio.js` | event recipes, melodies, continuous voices, vehicle assignment | `src/assets/audio.json` | oscillator/noise nodes and scheduler |
| P1 | `spawns.js`, `buses.js`, `crossing.js`, `daynight.js`, `tides.js` | population profiles, palettes, encounter tables, bus/ferry/crossing/day/weather/tide presets | `src/content/simulation.json` + stage overrides | entity advancement and collision algorithms |
| P1 | `tutorial.js`, `progress.js`, `modes.js` | tutorial graph, goals, unlock graph, mode defaults/start profiles | `src/content/progression.json` | state transitions and persistence |
| P1 | `feriaAssets.json` without external validator | formal schema/version and editor preview | keep file; add validator/DTO | existing shape interpreter |
| P2 | JSX screen structure and `styles.css` | only designer-facing screen layout/content variants and component tokens | screen schema using approved components/slots | React components, focus/navigation/accessibility |
| P2 | `hud.js` | HUD layout/style presets and minimap materials | `src/assets/hud.json` | live projection, culling, meters |
| P2 | PWA/ads/IAP/content URL constants | deployment/environment configuration where safe | build-time config with checked-in production defaults | service worker logic, purchase/ad APIs, sanitization |
| P2 | editor simplified renderer | consume the same shared assets as the game | same JSON registries | editor-specific selection overlays/hit testing |

### What should not be converted into arbitrary JSON

- Physics functions, collision resolution, path projection, route following,
  streaming, spatial hashes, RLE encoding/decoding, and deterministic geometry.
- Raw Canvas/Pixi command streams with unrestricted operations. Use a finite,
  validated shape DSL like the feria catalog.
- React behavior, keyboard/focus/accessibility logic, network sanitization, ad
  or purchase API calls.
- Generated manifest/tile data as an authoring source.
- Android density variants, built bundles, caches, screenshots, or backups.

## 13. Repeated constants and enum-layer audit

### Scope and classification rule

This audit scanned 168 authored JavaScript, JSX, Python, MJS, and JSON files in
the game, builder, tools, and private editor. Generated tile geometry and
translated prose were excluded from literal-frequency results; the shipped
manifest was then inspected separately to distinguish live values from dormant
branches.

An identical number in two files is not automatically one constant. `40` can
mean a speed limit, a pier width, a channel pitch, or a draw size. Constants
should be centralized only when changing one without the other would violate a
domain contract.

The layering rule is:

- **Enums identify closed states or wire tokens:** `water`, `crossing`,
  `semaforo`, `point`.
- **Registries attach data to an ID:** surface speed/material, road width/order,
  vehicle stats, NPC art, attraction parts.
- **Tuning/config owns behavior numbers:** spawn radius, storm duration, grip,
  camera framing.
- **Algorithms keep local mathematical constants:** interpolation epsilons,
  loop offsets, bezier control ratios.

Putting colors, widths, or arbitrary content IDs in an enum would only move the
hard-coding. The enum layer should define vocabulary; generated/shared data
should define the properties of each vocabulary item.

### Existing Python enum coverage

| Enum | Values/role | Current coverage | Audit result |
|---|---|---|---|
| `Surface` | integer wire IDs 0–10 | builder and manifest | correct authority, but the client/editor still mirror names and use raw numbers |
| `ParcelUse` | parcel semantic use | all shipped parcel uses | enum is sound; editor palette omits live `market` |
| `GreenType` | green-ground type | all shipped green types | sound; colors/dilation remain duplicated renderer/editor metadata |
| `LandmarkType` | landmark renderer dispatch | every currently shipped landmark type | Canvas also implements dormant `museum` and `anchor`, which are outside the enum |
| `PathSurface` | `paved`, `sand` kiosk paths | generated kiosk paths | sound for paths; it should not be overloaded with pier surface classes |
| `Weather` | `sunny`, `sunset`, `storm`, `night` | stages, simulation, renderers, UI | sound enum, still mirrored as JS literals/icons/phase records |
| `RoadClass` | retained OSM + internal road classes | every class currently emitted in tiles | sound enum; width, rank, and “major road” roles are handwritten elsewhere |
| `IslandKind` | `median`, `cuadra` | accepted but currently dormant | keep only while the emitted/client contract still accepts islands |

The enum layer is therefore useful but incomplete. Pydantic validates several
important fields as plain `str`, and JavaScript has no generated equivalent of
the Python enums.

### Confirmed live drift and missing coverage

These are not theoretical duplicate-literal risks; each was confirmed against
the current working tree and shipped manifest.

**All eight were closed on 2026-08-11**, and the findings are kept rather than
deleted because each one records why its own class of bug is invisible. The fix
was not to correct the copies — correcting them by hand is what had already been
done, and is why they drifted. `tools/gen_vocabulary.py` (`pnpm vocabulary`)
reads `churchill/world/enums/` and writes `src/domain/vocabulary.generated.js`
plus `src/assets/vocabulary.generated.json`; the game and the editor consume the
artifact, and `tests/test_vocabulary.py` fails if one goes stale, if the shipped
manifest disagrees with the enum class for class, or if an emitted value has no
renderer implementation. Each item's own resolution follows it.

1. **Surface vocabulary is already divergent.** The authoritative manifest has
   11 classes. `world-editor/src/npcs.js` has only the first 8, the editor Vite
   host validator has the first 10, and the editor surface palettes have 10
   entries. `malecon` is therefore missing from both editor validation and its
   tile palette; `barro`, `gravel`, and `malecon` are missing from the editor's
   NPC placement vocabulary.
   *Resolved:* the editor host reads `vocabulary.generated.json` from the game
   and refuses to start without it; surface palettes carry all 11 entries (class
   10 was painting as `undefined`), and the `npcs.js` list survives only as a
   complete last resort. An editor test that pinned `classes.slice(8)` by hand
   had been failing for a week, blaming the world — it compares against the
   generated vocabulary now.
2. **Raw surface integers bypass the enum.** Water `0`, beach `2`, bridge `5`,
   and acera `6` appear directly in `world2d/index.js`, `game/physics.js`,
   `game/spawns.js`, `game/crossing.js`, `c2d/water.js`, and `c2d/flora.js`.
   Renumbering is forbidden, but raw use still hides intent and makes role-set
   omissions likely.
   *Resolved:* all six read `SURFACE.*`, the local `const CLS_ACERA = 6` in
   `c2d/flora.js` is gone, and a test rejects any new
   `surfaceAt(...) === <number>` in those files.
3. **Road rank tables disagree.** Canvas `ROAD_ORDER` knows pedestrian,
   link, paseo, and bridge classes and gives distinct ranks. The editor table
   omits several classes and collapses others. Client `MAIN_ROAD` and builder
   `MAJOR` are also separate semantic sets; the latter includes `paseo` while
   the former does not.
   *Resolved:* `RENDER_RANK` in the enum layer generates `ROAD_RANK`, which the
   Canvas consumes — and it exposed a gap the audit had not: `living_street` had
   no rank at all, so such a calle would fall to `|| 0` and paint beneath the
   service roads. Latent rather than live, since `docs/map.osm` tags none today,
   which is precisely why it would have shipped. The two role sets stay two
   (`YIELDS_TO`, `TRAFFIC_MAIN`), named for the questions they answer, with a
   test that they never become equal.
4. **Pier style production exceeds validation/render coverage.** The shipped
   manifest contains `concrete`, `timber`, `apron`, `calzada`, and `malecon`.
   Canvas explicitly defines the first four but not `malecon`, so four current
   records fall back to concrete. The editor accepts only `concrete` and
   `timber`, so it cannot accurately validate all generated styles.
   *Resolved:* `PierStyle` (5 members) types `Pier.style`; the editor validates
   against the generated list. `Pier.surface` was `PathSurface | str` — it takes
   `SurfaceName` now, derived from `Surface` rather than retyped — and `seaEnd`
   takes `LineEnd`.
5. **Landmark dispatch exceeds its enum.** Canvas has cases for `museum` and
   `anchor`, but `LandmarkType` has neither. Neither is shipped today, so this
   is latent drift rather than current missing art.
   *Resolved:* both added, and a test requires every one of the 26 types to have
   a dispatch case.
6. **Sign kinds are untyped.** The manifest currently ships `alto`, `banca`,
   `bus`, `crossing`, `semaforo`, and `tope`. The Canvas switch additionally
   supports `ceda`, `semaforo_centered`, `semaforo_overhead`, and
   `speed_limit`. `Sign.kind` is only `str`, so a typo draws nothing.
   *Resolved:* `SignKind` holds all ten the renderer draws — deliberately more
   than the build emits, since art with no value to select it is drift too — and
   `Sign.kind: SignKind` makes a typo fail the build.
7. **The editor parcel palette omits a live enum member.** Two current parcels
   use `market`; Canvas has a market material, while the editor falls back to
   the generic lot color.
   *Resolved:* the editor's `PARCEL_FILL` has `market`, and its use list comes
   from the generated `PARCEL_USE`.
8. **Acera fallbacks conflict.** The current manifest says `aceraPx = 12`.
   Simulation/editor fallbacks use 12, while Canvas/Pixi helpers fall back to 8.
   Modern manifests hide the disagreement, but a missing/stale meta record
   changes collision-adjacent placement and drawing differently.
   *Resolved:* `WORLD2D` resolves `aceraPx` and `cuad` once and owns the only
   legacy defaults (`W.ACERA_PX`, `W.CUAD`); a test walks `src/` and fails if any
   other module reads `meta.aceraPx` for itself.

### Closed vocabularies to add to the enum layer

Priority means enum/schema work, not permission to mechanically replace every
literal in one change.

| Priority | Proposed enum | Values observed or required | Why it is closed |
|---|---|---|---|
| P0 | `StageKind` | `delivery`, `crossing` | changes start flow, required medium, goals, and win condition. **DONE 2026-08-13** (`enums/game.py`; `Stage.kind` is typed now, so a typo fails the build) |
| P0 | `VehicleMedium` | `land`, `water` | collision, spawn, shop fallback, and vehicle picker depend on it. **DONE 2026-08-13** (`enums/game.py`) |
| P0 | `VehicleKind` | `bike`, `car`, `boat` | shared silhouette/renderer dispatch; vehicle IDs remain a registry. **DONE 2026-08-13** (`enums/game.py`) |
| P0 | `SignKind` | `alto`, `banca`, `ceda`, `semaforo`, `semaforo_centered`, `semaforo_overhead`, `speed_limit`, `crossing`, `tope`, `bus` | producer/DTO/renderer must agree or furniture disappears |
| P0 | `PierStyle` | `concrete`, `timber`, `apron`, `calzada`, `malecon` | builder output selects a finite renderer material recipe |
| P0 | `LineEnd` | `first`, `last` | pier `seaEnd` affects stamping, collision, and deck length; null remains “neither” |
| P0 | `HostKind` | `cuadra`, `parcel`, `landmark`, `stadium`, `green` | editor, API validation, builder containment, and NPC hosts repeat it. **DONE 2026-08-13** (`enums/editing.py`) |
| P0 | `GeometryKind` | `point`, `line`, `polygon` | editor project schema and builder patch dispatch both depend on it. **DONE 2026-08-13** (`enums/editing.py`) |
| P0 | `EditorOperation` | `add`, `modify` | source replacement semantics are closed and validated. **DONE 2026-08-13** (`enums/editing.py`) |
| P0 | `RendererBackend` | `canvas`, `pixi` | required by the per-family ownership registry and fallback policy. **DONE 2026-08-13** (`enums/game.py`; the value also sits in a player's localStorage) |
| P1 | `GameMode` | `story`, `arcade`, `explore`, `tutorial` | repeated across mode starts, scoring, timers, UI, results, and analytics |
| P1 | `UIScreen` | `boot`, `intro`, `title`, `stagepick`, `brief`, `modebrief`, `tutbrief`, `vehpick`, `lanchapick`, `playing`, `paused`, `over`, `settings`, `supporters`, `shop` | React's screen state machine is a finite internal vocabulary |
| P1 | `NpcMovement` | `rail`, `bounded-random`, `route`, `stationary` | JSON chooses among code-owned movement algorithms |
| P1 | `FieldSport` | normalized `soccer`, `basketball`, `skateboard`, `baseball`, `tennis` | renderer/editor support is finite even though raw OSM `sport` is open-ended |
| P1 | `CoinType` | `gold`, `silver`, `bonus`, `frozen` | spawning and rendering currently share an implicit palette vocabulary |
| P1 | `EsteroEncounterKind` | `panga`, `fish`, `gulls`, `roots`, `remolino`, `pescador`, `yate`, `banco` | race simulation and renderer use the same finite behavior cases |
| P1 | `CrossingOutcome` | `landed`, `swamped` | determines progression versus failure and must not be a free string |
| P2 | `AmbientVehicleKind` | `car`, `truck`, `bus`, `ferry`, `panga` or separated land/boat enums | Canvas and dormant Pixi make the same size/detail decisions from these values |

`FieldSport` should preserve an optional raw OSM value separately if unknown
sports are useful for diagnostics. The normalized enum should contain only
styles the game actually knows how to draw or simulate.

### Repeated identities that should be registries, not enums

| Repeated identity | Correct authority | Reason not to make it a language enum |
|---|---|---|
| vehicle keys (`scooter`, `panga`, etc.) | `vehicles.json` asset registry — **built 2026-08-13** | designers should add vehicles without extending engine source |
| district, stage, landmark, customer, ferry, and kiosk IDs | world/content registries with reference validation | these are authored records, not engine states |
| NPC type IDs and NPC art IDs | `npcTypes.json` plus an art registry | NPC types are already data-extensible |
| attraction kinds | `feriaAssets.json` schema/registry | the existing shape DSL is the authority and can grow as data |
| editor feature types | feature-schema registry containing geometry/layer/symbol/handler | the editor is explicitly intended to gain new asset families |
| audio event IDs | audio recipe registry | new sounds should not require extending a central enum switch |
| visual family IDs | renderer ownership registry | new families should declare ownership/material contracts as data |
| material, palette, road-role, and surface-role names | versioned material/domain registries | each name carries properties and membership, not just identity |
| languages and translation keys | language/catalog registries | localization is intentionally extensible |

### Repeated numeric contracts to centralize outside enums

| Contract | Repetition found | Proposed authority |
|---|---|---|
| Ferry defaults `124 × 46`, dock offset `28` | builder service, DTO defaults, game fallback, editor patch/UI/server/MCP | one versioned ferry/deck default record; emitted manifest values own each instance |
| Channel tangent span `60` | builder measurement and client lane heading | emit `tangentSpan` with the channel or consume a generated navigation contract |
| Channel pitch `40` | builder `CHANNEL_PITCH`; client fallback `c.pitch || 40` | manifest `channel.pitch`; one named legacy-version fallback only |
| Surface IDs `0/2/5/6` | physics, spawns, crossing, water/flora render code, world accessor/viewer | generated JS `SURFACE.WATER/BEACH/BRIDGE/ACERA` from Python `Surface` |
| `aceraPx` fallback `8` versus `12` | Canvas/Pixi versus simulation/editor | manifest meta required in production; one versioned legacy default |
| Cuadrícula `20` | Python config, Canvas fallback, editor fallback | manifest `meta.cuad`; remove local production fallbacks after compatibility policy |
| Arcade duration `180` | state default, `startArcade`, smoke expectation; `180` also serves editor stage defaults | separate `ARCADE_DURATION_S` and `DEFAULT_STAGE_DURATION_S` to avoid merging different meanings |
| Open-ended timers `999` | Explore and Tutorial | explicit untimed/null policy instead of a magic near-infinity |
| Authored road width `28` | editor creation/rendering and builder patch fallback | editor feature schema default with world-pixel unit |
| Ferry/pier/road dimensions in world px | builder, editor, render fallbacks | unit-tagged asset/config records reviewed during `RESCALE.md` work |
| Road ordering and role membership | Canvas, editor, spawner, sign derivation | `RoadClass`-keyed registry containing render rank and named role flags |
| ~~Surface speed/roles/colors~~ | ~~Python tuples, JS multiplier, Pixi colors, Canvas/minimap/editor palettes~~ | **DONE 2026-08-11** — `src/assets/surfaces.json`, keyed by class name: `speed` + `day`/`night`. Read by `surfaces.js`, Pixi, the dev viewer, `debug_render.py` and the editor. Two of the five copies were wrong (bulevar `#d8d4c8` vs `#d9d6cd`; the viewer knew 7 of 11 and drew the rest magenta) |

The values used only inside a drawing recipe—such as a wheel radius, a shadow
alpha, or a bezier control ratio—belong in that asset's future shape/material
record, not in the enum layer. Truly mathematical values such as `Math.PI * 2`
or interpolation epsilon stay local code.

### Target enum and vocabulary architecture

The Python enum package remains the lowest world layer and wire authority. A
deterministic vocabulary generator should emit browser/editor artifacts from
it rather than maintain handwritten arrays:

**Built on 2026-08-11**, exactly as drawn — `tools/gen_vocabulary.py`, run by
`pnpm vocabulary` and checked by `tests/test_vocabulary.py`:

```text
churchill/world/enums/             # canonical wire/closed world vocabulary
        |
        +-- tools/gen_vocabulary.py   # deterministic, --check mode diffs it
                |
                +-- src/domain/vocabulary.generated.js
                +-- src/assets/vocabulary.generated.json
                +-- world-editor reads the JSON (and dies without it)

content/asset registries ----------> schema validation keyed by enum values
```

It carries `SURFACE` + `SURFACE_CLASSES` + `SURFACE_BY_NAME` + the five
`SURFACE_ROLE` sets, `ROAD_RANK` + two `ROAD_ROLE` sets, and **seventeen** string
vocabularies (ten on 2026-08-11, the seven P0s above on 2026-08-13). The physics
multiplier stays authored in `src/game/surfaces.js` — it is the one surface
property the world does not know — but keyed through `SURFACE` so a class cannot
be silently reassigned.

The enum package is layered by WHO OWNS THE VOCABULARY, not by size:
`enums/surface.py` is the wire format itself, `enums/features.py` is what the
world contains, `enums/game.py` is what the runtime branches on, and
`enums/editing.py` is what the editor authors and the game reads back. The last
one lives here rather than in the editor's own repo for exactly the reason this
whole layer exists — the editor is a separate repository, so a vocabulary it
kept privately would be a handwritten copy by definition.

The generated JavaScript API should expose frozen named maps and sets, for
example `SURFACE.WATER`, `SURFACE_BY_NAME`, `SURFACE_ROLE.DRIVABLE`,
`WEATHER.STORM`, and `STAGE_KIND.CROSSING`. Renderer/material properties should
remain in JSON registries keyed by those values.

Generation must be one-way: JavaScript and the editor consume the artifact and
must not invent additional wire values. An enum value change is a world/schema
change; an enum member-name refactor that preserves its emitted value is not.

### Validation gates to add

The first four are in `tests/test_vocabulary.py` as of 2026-08-11 (`pnpm test`).

- ~~Compare `manifest.grid.classes` byte-for-byte with generated `Surface`
  order.~~ **In place**, in the game and in the editor's own suite.
- ~~Fail when a DTO emits a string outside its enum~~ **in place** — `SignKind`,
  `PierStyle`, `LineEnd`, `SurfaceName` are enum-typed, so the build refuses the
  value rather than the renderer silently drawing nothing — ~~or when a renderer
  dispatch case is absent from the declared enum/asset registry.~~ **In place**
  for signs, pier styles and landmark types.
- ~~Fail when a shipped enum value lacks a renderer implementation~~ **in
  place**; fallback, material, editor label and inventory entry are not yet
  checked.
- ~~Scan game code for raw `surfaceAt(...) === <number>` and reject new uses.~~
  **In place** for the six modules the audit named — and, since 2026-08-13, over
  the whole of `src/` for the runtime tokens too: a bare `.kind === "crossing"`,
  `.medium === "land"`, `veh.kind === "boat"` or `geometry.kind === "…"` fails
  the suite. It earned itself immediately, catching a `crossing.js` comparison
  that the by-hand sweep had missed.
- ~~Compare Canvas, Pixi, minimap, editor, and debug materials by enum key rather
  than array length.~~ **In place for SURFACE materials** (2026-08-11): there is
  one registry, so there is nothing left to compare, and a test rejects any new
  class→colour table. ~~Still open for the non-surface families (structures,
  minimap, props)~~ — **closed 2026-08-13** by `src/assets/materials.json`, which
  covers parcels, greens, the five pier recipes, the street inks, the structure
  roof, the minimap and the editor's terrain presets. The Pixi half of that row
  had already closed itself: the backend has no hex literals at all.
- Validate named role sets: drivable, wall, street, carriageway, calle, major,
  pedestrian, waterborne, and renderer-owner. *Partly*: the five surface role
  sets and the two road ones are generated, so a consumer cannot mistype one;
  their MEMBERSHIP is not asserted against behaviour.
- Generate the supported mode/screen/sign/pier/vehicle vocabularies into
  `inventory.json`, then compare runtime dispatch with that machine index.
- Preserve unknown external OSM values separately; normalize only at the
  boundary where the game selects supported behavior.

### Recommended migration order

1. ~~Add cross-runtime validation tests that expose the current differences
   without changing world output.~~ **Done 2026-08-11** —
   `tests/test_vocabulary.py`, plus `pnpm test` in the game repo.
2. ~~Generate JavaScript surface constants from the Python `Surface` enum and
   replace raw numeric comparisons.~~ **Done 2026-08-11.**
3. ~~Make the editor consume all 11 surface values and the shared parcel/road
   metadata; verify `malecon`, `market`, barro, and gravel previews.~~ **Done
   2026-08-11** — the editor reads the generated JSON for surfaces, pier styles
   and parcel uses. Its ROAD rank table is still its own.
4. ~~Add `StageKind`, `SignKind`, `PierStyle`, `LineEnd`, `VehicleMedium`, and
   `VehicleKind` to the typed contract; resolve the live `malecon` pier style
   fallback deliberately.~~ **Done** — `SignKind`, `PierStyle`, `LineEnd`,
   `SurfaceName` on 2026-08-11 (and the `malecon` deck recipe exists);
   `StageKind`, `VehicleMedium`, `VehicleKind`, `RendererBackend`, `HostKind`,
   `GeometryKind` and `EditorOperation` on 2026-08-13, in two new modules —
   `enums/game.py` for what the runtime branches on and `enums/editing.py` for
   what the editor authors and the game reads back. The generated vocabulary
   carries 17 enums now.

   The `Stage.kind` change is the one worth naming: it was
   `Field(default="delivery", description="delivery | crossing")`, which
   documents a contract without enforcing it. `Manifest.model_validate` runs
   before every write, so a typo now fails the build rather than shipping a
   stage that loads, lists, and starts as a delivery run with no kiosk.
5. Centralize ferry/channel/acera/CUAD compatibility defaults with explicit
   units before executing the rescale plan.
6. Add the remaining simulation/UI enums, then migrate extensible identities to
   schema-validated registries rather than enlarging the enum layer forever.
7. Regenerate `inventory.json`, rebuild/snapshot only where the world contract
   intentionally changes, and smoke-test every renderer/backend combination.

## 14. Required future asset contracts

Every migrated asset family should provide:

1. `schemaVersion` and a stable `id`.
2. Explicit unit system: world px, screen px, metres, radians, seconds, Hz, or
   normalized fraction. Do not rely on field-name folklore alone.
3. A vocabulary enum for every dispatch key.
4. Defaults and bounds validated before runtime.
5. References by stable ID, with unresolved-reference errors.
6. Layer, anchor/origin, bounds, collision proxy, and culling bounds where
   visual geometry affects play.
7. Backend-neutral parts/materials; Canvas, Pixi, editor, preview, and future
   engines consume the same definition.
8. Offline bundled default plus optional runtime override, with an explicit
   merge/replace policy.
9. Editor form metadata and preview support.
10. Inventory extraction so every asset appears automatically in
    `inventory.json` and this document can be checked for drift.

Recommended top-level registries:

```text
src/assets/
  materials.json
  surfaces.json
  vehicles.json
  world-props.json
  actors.json
  audio.json
  hud.json

src/content/
  economy.json
  progression.json
  simulation.json

content/world/                 # Python builder inputs
  districts.json
  landmarks.json
  customers.json
  stages.json
  sites.json
```

This is a target structure, not permission to move files mechanically. Each
family needs a schema, dual-reader migration if necessary, snapshot proof, and
runtime smoke verification.

## 15. Known drift and engine risks

1. **The machine inventory is incomplete for this goal.** It indexes 83
   JavaScript modules and the generated world, but not physical assets, Python
   modules/constants, CSS, Android, tests, or the private editor.
2. **Visual type safety is one-way.** Python enums explain which JS switch must
   agree, but an unknown sign/attraction may draw nothing and an unknown
   landmark can also draw nothing; the enum documentation's claimed generic
   pin fallback is not present in the current Canvas switch. Add cross-runtime
   catalog validation.
3. **Surfaces are duplicated.** The current editor has literal surface arrays;
   its NPC list contains the first eight and its validator/palettes the first
   ten, while the manifest contains eleven. This is the exact class of drift a
   canonical registry prevents.
4. **Canvas, Pixi, minimap, and editor palettes are duplicated.** A material
   change can update the game but leave preview/minimap/fallback inconsistent.
5. **Pixi ownership comments exceed current behavior.** The retained full scene
   says new visuals should land in Pixi, while the shipped gameplay mode is
   landmark-only and `_MIGRATED` is empty. This is not a reason to delete Pixi:
   boot water is active, the full scene/viewer are migration inputs, and Pixi
   water is the planned first rescale family. The engine needs one declared
   backend contract, not comments as ownership.
6. **Vehicle definitions are fragmented.** Stats, physics, economy, silhouette,
   painted detail, delivery cargo, preview, and engine voice are separate.
7. **Stage content is split.** Python owns runtime stage records; translation
   JSON owns localized overlays; crossing conditions live in JS; unlock rules
   also live in code.
8. **World source and render asset are coupled by strings.** `type`, `use`,
   `kind`, `sport`, `style`, and `surface` cross multiple languages without a
   single generated contract.
9. **The private editor is gitignored.** Its schema/tooling is strategically
   important but is not protected by the parent repository's normal review and
   CI unless maintained in its own repository.
10. **Synced/build output is easy to mistake for source.** Android web assets,
    density PNGs, `dist/`, editor exports, backups, screenshots, and debug
    images must remain marked derived/reference-only.

## 16. Verification and inventory maintenance

### For any game or module change

```sh
pnpm inventory
pnpm build
pnpm preview --host 127.0.0.1 --port 8799
node tools/smoke.mjs http://localhost:8799/
```

The smoke run is mandatory for render changes because a runtime ReferenceError
can freeze the frame while a Vite build still succeeds.

For a Canvas/Pixi family migration, also verify the family at the current scale
before combining it with a world rescale. Capture the same representative views
in both backends, record performance on web and Android, confirm only one backend
owns the family per frame, and retain the old implementation until acceptance.

### For a world refactor with no intended output change

```sh
python3 tools/world_snapshot.py rebuild
```

Also compare the stable build log.

### For an intended world change

```sh
pnpm world:build
python3 tools/world_snapshot.py save
pnpm inventory
python3 tools/gen_lotes.py
```

### For the private editor

```sh
cd world-editor
pnpm test
pnpm build
```

### Inventory drift checks to add

- Extend `tools/gen-inventory.mjs` to list physical assets, JSON schemas,
  Python modules, UI screens, audio recipe IDs, renderer asset kinds, and editor
  catalogs.
- Validate every manifest enum against renderer/interpreter registries.
- Validate surface wire IDs/names across Python, game, Pixi, NPC, minimap, and
  editor.
- Report authored code literals by family, not merely line count.
- Mark every file as source, generated, derived, reference, backup, or cache.
- Fail CI when an asset file is unreferenced or when code dispatch has no data
  definition (and vice versa).
- Generate stable sections of this Markdown from `inventory.json`; keep only
  conclusions and migration policy hand-authored.

## 17. Definition of “engine-ready”

The game is ready for a future engine when:

- Every designer-facing object has one schema-validated authority.
- Closed vocabularies are generated from one enum authority; no renderer,
  editor, or tool maintains a handwritten partial mirror.
- World placement and visual asset identity are separate, linked by stable IDs.
- Canvas2D, Pixi, editor previews, UI previews, and the future engine read the
  same asset definitions.
- Every visual family has one explicit gameplay renderer owner per frame; a
  fallback is declared and tested rather than accidentally overdrawn.
- Pixi water preserves the accepted character of the current water across the
  selected rescale, or any deliberate visual differences are documented and
  approved before Canvas water is retired.
- Adding a vehicle, prop, NPC art family, stage, sound, or material does not
  require editing a renderer switch or unrelated simulation module.
- Algorithms remain code and content remains data; JSON does not become an
  unbounded scripting language.
- The generated world stays deterministic and snapshot-verified.
- The automatic inventory proves there are no orphan asset definitions,
  unhandled kinds, missing references, or silent fallbacks.
