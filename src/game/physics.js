// Per-frame simulation: driving physics, surface handling, collisions
// (cuadras, buildings, barriers, traffic, pedestrians), delivery proximity,
// melt, camera follow, and entity advancement.
import { WORLD2D as W } from "../world2d/index.js";
import { GAME_MODE, GEOMETRY_KIND, VEHICLE_MEDIUM } from "../domain/vocabulary.generated.js";
import { state, traffic, pedestrians, gulls, boats, trains, schools, gullFlocks, pushFloat } from "./state.js";
import { isTimed } from "./timers.js";
import { SURFACE, SURFACE_MUL } from "./surfaces.js";
import { HULL, hullBankAssist, hullFriction, hullGlance, hullLean, hullPivot, hullTopMul, hullTurn } from "./boat.js";
import { input, readInput, pollGamepad, applyTouch } from "./input.js";
import { updateAnimals, maintainStreaming, setSpawnCamera, advanceOnSurface, advancePed, advanceFieldPed, advanceSwimmer, advanceBeachGames, advanceBeachPlayer, advanceCarOnRoad, advanceEditorRoute, advanceTrain, advanceSchool } from "./spawns.js";
import { advanceBus, advancePassenger, maintainBusStops } from "./buses.js";
import { nearestKiosk, pickCustomer, pickUpOrder, deliverOrder, dropOrder, spoilRate } from "./delivery.js";
import { sfx } from "./audio.js";
import { t } from "../i18n/index.js";
import { tutorialTick } from "./tutorial.js";
import { economy, COINS_PER_PICKUP } from "./economy.js";
import ACTORS from "../assets/actors.json" with { type: "json" };
import SIM from "../content/simulation.json" with { type: "json" };
import { tuning } from "./tuning.js";
import { advanceFerries, carry, deckAt, ferries, muelleAt, routePoint } from "./ferries.js";
import { advanceCrossing, advanceEstero, boostReady, catchFish, crossingState, spendBoost } from "./crossing.js";
import { updateDayCycle , wetGrip } from "./daynight.js";
import { tornadoPull, updateTornado } from "./tornado.js";
import { updateTide } from "./tides.js";
import { updateEditorTriggers } from "./editorGameplay.js";
import { activeEditorBoost, tickEditorBoosts } from "./editorContent.js";

//: TECHO DE SUB-PASOS POR CUADRO. El sub-paso está para que un cuadro lento no
//: deje al carro atravesar una pared (ver el lazo de integración), pero un
//: cuadro CATASTRÓFICO —una pestaña que vuelve de segundo plano con un `dt` de
//: varios segundos— no puede convertirse en cientos de pruebas de colisión.
//: Ocho cubren hasta ~68 px de avance, muy por encima de cualquier cuadro que
//: siga siendo jugable; más allá de eso el sub-paso deja de ser exacto, que es
//: preferible a que se congele.
const SUBSTEP_MAX = 8;

// surface classes pedestrians walk on (aceras only — never the road)
const PED_CLS = [SURFACE.ACERA]; // fallback for free (stadium) peds; rail peds cross via advancePed

//: parqueado, no de paso. Cruzar el estero no puede pasarle a alguien que iba
//: pasando por el muelle a toda.
const PASSAGE_SPEED = 40;

/**
 * LA PUERTA DEL MUELLE — se pregunta al ENTRAR, no mientras se está.
 *
 * La diferencia importa y es la regla que pidió el diseño: al cruzar se sale
 * parado ENCIMA del muelle del otro lado, así que una prueba de «¿estoy en un
 * muelle?» volvería a preguntar en el cuadro siguiente, para siempre. Se
 * compara contra el muelle del cuadro anterior, de modo que la oferta es un
 * FLANCO: hay que salirse y volver a entrar. Lo mismo vale para el «ahorita
 * no», que así no necesita su propia bandera.
 *
 * El sim sólo LEVANTA la oferta; contestarla es de la UI, porque el sim no
 * sabe qué es una pantalla.
 */
function maintainPassageOffer(p) {
  const here = muelleAt(p.x, p.y);
  const was = state.passageMuelle;
  state.passageMuelle = here < 0 ? null : here;
  if (here < 0) { state.passageOffer = null; return; }
  if (was !== null) return;                      // ya estaba aquí: no es un flanco
  if (p.speed > PASSAGE_SPEED) return;           // iba pasando, no parqueando
  state.passageOffer = here;
}

// ----- Polygon collision helpers ------------------------------------------
function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i], yi = pts[i + 1], xj = pts[j], yj = pts[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function nearestEdgePoint(x, y, pts) {
  let bd = Infinity, bx = 0, by = 0;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const x0 = pts[j], y0 = pts[j + 1], x1 = pts[i], y1 = pts[i + 1];
    const dx = x1 - x0, dy = y1 - y0;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = x0 + dx * t, qy = y0 + dy * t;
    const d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy);
    if (d2 < bd) { bd = d2; bx = qx; by = qy; }
  }
  return { x: bx, y: by, d: Math.sqrt(bd) };
}
// Push the player out of a building polygon; returns true on hit.
function collideBuilding(p, b) {
  const inside = pointInPoly(p.x, p.y, b.pts);
  const q = nearestEdgePoint(p.x, p.y, b.pts);
  if (!inside && q.d >= 9) return false;
  let nx, ny;
  if (q.d > 0.0001) {
    nx = (p.x - q.x) / q.d; ny = (p.y - q.y) / q.d;
    if (inside) { nx = -nx; ny = -ny; } // outward through the boundary point
  } else { nx = 0; ny = -1; }
  p.x = q.x + nx * 9; p.y = q.y + ny * 9;
  const vn = p.vx * nx + p.vy * ny;
  if (vn < 0) { p.vx -= vn * 0.95 * nx; p.vy -= vn * 0.95 * ny; } // absorb normal comp (gentle)
  return true;
}

// OLAS on the muelles. You are out over the gulf on a deck with water on both
// sides, so the surf should be the loudest thing there — it is the one calm
// spot on the map, and it is worth making it feel like one.
//
// Deck class alone is not enough: class 5 is also the Mata de Limón bridge and
// the causeway, which are over an estuary, not the sea. So the level comes from
// how far ALONG a muelle you are: 0 at the landward end, full out at the sea
// end, which also gives the ramp something to do as you drive out.
// DJ URTECH. How loud his set is where the player is standing: 1 at the booth,
// 0 past DJ_REACH. Much further than the pool's 340 px on purpose — a sound
// system carries down the whole Paseo, and hearing it before you can see it is
// the point. The curve is squared so the last block is where it really lands.
const DJ_REACH = 640;
function djLevel(p) {
  let best = 0;
  for (const A of W.ATTRACTIONS || []) {
    if (A.kind !== "dj") continue;
    const d = Math.hypot(A.x - p.x, A.y - p.y);
    if (d >= DJ_REACH) continue;
    best = Math.max(best, ((DJ_REACH - d) / DJ_REACH) ** 2);
  }
  return best;
}

function surfLevel(p, surf) {
  if (surf !== SURFACE.BRIDGE) return 0;
  let best = 0;
  // ARCLENGTH ALONG THE MUELLE, whichever one you are on and however it bends:
  // 0 at the shore end, 1 at the sea end. Both piers are polylines now, so this
  // is the same projection per segment rather than one case per singleton.
  for (const P of W.PIERS) {
    const pts = P.pts;
    let run = 0, total = 0;
    for (let i = 0; i < pts.length - 2; i += 2) {
      total += Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1]);
    }
    for (let i = 0; i < pts.length - 2; i += 2) {
      const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = ((p.x - ax) * dx + (p.y - ay) * dy) / l2;
      const qx = ax + dx * t, qy = ay + dy * t;
      if (t >= -0.1 && t <= 1.1 && Math.hypot(p.x - qx, p.y - qy) < P.w) {
        const along = (run + Math.max(0, Math.min(1, t)) * Math.sqrt(l2)) / Math.max(1, total);
        best = Math.max(best, Math.min(1, Math.max(0, along)));
      }
      run += Math.sqrt(l2);
    }
  }
  return best;
}

export function update(dt) {
  if (state.paused || state.over) return;
  tickEditorBoosts(dt, state);
  readInput(); pollGamepad();
  applyTouch(state.cam, state.p, state.veh);

  const p = state.p; const veh = state.veh;
  // FERRIES first, before anything reads the ground. The deck is the only
  // moving surface in the game, so the player has to be carried by it BEFORE
  // the collider runs — otherwise the solver spends the frame pushing them out
  // of the sea the ferry just sailed them into.
  const aboard = deckAt(p.x, p.y);
  // THE TWO GULF FERRIES ARE UNTOUCHED. Park on the Paquera or Playa Naranjo
  // deck, wait, and she still sails you out and home with the car on board —
  // that Easter egg is the reason `deckAt`/`carry` exist and none of the race
  // below has anything to do with it.
  const cross = crossingState();
  advanceFerries(dt, aboard);
  if (aboard) carry(aboard, p);
  // THE TRAVESÍA IS NO LONGER A RIDE ON A DECK. You sail it yourself, in a
  // water-medium vehicle, so the crossing is armed by BEING A BOAT IN THE
  // ESTERO rather than by standing on a hull that is under way. `modes.js`
  // starts it for the crossing stage; in Recorrer, swapping to a lancha at the
  // muelle is what arms it (see `takeTheLancha`).
  state.gullBlind = Math.max(0, (state.gullBlind || 0) - dt);
  state.aboard = aboard ? aboard.id : null;
  // AT SEA. The melt and the surf both key off this, and both are declared up
  // here so neither reads it before it exists (it used to be defined 60 lines
  // below the melt that consumed it). Two ways to be at sea now: riding a gulf
  // ferry under way, or sailing the estero yourself.
  const crossing = (!!aboard && aboard.phase !== "docked") || cross.active;
  // Cast-off / arrival are the only moments the ride has, and without a word
  // for them a ferry leaving under you reads as a bug rather than as the
  // Easter egg firing. The flags are one-shot, cleared as they are consumed.
  for (const f of [aboard]) {
    if (!f) continue;
    if (f.justSailed) { f.justSailed = false; pushFloat(p.x, p.y - 50, "⛴️ " + f.name.toUpperCase(), "#9fd7ef"); }
    if (f.justHome) { f.justHome = false; pushFloat(p.x, p.y - 50, "⚓ PUNTARENAS", "#9fd7ef"); }
  }
  updateDayCycle(dt);          // the sky, when the mode asked for a clock
  updateTide(dt);              // …and the water under it, always
  updateTornado(dt);           // …y el tornado, que sólo existe en las bravas
  const surf = W.surfaceAt(p.x, p.y);
  const onRoad = surf === SURFACE.ROAD || surf === SURFACE.BRIDGE; // road or bridge deck
  const onSand = surf === SURFACE.BEACH;
  const inWater = surf === SURFACE.WATER;
  // A BOAT'S GOOD SURFACE IS THE ONE A CAR DROWNS IN. The water multiplier
  // stays exactly what it is — it describes a CAR in the sea, and a car can
  // still end up there off a deck — but for a hull the estero is the road.
  const afloat = veh.medium === VEHICLE_MEDIUM.WATER;
  const surfaceMul = aboard ? 1.0                       // steel deck
    : afloat ? (surf === SURFACE.WATER ? 1.0 : 0.5)     // aground: she barely moves
    : SURFACE_MUL[surf] !== undefined ? SURFACE_MUL[surf] : 0.78;
  // EL ASFALTO MOJADO, y era casi mentira: `state.weather === "storm" ? 0.92 : 1`
  // — un interruptor sobre el NOMBRE del clima, a 0.92 (que no se siente), y que
  // se apagaba en el mismo cuadro en que escampaba. Ahora sale del CHARCO: entra
  // con la rampa de la tormenta, es 0.82 (resbaloso de sentir, no de perder el
  // carro) y se va secando después, así que la calle sigue traicionera un rato
  // con el cielo ya abierto.
  const wetMul = wetGrip();
  // i-frames after a traffic hit so one collision can't roll the churchill
  // drop every frame of contact
  state.hitT = Math.max(0, (state.hitT || 0) - dt);

  // ---- Collider: capsule vs. the tile grid, by penetration depth ----------
  //
  // Every wall cell is a CELL-px AABB. The car is a CAPSULE (two circles swept
  // along its axis). For a circle vs. an AABB the contact is exact and cheap:
  // clamp the centre into the box to get the closest point q, then n = (c-q)
  // normalised and depth = r - |c-q|. Resolving means pushing out along n by
  // depth and removing the into-wall velocity — nothing else.
  //
  // This replaces a pile of heuristics that could not work:
  //   * an oriented BOX hooked its corners on kerb cells (the tuk-tuk wheels);
  //   * summing the directions of all nearby walls to get a normal CANCELS in a
  //     corridor — water on both sides of a muelle, aceras on both sides of a
  //     calle — which left no normal to slide along;
  //   * so a "corridor?" test fell back to an axis-separated slide, which is
  //     right for the VERTICAL Muelle de Cruceros and wrong for the 45° Muelle
  //     del Faro and every diagonal acera. No threshold fixes that: the two
  //     cases are indistinguishable by normal magnitude.
  // Taking the NEAREST surface instead of a sum removes the whole distinction —
  // axis walls, diagonals, corridors and inside corners are one computation.
  const CELL = (W.META && W.META.cell) || 4;
  // A point ON a ferry deck is never a wall, whatever the raster says under it
  // — and the water one pixel outside the deck still is, which is what gives
  // the rails for free instead of needing a fence of their own.
  // UNCONDITIONAL, not `aboard && …`: gating it on already being aboard is a
  // chicken-and-egg, since the ramp you board across is itself deck.
  const isWall = (x, y) => {
    if (deckAt(x, y)) return false;
    if (W.driveUnderAt(x, y)) return false;
    // BEACH IS NOT A WALL. The world has always said so — `DRIVABLE` in
    // churchill/world/enums/surface.py includes it, and SURFACE_MUL[BEACH] is
    // a speed for driving on sand — but the collider walled it off, so 78,830
    // cells of beach were drivable in the build's own reachability gate and
    // untouchable in the game. The sand is slow and loose, not a barrier.
    const c = W.surfaceAt(x, y);
    // A BOAT'S WORLD IS THE INVERSE OF A CAR'S. Water is the only ground she
    // has, and everything else is a wall — including the muelle deck (BRIDGE),
    // because a pier is something a hull goes AROUND, not a ramp she climbs.
    // Inverting the test rather than listing water's complement is deliberate:
    // the surface classes are append-only, so a class added later is a wall to
    // a boat by default, which is the safe direction to be wrong in.
    if (afloat) return c !== SURFACE.WATER;
    // …and the MALECÓN is a wall to a car, like the acera. It was drivable
    // at 0.55 — "you crawl among people" — which was an attempt to say "this is
    // not really for you" in the only vocabulary the surface table had. The
    // honest version is that a promenade is somewhere people walk. The two
    // Paseo kiosks standing on it are reached by their own stamped calle
    // auxiliar, the bajadas onto the sand are stamped ROAD, and the campo
    // ferial is packed earth, so nothing that has to be reachable went with it.
    return c === SURFACE.LAND || c === SURFACE.ACERA || c === SURFACE.WATER ||
           c === SURFACE.MALECON;
  };
  // On a pier deck the only wall is the surrounding water, so the
  // usual 20% overhang forgiveness reads as "half off the muelle" — probe at
  // near-full extents there so the body can't hang over the edge. A HULL WANTS
  // THE FORGIVENESS BACK: that 0.98 exists for a kerb you can see, and the
  // estero's wall is mangrove that reads as ragged, so a boat brushing it
  // should slide rather than stop.
  const probeF = afloat ? HULL.probeF
    : (aboard || W.surfaceAt(p.x, p.y) === SURFACE.BRIDGE) ? 0.98 : 0.8;
  const hw = veh.w * 0.5 * probeF, hh = veh.h * 0.5 * probeF;
  const BUBBLE_PAD = 1.5;                     // keeps the drawn body off the kerb
  const br = hh + BUBBLE_PAD;                 // bubble radius = half the body width
  const bo = Math.max(0, hw - br);            // ± offset of the two bubble centres

  // Deepest contact of the capsule at (x, y, ang): { depth, nx, ny } or null.
  const contactAt = (x, y, ang = p.a) => {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let best = null;
    for (let e = -1; e <= 1; e += 2) {
      const cx = x + ca * bo * e, cy = y + sa * bo * e;
      const c0 = Math.floor((cx - br) / CELL), c1 = Math.floor((cx + br) / CELL);
      const r0 = Math.floor((cy - br) / CELL), r1 = Math.floor((cy + br) / CELL);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const ax0 = c * CELL, ay0 = r * CELL;
          if (!isWall(ax0 + CELL * 0.5, ay0 + CELL * 0.5)) continue;
          const qx = Math.min(Math.max(cx, ax0), ax0 + CELL);
          const qy = Math.min(Math.max(cy, ay0), ay0 + CELL);
          let dx = cx - qx, dy = cy - qy;
          let d = Math.hypot(dx, dy);
          if (d >= br) continue;
          if (d < 1e-6) {
            // centre buried in the cell: leave by the shallowest face
            const l = cx - ax0, rt = ax0 + CELL - cx, tp = cy - ay0, bt = ay0 + CELL - cy;
            const mn = Math.min(l, rt, tp, bt);
            dx = mn === l ? -1 : mn === rt ? 1 : 0;
            dy = mn === tp ? -1 : mn === bt ? 1 : 0;
            d = 1;
          }
          const depth = br - d;
          if (!best || depth > best.depth) best = { depth, nx: dx / d, ny: dy / d };
        }
      }
      if (bo === 0) break;                    // one bubble covers a stubby body
    }
    return best;
  };
  const blockedAt = (x, y, ang = p.a) => contactAt(x, y, ang) !== null;

  // turning — during a touch snap window (finger re-placed) the low-speed
  // floor rises so the car pivots instead of trailer-arcing; the held-finger
  // curve is untouched, and both meet at the same top-speed rate (1.3).
  input.snapT = Math.max(0, input.snapT - dt);
  const turning = input.right - input.left;
  const spdFac = Math.min(1, Math.abs(p.speed) / (veh.top * tuning.speed));
  // THROTTLE AND BOOST ARE READ HERE, not at the thrust below, because a hull's
  // turn rate depends on them: an outboard pushes water past the rudder the
  // moment you open it. For a car nothing changed — the same two values, a few
  // lines earlier.
  // …and in a crossing the turbo runs on IMPULSO, which you earn by brushing
  // things, taking gates and jumping a yate's wake. Everywhere else it is the
  // ordinary turbo and `boostReady()` answers true.
  const boosting = (input.boost && boostReady())
    || (state.headstartT || 0) > 0 || Boolean(activeEditorBoost(state, "turbo"));
  if (boosting && input.boost) spendBoost(dt);
  // ONE THROTTLE FOR BOTH MEDIA. A hull used to get an idle floor here, which
  // meant she made way with the controls untouched — see `boat.js`.
  const throttle = input.up - input.down * 0.6;
  let turnRate;
  if (afloat) {
    // See `boat.js` for why this is a curve and not a suppression, and for the
    // no-speed/no-turn deadlock the old `pivot = 0` + `0.25 + 0.75*spdFac` made.
    turnRate = veh.turn * hullTurn(spdFac, throttle, boosting, input.brake);
    // …AND SHE PIVOTS TOO. This term used to be the car's alone, on the grounds
    // that a hull with no way on has no steerage — which is true of a boat and
    // false of a game: it left "point her, then go" impossible on water, and the
    // hole was plugged with idle thrust that drove her without being asked. Pay
    // for the pointing directly instead.
    turnRate += veh.turn * hullPivot(p.speed);
  } else {
    turnRate = veh.turn * (input.snapT > 0 ? 0.75 + spdFac * 0.55 : 0.4 + spdFac * 0.9);
    // Pivot-in-place: when nearly stopped, spin fast toward the steer target so
    // a tap turns the car ON ITS OWN AXIS immediately, then it drives off facing
    // the finger (instead of arcing forward to turn). Fades out by ~60px/s.
    turnRate += veh.turn * 1.5 * Math.max(0, 1 - Math.abs(p.speed) / 60);
  }
  const prevA = p.a;
  // The brake's turn bonus is the car's handbrake. A hull gets hers inside
  // `hullTurn` (`driftTurn`), where it belongs with the grip cut it goes with.
  p.a += turning * turnRate * dt * (!afloat && input.brake ? 1.35 : 1);
  // angular velocity (rad/s) this frame — the renderer draws wind swirls around
  // the car when it whips around, scaled by this
  p.av = dt > 0 ? (p.a - prevA) / dt : 0;
  if (afloat) hullLean(p, turning, spdFac, dt);   // heel — renderer only
  // A clear spot the car may be nudged to: its box must be unblocked AND its
  // CENTER must be on a DRIVABLE street (class 3 road / 5 bridge). Requiring
  // drivable-center is what makes unstick nudges safe — they can never place
  // the car in a cuadra/acera/beach (that was the "entering cuadras" bug).
  // For a boat the same rule reads the other way round: the only safe centre is
  // open water. Leaving the street test in place gave a hull NO legal nudge
  // anywhere in the estero, so the shimmy below never fired and she locked
  // against the mangrove exactly like the dead end this guard exists to avoid.
  const clearSpot = (x, y) => {
    if (deckAt(x, y)) return !blockedAt(x, y);
    const c = W.surfaceAt(x, y);
    if (afloat) return c === SURFACE.WATER && !blockedAt(x, y);
    return (c === SURFACE.ROAD || c === SURFACE.BRIDGE) && !blockedAt(x, y);
  };

  // Turning must never sweep the body INTO a wall (that penetration was the
  // pass-through bug). But a flat veto deadlocks narrow streets: with walls
  // on both sides every rotation penetrates, and touch has no reverse — the
  // car locks facing a dead end. So first try a SMALL shimmy onto a drivable
  // spot that gives the rotation room; only veto the turn if none exists.
  if (p.a !== prevA && blockedAt(p.x, p.y) && !blockedAt(p.x, p.y, prevA)) {
    let ok = false;
    for (let rr = 2; rr <= 8 && !ok; rr += 2) {
      for (let k = 0; k < 8; k++) {
        const aa = (k / 8) * Math.PI * 2;
        const nx = p.x + Math.cos(aa) * rr, ny = p.y + Math.sin(aa) * rr;
        if (clearSpot(nx, ny)) { p.x = nx; p.y = ny; ok = true; break; }
      }
    }
    if (!ok) p.a = prevA;
  }

  // WALL CONTACT from the previous frame (the collision response below records
  // the kerb's normal). Sliding along a wall was still ending in a dead stop:
  // the wall removes the into-wall velocity, which leaves the car moving
  // SIDEWAYS relative to a heading that still points at the kerb — and grip
  // then eats exactly that, every frame. So while in contact, thrust is
  // redirected ALONG the kerb and grip is relaxed: you keep driving down the
  // acera like you keep driving down the muelle, instead of stopping dead.
  p.wallT = Math.max(0, (p.wallT || 0) - dt);
  const onWall = p.wallT > 0;

  // acceleration (headstart consumable = free turbo for its first seconds).
  // `boosting` and `throttle` were read up at the turning block — see there.
  let ax = Math.cos(p.a), ay = Math.sin(p.a);
  if (onWall) {
    const an = ax * p.wallNX + ay * p.wallNY;   // wallN points AWAY from the wall
    if (an < 0) { ax -= an * p.wallNX; ay -= an * p.wallNY; }
  }
  // SUBIR CUESTA. `state.grade` es dz/ds firmado en la dirección del vehículo,
  // así que un mismo cerro frena de subida y suelta de bajada con el mismo
  // número y sin una rama. Los topes están porque el campo es interpolado cada
  // 32 m y un artefacto local no puede dejar el carro clavado ni dispararlo.
  const gcfg = SIM.grade;
  const gAccel = Math.max(gcfg.accelMin, Math.min(gcfg.accelMax,
    1 + state.grade * gcfg.accelPerGrade));
  p.vx += ax * veh.accel * tuning.speed * throttle * gAccel * dt;
  p.vy += ay * veh.accel * tuning.speed * throttle * gAccel * dt;
  if (boosting) { p.vx *= 1 + 0.7 * dt; p.vy *= 1 + 0.7 * dt; }

  // grip (kill lateral)
  const heading = { x: Math.cos(p.a), y: Math.sin(p.a) };
  const fwd = p.vx * heading.x + p.vy * heading.y;
  const side = -p.vx * heading.y + p.vy * heading.x;
  const gripBoost = activeEditorBoost(state, "grip-multiplier")?.value || 1;
  // SAND FIGHTS BACK. It is slow through SURFACE_MUL, but a beach that only
  // capped the top speed would drive like a narrow road: the loose surface is
  // what makes it a shortcut you take on purpose rather than by accident.
  // A HULL LETS GO HARDER AND HOLDS ON LONGER. The brake is her drift verb, so
  // it cuts grip past what a handbrake does; and the car's 0.15 wall relax is
  // tuned for a kerb you can see, which makes a boat skate along a ragged
  // mangrove edge instead of running down it.
  // EL TORNADO ES UNA CORRIENTE, igual que el remolino del estero: no choca, tira
  // — y le tuerce la trompa además de moverla, que es lo que lo hace sentir
  // viento y no muro. Se aplica acá, con el resto de las fuerzas, en vez de
  // escribir en `p` desde su propio módulo.
  const twist = tornadoPull(p);
  if (twist) {
    p.vx += twist.ax * dt;
    p.vy += twist.ay * dt;
    p.a += twist.spin * dt;
  }
  const grip = veh.grip * gripBoost * (input.brake ? (afloat ? HULL.driftGrip : 0.55) : 1) * wetMul
    * (onWall ? (afloat ? HULL.wallGrip : 0.15) : 1) * (onSand ? 0.62 : 1);
  const kept = side * (1 - Math.min(1, grip * dt * 6));
  p.vx = heading.x * fwd - heading.y * kept;
  p.vy = heading.y * fwd + heading.x * kept;
  p.drift = Math.abs(side) > 60 ? Math.min(1, p.drift + dt * 3) : Math.max(0, p.drift - dt * 2);

  // rolling friction
  // `drag` is why a boat coasts. Friction is DIVIDED by the surface multiplier,
  // and on open water at mul 1.0 a car's rolling friction stops a hull dead in
  // her own length — which reads as driving through treacle, not as sailing.
  // …and once she is up on the plane there is less of her in the water, which
  // is what turns "hold the throttle" from an instruction into a reward.
  const fric = afloat ? hullFriction(Boolean(input.up || input.down), spdFac)
    : (input.up || input.down) ? 0.4 : 1.8;
  const sp2 = Math.hypot(p.vx, p.vy);
  if (sp2 > 0.1) {
    const k = Math.max(0, sp2 - fric * (veh.drag || 1) * (1 / surfaceMul) * dt * 60) / sp2;
    p.vx *= k; p.vy *= k;
  }
  // Brake / stop button: an EXAGGERATED, snappy stop (arcade handbrake) — bleed
  // the velocity hard so a tap kills momentum near-instantly instead of a slow
  // coast, and clamp to a dead stop once slow.
  // A BOAT STILL HAS NO TYRES — astern thrust bleeds way rather than killing it,
  // which is why the decay is 3.2 against a car's 16. But she DOES come to a
  // stop at the end of it: the dead-stop clamp used to be the car's alone, and a
  // hull that could never quite stop is a hull that is always drifting somewhere
  // you did not steer.
  if (input.brake) {
    const decay = Math.max(0, 1 - (afloat ? 3.2 : 16) * dt);
    p.vx *= decay; p.vy *= decay;
    if (Math.hypot(p.vx, p.vy) < 12) { p.vx = 0; p.vy = 0; }
  }
  // turbotank upgrade raises the boost speed cap (1.35 stock → up to 1.55)
  const speedBoost = activeEditorBoost(state, "speed-multiplier")?.value || 1;
  // Y EL TECHO TAMBIÉN PAGA LA CUESTA, no sólo la aceleración. Con sólo lo
  // segundo una subida larga se acaba corriendo igual de rápido, nada más que
  // tardando en llegar ahí — y una cuesta que no se nota al final no es una
  // cuesta. Un casco no: en el agua no hay pendiente que subir.
  const gTop = afloat ? 1 : Math.max(SIM.grade.topMin, Math.min(SIM.grade.topMax,
    1 + state.grade * SIM.grade.topPerGrade));
  const top = veh.top * speedBoost * tuning.speed * surfaceMul * gTop
    * (boosting ? economy.upgradeEffect("turbotank") : 1) * wetMul
    * (afloat ? hullTopMul(spdFac) : 1);
  const sp3 = Math.hypot(p.vx, p.vy);
  if (sp3 > top) { p.vx *= top / sp3; p.vy *= top / sp3; }

  // THE BANK YOU FEEL BEFORE YOU TOUCH IT. The manglar is still solid — see
  // `isWall`; "no walls" means the estero must not feel FENCED, not that a hull
  // may sail over the mangrove. What it means in practice is this cushion: you
  // are bled off the shore before you reach it. It only ever REMOVES velocity
  // heading into the bank now — see `hullBankAssist` for why pushing was wrong.
  // Before the integration, so it is a force and not a shove.
  if (afloat) hullBankAssist(p, veh, dt, (x, y) => W.surfaceAt(x, y) === SURFACE.WATER);
  // EL PASO SE PARTE, porque la colisión es una CAJA EN EL DESTINO y no un
  // barrido. `contactAt` pregunta «¿estoy dentro de algo AQUÍ?», así que un
  // paso más largo que el cuerpo puede saltarse una pared entera y aparecer
  // limpio del otro lado — el carro atraviesa la manzana y no hay nada en el
  // resolvedor de abajo que pueda enterarse, porque cuando le toca mirar ya no
  // hay contacto.
  //
  // Ya era marginal: a 352 px/s y 30 fps el cuerpo avanzaba 11.7 px contra una
  // cápsula de ~8.5 px de radio. El reescalado a 3.125 px/m subió las
  // velocidades por 1.25 —tenían que subir, o el mismo px/s recorre menos
  // suelo—, así que lo marginal pasaba a ser ordinario. `docs/RESCALE.md` lo
  // dice sin rodeos: el sub-paso es parte de esta tarea, no un follow-up.
  //
  // El tope es el RADIO DE LA CÁPSULA, de modo que dos posiciones consecutivas
  // siempre se solapan y no queda hueco por donde colarse. A 60 fps con las
  // velocidades de hoy esto da UN sub-paso y el código de abajo es literalmente
  // el que había — que es lo que hace el cambio seguro: sólo pagan los cuadros
  // lentos, que son los que tenían el bug.
  // …Y CADA SUB-PASO SE RESUELVE, no se abandona el resto. La primera versión
  // de esto cortaba el lazo en cuanto había contacto y dejaba que el resolvedor
  // de abajo sacara el cuerpo — o sea ACORTABA EL PASO, que es exactamente lo
  // que el comentario de ese resolvedor dice que no se puede hacer («the step
  // is never shortened … which is what keeps the car travelling ALONG a wall
  // instead of stopping on it»).
  //
  // Medido: con la moto en el pasillo de 40 px que baja al kiosco del Paseo,
  // rozando la pared del malecón todo el rato, cada cuadro entregaba 1/subs de
  // su avance y el resto se tiraba. En el navegador headless del smoke —donde
  // el cuadro es largo y `subs` sube a cinco— eso son 82 px en dos segundos con
  // un tope de 288 px/s. No es un mundo mal construido: es el paso acortado.
  const stepPx = Math.hypot(p.vx, p.vy) * dt;
  const subs = Math.min(SUBSTEP_MAX, Math.max(1, Math.ceil(stepPx / Math.max(2, br))));
  let hit0 = null, nx = 0, ny = 0, stuck = null;
  for (let s = 0; s < subs; s++) {
    p.x += (p.vx * dt) / subs;
    p.y += (p.vy * dt) / subs;
    let hit = contactAt(p.x, p.y);
    if (!hit) continue;
    // RESOLVE: push out along the contact normal by the penetration depth,
    // re-measure, repeat. Each pass takes the DEEPEST contact, so an inside
    // corner settles over a couple of iterations instead of needing a special
    // case. Position is never reverted and the step is never shortened — the
    // body is simply moved to the nearest legal pose, which is what keeps the
    // car travelling ALONG a wall instead of stopping on it.
    hit0 = hit;
    for (let i = 0; i < 4 && hit; i++) {
      p.x += hit.nx * (hit.depth + 0.01);
      p.y += hit.ny * (hit.depth + 0.01);
      nx = hit.nx; ny = hit.ny;
      hit = contactAt(p.x, p.y);
    }
    stuck = hit;          // sigue dentro tras cuatro pasadas
  }
  // Solid cuadras + aceras + open water: LAND, ACERA (the kerb) and WATER are
  // the walls you slide along. THE SAND IS NOT ONE — see `isWall` above: beach
  // is drivable, slow and loose, and the MALECON beside it is a wall for a car,
  // like the acera. What keeps you off the beach is that nothing
  // leads there any more except the bajadas, not a wall.
  if (hit0) {
    // La posición ya quedó resuelta arriba, sub-paso a sub-paso; aquí sólo va
    // la respuesta de VELOCIDAD, que es una por cuadro y no una por sub-paso.
    const hit = stuck;
    // Velocity: remove ONLY the component going into the wall. All tangential
    // speed carries, on an axis wall and a 45° one alike.
    // A HULL GLANCES. Removing all of the into-wall velocity is right for a car
    // against a kerb and wrong for a boat against a bank: it stops her dead on a
    // shore she was passing at 15°, which is most of what "the path gets smaller
    // and smaller" felt like. `hullGlance` keeps most of the tangential speed,
    // gives a little of the normal back and swings the bow off — a brush turns
    // you back down the channel, a square-on ram still stops you.
    let hitSpeed = 0;
    if (afloat) {
      hitSpeed = hullGlance(p, nx, ny, dt);
    } else {
      const vn = p.vx * nx + p.vy * ny;
      if (vn < 0) {
        hitSpeed = Math.hypot(p.vx, p.vy);
        p.vx -= vn * nx; p.vy -= vn * ny;
      }
    }
    if (hitSpeed > 220) state.cam.shake = Math.max(state.cam.shake, Math.min(2, hitSpeed / 220));
    // Hand the kerb to the next frame: thrust gets redirected along it and grip
    // is relaxed, so holding the finger into a wall drives you down it.
    p.wallNX = nx; p.wallNY = ny; p.wallT = 0.12;
    // Only if four passes could not free the body (spawned inside geometry, a
    // one-cell pocket) do we fall back — and even then we keep the along-wall
    // speed rather than dead-stopping.
    if (hit && p.freeX !== undefined && Math.hypot(p.x - p.freeX, p.y - p.freeY) < 60) {
      p.x = p.freeX; p.y = p.freeY;
      const vt = p.vx * -ny + p.vy * nx;
      p.vx = -ny * vt * 0.5; p.vy = nx * vt * 0.5;
      if (p.freeA !== undefined) p.a = p.freeA;
    }
    // (record the free pose ONLY on drivable street, so a fallback always lands
    // back on the road, never on a paseo/acera edge)
    // — and for a hull the drivable street IS the water, or the pose is never
    // recorded at all and the pocket fallback above can never fire.
  } else if (afloat ? W.surfaceAt(p.x, p.y) === SURFACE.WATER : W.onRoad(p.x, p.y)) {
    p.freeX = p.x; p.freeY = p.y; p.freeA = p.a;
  }
  p.speed = Math.hypot(p.vx, p.vy);

  // On the 2-D world the coastline is enforced by water-as-wall above, so the
  // old corridor peninsula push-back (topY/botY) is gone. Just clamp to the
  // world rect as a final safety net.
  if (p.x < 12) { p.x = 12; p.vx = Math.abs(p.vx) * 0.3; }
  if (p.x > W.W - 12) { p.x = W.W - 12; p.vx = -Math.abs(p.vx) * 0.3; }
  if (p.y < 12) { p.y = 12; p.vy = Math.abs(p.vy) * 0.3; }
  if (p.y > W.H - 12) { p.y = W.H - 12; p.vy = -Math.abs(p.vy) * 0.3; }
  // The sea shakes a CAR because a car in the sea is a mistake. For a boat it is
  // simply where she lives, and shaking every frame she is afloat would make the
  // whole crossing unreadable.
  if (inWater && !afloat && Math.random() < 0.06) state.cam.shake = Math.max(state.cam.shake, 2);

  // Building collisions (polygon buildings via spatial hash)
  //
  // A `ghost` is a NAMED footprint the builder could not find land for, because
  // this world paints a carriageway at ~3x its real size and on the Paseo's
  // divided avenue that swallows the whole seafront frontage — the Hotel Tioga,
  // Las Brisas, the Parroquia del Carmen. It is drawn at its true outline
  // (a landmark you cannot recognise is not a landmark) but it must not be a
  // wall, or the hotels would fence off the street they stand on.
  for (const b of W.buildingsNear(p.x, p.y)) {
    if (b.ghost) continue;
    const a = b.aabb;
    if (p.x < a.x0 - 9 || p.x > a.x1 + 9 || p.y < a.y0 - 9 || p.y > a.y1 + 9) continue;
    if (collideBuilding(p, b)) {
      state.cam.shake = Math.max(state.cam.shake, 3);
      if (state.carrying && Math.random() < 0.01) dropOrder();
    }
  }

  // LOS JUEGOS DE LA FERIA ESTORBAN — Y REBOTAN.
  //
  // Eran escenografía que el carro atravesaba, y la razón escrita para dejarlos
  // así era que estampar un carrusel sacaría un destino de la red. Esa razón se
  // conserva ENTERA: nada de esto se estampa. La atracción sigue sin existir
  // para el raster, la compuerta de red manejable ni la ve, y el estorbo vive
  // sólo aquí. Por eso un carrusel no puede desconectar un kiosco por
  // construcción, en vez de por medición.
  //
  // Y REBOTA, no frena. Un edificio absorbe 0.95 de la componente normal —te
  // quedás pegado a la pared, que es lo correcto para una pared—; un juego de
  // feria devuelve, como un bumper. `restitution`, `minPush` y el radio salen
  // de `actors.json -> attraction`, del lado del cliente, porque afinar un
  // rebote no puede costar una reconstrucción del mundo.
  const AT = ACTORS.attraction;
  for (const A of W.ATTRACTIONS || []) {
    const rr = (A.r || 24) * AT.radiusScale;
    const dx = p.x - A.x, dy = p.y - A.y;
    const d2 = dx * dx + dy * dy;
    const reach = rr + 9;
    if (d2 > reach * reach) continue;
    const d = Math.sqrt(d2) || 0.0001;
    // Dead centre has no normal to leave by, so pick one rather than divide by
    // zero and launch the car to NaN.
    const nx = d2 > 1e-6 ? dx / d : 0, ny = d2 > 1e-6 ? dy / d : -1;
    p.x = A.x + nx * reach;
    p.y = A.y + ny * reach;
    const vn = p.vx * nx + p.vy * ny;
    if (vn < 0) {
      p.vx -= vn * (1 + AT.restitution) * nx;
      p.vy -= vn * (1 + AT.restitution) * ny;
    } else {
      p.vx += nx * AT.minPush;                 // entró casi sin normal: sacalo
      p.vy += ny * AT.minPush;
    }
    state.cam.shake = Math.max(state.cam.shake, AT.shake);
    sfx.play("bump");
    // CHOCAR CON LA FERIA CUESTA, o estorbar no significa nada.
    if (state.carrying) {
      state.carrying.melt = Math.min(state.carrying.total,
        state.carrying.melt + state.carrying.total * AT.meltPenalty);
    }
  }

  // Barrier collisions (explore mode locked districts)
  // TWO SHAPES OF BARRIER, because they fence two different things.
  //
  // A PROGRESSION barrier is a LINE at a district's western edge: the districts
  // run west to east along the spit, so "you have not opened this one yet" is
  // genuinely a wall across the road, and you may always come back west.
  //
  // The MVP gate is a BOX, one per closed barrio. It used to be a line too —
  // the westernmost locked district's x0 — and that is the wrong shape in a
  // 2-D world: the closed barrios are INLAND and their x-ranges overlap the
  // coastal ones, so the line stood across the costanera and shut El Cocal,
  // Mata de Limón and Caldera, which ship today and hold three of the stages.
  if (state.barriers && state.barriers.length) {
    for (const br of state.barriers) {
      if (br.x0 !== undefined) {
        // Inside a closed barrio: push out by the SHORTEST way back out, so a
        // player who reaches a corner is returned the way they came rather
        // than flung along the box.
        if (p.x < br.x0 || p.x > br.x1 || p.y < br.y0 || p.y > br.y1) continue;
        const dl = p.x - br.x0, dr = br.x1 - p.x, dt = p.y - br.y0, db = br.y1 - p.y;
        const m = Math.min(dl, dr, dt, db);
        if (m === dl) { p.x = br.x0 - 14; p.vx = -Math.abs(p.vx) * 0.4; }
        else if (m === dr) { p.x = br.x1 + 14; p.vx = Math.abs(p.vx) * 0.4; }
        else if (m === dt) { p.y = br.y0 - 14; p.vy = -Math.abs(p.vy) * 0.4; }
        else { p.y = br.y1 + 14; p.vy = Math.abs(p.vy) * 0.4; }
        state.cam.shake = Math.max(state.cam.shake, 8);
        state.storyTip = t("tip.mvpWall");
        continue;
      }
      if (Math.abs(p.x - br.x) < 14) {
        if (p.x > br.x - 14 && p.x < br.x) {
          p.x = br.x - 14; p.vx = -Math.abs(p.vx) * 0.4;
          state.cam.shake = Math.max(state.cam.shake, 8);
          state.storyTip = t("tip.lockedDistrict", { district: br.district.toUpperCase(), n: br.requiredStage });
        } else if (p.x > br.x && p.x < br.x + 14) {
          // can re-enter going west: allow
        }
      }
    }
  }

  // THE RACE, read AFTER the solver. `advanceCrossing` recovers where she got
  // to by projecting onto the route, so it has to see the pose she actually
  // ended the frame at — running it before the collider would score her at a
  // position the collision resolution was about to take back, and a gate could
  // be credited for a line she never held.
  if (cross.active) {
    advanceCrossing(dt, p);
    advanceEstero(dt, p, veh);
  }
  // RECORRER: the muelle is where the road runs out and the lancha starts.
  // Park on the pier and you take your own boat; land at the far shore and you
  // LA PUERTA DEL MUELLE — Recorrer y Arcade, nunca Historia. En una etapa el
  // recorrido ES el nivel, y una puerta que salta media península convierte
  // cualquier objetivo en un atajo. Y sólo en tierra: el que anda en lancha ya
  // puede navegar hasta la otra orilla, que es de lo que trata su mitad del
  // modo — ofrecerle un teletransporte sería ofrecerle saltarse el juego.
  if ((state.mode === GAME_MODE.EXPLORE || state.mode === GAME_MODE.ARCADE) && !afloat) {
    maintainPassageOffer(p);
  } else if (state.passageOffer !== null || state.passageMuelle !== null) {
    state.passageOffer = null; state.passageMuelle = null;
  }

  // District identity: fire a "you entered X" title card when the player
  // crosses into a new band (free-roam modes only), and age out the card.
  if (state.mode === GAME_MODE.EXPLORE || state.mode === GAME_MODE.ARCADE) {
    const d = W.districtAt(p.x, p.y);
    if (d && d.id !== state.district) {
      // suppress the very first assignment (spawn) so it doesn't pop on start
      if (state.district !== null) state.districtToast = { id: d.id, name: d.name, tone: d.tone, t: 0 };
      state.district = d.id;
    }
  }
  if (state.districtToast) {
    state.districtToast.t += dt;
    if (state.districtToast.t > 2.6) state.districtToast = null;
  }

  // Elevation ramp: the barro avenue rides ~1 m above the cross streets, so the
  // car smoothly climbs onto it and ramps back down at each intersection.
  const elevTarget = W.onElevated(p.x, p.y) ? 1 : 0;
  state.elev += (elevTarget - state.elev) * Math.min(1, dt * 5);

  // LA CUESTA, DERIVADA DEL TERRENO. `state.elev` de arriba sigue siendo lo que
  // era: un booleano por NOMBRE de calle que levanta el dibujo 7 px y no toca
  // una sola ecuación. Esto es otra cosa — la cota real del IGN bajo el carro.
  //
  // Y ES LA PENDIENTE FIRMADA EN LA DIRECCIÓN EN QUE VA, no la magnitud: una
  // cuesta que se siente igual de frente y de espaldas no es una cuesta, es un
  // parche de asfalto lento. Por eso se proyecta el gradiente sobre el rumbo.
  const gr = W.groundGradeAt(p.x, p.y);
  const along = gr.dzdx * Math.cos(p.a) + gr.dzdy * Math.sin(p.a);
  state.zM = W.groundZAt(p.x, p.y);
  state.grade += (along - state.grade) * Math.min(1, dt * SIM.grade.smoothing);

  // Drift sparks — dust off a sliding tyre, and SPRAY off a hull that is
  // crabbing. Same emitter, different material: the sandy tan that reads as
  // grit kicked off the barro reads as nothing at all on open water.
  if (p.drift > 0.4 && p.speed > 80) {
    state.particles.push({
      x: p.x - Math.cos(p.a) * 10 + (Math.random() - 0.5) * 6,
      y: p.y - Math.sin(p.a) * 10 + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
      life: afloat ? 0.55 : 0.9,
      r: afloat ? 3 + Math.random() * 4 : 5 + Math.random() * 4,
      c: afloat ? "rgba(226,244,252,0.62)" : "rgba(240,220,180,0.55)",
    });
  }

  // Pickup / delivery
  const nk = nearestKiosk(p);
  if (!state.carrying && nk.lm && nk.d < 38 && p.speed < 60) {
    if (!state.pendingOrder) pickCustomer();
    pickUpOrder(nk.lm);
  }
  if (state.carrying) {
    const c = state.carrying.customer;
    const dc = Math.hypot(p.x - c.x, p.y - c.y);
    if (dc < 36 && p.speed < 80) deliverOrder();
  }
  // consumable timers (armed at run start by modes.js)
  if (state.headstartT > 0) state.headstartT = Math.max(0, state.headstartT - dt);
  if (state.icepackT > 0 && state.carrying) state.icepackT = Math.max(0, state.icepackT - dt);
  if (state.carrying) {
    const heat = state.weather === "sunset" ? 0.9 : state.weather === "storm" ? 1.05 : state.weather === "night" ? 0.7 : 1.0;
    // cooler upgrade slows the melt; an active ice pack pauses it entirely —
    // and so does a ferry crossing. The whole point of the Easter egg is a
    // break, and a 45 s break that costs you the delivery is not one.
    // …Y CADA COMIDA TIENE SU RELOJ. El churchill se derrite manejando; el
    // ceviche corre con el cielo; el vigorón lo aguada la lluvia. `spoilRate`
    // en `delivery.js` elige el modelo por el producto que va en la carga —
    // aquí sólo se junta lo que la FÍSICA sabe (si va en calle) con lo que el
    // jugador compró (la hielera). Sin carga es el churchill, o sea lo de antes.
    const meltRate = (state.icepackT > 0 || crossing || activeEditorBoost(state, "melt-freeze")) ? 0
      : spoilRate(state.veh.melt * economy.upgradeEffect("cooler"), onRoad, heat);
    state.carrying.melt += dt * meltRate;
    if (state.carrying.melt >= state.carrying.total) dropOrder();
  }

  updateEditorTriggers();

  // Camera follow with lookahead scaled to the real view (a fixed 70px
  // exceeded the vertical half-view on short screens), then a HARD clamp so
  // the vehicle can never leave the middle of the screen.
  const cam = state.cam;
  const viewHw = cam.zoom ? (cam.vw / cam.zoom) * 0.5 : 160;
  const viewHh = cam.zoom ? (cam.vh / cam.zoom) * 0.5 : 100;
  const look = Math.min(40, viewHh * 0.35);
  const tx = p.x + Math.cos(p.a) * look;
  const ty = p.y + Math.sin(p.a) * look;
  cam.x += (tx - cam.x) * Math.min(1, dt * 4);
  cam.y += (ty - cam.y) * Math.min(1, dt * 4);
  const maxOx = viewHw * 0.35, maxOy = viewHh * 0.35;
  cam.x = Math.max(p.x - maxOx, Math.min(p.x + maxOx, cam.x));
  cam.y = Math.max(p.y - maxOy, Math.min(p.y + maxOy, cam.y));
  cam.shake = Math.max(0, cam.shake - dt * 22);

  // Stream tiles around the camera and keep camera-local ambient life topped up.
  W.update(cam.x, cam.y);
  setSpawnCamera(cam.x, cam.y);
  maintainStreaming();
  // the paradas near the camera keep their gente esperando (buses.js). Called
  // here rather than from maintainStreaming so spawns.js stays the module the
  // bus logic depends on, and not the other way round as well.
  maintainBusStops(cam.x, cam.y, dt);

  // Tutorial step machine (only set in tutorial mode)
  if (state.tutorial) tutorialTick(dt);

  // Collectable churchill coins belong to EVERY run (Historia, Arcade,
  // Recorrer, tutorial). They stream around the player on drivable ground —
  // including the open stadium pitches (class 3), so coins appear inside the
  // estadios just like Recorrer, no special stadium-coin code needed.
  maintainArcadeCoins(dt);

  // Combo decay
  if (state.combo > 1) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) state.combo = 1;
  }

  advanceEntities(dt, true);

  sfx.engine(p.speed / (veh.top || 1), !!input.boost, state.vehicleKey);
  sfx.drift(p.drift > 0.4 && p.speed > 80 ? p.drift : 0);
  sfx.iceCream(state.vehicleKey === "cart" && !!state.carrying);
  // Water ambience, by WHAT the water is. A park fountain and the Balneario
  // used to share one voice, which meant a sea-water inlet with swimmers in it
  // trickled like a garden jet. Two distances, two beds:
  //   park  → fountain (jet, splash, droplets), audible from ~220px
  //   pool  → pool (lapping + swimmers), audible further out because it is a
  //           whole cuadra of water, not a basin you have to stand next to
  let fdist = Infinity, pdist = Infinity;
  for (const lm of W.LANDMARKS) {
    if (lm.type === "park") fdist = Math.min(fdist, Math.hypot(lm.x - p.x, lm.y - p.y));
    else if (lm.type === "pool") pdist = Math.min(pdist, Math.hypot(lm.x - p.x, lm.y - p.y));
  }
  sfx.fountain(fdist < 220 ? Math.max(0, Math.min(1, (220 - fdist) / 160)) : 0);
  sfx.pool(pdist < 340 ? Math.max(0, Math.min(1, (340 - pdist) / 240)) : 0);
  // OLAS: out on a muelle, and the whole time you are at sea on a ferry — the
  // crossing IS the calm moment, so it gets the loudest surf on the map.
  sfx.waves(crossing ? 1 : surfLevel(p, surf));
  // DJ URTECH, frente a La Takería. Audible much further out than the pool
  // is — because that is what a sound system on the Paseo does — and the level
  // opens his lowpass as well as his gain, so from down the street you get the
  // kick and only up close the whole set.
  sfx.dj(djLevel(p));

  if (state.weather === "storm") state.rainT += dt;

  // THE RUN CLOCK. A run either has one or it does not (`timers.js`), and this
  // asks the clock rather than listing the modes that own one — the list was
  // wrong: Recorrer counted 999 s down and set it back to 999 at zero, a
  // treadmill with no consumer, since the HUD hides the timer there anyway.
  if (isTimed(state)) {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) { state.timeLeft = 0; state.over = true; state.won = false; }
  }
}

// Arcade collectable coins: little churchill coins scattered on the streets
// AROUND the camera (camera-local streaming, like the ambient life). Drive over
// one to bank COINS_PER_PICKUP; the pool tops itself back up and refreshes as
// you roam, so the whole map feels dotted with coins to grab.
const ACOIN_TARGET = 18;        // coins kept alive around the camera
const ACOIN_SPAWN_MIN = 130;    // never drop one on top of the player
const ACOIN_SPAWN_MAX = 1100;   // out to the streamed ring
const ACOIN_KEEP = 1500;        // cull past this (fresh coins as you move on)
const ACOIN_PICK_R = 22;        // grab radius
// COIN RAIN on the estadio / la plaza. It is a treat, not an income stream:
// one burst worth at most ACOIN_RAIN_VALUE, each coin fades after
// ACOIN_RAIN_TTL, and the next burst only comes ACOIN_RAIN_COOLDOWN after the
// last one is gone. Without those three it just printed money.
//
// ONE COIN PER FAN, thrown by the crowd. The burst used to be 30 coins sprayed
// over the bbox, which read as a carpet — a dozen well-spaced SILVER coins,
// each worth many times a street coin, is the same money and looks like a
// celebration. Silver is the tell: gold = ₡10 off the street, silver = loot.
const ACOIN_RAIN_VALUE = 300;   // ₡ per burst (cap, split across the fans)
const ACOIN_RAIN_SPREAD = 34;   // px a coin lands from the fan who threw it
const ACOIN_RAIN_TTL = 11;      // s a rain coin stays before it vanishes
const ACOIN_RAIN_COOLDOWN = 20; // s of quiet after the last one goes
// The stadium/plaza cuadra the point is inside, or null.
function stadiumUnder(x, y) {
  for (const S of W.FIELDS || [])
    if (x >= S.x0 - 60 && x <= S.x1 + 60 && y >= S.y0 - 60 && y <= S.y1 + 60) return S;
  return null;
}
function inFootprint(x, y, S) {
  const f = S.footprint;
  if (!f) return true;
  let inside = false;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const xi = f[i], yi = f[i + 1], xj = f[j], yj = f[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function maintainArcadeCoins(dt) {
  if (!state.arcadeCoins) state.arcadeCoins = [];
  if (!state.editorCoinCooldown) state.editorCoinCooldown = {};
  const arr = state.arcadeCoins, p = state.p, cam = state.cam;
  for (const id of Object.keys(state.editorCoinCooldown)) {
    state.editorCoinCooldown[id] = Math.max(0, state.editorCoinCooldown[id] - dt);
  }
  for (let i = arr.length - 1; i >= 0; i--) {
    const c = arr[i];
    c.t += dt;                                   // spin/bob phase for the renderer
    if (c.rain !== undefined) {                  // rain coins are on a timer
      c.rain -= dt;
      if (c.rain <= 0) { arr.splice(i, 1); continue; }
    }
    if (Math.hypot(p.x - c.x, p.y - c.y) < ACOIN_PICK_R) {
      const val = c.v || COINS_PER_PICKUP;
      economy.addCoins(val);
      state.runCoins = (state.runCoins || 0) + val;
      pushFloat(c.x, c.y - 12, `+₡${val}`, c.silver ? "#dfe6ef" : "#f3c969");
      sfx.play("coin");
      if (c.editorSpawnId) state.editorCoinCooldown[c.editorSpawnId] = c.respawn || 5;
      arr.splice(i, 1); continue;
    }
    if (!c.persistent && Math.hypot(c.x - cam.x, c.y - cam.y) > ACOIN_KEEP) arr.splice(i, 1);
  }
  syncEditorCoinSpawns(arr, cam);
  // ONE BURST AT A TIME, one coin per fan on the pitch (the street spawner only
  // ever drops coins on the ring road) — the reward for going in there to do
  // donuts. The fans already wander the grass well inside the footprint, so
  // throwing from them scatters the burst without a rejection loop.
  state.rainWait = Math.max(0, (state.rainWait || 0) - dt);
  const pitch = stadiumUnder(cam.x, cam.y);
  if (pitch && !state.rainWait && !arr.some((c) => c.rain)) {
    const fans = pedestrians.filter((pe) => pe.stadium === pitch);
    const val = Math.max(COINS_PER_PICKUP,
                         Math.round(ACOIN_RAIN_VALUE / Math.max(1, fans.length)));
    let made = 0;
    for (const fan of fans) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * ACOIN_RAIN_SPREAD;
      const x = fan.x + Math.cos(a) * r, y = fan.y + Math.sin(a) * r;
      // inside the POLYGON, not just its bbox — a diagonal plaza leaves the
      // bbox corners out on the surrounding streets, and those are drivable
      // too, so a surface test alone let the rain fall outside the field
      if (!inFootprint(x, y, pitch)) continue;
      if (Math.hypot(x - p.x, y - p.y) < 60) continue;
      arr.push({ x, y, t: Math.random() * 6, rain: ACOIN_RAIN_TTL, v: val, silver: true });
      made++;
    }
    if (made) state.rainWait = ACOIN_RAIN_TTL + ACOIN_RAIN_COOLDOWN;
  }
  let guard = 0;
  while (arr.length < ACOIN_TARGET && guard++ < ACOIN_TARGET * 5) {
    const a = Math.random() * Math.PI * 2;
    const r = ACOIN_SPAWN_MIN + Math.sqrt(Math.random()) * (ACOIN_SPAWN_MAX - ACOIN_SPAWN_MIN);
    const x = cam.x + Math.cos(a) * r, y = cam.y + Math.sin(a) * r;
    const s = W.surfaceAt(x, y);
    // streets, pier deck, calle peatonal, malecón
    if (s !== SURFACE.ROAD && s !== SURFACE.BRIDGE && s !== SURFACE.BOULEVARD &&
        s !== SURFACE.MALECON) continue;
    if (Math.hypot(x - p.x, y - p.y) < ACOIN_SPAWN_MIN) continue;
    arr.push({ x, y, t: Math.random() * 6 });
  }
}

function editorSpawnPoint(feature) {
  if (feature.geometry.kind === GEOMETRY_KIND.POINT) return feature.geometry.point;
  const points = feature.geometry.points;
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}
function pointInEditorSpawn(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}
function randomEditorCoinPoint(feature, radius) {
  const center = editorSpawnPoint(feature);
  if (feature.geometry.kind === GEOMETRY_KIND.POINT) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
    return [center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r];
  }
  const points = feature.geometry.points;
  const xs = points.map((point) => point[0]), ys = points.map((point) => point[1]);
  for (let attempt = 0; attempt < 40; attempt++) {
    const x = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs));
    const y = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys));
    if (pointInEditorSpawn(x, y, points)) return [x, y];
  }
  return center;
}
function syncEditorCoinSpawns(arr, cam) {
  for (const feature of W.COIN_SPAWNS || []) {
    const properties = feature.properties || {};
    const center = editorSpawnPoint(feature);
    if (Math.hypot(center[0] - cam.x, center[1] - cam.y) > ACOIN_KEEP) continue;
    if ((state.editorCoinCooldown[feature.id] || 0) > 0) continue;
    const wanted = Math.max(1, Math.min(100, Number(properties.count) || 1));
    const live = arr.filter((coin) => coin.editorSpawnId === feature.id).length;
    for (let index = live; index < wanted; index++) {
      const [x, y] = randomEditorCoinPoint(feature, Number(properties.spawnRadius) || 24);
      arr.push({
        x, y, t: Math.random() * 6,
        v: Math.max(1, Number(properties.coinValue) || COINS_PER_PICKUP),
        coinType: properties.coinType || "gold",
        editorSpawnId: feature.id,
        respawn: Math.max(0.25, Number(properties.respawnSeconds) || 5),
        persistent: true,
      });
    }
  }
}

// World-entity advancement (traffic, pedestrians, animals, gulls, boats,
// floats/particles). Also drives the menu attract mode, where there is no
// player: withPlayer=false skips every player-proximity interaction.
export function advanceEntities(dt, withPlayer = true) {
  const p = state.p;

  // Floats / particles
  for (const f of state.floats) { f.t += dt; f.y -= 16 * dt; }
  state.floats = state.floats.filter(f => f.t < f.ttl);
  for (const pt of state.particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.life -= dt; }
  state.particles = state.particles.filter(pt => pt.life > 0);

  // Traffic — lane-follows its road polylines (spawns.js), handing off to a
  // connecting way at intersections; recycled only by the far cull.
  for (const t of traffic) {
    // a bus is the same vehicle on the same road network — it just stops
    if (t.editorRoute) advanceEditorRoute(t, dt);
    else if (t.kind === "bus") advanceBus(t, dt);
    else advanceCarOnRoad(t, dt);
    if (withPlayer && Math.abs(t.x - p.x) < 14 && Math.abs(t.y - p.y) < 10) {
      p.vx -= (t.x - p.x) * 0.35; p.vy -= (t.y - p.y) * 0.35;
      state.cam.shake = Math.max(state.cam.shake, 6);
      // one drop roll per collision event, not per frame of contact
      if (state.hitT <= 0) {
        state.hitT = 1.5;
        if (state.carrying && Math.random() < 0.35) dropOrder();
      }
    }
  }


  // Pedestrians — RAIL-BOUND to a road, walk the aceras + cross (main model);
  // a speeding player makes them bolt across the street
  for (const pe of pedestrians) {
    if (pe.editorRoute) { advanceEditorRoute(pe, dt); pe.ph += dt * 6; }
    else if (pe.stationary) pe.ph += dt * 2;
    else if (pe.bus) advancePassenger(pe, dt);                                   // waiting at / boarding / leaving a parada
    else if (pe.road) advancePed(pe, dt);
    else if (pe.field) advanceFieldPed(pe, dt);                                  // estadio/plaza crowd wandering the pitch
    else if (pe.swim) advanceSwimmer(pe, dt);                                    // balneario swimmers
    else if (pe.game) advanceBeachPlayer(pe, dt);                                // la mejenga on the sand
    else { pe.ph += dt * 6; advanceOnSurface(pe, dt, pe.cls || PED_CLS, 0.03); } // free (surface) peds
    if (withPlayer && Math.abs(pe.x - p.x) < 14 && Math.abs(pe.y - p.y) < 12 && p.speed > 40) {
      for (let i = 0; i < 6; i++) state.particles.push({ x: pe.x, y: pe.y, vx: (Math.random()-0.5)*180, vy: (Math.random()-0.5)*180, life: 0.7, r: 3, c: "#fff" });
      if (pe.road && !pe.crossing) { pe.crossing = true; pe.crossPhase = 0; } // bolt across
    }
  }

  updateAnimals(dt);
  advanceBeachGames(dt);       // the ball each mejenga is played with

  // The heritage train ping-pongs its rail piece (decorative, no collision —
  // the rails aren't drivable)
  for (const tr of trains) advanceTrain(tr, dt);

  // Gulls
  for (const g of gulls) {
    g.x += g.vx * dt; g.y += g.vy * dt; g.ph += dt * 8;
    if (g.x < 0) g.x = W.W; if (g.x > W.W) g.x = 0;
    // Gulls hover over open water; if one drifts over land, steer it back.
    if (!W.inWater(g.x, g.y)) g.vy = -g.vy || 20;
    if (withPlayer && state.carrying && Math.hypot(g.x - p.x, g.y - p.y) < 70 && Math.random() < 0.005) {
      if (Math.random() < 0.3) dropOrder();
    }
  }
  // LAS ORDAS. Una bandada posada deriva despacio; cuando el carro entra en
  // ella ALZA EL VUELO — y eso es el estorbo: la nube te ciega y te puede tumbar
  // el churchill. `gullBlind` y su pintor ya existían para la Travesía y no los
  // usaba nadie más; aquí es exactamente el mismo efecto y no un segundo.
  //
  // Se ESQUIVA, no se atraviesa: por eso el radio es generoso y el aviso es
  // visual (los pájaros se levantan antes de que llegues), no un golpe seco.
  for (const f of gullFlocks) {
    f.x += f.vx * dt; f.y += f.vy * dt;
    f.spooked = Math.max(0, f.spooked - dt);
    const d = Math.hypot(f.x - p.x, f.y - p.y);
    if (withPlayer && d < f.r + 40) {
      f.spooked = 1.2;
      // huyen del carro, no en una dirección inventada
      const k = 26 / (d || 1);
      f.vx += (f.x - p.x) * k * dt; f.vy += (f.y - p.y) * k * dt;
    }
    const sp = Math.hypot(f.vx, f.vy);
    if (sp > 70) { f.vx *= 70 / sp; f.vy *= 70 / sp; }
    for (const b of f.birds) {
      b.ph += dt * (6 + f.spooked * 10);
      b.lift += ((f.spooked ? 1 : 0) - b.lift) * Math.min(1, dt * 4);
    }
    if (withPlayer && d < f.r) {
      state.gullBlind = Math.max(state.gullBlind || 0, 0.55);
      if (state.carrying && Math.random() < 0.012) dropOrder();
    }
  }

  // Boats drift
  for (const b of boats) {
    b.wake += dt;
    if (b.balneario) {                        // leisure boat penned in the inlet
      const B = b.balneario;
      b.x += b.vx * dt;
      if (b.x < B.x0 + 24) { b.x = B.x0 + 24; b.vx = Math.abs(b.vx); }
      if (b.x > B.x1 - 24) { b.x = B.x1 - 24; b.vx = -Math.abs(b.vx); }
      continue;
    }
    b.x += b.vx * dt;
    if (b.x < -120) b.x = W.W + 80;
    if (b.x > W.W + 120) b.x = -80;
  }
  // Los bancos de atún: the shoal drifts, its fleet turns around it, and a boat
  // that runs through the middle gets paid. Only a BOAT — a car cannot reach
  // open water, and a churchill delivery has no business scoring fish.
  const afloatNow = state.veh?.medium === VEHICLE_MEDIUM.WATER;
  for (const sc of schools) {
    advanceSchool(sc, dt);
    if (sc.taken || !afloatNow) continue;
    if (Math.hypot(sc.x - p.x, sc.y - p.y) > sc.r) continue;
    sc.taken = true;
    // In the crossing it feeds the level's own fish count; out in the gulf in
    // Recorrer there is no crossing to score, so it pays coins instead.
    if (crossingState().active) catchFish(6);
    else {
      const coins = 40;
      economy.addCoins(coins);
      state.runCoins = (state.runCoins || 0) + coins;
      pushFloat(p.x, p.y - 40, `+${coins} 🐟`, "#9fd7ef");
    }
  }
}
