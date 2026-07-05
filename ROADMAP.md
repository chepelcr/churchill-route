# La Ruta del Churchill — Roadmap

Audit date: 2026-07-05, comparing `docs/GAME_DESIGN.md` against the implementation.
The OSM world pipeline (`tools/build_world.py` → `world-data.js`) and the three
game modes are live; the items below are what remains.

## ✅ Fixed during this audit

- [x] Story-mode deliveries now extend the timer (+10 s / +5 s) as the GDD specifies — previously only Arcade/Recorrer got extensions.
- [x] Recorrer barrier signs now show the correct required stage (stage whose clear unlocks the district) instead of the district's array index.
- [x] `bridge=yes` OSM segments (Río Barranca at El Roble, estero arms on Vía 23) get a concrete deck render + bridge surface class.
- [x] Muelle pier connected to the street grid (drivable network 99% reachable from spawn; the unreachable 1% is canvas-clipped fragments at the top edge outside the play area).

## ✅ City-feel pass — done 2026-07-05 PM

- [x] **Vehicle sprites per type** — bikes (bici/scooter) render as two-wheeler with rider + helmet; cars keep the body/roof/windshield box. Stretch remains: distinct silhouettes per car (tuktuk 3-wheel, pickup bed, cart canopy).
- [x] **More zoom** — engine `ZOOM` 1.8 → 2.4, street-level city driving.
- [x] **Aceras** — surface class 6: 8px sidewalk fringe on all roads in the grid + concrete band render (w+16) + 0.62 traction; synthesized houses front the acera leaving ~6px of visible sidewalk.
- [x] **Solid cuadras** — class-1 land is now a wall with slide-along-edges physics. Drivable: streets/aceras/beach/paseo/bridges/pier + plaza pads stamped under every kiosk, customer, and the Faro plaza. Verified: all 6 kiosks + 18 customers reachable from spawn through the drivable network (97.9% connectivity, pier included).
- [x] **Waiting customer figure** — the active delivery target now renders as a waving person on a concrete pad with a pulse ring (was an invisible point + arrow).
- [x] **Alive city** — pedestrians walk the aceras of every local street (240 cap, Paseo stays densest), ~220 parked cars along curbs (kept clear of kiosks), vendor carts with swaying parasols on the Paseo and beside every kiosk, 14 stray dogs/cats that amble across streets and pause.
- [x] **Vehicle + traffic variations** — player: bici (thin frame + rear cooler box), scooter (deck + leg shield), tuktuk (teardrop 3-wheeler with canopy), cart (striped canopy + freezer lid), pickup (cab + open bed with cooler), turbo (exposed-wheel kart with spoiler). Traffic on main roads mixes cars, box trucks (15%), and orange buses (9%, slower, window rows).
- [ ] Alive city 2: peds react to horn, occasional cyclists, market crowd at the Mercado, night windows lighting up.
- Note: Chrome fully suspends requestAnimationFrame for hidden/occluded windows — game and screenshots pause; not a bug (verified `document.visibilityState === "hidden"` during every observed "freeze").

## 🎯 Gameplay gaps vs the GDD

- [ ] **Audio** — no music or SFX anywhere in the codebase (no `Audio`/`AudioContext` usage). Needs: engine SFX (pickup, deliver, drop, splash, combo), ambient loop, weather layer.
- [ ] **Turbo boost semantics** — GDD says X multiplies current velocity ×1.35 one-shot; implementation is a continuous ramp (`vx *= 1 + 0.7·dt`) plus a ×1.35 speed-cap raise. Decide which feel is wanted and align GDD or code.
- [ ] **Seagull drop chance** — effective ~0.15%/frame (two nested rolls) vs GDD's ~0.5%/frame. Balance decision.
- [ ] **i18n / English mode** — target audience includes international tourists but every UI string is hard-coded Spanish. Needs a string table + language toggle.
- [ ] **Handbrake turn boost** (×1.35 while braking) exists in code but not in the GDD — document or remove.

## 🗺️ World / map roadmap

- [ ] **Mata de Limón bridge span** — the marquee suspension bridge is only ~55 px long because the coast leg is compressed by the x-warp. Add a local scale boost around the estero so stage 6's crossing feels substantial.
- [ ] **Route 27 / Caldera edge** — roads clip abruptly at the canvas east edge; add a stylized "A SAN JOSÉ →" vanishing treatment.
- [ ] **Building density pass 2** — 770 buildings placed; blocks in Barranca/El Roble (north bank) and rural coast are still sparse. Raise synth caps / add second-row placement for deep blocks.
- [ ] **Estero de Puntarenas north bank** — mangrove/wetland texture band along the estero side of the spit (currently plain land).
- [ ] **Named intersections** — El Roble junction and the Angostura narrows could carry signage landmarks like Caldera Bulevar does.

## 📔 GDD updates needed (implemented but undocumented)

- [ ] Drivable **Muelle Nacional pier** (guard hut, lamps, blue rails; class-5 surface).
- [ ] **Boats** — ferries + pangas animate offshore.
- [ ] Landmark types `house`, `beachsign`, `sign`, `civic` render but aren't in the GDD type list; data has 30 landmarks, GDD says 29.
- [ ] Camera **ZOOM = 1.8** and the corridor-unroll map projection (world no longer matches the GDD's original synthetic-profile description).

## 🧹 Technical debt

- [ ] Dead state: `state.rainT`, `state.timeOfDay`, `boat.wake`, unused `Game.pause()` API (React drives pause directly).
- [ ] `weatherColors()` allocated per-object per-frame (drawHills/drawLand/drawEstuary) — cache per frame.
- [ ] `drawLandmark` has no `default:` case — a new landmark type would silently render only its shadow.
- [ ] Touch controls double-gated (JS coarse-pointer check + CSS `min-width:880px` hide) — landscape tablets get a joystick that's attached but invisible.
- [ ] Headless smoke harness lives in a session scratchpad — move `headless.js` into `tools/` and wire a CI check.

## ✅ Completed 2026-07-05 (was "in progress")

- [x] **Pushed to `main`** and deployed: https://churchill.jcampos.dev (GitHub Pages, build_type=workflow; the first run failed racing the legacy-mode switch — re-dispatch succeeded).
- [x] **Vehicles verified** — all 6 GDD vehicles selectable in the UI (`ui.jsx:94` maps every `Game.VEHICLES` entry) with stats matching the GDD table. Only divergence: turbo boost is a ramp, not a one-shot ×1.35 (tracked above).
- [x] **Customer/delivery spread enforced** — c3 was 64px from kiosk 1 (instant deliveries); the pipeline now guarantees every customer ≥150px from all kiosks and ≥120px from other customers (expanding-ring reposition on land within the customer's district), verified zero violations across all 18.

## 🚀 Deployment

- [x] GitHub Actions → GitHub Pages workflow (`.github/workflows/deploy.yml`), deploys on push to `main`.
- [ ] Cache-busting for `world-data.js` (query-string hash) so map updates aren't stale behind CDN cache.
- [ ] PWA manifest + offline cache for beach-wifi play.

## 🔁 How to regenerate the map (for any tool/session)

```
python3 tools/build_world.py        # rebuilds world-data.js + tools/debug_map.png + debug_features.svg
python3 -m http.server 8734         # serve; open http://localhost:8734
```
Knobs at the top of `tools/build_world.py`: `TOWN_FRACTION`, `CROSS_EXAG`, `ROAD_WIDTH_PX`,
`BUILDING_SCALE`, `SYNTH_MAX_TOTAL`, `DISTRICT_BOUNDS_GEO`, `LANDMARK_DEFS`/`CUSTOMER_DEFS`
(geo anchors; build fails listing unresolved POIs). Engine camera zoom: `ZOOM` const in engine.js.
