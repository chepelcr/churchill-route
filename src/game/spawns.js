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
// target populations near the camera (tuned to the corridor build's feel:
// sidewalks full of people, streets with light town traffic)
const TARGET = { traffic: 20, pedestrians: 64, vendors: 10, animals: 8, gulls: 16, boats: 6, trains: 1 };
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
// Advance along the polyline; recycled at either end (maintainStreaming
// respawns it elsewhere near the camera).
export function advanceCarOnRoad(c, dt) {
  if (!c.road) { c.dead = true; return; }
  c.s += c.v * dt * c.dir;
  if (c.s <= 0 || c.s >= c.road.len) { c.dead = true; return; }
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
    w: main ? 38 : 32, h: main ? 18 : 16, kind: "car",
    x: 0, y: 0, ang: 0,
  };
  if (main) {
    const roll = Math.random();
    if (roll < 0.15) { car.kind = "truck"; car.w = 46; car.h = 18; }
    else if (roll < 0.24) { car.kind = "bus"; car.w = 56; car.h = 19; car.color = "#e0762e"; car.v *= 0.85; }
  }
  placeCarOnRoad(car);
  if (Math.hypot(car.x - _cam.x, car.y - _cam.y) > SPAWN_R) return null; // road wandered off-range
  return car;
}
// Pedestrians walk the aceras ALONG the streets (the corridor build's model):
// pick a road near the camera, offset to the mid-acera beside it, and walk
// parallel to it. Random-point sampling can't find the thin acera fringe.
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
  const off = r.w / 2 + 10; // mid-acera (1 cuadrícula deep)
  for (const side of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
    const x = pt.x - Math.sin(pt.ang) * off * side;
    const y = pt.y + Math.cos(pt.ang) * off * side;
    if (W.surfaceAt(x, y) !== 6) continue; // that side has no sidewalk here
    if (Math.hypot(x - _cam.x, y - _cam.y) > SPAWN_R) return null;
    return {
      x, y, ang: pt.ang + (Math.random() < 0.5 ? 0 : Math.PI), // walk the street
      v: 14 + Math.random() * 12,
      hue: (Math.random() * 360) | 0, ph: Math.random() * Math.PI * 2,
    };
  }
  return null;
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
export function maintainStreaming() {
  topUp(traffic, TARGET.traffic, spawnOneCar, (e) => e.dead || far(e));
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
