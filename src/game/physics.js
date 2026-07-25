// Per-frame simulation: driving physics, surface handling, collisions
// (cuadras, buildings, barriers, traffic, pedestrians), delivery proximity,
// melt, camera follow, and entity advancement.
import { WORLD2D as W } from "../world2d/index.js";
import { state, traffic, pedestrians, gulls, boats, trains, pushFloat } from "./state.js";
import { SURFACE_MUL } from "./surfaces.js";
import { input, readInput, pollGamepad, applyTouch } from "./input.js";
import { updateAnimals, maintainStreaming, setSpawnCamera, advanceOnSurface, advancePed, advanceRingPed, advanceSwimmer, advanceCarOnRoad, advanceTrain } from "./spawns.js";
import { nearestKiosk, pickCustomer, pickUpChurchill, deliverChurchill, dropChurchill } from "./delivery.js";
import { sfx } from "./audio.js";
import { t } from "../i18n/index.js";
import { tutorialTick } from "./tutorial.js";
import { economy, COINS_PER_PICKUP } from "./economy.js";
import { tuning } from "./tuning.js";

// surface classes pedestrians walk on (aceras only — never the road)
const PED_CLS = [6]; // fallback for free (stadium) peds; rail peds cross via advancePed

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

export function update(dt) {
  if (state.paused || state.over) return;
  readInput(); pollGamepad();
  applyTouch(state.cam, state.p);

  const p = state.p; const veh = state.veh;
  const surf = W.surfaceAt(p.x, p.y);
  const onRoad = surf === 3 || surf === 5; // road or bridge deck
  const inWater = surf === 0;
  const surfaceMul = SURFACE_MUL[surf] !== undefined ? SURFACE_MUL[surf] : 0.78;
  const wetMul = state.weather === "storm" ? 0.92 : 1;
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
  const isWall = (x, y) => { const c = W.surfaceAt(x, y); return c === 1 || c === 6 || c === 0 || c === 2; };
  // On a pier deck (class 5) the only wall is the surrounding water, so the
  // usual 20% overhang forgiveness reads as "half off the muelle" — probe at
  // near-full extents there so the body can't hang over the edge.
  const probeF = W.surfaceAt(p.x, p.y) === 5 ? 0.98 : 0.8;
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
  let turnRate = veh.turn * (input.snapT > 0 ? 0.75 + spdFac * 0.55 : 0.4 + spdFac * 0.9);
  // Pivot-in-place: when nearly stopped, spin fast toward the steer target so a
  // tap turns the car ON ITS OWN AXIS immediately, then it drives off facing
  // the finger (instead of arcing forward to turn). Fades out by ~60px/s.
  const pivot = Math.max(0, 1 - Math.abs(p.speed) / 60);
  turnRate += veh.turn * 1.5 * pivot;
  const prevA = p.a;
  p.a += turning * turnRate * dt * (input.brake ? 1.35 : 1);
  // angular velocity (rad/s) this frame — the renderer draws wind swirls around
  // the car when it whips around, scaled by this
  p.av = dt > 0 ? (p.a - prevA) / dt : 0;
  // A clear spot the car may be nudged to: its box must be unblocked AND its
  // CENTER must be on a DRIVABLE street (class 3 road / 5 bridge). Requiring
  // drivable-center is what makes unstick nudges safe — they can never place
  // the car in a cuadra/acera/beach (that was the "entering cuadras" bug).
  const clearSpot = (x, y) => { const c = W.surfaceAt(x, y); return (c === 3 || c === 5) && !blockedAt(x, y); };

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

  // acceleration (headstart consumable = free turbo for its first seconds)
  const boosting = input.boost || (state.headstartT || 0) > 0;
  const throttle = input.up - input.down * 0.6;
  let ax = Math.cos(p.a), ay = Math.sin(p.a);
  if (onWall) {
    const an = ax * p.wallNX + ay * p.wallNY;   // wallN points AWAY from the wall
    if (an < 0) { ax -= an * p.wallNX; ay -= an * p.wallNY; }
  }
  p.vx += ax * veh.accel * tuning.speed * throttle * dt;
  p.vy += ay * veh.accel * tuning.speed * throttle * dt;
  if (boosting) { p.vx *= 1 + 0.7 * dt; p.vy *= 1 + 0.7 * dt; }

  // grip (kill lateral)
  const heading = { x: Math.cos(p.a), y: Math.sin(p.a) };
  const fwd = p.vx * heading.x + p.vy * heading.y;
  const side = -p.vx * heading.y + p.vy * heading.x;
  const grip = veh.grip * (input.brake ? 0.55 : 1) * wetMul * (onWall ? 0.15 : 1);
  const kept = side * (1 - Math.min(1, grip * dt * 6));
  p.vx = heading.x * fwd - heading.y * kept;
  p.vy = heading.y * fwd + heading.x * kept;
  p.drift = Math.abs(side) > 60 ? Math.min(1, p.drift + dt * 3) : Math.max(0, p.drift - dt * 2);

  // rolling friction
  const fric = (input.up || input.down) ? 0.4 : 1.8;
  const sp2 = Math.hypot(p.vx, p.vy);
  if (sp2 > 0.1) {
    const k = Math.max(0, sp2 - fric * (1 / surfaceMul) * dt * 60) / sp2;
    p.vx *= k; p.vy *= k;
  }
  // Brake / stop button: an EXAGGERATED, snappy stop (arcade handbrake) — bleed
  // the velocity hard so a tap kills momentum near-instantly instead of a slow
  // coast, and clamp to a dead stop once slow.
  if (input.brake) {
    const decay = Math.max(0, 1 - 16 * dt);
    p.vx *= decay; p.vy *= decay;
    if (Math.hypot(p.vx, p.vy) < 12) { p.vx = 0; p.vy = 0; }
  }
  // turbotank upgrade raises the boost speed cap (1.35 stock → up to 1.55)
  const top = veh.top * tuning.speed * surfaceMul * (boosting ? economy.upgradeEffect("turbotank") : 1) * wetMul;
  const sp3 = Math.hypot(p.vx, p.vy);
  if (sp3 > top) { p.vx *= top / sp3; p.vy *= top / sp3; }

  p.x += p.vx * dt; p.y += p.vy * dt;
  // Solid cuadras + aceras + beach + open water: you drive ONLY the streets
  // (and the pier deck, class 5). Class 1 land, class 6 acera/curb, class 2
  // beach and class 0 water are walls you slide along. Beach became a wall on
  // user request (beach-classed pockets also let you slip inside cuadras).
  const hit0 = contactAt(p.x, p.y);
  if (hit0) {
    // RESOLVE: push out along the contact normal by the penetration depth,
    // re-measure, repeat. Each pass takes the DEEPEST contact, so an inside
    // corner settles over a couple of iterations instead of needing a special
    // case. Position is never reverted and the step is never shortened — the
    // body is simply moved to the nearest legal pose, which is what keeps the
    // car travelling ALONG a wall instead of stopping on it.
    let hit = hit0, nx = hit.nx, ny = hit.ny;
    for (let i = 0; i < 4 && hit; i++) {
      p.x += hit.nx * (hit.depth + 0.01);
      p.y += hit.ny * (hit.depth + 0.01);
      nx = hit.nx; ny = hit.ny;
      hit = contactAt(p.x, p.y);
    }
    // Velocity: remove ONLY the component going into the wall. All tangential
    // speed carries, on an axis wall and a 45° one alike.
    const vn = p.vx * nx + p.vy * ny;
    if (vn < 0) {
      const hitSpeed = Math.hypot(p.vx, p.vy);
      p.vx -= vn * nx; p.vy -= vn * ny;
      if (hitSpeed > 220) state.cam.shake = Math.max(state.cam.shake, Math.min(2, hitSpeed / 220));
    }
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
  } else if (W.onRoad(p.x, p.y)) { p.freeX = p.x; p.freeY = p.y; p.freeA = p.a; }
  p.speed = Math.hypot(p.vx, p.vy);

  // On the 2-D world the coastline is enforced by water-as-wall above, so the
  // old corridor peninsula push-back (topY/botY) is gone. Just clamp to the
  // world rect as a final safety net.
  if (p.x < 12) { p.x = 12; p.vx = Math.abs(p.vx) * 0.3; }
  if (p.x > W.W - 12) { p.x = W.W - 12; p.vx = -Math.abs(p.vx) * 0.3; }
  if (p.y < 12) { p.y = 12; p.vy = Math.abs(p.vy) * 0.3; }
  if (p.y > W.H - 12) { p.y = W.H - 12; p.vy = -Math.abs(p.vy) * 0.3; }
  if (inWater && Math.random() < 0.06) state.cam.shake = Math.max(state.cam.shake, 2);

  // Building collisions (polygon buildings via spatial hash)
  for (const b of W.buildingsNear(p.x, p.y)) {
    const a = b.aabb;
    if (p.x < a.x0 - 9 || p.x > a.x1 + 9 || p.y < a.y0 - 9 || p.y > a.y1 + 9) continue;
    if (collideBuilding(p, b)) {
      state.cam.shake = Math.max(state.cam.shake, 3);
      if (state.carrying && Math.random() < 0.01) dropChurchill();
    }
  }

  // Barrier collisions (explore mode locked districts)
  if (state.barriers && state.barriers.length) {
    for (const br of state.barriers) {
      if (Math.abs(p.x - br.x) < 14) {
        if (p.x > br.x - 14 && p.x < br.x) {
          p.x = br.x - 14; p.vx = -Math.abs(p.vx) * 0.4;
          state.cam.shake = Math.max(state.cam.shake, 8);
          state.storyTip = br.mvp
            ? t("tip.mvpWall")
            : t("tip.lockedDistrict", { district: br.district.toUpperCase(), n: br.requiredStage });
        } else if (p.x > br.x && p.x < br.x + 14) {
          // can re-enter going west: allow
        }
      }
    }
  }

  // District identity: fire a "you entered X" title card when the player
  // crosses into a new band (free-roam modes only), and age out the card.
  if (state.mode === "explore" || state.mode === "arcade") {
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

  // Drift sparks
  if (p.drift > 0.4 && p.speed > 80) {
    state.particles.push({
      x: p.x - Math.cos(p.a) * 10 + (Math.random() - 0.5) * 6,
      y: p.y - Math.sin(p.a) * 10 + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
      life: 0.9, r: 5 + Math.random() * 4, c: "rgba(240,220,180,0.55)",
    });
  }

  // Pickup / delivery
  const nk = nearestKiosk(p);
  if (!state.carrying && nk.lm && nk.d < 38 && p.speed < 60) {
    if (!state.pendingOrder) pickCustomer();
    pickUpChurchill(nk.lm);
  }
  if (state.carrying) {
    const c = state.carrying.customer;
    const dc = Math.hypot(p.x - c.x, p.y - c.y);
    if (dc < 36 && p.speed < 80) deliverChurchill();
  }
  // consumable timers (armed at run start by modes.js)
  if (state.headstartT > 0) state.headstartT = Math.max(0, state.headstartT - dt);
  if (state.icepackT > 0 && state.carrying) state.icepackT = Math.max(0, state.icepackT - dt);
  if (state.carrying) {
    const heat = state.weather === "sunset" ? 0.9 : state.weather === "storm" ? 1.05 : state.weather === "night" ? 0.7 : 1.0;
    // cooler upgrade slows the melt; an active ice pack pauses it entirely
    const meltRate = state.icepackT > 0 ? 0
      : state.veh.melt * (onRoad ? 1.0 : 1.25) * heat * economy.upgradeEffect("cooler");
    state.carrying.melt += dt * meltRate;
    if (state.carrying.melt >= state.carrying.total) dropChurchill();
  }

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
  // Park fountains + the Balneario pool trickle as you get near (loudest
  // within ~60px, fades by 220)
  let fdist = Infinity;
  for (const lm of W.LANDMARKS) {
    if (lm.type !== "park" && lm.type !== "pool") continue;
    const d = Math.hypot(lm.x - p.x, lm.y - p.y);
    if (d < fdist) fdist = d;
  }
  sfx.fountain(fdist < 220 ? Math.max(0, Math.min(1, (220 - fdist) / 160)) : 0);

  if (state.weather === "storm") state.rainT += dt;

  // Arcade timer (also stage timer)
  if (state.mode === "arcade" || state.mode === "story") {
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) { state.timeLeft = 0; state.over = true; state.won = false; }
  }
  if (state.mode === "explore") {
    // Long, generous timer — encourages cruising
    state.timeLeft -= dt;
    if (state.timeLeft <= 0) state.timeLeft = 999;
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
const ACOIN_RAIN_VALUE = 300;   // ₡ per burst (cap)
const ACOIN_RAIN_TTL = 11;      // s a rain coin stays before it vanishes
const ACOIN_RAIN_COOLDOWN = 20; // s of quiet after the last one goes
// The stadium/plaza cuadra the point is inside, or null.
function stadiumUnder(x, y) {
  for (const S of W.STADIUMS || [])
    if (x >= S.x0 - 60 && x <= S.x1 + 60 && y >= S.y0 - 60 && y <= S.y1 + 60) return S;
  return null;
}
function maintainArcadeCoins(dt) {
  if (!state.arcadeCoins) state.arcadeCoins = [];
  const arr = state.arcadeCoins, p = state.p, cam = state.cam;
  for (let i = arr.length - 1; i >= 0; i--) {
    const c = arr[i];
    c.t += dt;                                   // spin/bob phase for the renderer
    if (c.rain !== undefined) {                  // rain coins are on a timer
      c.rain -= dt;
      if (c.rain <= 0) { arr.splice(i, 1); continue; }
    }
    if (Math.hypot(p.x - c.x, p.y - c.y) < ACOIN_PICK_R) {
      economy.addCoins(COINS_PER_PICKUP);
      state.runCoins = (state.runCoins || 0) + COINS_PER_PICKUP;
      pushFloat(c.x, c.y - 12, `+₡${COINS_PER_PICKUP}`, "#f3c969");
      sfx.play("coin");
      arr.splice(i, 1); continue;
    }
    if (Math.hypot(c.x - cam.x, c.y - cam.y) > ACOIN_KEEP) arr.splice(i, 1);
  }
  // one burst at a time, sprayed ACROSS the pitch (the street spawner only ever
  // drops coins on the ring road) — the reward for going in there to do donuts
  state.rainWait = Math.max(0, (state.rainWait || 0) - dt);
  const pitch = stadiumUnder(cam.x, cam.y);
  if (pitch && !state.rainWait && !arr.some((c) => c.rain)) {
    const n = Math.floor(ACOIN_RAIN_VALUE / COINS_PER_PICKUP);
    let g2 = 0, made = 0;
    while (made < n && g2++ < n * 8) {
      const x = pitch.x0 + Math.random() * (pitch.x1 - pitch.x0);
      const y = pitch.y0 + Math.random() * (pitch.y1 - pitch.y0);
      const s = W.surfaceAt(x, y);
      if (s !== 3 && s !== 5) continue;
      if (Math.hypot(x - p.x, y - p.y) < 60) continue;
      arr.push({ x, y, t: Math.random() * 6, rain: ACOIN_RAIN_TTL });
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
    if (s !== 3 && s !== 5) continue;            // streets + pier deck only (drivable)
    if (Math.hypot(x - p.x, y - p.y) < ACOIN_SPAWN_MIN) continue;
    arr.push({ x, y, t: Math.random() * 6 });
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
    advanceCarOnRoad(t, dt);
    if (withPlayer && Math.abs(t.x - p.x) < 14 && Math.abs(t.y - p.y) < 10) {
      p.vx -= (t.x - p.x) * 0.35; p.vy -= (t.y - p.y) * 0.35;
      state.cam.shake = Math.max(state.cam.shake, 6);
      // one drop roll per collision event, not per frame of contact
      if (state.hitT <= 0) {
        state.hitT = 1.5;
        if (state.carrying && Math.random() < 0.35) dropChurchill();
      }
    }
  }

  // Pedestrians — RAIL-BOUND to a road, walk the aceras + cross (main model);
  // a speeding player makes them bolt across the street
  for (const pe of pedestrians) {
    if (pe.road) advancePed(pe, dt);
    else if (pe.ring) advanceRingPed(pe, dt);                                    // stadium fans on the graderías
    else if (pe.swim) advanceSwimmer(pe, dt);                                    // balneario swimmers
    else { pe.ph += dt * 6; advanceOnSurface(pe, dt, pe.cls || PED_CLS, 0.03); } // free (surface) peds
    if (withPlayer && Math.abs(pe.x - p.x) < 14 && Math.abs(pe.y - p.y) < 12 && p.speed > 40) {
      for (let i = 0; i < 6; i++) state.particles.push({ x: pe.x, y: pe.y, vx: (Math.random()-0.5)*180, vy: (Math.random()-0.5)*180, life: 0.7, r: 3, c: "#fff" });
      if (pe.road && !pe.crossing) { pe.crossing = true; pe.crossPhase = 0; } // bolt across
    }
  }

  updateAnimals(dt);

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
      if (Math.random() < 0.3) dropChurchill();
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
}
