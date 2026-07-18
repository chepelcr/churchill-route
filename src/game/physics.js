// Per-frame simulation: driving physics, surface handling, collisions
// (cuadras, buildings, barriers, traffic, pedestrians), delivery proximity,
// melt, camera follow, and entity advancement.
import { WORLD2D as W } from "../world2d/index.js";
import { state, traffic, pedestrians, gulls, boats, trains } from "./state.js";
import { SURFACE_MUL } from "./surfaces.js";
import { input, readInput, pollGamepad, applyTouch } from "./input.js";
import { updateAnimals, maintainStreaming, setSpawnCamera, advanceOnSurface, advanceCarOnRoad, advanceTrain } from "./spawns.js";
import { nearestKiosk, pickCustomer, pickUpChurchill, deliverChurchill, dropChurchill } from "./delivery.js";
import { sfx } from "./audio.js";
import { t } from "../i18n/index.js";
import { tutorialTick } from "./tutorial.js";
import { economy } from "./economy.js";

// surface classes pedestrians walk on (aceras only — never the road)
const PED_CLS = [6];

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

  // Full-body wall probe: the four corners of the car's oriented box (0.8×
  // extents for arcade forgiveness) — a center-only test let half the body
  // sink into aceras. Classes 1 land / 6 acera / 0 water / 2 beach are walls.
  const isWall = (x, y) => { const c = W.surfaceAt(x, y); return c === 1 || c === 6 || c === 0 || c === 2; };
  const hw = veh.w * 0.5 * 0.8, hh = veh.h * 0.5 * 0.8;
  const blockedAt = (x, y, ang = p.a) => {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    return isWall(x + ca * hw - sa * hh, y + sa * hw + ca * hh) ||
           isWall(x + ca * hw + sa * hh, y + sa * hw - ca * hh) ||
           isWall(x - ca * hw - sa * hh, y - sa * hw + ca * hh) ||
           isWall(x - ca * hw + sa * hh, y - sa * hw - ca * hh);
  };

  // turning — during a touch snap window (finger re-placed) the low-speed
  // floor rises so the car pivots instead of trailer-arcing; the held-finger
  // curve is untouched, and both meet at the same top-speed rate (1.3).
  input.snapT = Math.max(0, input.snapT - dt);
  const turning = input.right - input.left;
  const spdFac = Math.min(1, Math.abs(p.speed) / veh.top);
  const turnRate = veh.turn * (input.snapT > 0 ? 0.75 + spdFac * 0.55 : 0.4 + spdFac * 0.9);
  const prevA = p.a;
  p.a += turning * turnRate * dt * (input.brake ? 1.35 : 1);
  // Turning must never sweep the body INTO a wall: once a corner penetrated,
  // both current and previous positions read blocked and the resolver's
  // "drive out" fallback let the car sail straight through the cuadra
  // (the hit-the-acera-twice pass-through bug).
  if (p.a !== prevA && blockedAt(p.x, p.y) && !blockedAt(p.x, p.y, prevA)) p.a = prevA;

  // acceleration (headstart consumable = free turbo for its first seconds)
  const boosting = input.boost || (state.headstartT || 0) > 0;
  const throttle = input.up - input.down * 0.6;
  p.vx += Math.cos(p.a) * veh.accel * throttle * dt;
  p.vy += Math.sin(p.a) * veh.accel * throttle * dt;
  if (boosting) { p.vx *= 1 + 0.7 * dt; p.vy *= 1 + 0.7 * dt; }

  // grip (kill lateral)
  const heading = { x: Math.cos(p.a), y: Math.sin(p.a) };
  const fwd = p.vx * heading.x + p.vy * heading.y;
  const side = -p.vx * heading.y + p.vy * heading.x;
  const grip = veh.grip * (input.brake ? 0.55 : 1) * wetMul;
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
  // turbotank upgrade raises the boost speed cap (1.35 stock → up to 1.55)
  const top = veh.top * surfaceMul * (boosting ? economy.upgradeEffect("turbotank") : 1) * wetMul;
  const sp3 = Math.hypot(p.vx, p.vy);
  if (sp3 > top) { p.vx *= top / sp3; p.vy *= top / sp3; }

  const prevX = p.x, prevY = p.y;
  p.x += p.vx * dt; p.y += p.vy * dt;
  // Solid cuadras + aceras + beach + open water: you drive ONLY the streets
  // (and the pier deck, class 5). Class 1 land, class 6 acera/curb, class 2
  // beach and class 0 water are walls you slide along — kill only the blocked
  // axis so tangential motion carries you. Beach became a wall on user
  // request (beach-classed pockets also let you slip inside cuadras).
  if (blockedAt(p.x, p.y)) {
    const okX = !blockedAt(p.x, prevY);
    const okY = !blockedAt(prevX, p.y);
    if (okX && !okY) { p.y = prevY; p.vy = 0; }
    else if (okY && !okX) { p.x = prevX; p.vx = 0; }
    else if (!blockedAt(prevX, prevY)) {
      p.x = prevX; p.y = prevY; p.vx *= -0.45; p.vy *= -0.45;
      state.cam.shake = Math.max(state.cam.shake, 2);
    } else if (p.freeX !== undefined && Math.hypot(p.x - p.freeX, p.y - p.freeY) < 60) {
      // both ends blocked but we were clear a moment ago: snap back instead of
      // the drive-out fallback (which would carry the car through the cuadra).
      // The distance gate keeps stale positions from a previous run inert.
      p.x = p.freeX; p.y = p.freeY; p.vx = 0; p.vy = 0;
    }
    // else: spawned/teleported inside a block — let it drive out
  } else { p.freeX = p.x; p.freeY = p.y; } // last fully-clear pose
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

  // Combo decay
  if (state.combo > 1) {
    state.comboTimer -= dt;
    if (state.comboTimer <= 0) state.combo = 1;
  }

  advanceEntities(dt, true);

  sfx.engine(p.speed / (veh.top || 1), !!input.boost, state.vehicleKey);
  sfx.drift(p.drift > 0.4 && p.speed > 80 ? p.drift : 0);

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

  // Pedestrians — walk the aceras / road edges; scatter from a speeding player
  for (const pe of pedestrians) {
    pe.ph += dt * 6;
    advanceOnSurface(pe, dt, PED_CLS, 0.03);
    if (withPlayer && Math.abs(pe.x - p.x) < 14 && Math.abs(pe.y - p.y) < 12 && p.speed > 40) {
      for (let i = 0; i < 6; i++) state.particles.push({ x: pe.x, y: pe.y, vx: (Math.random()-0.5)*180, vy: (Math.random()-0.5)*180, life: 0.7, r: 3, c: "#fff" });
      pe.ang += Math.PI * (0.4 + Math.random() * 0.6); // bolt away
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
    b.x += b.vx * dt; b.wake += dt;
    if (b.x < -120) b.x = W.W + 80;
    if (b.x > W.W + 120) b.x = -80;
  }
}
