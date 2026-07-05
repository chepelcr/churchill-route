# La Ruta del Churchill — Roadmap

Audit date: 2026-07-05, comparing `docs/GAME_DESIGN.md` against the implementation.
The OSM world pipeline (`tools/build_world.py` → `world-data.js`) and the three
game modes are live; the items below are what remains.

## ✅ Fixed during this audit

- [x] Story-mode deliveries now extend the timer (+10 s / +5 s) as the GDD specifies — previously only Arcade/Recorrer got extensions.
- [x] Recorrer barrier signs now show the correct required stage (stage whose clear unlocks the district) instead of the district's array index.
- [x] `bridge=yes` OSM segments (Río Barranca at El Roble, estero arms on Vía 23) get a concrete deck render + bridge surface class.
- [x] Muelle pier connected to the street grid (drivable network 99% reachable from spawn; the unreachable 1% is canvas-clipped fragments at the top edge outside the play area).

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

## 🚧 In progress right now (continue here if this session stops)

- [ ] **Commit + push everything to `main`** (`Pacific-Code-Labs/churchill-route`). New/changed: `tools/build_world.py`, `world-data.js`, `world.js`, `engine.js`, `index.html`, `docs/`, `how-look-puntarenas/`, `.github/workflows/deploy.yml`, `.gitignore`, `ROADMAP.md`.
- [ ] **Enable GitHub Pages** with build_type=workflow: `gh api repos/Pacific-Code-Labs/churchill-route/pages -X POST -f build_type=workflow` (PUT if it already exists), then verify the Actions run deploys and the game loads at the Pages URL (all asset paths are relative, so the `/churchill-route/` subpath works).
- [ ] **Vehicle implementation check** — verify all 6 GDD vehicles (bici/scooter/tuktuk/cart/pickup/turbo) are selectable in the UI and their stats match the GDD table (engine.js VEHICLES matches per audit; confirm ui.jsx exposes all 6 in vehicle select).
- [ ] **Customer/delivery placement spread** — deliveries must land at each customer's own spot, not cluster. Suspect: pipeline `nudge_to_land` may snap several nearby geo anchors to the same/adjacent cells, and hand geo anchors sit too close (e.g. c3/c4/c5 on the Paseo ~150 m apart). Verify actual `customers[]` spread in world-data.js, then space the `CUSTOMER_DEFS` geo anchors and add a min-separation assert (≥120 px between customers in the same district) in `tools/build_world.py`. Regenerate + retest.

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
