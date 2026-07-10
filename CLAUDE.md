# CLAUDE.md

Guidance for Claude Code when working in this repo.

## What this is

**La Ruta del Churchill** — a top-down arcade delivery game set on a faithful,
corridor-unrolled recreation of the Puntarenas peninsula, Costa Rica. You drive a
vehicle, pick up a *churchill* (shaved-ice drink) at a kiosk, and deliver it to a
customer before it melts. Three modes: **Historia** (7 stages), **Arcade** (3-min
free roam), **Recorrer** (open world with unlockable districts).

Design doc: `docs/GAME_DESIGN.md`. Roadmap + milestone tracker: `ROADMAP.md`.

## Toolchain

Vite + pnpm project. Node 20+; get pnpm via `corepack` (or `~/.local/bin/pnpm`).

```
pnpm install
pnpm dev            # HMR dev server (falls back off :8734 if taken)
pnpm build          # -> dist/ (static; GitHub Pages publishes this)
pnpm preview        # serve the production build
pnpm inventory      # regenerate inventory.json
pnpm world:build    # rebuild src/world/data.js from docs/map.osm (deterministic)
```

Deploy: push to `main` → `.github/workflows/deploy.yml` builds with pnpm and
publishes `dist/` to GitHub Pages (https://churchill.jcampos.dev, `CNAME`).

## Architecture (`src/`)

The game is an MVC-ish split. Game logic (the "model") is renderer-agnostic; the
renderer (the "view") lives behind a seam so backends can be swapped.

- `src/main.jsx` — entry: mounts `<App/>`, registers the service worker.
- `src/game/` — simulation + state (renderer-agnostic):
  - `state.js` — the shared mutable `state` singleton + world-entity arrays
    (traffic, pedestrians, gulls, boats, parked, vendors, animals) + `pushFloat`.
  - `vehicles.js`, `surfaces.js` — **pure data, browser-free** (also imported by
    the inventory script; keep them free of `window`/DOM).
  - `input.js` (keyboard/gamepad/touch), `spawns.js`, `delivery.js` (pickup/
    deliver loop + scoring), `physics.js` (`update(dt)`: driving, collisions,
    entity advancement), `progress.js` (localStorage unlocks/barriers),
    `modes.js` (`startArcade`/`startStage`/`startExplore` + setters).
  - `index.js` — **Game facade** + main loop; exports `Game`, mirrors it to
    `window.Game` for the dev tweaks host + console debugging.
- `src/world/` — `data.js` (**generated**, do not hand-edit) + `index.js` (the
  `WORLD` accessor: RLE surface grid decode, `surfaceAt`, road arclength
  samplers, building spatial hash, silhouettes).
- `src/render/` — `Renderer.js` (the seam: `setupCanvas`, `render`) →
  `canvas2d.js` (current Canvas2D backend, extracted from the old engine).
  **Milestone C adds a `pixi/` backend and swaps the one line in `Renderer.js`.**
- `src/ui/` — React: `App.jsx` (screen state machine), `screens/*`
  (Title, StageSelect, HUD, Pause, Results, StageBrief), `TouchControls.jsx`,
  `GameTweaks.jsx`, `tweaks/TweaksPanel.jsx` (reusable dev panel + host bridge).

The UI polls `Game.state` on a rAF tick (state is a live mutable singleton, not
React state) — don't try to make the game state flow through React.

## World pipeline

`tools/build_world.py` reads `docs/map.osm` and emits `src/world/data.js` (an ESM
`export const WORLD_DATA`). It projects real geo onto an 8800×1400 world via a
**corridor-unroll**: x = arclength along the Faro→Caldera spine, y = exaggerated
perpendicular offset. Deterministic (no RNG) — same input → identical output.

Surface grid classes (see `src/game/surfaces.js`): `0 water, 1 land (solid cuadra
interior — blocked in physics), 2 beach, 3 road, 4 paseo, 5 bridge/pier, 6 acera`.

Knobs at the top of `build_world.py`: `TOWN_FRACTION`, `CROSS_EXAG`,
`ROAD_WIDTH_PX`, `BUILDING_SCALE`, `DISTRICT_BOUNDS_GEO`, `LANDMARK_DEFS` /
`CUSTOMER_DEFS` (geo anchors — build fails listing unresolved POIs).

## inventory.json

`pnpm inventory` writes a machine-readable index at repo root: world counts
(roads by class, buildings, landmarks by type, customers, districts, stages),
element catalogs (vehicles, surfaces, districts, stages, landmarks, customers),
and a **module map** (`src/` file → exports + line count). Read it to understand
the game's contents without reading the code. Refresh after world/module changes.

## Conventions

- After changing the world or any module, run `pnpm inventory`.
- Keep `src/game/vehicles.js` and `src/game/surfaces.js` free of DOM/`window` so
  Node (the inventory script) can import them.
- The camera zoom is responsive: `computeZoom` in `src/render/canvas2d.js`
  frames at most `meta.cuadsPerView` (12) cuadrículas of `meta.cuad` (20) px.
- Don't hand-edit `src/world/data.js` — regenerate with `pnpm world:build`.
- Verify game changes by actually running the app (`pnpm dev` + browser), not
  just building — the render loop and physics have no unit tests.
