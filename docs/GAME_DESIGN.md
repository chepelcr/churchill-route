# La Ruta del Churchill — Game Design Document

> *¡Pura vida, mae!* — Arcade delivery game set on the Puntarenas peninsula, Costa Rica.

---

## Core Concept

You are a Churchill delivery person in Puntarenas. A **Churchill** is a Costa Rican shaved-ice drink. Pick them up at kiosks along the Paseo de los Turistas, then race to reach customers before the ice melts. The game combines top-down arcade driving, a time-pressure delivery loop, and a drift/combo system layered over a faithful recreation of the real Puntarenas peninsula.

---

## The World

The map is an 8800 × 1400 world-space canvas representing the actual Puntarenas sand spit — a long, narrow peninsula that tapers to a point at El Faro in the west and widens toward Caldera in the east.

### Districts (west → east)

| # | ID | Name | Character |
|---|---|---|---|
| 1 | `faro` | El Faro | Narrow tip, lighthouse, no cross-streets |
| 2 | `carmen` | Carmen | Ferry terminal, cruise pier, first kiosk zone |
| 3 | `paseo` | Paseo de los Turistas | Wide promenade boulevard, palm trees, hotels, tourist hub |
| 4 | `centro` | Centro Puntarenas | Dense grid, market, cathedral, tight calles |
| 5 | `playitas` | Barrio Las Playitas | Stadium, yacht club, sparser layout |
| 6 | `cocal` | Barrio El Cocal | Quieter, longer stretches, coastal park |
| 7 | `mata` | Mata de Limón | Suspension bridge, mangrove estuary, village |
| 8 | `caldera` | Caldera Bulevar | Port, train station, Ruta 27, mainland |

### Street Layout

- **Avenidas (E–W):** Av. 3 (north), **Ruta 17 / Av. Central** (main spine, densest traffic), Av. 2 (south), **Av. 4 / Paseo** (pedestrian promenade).
- **Calles (N–S):** Denser in Centro (C.1, C.3, C.5…), sparser in outer districts.
- Roads give full speed; the Paseo slows you to 55%; beach gives 70%; water drops to 35%.

### Special Geography

- **Puente de Mata de Limón** — suspension bridge crossing the estuary; narrow deck, towers, catenary cables.
- **Estero de Mata de Limón** — mangrove lagoon cut into the mainland; counts as water (slows + hazard).
- **Hills** behind Mata de Limón/Caldera visible as a background band.

---

## Game Modes

### Historia (Story)

Seven sequential stages unlocked one at a time. Each stage locks you to a specific set of kiosks and customers, sets the weather, and gives a delivery target and time limit. Clearing a stage unlocks the next district in Explore mode and saves progress to `localStorage`.

| Stage | Name | District | Weather | Target | Time |
|---|---|---|---|---|---|
| 1 | El Faro | Carmen | Sunny | 3 | 90 s |
| 2 | Paseo de los Turistas | Paseo | Sunny | 4 | 120 s |
| 3 | Mercado y Catedral | Centro | Sunny | 4 | 130 s |
| 4 | Atardecer en Las Playitas | Playitas | Sunset | 5 | 140 s |
| 5 | Tormenta en El Cocal | Cocal | Storm | 5 | 160 s |
| 6 | Puente · Mata de Limón | Mata | Night | 4 | 150 s |
| 7 | Caldera · Final | Caldera | Sunny | 4 | 170 s |

Player spawns near the first kiosk of each stage. Each successful delivery in story mode extends the timer (+10 s for ≥60% cold; +5 s otherwise).

### Arcade

3-minute free-roam across the whole peninsula. No stage restrictions — all kiosks and all 18 customers are in play. Timer extensions apply as in story mode. No district barriers.

### Recorrer (Explore)

Open-world mode with a near-infinite timer (resets to 999 s when it hits zero). Districts beyond what you've unlocked are blocked by striped barriers; you need to clear the corresponding story stage to pass. Delivery timer extensions are slightly more generous (+12/+6 s).

---

## Core Delivery Loop

```
Kiosk → [slow to < 60 px/s, within 38 px] → AUTO PICKUP
Churchill melts while you drive
Customer → [slow to < 80 px/s, within 36 px] → AUTO DELIVER
```

1. A customer is randomly assigned when you approach a kiosk (or after each delivery).
2. On pickup, a **melt timer** starts — its length scales with the kiosk-to-customer distance (minimum 18 s), so longer routes give more time.
3. The melt bar drains. At 0% remaining the Churchill drops, combo resets, and you have to return to a kiosk.
4. On delivery, score and combo are awarded, the next customer is assigned, and the cycle repeats.

### Melt Rate Factors

| Factor | Effect |
|---|---|
| Vehicle `melt` stat | Base rate (0.55 cart → 1.3 turbo kart) |
| Off-road surface | +25% melt penalty |
| Sunny | ×1.0 |
| Sunset | ×0.9 (slower) |
| Storm | ×1.05 (faster) |
| Night | ×0.7 (slower) |

---

## Scoring

```
total = round((250 + speed × 0.4 + (1 − meltPct) × 500) × combo)
```

- **Base:** 250 pts per delivery.
- **Speed bonus:** your speed at delivery × 0.4.
- **Melt bonus:** up to +500 for a fully cold Churchill; 0 if nearly melted.
- **Combo multiplier:** applied on top of everything.
- **Perfect:** melt < 25% → "PERFECTO!" float; otherwise no extra scoring but combo still grows.

### Score Rank (Results Screen)

| Rank | Threshold |
|---|---|
| S — LEYENDA PORTEÑA | > 6 000 |
| A — Maestro Churchillero | > 3 500 |
| B — Repartidor del Paseo | > 1 800 |
| C — Aprendiz del kiosco | > 800 |
| D — Se te derritió todo | ≤ 800 |

---

## Combo System

- Starts at ×1, caps at ×8.
- **Grows** by 1 on each delivery where melt < 40%.
- **Decays** to ×1 after 7 seconds without a delivery.
- **Resets** to ×1 immediately if the Churchill melts (dropped).

---

## Vehicles

| Key | Name | Top Speed | Accel | Turn | Grip | Melt Rate | Kind |
|---|---|---|---|---|---|---|---|
| `bici` | Bicicleta + cooler | 270 | 240 | 3.5 | 0.86 | 0.7 | bike |
| `scooter` | Scooter retro | 350 | 330 | 3.1 | 0.78 | 1.0 | bike |
| `tuktuk` | Tuk-tuk porteño | 320 | 290 | 2.8 | 0.74 | 0.9 | car |
| `cart` | Mini carrito helado | 290 | 260 | 2.5 | 0.70 | 0.55 | car |
| `pickup` | Pickup pescador | 410 | 370 | 2.4 | 0.68 | 1.1 | car |
| `turbo` | Turbo Churchill Kart | 540 | 500 | 3.2 | 0.62 | 1.3 | car |

- **Grip** controls how much lateral slip bleeds off per frame. Low grip = more drift.
- **Melt** multiplies the base melt rate. The cart is the safest cooler; the turbo kart is the riskiest.
- The `X` turbo boost multiplies current velocity by ×1.35 and overrides the top-speed cap while held.

---

## Physics Summary

- **Turning** scales with speed (faster = tighter turn response).
- **Drift** builds when lateral slip exceeds 60 px/s; holding Space/Shift reduces grip to 55% (handbrake drift).
- **Friction** is higher when neither accelerating nor braking.
- **Surfaces:** road 1.0×, off-road 0.78×, beach 0.7×, paseo 0.55×, water 0.35×.
- Storm weather multiplies all traction by 0.85.
- **Water entry** triggers camera shake; too far into water bounces you back.
- **Building collisions** bounce with velocity reversal; 6% chance to drop the Churchill.
- **Speed lines** render on screen above 240 px/s as a visual cue.

---

## Hazards

| Hazard | Effect |
|---|---|
| **Traffic** (Ruta 17 dense, Av.2/3 lighter) | Collision pushes player; ~18% chance to drop Churchill |
| **Pedestrians** (Paseo promenade) | Scatter on impact; particle burst |
| **Seagulls** (over water) | Within 70 px while carrying: ~0.5% chance per frame to drop Churchill (~30% chance per encounter) |
| **Buildings** | Solid collision; 6% drop chance |
| **Churchill melt** | Automatic drop at 0% ice remaining |
| **District barriers** (Explore mode) | Physical wall; shows required stage number |

---

## Weather Conditions

| Condition | Visual | Traction | Melt | Timer extensions |
|---|---|---|---|---|
| `sunny` | Sky gradient + shimmer | ×1.0 | ×1.0 | standard |
| `sunset` | Orange/pink palette | ×1.0 | ×0.9 | standard |
| `storm` | Dark tones + rain animation | ×0.85 | ×1.05 | standard |
| `night` | Dark vignette + window glow | ×1.0 | ×0.7 | standard |

---

## Landmarks & Kiosks

There are 29 landmarks spread across all districts. Six are active **kiosks** — the only pickup points:

| ID | Name | District |
|---|---|---|
| `kios_paseo1` | Kiosco Doña Lela | Paseo |
| `kios_paseo2` | Churchill El Mariachi | Paseo |
| `kios_centro` | Kiosco La Porteña | Centro |
| `kios_play` | Kiosco Playitas | Playitas |
| `kios_cocal` | Kiosco El Cocal | Cocal |
| `kios_mata` | Kiosco Mata de Limón | Mata |

Other landmark types (visual / atmosphere): lighthouse, ferry, cruise pier, church, cathedral, market, supermarket, hotel, park, stadium, marina, museum, estuary, restaurant, train station, port, bridge, village, highway sign.

---

## Customers (Delivery Destinations)

18 characters spread across the peninsula, each with a unique line:

| ID | Name | District | Line |
|---|---|---|---|
| c1 | Don Beto, pescador | Carmen | *¡Antes que se derrita, mae!* |
| c2 | Crucerista alemana | Carmen | *Eine Churchill, bitte!* |
| c3 | Carnaval troupe | Paseo | *Para los muchachos del baile.* |
| c4 | Familia tica | Paseo | *Cuatro, con extra leche.* |
| c5 | Surfista canadiense | Paseo | *Make it extra red, dude.* |
| c6 | Padre Ramírez | Centro | *Bendito churchill.* |
| c7 | Vendedor de ceviche | Centro | *Cambio: ceviche x churchill.* |
| c8 | Doña del mercado | Centro | *Rojito bien fuerte.* |
| c9 | Niño con bici | Centro | *¡El mío con piña!* |
| c10 | Equipo de fútbol | Playitas | *Once. Es broma. Tres.* |
| c11 | Doña del rocking chair | Playitas | *Como en los años 80.* |
| c12 | Yatista gringo | Playitas | *Best churchill ever, man.* |
| c13 | Pareja en mirador | Cocal | *Para ver el atardecer.* |
| c14 | Camionero de Ruta 17 | Cocal | *Rápido, voy pa' Caldera.* |
| c15 | Pescadores del estero | Mata | *Justo antes de la lluvia.* |
| c16 | Cocineros de Leda | Mata | *Postre para los clientes.* |
| c17 | Maquinista del tren | Caldera | *Salgo al amanecer, mae.* |
| c18 | Estibador del Puerto | Caldera | *Cargando contenedor.* |

---

## Controls

| Input | Action |
|---|---|
| W / ↑ | Accelerate |
| S / ↓ | Reverse / brake |
| A / ← | Steer left |
| D / → | Steer right |
| Space / Shift | Handbrake (drift) |
| X | Turbo boost |
| P / Escape | Pause / resume |
| Gamepad left stick | Steer + throttle |
| Gamepad A / RT | Accelerate |
| Gamepad X | Brake |
| Gamepad RB | Boost |
| Touch (coarse pointer) | Virtual joystick + gas/brake pedals |

---

## HUD Elements

- **Score** — running total.
- **Combo** — current multiplier (×1–×8).
- **Timer** — countdown in seconds; turns red/urgent below 20 s. Explore mode shows "RECORRER" instead.
- **Stage progress** — `stageDeliveries / stageTarget` in story mode; total delivery count otherwise.
- **District tab** — current district name with its color swatch.
- **Story tip** — contextual text (stage brief, current objective, error feedback).
- **Melt bar** — shows customer name, % ice remaining, and a quip that escalates with urgency.
- **Minimap** (top-right) — peninsula silhouette with district labels, player dot (yellow), and target dot (white = kiosk, pink = customer).
- **Objective arrow** — on-screen directional pointer that switches color based on current goal.

---

## Progression & Persistence

- Progress is saved in `localStorage` under the key `churchill_progress_v1`.
- Cleared stage IDs and best score are stored.
- Starting unlocks: `faro` and `carmen` districts.
- Clearing stage *N* unlocks the stage's `unlock` district **and** the following stage's district as a stretch bonus.
- In Explore mode, locked districts show physical barriers with orange cones and a "⛔ BLOQUEADO / ETAPA N" sign.
- A "Resetear progreso" button in the Stage Select screen wipes progress back to defaults.

---

## Tech Stack

| Layer | Technology |
|---|---|
| World data | `world.js` — plain JS IIFE, exposes `window.WORLD` |
| Game engine | `engine.js` — plain JS IIFE, exposes `window.Game`, runs `requestAnimationFrame` loop |
| Rendering | HTML5 Canvas 2D, DPR-aware, camera follow with lookahead + shake |
| UI / Screens | React 18 (`ui.jsx`, compiled by Babel standalone) |
| Tweaks panel | `tweaks-panel.jsx` — floating live-edit panel for weather and vehicle |
| Fonts | Bungee, Space Grotesk, JetBrains Mono (Google Fonts) |
| Input | Keyboard, Gamepad API, touch events |
| Persistence | `localStorage` |

---

## Scenarios in Detail

### Scenario A — Perfecto Run (high score)

Fast vehicle (pickup or turbo), Ruta 17 full-throttle, kiosk → customer in under 40% melt, back-to-back deliveries before 7 s combo decay. Combo caps at ×8 and each "PERFECTO!" delivery scores ~3 500–4 000 pts.

### Scenario B — Tormenta (Stage 5)

Reduced traction forces wider cornering lines. Melt rate slightly higher. Rain animation reduces visibility. Pedestrians and traffic still present. The player must balance speed (to counter-act melt) against the 0.85× grip penalty.

### Scenario C — Night Crossing (Stage 6)

Night vignette darkens the edges. Melt rate drops to 0.7×, giving more delivery time. The challenge is navigating the Puente de Mata de Limón — a narrow deck where going off-road into the estuary water triggers heavy slowdown and potential drops.

### Scenario D — Explore Barriers

In Recorrer mode, the player starts unlocked only in El Faro and Carmen. Each district entry west → east is gated by a physical barrier. To unlock Paseo the player must clear Stage 1, Centro needs Stage 2, etc. This creates a natural progression pressure even in "free roam."

### Scenario E — Seagull Sabotage

Seagulls patrol the water bands above and below the peninsula. When you carry a Churchill near a gull (within 70 px), each frame rolls a 0.5% chance to trigger a drop (~30% chance per second of proximity). Fast crossing or road-centered routing avoids them; low-grip drifting into the water edge invites them.
