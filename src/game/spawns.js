// World-entity spawning for the streamed 2-D world (WORLD2D). Because only the
// tiles around the camera are resident, ambient life (traffic, pedestrians,
// vendors, animals, gulls, boats) is maintained *camera-local*: entities are
// spawned near the camera on resident surfaces, advance by heading each frame,
// and are recycled when they hit a wall or drift out of range. This replaces the
// old global arclength model (place-once across the whole corridor via ROADS +
// roadPointAt), which cannot work when most of the map isn't loaded.
import { WORLD2D as W } from "../world2d/index.js";
import { traffic, pedestrians, gulls, boats, parked, vendors, animals, trains } from "./state.js";

// how far from the camera we keep life alive / spawn it (world px)
const KEEP_R = 1400;
const SPAWN_R = 1100;
const SPAWN_MIN = 300; // keep spawns outside the visible view (half-diagonal ≈ 230)
// target populations near the camera (tuned to the corridor build's feel:
// sidewalks full of people, streets with light town traffic)
const TARGET = { traffic: 14, pedestrians: 64, vendors: 10, animals: 8, gulls: 16, boats: 6, trains: 1 };
const CAR_PALETTE = ["#9bc4d4", "#f4d77a", "#e85d75", "#6fbf99", "#caa089", "#fff", "#3a3a48", "#f08a5d"];

// the camera the maintenance centres on (set each frame by physics)
const _cam = { x: 0, y: 0 };
export function setSpawnCamera(x, y) { _cam.x = x; _cam.y = y; }

// --- surface sampling among resident tiles -------------------------------
// A random world point near (cx,cy) whose surface class is in `classes`.
function sampleNear(cx, cy, classes, rMin, rMax) {
  for (let i = 0; i < 48; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rMin + Math.sqrt(Math.random()) * (rMax - rMin);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (classes.includes(W.surfaceAt(x, y))) return { x, y };
  }
  return null;
}
const far = (e) => Math.hypot(e.x - _cam.x, e.y - _cam.y) > KEEP_R;

// --- traffic: lane-following along the road POLYLINES ---------------------
// Cars ride the per-tile road centerlines (arclength advance + a lane offset
// to their driving side) instead of wandering the surface grid, so they stay
// aligned with the street and never cut across junctions diagonally.
const MAIN_ROAD = new Set(["trunk", "trunk_link", "primary", "primary_link", "secondary"]);

// Interpolated point + tangent angle at arclength s along a prepped road.
function roadPointAt(r, s) {
  const pts = r.pts, cum = r.cum;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const s0 = cum[i - 1], seg = cum[i] - s0 || 1;
  const t = Math.max(0, Math.min(1, (s - s0) / seg));
  const x0 = pts[(i - 1) * 2], y0 = pts[(i - 1) * 2 + 1];
  const x1 = pts[i * 2], y1 = pts[i * 2 + 1];
  return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, ang: Math.atan2(y1 - y0, x1 - x0) };
}
// Place the car at its (road, s, dir, lane): right-hand side of travel.
function placeCarOnRoad(c) {
  const pt = roadPointAt(c.road, c.s);
  const a = c.dir > 0 ? pt.ang : pt.ang + Math.PI;
  c.x = pt.x + Math.cos(a + Math.PI / 2) * c.lane;
  c.y = pt.y + Math.sin(a + Math.PI / 2) * c.lane;
  c.ang = a;
}
// Roads end at OSM way ends — i.e. intersections, which are constantly
// on-screen (the view is only ~400 world px wide). Cars must never die there:
// they hand off to a connecting way, or U-turn at a true dead end, and are
// only ever recycled by the far() cull.
const EPS_JOIN = 3; // ways share exact integer endpoints; min road spacing is 20px
function roadEndpoint(r, atStart) {
  const p = r.pts;
  return atStart ? { x: p[0], y: p[1] } : { x: p[p.length - 2], y: p[p.length - 1] };
}
// A road spanning tiles is duplicated whole into each tile: same geometry,
// distinct objects. Same length + same endpoints = the same way.
function sameRoadGeometry(a, b) {
  if (Math.abs(a.len - b.len) > EPS_JOIN) return false;
  const a0 = roadEndpoint(a, true), a1 = roadEndpoint(a, false);
  const b0 = roadEndpoint(b, true), b1 = roadEndpoint(b, false);
  return Math.hypot(a0.x - b0.x, a0.y - b0.y) <= EPS_JOIN &&
         Math.hypot(a1.x - b1.x, a1.y - b1.y) <= EPS_JOIN;
}
// Connecting ways at the endpoint the car is exiting through. No minimum
// length here: short *_link stubs are exactly what joins roads up.
function findNextRoad(c) {
  const E = roadEndpoint(c.road, c.dir < 0);
  const tiles = W.visibleTiles(E.x - 8, E.y - 8, E.x + 8, E.y + 8);
  const cands = [];
  const seen = (r2) => cands.some((k) => sameRoadGeometry(k.road, r2));
  for (const t of tiles)
    for (const r2 of t.roads) {
      if (r2 === c.road || r2.cls === "pedestrian") continue;
      if (sameRoadGeometry(r2, c.road) || seen(r2)) continue;
      const b0 = roadEndpoint(r2, true), b1 = roadEndpoint(r2, false);
      if (Math.hypot(b0.x - E.x, b0.y - E.y) <= EPS_JOIN) cands.push({ road: r2, dir: 1 });
      else if (Math.hypot(b1.x - E.x, b1.y - E.y) <= EPS_JOIN) cands.push({ road: r2, dir: -1 });
    }
  if (!cands.length) return null;
  return cands[(Math.random() * cands.length) | 0];
}
export function advanceCarOnRoad(c, dt) {
  if (!c.road) { c.dead = true; return; }
  c.s += c.v * dt * c.dir;
  if (c.s <= 0 || c.s >= c.road.len) {
    const over = c.s <= 0 ? -c.s : c.s - c.road.len;
    const next = findNextRoad(c);
    if (next) {
      c.road = next.road; c.dir = next.dir;
      c.s = next.dir > 0 ? Math.min(next.road.len, over)
                         : Math.max(0, next.road.len - over);
      c.lane = next.road.w >= 30 ? next.road.w / 4 : 0;
      if (!MAIN_ROAD.has(next.road.cls) && c.v > 76) c.v = 48 + Math.random() * 28;
    } else {
      c.dir *= -1; // true dead end: ping-pong like the train
      c.s = Math.max(0, Math.min(c.road.len, c.s));
    }
  }
  placeCarOnRoad(c);
}

function spawnOneCar() {
  // candidate roads on resident tiles near the camera (skip footpaths/stubs)
  const tiles = W.visibleTiles(_cam.x - SPAWN_R, _cam.y - SPAWN_R, _cam.x + SPAWN_R, _cam.y + SPAWN_R);
  const cand = [];
  for (const t of tiles)
    for (const r of t.roads) {
      if (r.cls === "pedestrian" || r.len < 140) continue;
      cand.push(r);
    }
  if (!cand.length) return null;
  const r = cand[(Math.random() * cand.length) | 0];
  const main = MAIN_ROAD.has(r.cls);
  const car = {
    road: r, s: 20 + Math.random() * (r.len - 40),
    dir: Math.random() < 0.5 ? 1 : -1,
    lane: r.w >= 30 ? r.w / 4 : 0, // wide street: keep to your side; narrow: center
    v: main ? 70 + Math.random() * 40 : 48 + Math.random() * 28,
    color: CAR_PALETTE[(Math.random() * CAR_PALETTE.length) | 0],
    w: main ? 27 : 23, h: main ? 13 : 12, kind: "car",
    x: 0, y: 0, ang: 0,
  };
  if (main) {
    const roll = Math.random();
    if (roll < 0.15) { car.kind = "truck"; car.w = 33; car.h = 13; }
    else if (roll < 0.24) { car.kind = "bus"; car.w = 41; car.h = 14; car.color = "#e0762e"; car.v *= 0.85; }
  }
  placeCarOnRoad(car);
  // Off-range OR on-screen (view half-diagonal ≈ 230): never materialize in view.
  const d = Math.hypot(car.x - _cam.x, car.y - _cam.y);
  if (d > SPAWN_R || d < SPAWN_MIN) return null;
  return car;
}
// Pedestrians walk the aceras ALONG the streets (the corridor build's model):
// pick a road near the camera, offset to the mid-acera beside it, and walk
// parallel to it. Random-point sampling can't find the thin acera fringe.
// Pedestrians are RAIL-BOUND to a road (main-branch model): they walk its
// arclength at a fixed mid-acera offset and occasionally cross to the other
// sidewalk. Position is always road + perpendicular offset, so they never
// wander into a cuadra interior (the free-surface wander did).
function spawnOnePed() {
  const tiles = W.visibleTiles(_cam.x - SPAWN_R, _cam.y - SPAWN_R, _cam.x + SPAWN_R, _cam.y + SPAWN_R);
  const cand = [];
  for (const t of tiles)
    for (const r of t.roads) {
      if (r.cls === "bridge" || r.len < 80) continue;
      cand.push(r);
    }
  if (!cand.length) return null;
  const r = cand[(Math.random() * cand.length) | 0];
  const s = 20 + Math.random() * (r.len - 40);
  const pt = roadPointAt(r, s);
  const baseOff = r.w / 2 + 10; // mid-acera (1 cuadrícula deep)
  for (const side of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
    const x = pt.x - Math.sin(pt.ang) * baseOff * side;
    const y = pt.y + Math.cos(pt.ang) * baseOff * side;
    if (W.surfaceAt(x, y) !== 6) continue; // that side has no sidewalk here
    if (Math.hypot(x - _cam.x, y - _cam.y) > SPAWN_R) return null;
    return {
      road: r, s, side, baseOff, off: side * baseOff,
      v: (Math.random() < 0.5 ? 1 : -1) * (14 + Math.random() * 12),
      crossing: false, crossPhase: 0,
      x, y, hue: (Math.random() * 360) | 0, ph: Math.random() * Math.PI * 2,
    };
  }
  return null;
}
// Advance a rail-bound pedestrian along its road (main-branch walk + cross).
export function advancePed(pe, dt) {
  const r = pe.road;
  if (!r) { pe.dead = true; return; }
  pe.ph += dt * 6;
  if (pe.crossing) {
    pe.crossPhase += dt * 0.72;
    const tt = Math.min(1, pe.crossPhase);
    pe.off = pe.side * pe.baseOff * (1 - 2 * tt); // slide across the road
    if (tt >= 1) { pe.crossing = false; pe.side = -pe.side; pe.off = pe.side * pe.baseOff; }
  } else {
    pe.s += pe.v * dt;
    if (pe.s < 10) { pe.s = 10; pe.v = Math.abs(pe.v); }
    else if (pe.s > r.len - 10) { pe.s = r.len - 10; pe.v = -Math.abs(pe.v); }
    if (Math.random() < 0.0016) { pe.crossing = true; pe.crossPhase = 0; }
  }
  const pt = roadPointAt(r, pe.s);
  pe.x = pt.x - Math.sin(pt.ang) * pe.off;
  pe.y = pt.y + Math.cos(pt.ang) * pe.off;
  pe.ang = pe.v >= 0 ? pt.ang : pt.ang + Math.PI;
}
function spawnOneVendor() {
  const pt = sampleNear(_cam.x, _cam.y, [6, 2], 150, SPAWN_R); // acera or beach apron
  if (!pt) return null;
  return { x: pt.x, y: pt.y, hue: 10 + ((Math.random() * 320) | 0), ph: Math.random() * 6 };
}
function spawnOneAnimal() {
  const pt = sampleNear(_cam.x, _cam.y, [6, 3, 2], 120, SPAWN_R);
  if (!pt) return null;
  return { x: pt.x, y: pt.y, ang: Math.random() * Math.PI * 2, pause: Math.random() * 3,
           cat: Math.random() < 0.4, ph: Math.random() * 6, v: 26 };
}
// --- trains on the old Ferrocarril rails ---------------------------------
// A little heritage train (loco + 2 wagons) runs the disused rail line.
// Rails are per-tile polylines without arclength tables — build them lazily.
const WAGON_GAP = 40;
function railPrep(rl) {
  if (rl.cum) return rl;
  const p = rl.pts, cum = [0];
  for (let i = 2; i < p.length; i += 2) {
    cum.push(cum[cum.length - 1] + Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]));
  }
  rl.cum = cum; rl.len = cum[cum.length - 1];
  return rl;
}
function spawnOneTrain() {
  const tiles = W.visibleTiles(_cam.x - SPAWN_R, _cam.y - SPAWN_R, _cam.x + SPAWN_R, _cam.y + SPAWN_R);
  const cand = [];
  for (const t of tiles) for (const rl of t.rails || []) {
    if (railPrep(rl).len > 500) cand.push(rl);
  }
  if (!cand.length) return null;
  const rl = cand[(Math.random() * cand.length) | 0];
  const tr = {
    rail: rl,
    s: WAGON_GAP * 2 + Math.random() * (rl.len - WAGON_GAP * 4),
    dir: Math.random() < 0.5 ? 1 : -1,
    v: 52 + Math.random() * 16,
    cars: [], x: 0, y: 0,
  };
  poseTrain(tr);
  if (Math.hypot(tr.x - _cam.x, tr.y - _cam.y) > SPAWN_R + 200) return null;
  return tr;
}
function poseTrain(tr) {
  tr.cars.length = 0;
  for (let k = 0; k < 3; k++) {
    const s = Math.max(0, Math.min(tr.rail.len, tr.s - tr.dir * WAGON_GAP * k));
    const pt = roadPointAt(tr.rail, s);
    tr.cars.push({ x: pt.x, y: pt.y, ang: tr.dir > 0 ? pt.ang : pt.ang + Math.PI });
  }
  tr.x = tr.cars[0].x; tr.y = tr.cars[0].y;
}
export function advanceTrain(tr, dt) {
  tr.s += tr.v * dt * tr.dir;
  if (tr.s >= tr.rail.len || tr.s <= 0) {
    tr.dir *= -1;                       // ping-pong the line, never vanish mid-view
    tr.s = Math.max(0, Math.min(tr.rail.len, tr.s));
  }
  poseTrain(tr);
}

function spawnOneGull() {
  const pt = sampleNear(_cam.x, _cam.y, [0], 200, KEEP_R); // open water
  if (!pt) return null;
  return { x: pt.x, y: pt.y, vx: (Math.random() < 0.5 ? 1 : -1) * (40 + Math.random() * 50),
           vy: (Math.random() - 0.5) * 20, ph: Math.random() * Math.PI * 2 };
}
function spawnOneBoat() {
  const pt = sampleNear(_cam.x, _cam.y, [0], 300, KEEP_R);
  if (!pt) return null;
  return { x: pt.x, y: pt.y, vx: (Math.random() < 0.5 ? 1 : -1) * (10 + Math.random() * 14),
           kind: Math.random() < 0.2 ? "ferry" : "panga", wake: 0 };
}

// Recycle far/dead entities and top each pool back up near the camera. Called
// each frame (cheap: a few samples). Arrays are the same shared state arrays.
function topUp(arr, target, make, isDead) {
  for (let i = arr.length - 1; i >= 0; i--) if (isDead(arr[i])) arr.splice(i, 1);
  let guard = 0;
  while (arr.length < target && guard++ < target * 3) { const e = make(); if (e) arr.push(e); }
}
// Stadium spectators (kind "fan") are CONTAINED on the graderías — they patrol
// the ring just outside the pitch footprint, never spilling onto the pitch or
// wandering the city like ordinary peds. Drawn like city peds (hue/ph).
const STADIUM_PEDS = 12;
const RING_OFF = 9;            // px outward from the footprint edge onto the stands

// Cache each stadium's footprint perimeter as edges with outward normals +
// cumulative arclength, so a fan's `su` (distance around) maps to a ring point.
function stadiumPerimeter(S) {
  if (S._peri) return S._peri;
  const f = S.footprint;
  if (!f || f.length < 6) { S._peri = null; return null; }
  const pts = [];
  for (let i = 0; i < f.length; i += 2) pts.push({ x: f[i], y: f[i + 1] });
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  const edges = []; let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    let nx = -dy / L, ny = dx / L;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; } // outward
    edges.push({ ax: a.x, ay: a.y, dx: dx / L, dy: dy / L, nx, ny, len: L, cum: total, ang: Math.atan2(dy, dx) });
    total += L;
  }
  S._peri = { edges, total };
  return S._peri;
}
function ringPoint(P, s, off) {
  let e = P.edges[0];
  for (const ed of P.edges) { if (s >= ed.cum && s < ed.cum + ed.len) { e = ed; break; } e = ed; }
  const d = s - e.cum;
  return { x: e.ax + e.dx * d + e.nx * off, y: e.ay + e.dy * d + e.ny * off, ang: e.ang };
}
// Advance a fan around the graderías ring (perimeter walk, occasional reverse).
export function advanceRingPed(pe, dt) {
  const P = stadiumPerimeter(pe.stadium);
  if (!P) { pe.dead = true; return; }
  pe.ph += dt * 6;
  pe.su = (pe.su + pe.v * dt * pe.sdir + P.total) % P.total;
  const q = ringPoint(P, pe.su, RING_OFF);
  pe.x = q.x; pe.y = q.y;
  pe.ang = q.ang + (pe.sdir < 0 ? Math.PI : 0);
  if (Math.random() < 0.004) pe.sdir *= -1;
}
function maintainStadiumPeds() {
  const arr = W.STADIUMS;
  if (!arr || !arr.length) return;
  for (const S of arr) {
    if (Math.hypot(S.cx - _cam.x, S.cy - _cam.y) > SPAWN_R + 400) continue;
    const P = stadiumPerimeter(S);
    if (!P) continue;
    let n = 0;
    for (const pe of pedestrians) if (pe.stadium === S) n++;
    let guard = 0;
    while (n < STADIUM_PEDS && guard++ < STADIUM_PEDS * 3) {
      const su = Math.random() * P.total, q = ringPoint(P, su, RING_OFF);
      pedestrians.push({
        x: q.x, y: q.y, ang: 0, v: 7 + Math.random() * 9,     // real pos NOW so far() can't cull it
        hue: (Math.random() * 360) | 0, ph: Math.random() * Math.PI * 2,
        stadium: S, ring: true, kind: "fan",
        su, sdir: Math.random() < 0.5 ? 1 : -1,
      });
      n++;
    }
  }
}

// Balneario Municipal: a sea-water inlet. Swimmers (kind "swimmer") bob inside
// its bbox and a leisure boat drifts back and forth — both CONTAINED, another
// NPC type distinct from city walkers and stadium fans.
const BALNEARIO_SWIMMERS = 6;
function maintainBalneario() {
  const B = W.BALNEARIO;
  if (!B) return;
  if (Math.hypot(B.cx - _cam.x, B.cy - _cam.y) > SPAWN_R + 400) return;
  let n = 0;
  for (const pe of pedestrians) if (pe.balneario) n++;
  let guard = 0;
  while (n < BALNEARIO_SWIMMERS && guard++ < BALNEARIO_SWIMMERS * 8) {
    const x = B.x0 + 8 + Math.random() * Math.max(1, B.x1 - B.x0 - 16);
    const y = B.y0 + 8 + Math.random() * Math.max(1, B.y1 - B.y0 - 16);
    if (W.surfaceAt(x, y) !== 0) continue;    // only in the actual water, not the bbox corners
    pedestrians.push({
      x, y, ang: Math.random() * Math.PI * 2, v: 5 + Math.random() * 6,
      hue: (Math.random() * 360) | 0, ph: Math.random() * Math.PI * 2,
      balneario: B, swim: true, kind: "swimmer",
    });
    n++;
  }
  let hasBoat = false;
  for (const b of boats) if (b.balneario) hasBoat = true;
  if (!hasBoat && W.surfaceAt(B.cx, B.cy) === 0) {
    boats.push({
      x: B.cx, y: B.cy,
      vx: (Math.random() < 0.5 ? 1 : -1) * (6 + Math.random() * 4), vy: 0,
      kind: "panga", wake: 0, balneario: B, s: 0.7,
    });
  }
}
// Advance a swimmer: slow drift that stays on ACTUAL water (surface class 0),
// so it follows the inlet's real shape instead of the rectangular bbox — no
// more swimmers wandering onto the streets at the block corners.
export function advanceSwimmer(pe, dt) {
  pe.ph += dt * 4;
  const nx = pe.x + Math.cos(pe.ang) * pe.v * dt;
  const ny = pe.y + Math.sin(pe.ang) * pe.v * dt;
  if (W.surfaceAt(nx, ny) === 0) { pe.x = nx; pe.y = ny; }
  else pe.ang += Math.PI * (0.6 + Math.random() * 0.8);   // hit the shore → turn back into the water
  if (Math.random() < 0.02) pe.ang += (Math.random() - 0.5) * 0.8;
}

export function maintainStreaming() {
  topUp(traffic, TARGET.traffic, spawnOneCar, (e) => e.dead || far(e));
  maintainStadiumPeds();
  maintainBalneario();
  topUp(trains, TARGET.trains, spawnOneTrain, (e) => Math.hypot(e.x - _cam.x, e.y - _cam.y) > KEEP_R + 600);
  topUp(pedestrians, TARGET.pedestrians, spawnOnePed, (e) => e.dead || far(e));
  topUp(vendors, TARGET.vendors, spawnOneVendor, far);
  topUp(animals, TARGET.animals, spawnOneAnimal, (e) => e.dead || far(e));
  topUp(gulls, TARGET.gulls, spawnOneGull, far);
  topUp(boats, TARGET.boats, spawnOneBoat, (e) => Math.hypot(e.x - _cam.x, e.y - _cam.y) > KEEP_R + 400);
}

// Advance an entity along its heading, keeping it on one of `classes`. Turns at
// walls (tries ±90°, then 180°); marks it dead (recycled next maintain) if
// boxed in. Used by physics for traffic + pedestrians.
export function advanceOnSurface(e, dt, classes, turnChance = 0.01) {
  const step = e.v * dt;
  const nx = e.x + Math.cos(e.ang) * step, ny = e.y + Math.sin(e.ang) * step;
  if (classes.includes(W.surfaceAt(nx, ny))) {
    e.x = nx; e.y = ny;
    if (Math.random() < turnChance) e.ang += (Math.random() - 0.5) * 0.6;
    return true;
  }
  for (const d of [Math.PI / 2, -Math.PI / 2, Math.PI]) {
    const a = e.ang + d, mx = e.x + Math.cos(a) * step, my = e.y + Math.sin(a) * step;
    if (classes.includes(W.surfaceAt(mx, my))) { e.ang = a; e.x = mx; e.y = my; return true; }
  }
  e.dead = true;
  return false;
}

// Animals amble; recycled by maintainStreaming when far. Position-based now.
export function updateAnimals(dt) {
  for (const a of animals) {
    a.ph += dt * 5;
    if (a.pause > 0) { a.pause -= dt; continue; }
    const nx = a.x + Math.cos(a.ang) * a.v * dt, ny = a.y + Math.sin(a.ang) * a.v * dt;
    const c = W.surfaceAt(nx, ny);
    if (c === 6 || c === 3 || c === 2) { a.x = nx; a.y = ny; if (Math.random() < 0.02) { a.ang += (Math.random() - 0.5); a.pause = Math.random() * 3; } }
    else { a.ang += Math.PI * (0.5 + Math.random()); a.pause = 0.3 + Math.random(); }
  }
}

// Mode-start hooks: clear the pools; maintainStreaming refills them near the
// camera on the first frames. Kept as named exports so modes.js/index.js don't
// need to change their call sites.
export function spawnTraffic() { traffic.length = 0; trains.length = 0; }
export function spawnPedestrians() { pedestrians.length = 0; spawnAmbient(); }
export function spawnAmbient() { parked.length = 0; vendors.length = 0; animals.length = 0; }
export function spawnGulls() { gulls.length = 0; }
export function spawnBoats() { boats.length = 0; }
