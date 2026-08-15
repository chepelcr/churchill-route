// World-entity spawning for the streamed 2-D world (WORLD2D). Because only the
// tiles around the camera are resident, ambient life (traffic, pedestrians,
// vendors, animals, gulls, boats) is maintained *camera-local*: entities are
// spawned near the camera on resident surfaces, advance by heading each frame,
// and are recycled when they hit a wall or drift out of range. This replaces the
// old global arclength model (place-once across the whole corridor via ROADS +
// roadPointAt), which cannot work when most of the map isn't loaded.
import { WORLD2D as W } from "../world2d/index.js";
import { traffic, pedestrians, gulls, boats, parked, vendors, animals, trains, schools, beachGames } from "./state.js";
import { VEHICLES } from "./vehicles.js";
import { SURFACE } from "./surfaces.js";
import { ROAD_ROLE } from "../domain/vocabulary.generated.js";
import { npcCrowdSize, npcMayStand, npcSpeed, npcSurfaceClasses, npcType } from "./npcs.js";
import SIM from "../content/simulation.json" with { type: "json" };

// The sidewalk's depth is a WORLD knob (ACERA_CELLS): the accessor resolves it
// from the manifest and owns the single legacy default, so the sim and the
// renderers can no longer fall back to different kerbs.
const ACERA_PX = W.ACERA_PX;
// how far from the camera we keep life alive / spawn it (world px)
// HOW MUCH LIFE THERE IS, AND HOW FAR OUT IT LIVES — `src/content/simulation.json`.
// The algorithms stay here: the surface sampler, the rails, the advancers. These
// are the numbers that decide how the town feels, and they are exactly what a
// designer expects to change without opening this file.
const KEEP_R = SIM.streaming.keepRadius;
const SPAWN_R = SIM.streaming.spawnRadius;
const SPAWN_MIN = SIM.streaming.spawnMin;
// target populations near the camera (tuned to the corridor build's feel:
// sidewalks full of people, streets with light town traffic)
// The walker count comes from the REGISTRY (npcTypes.json), because "how many
// people are on the sidewalk" is a thing the editor is meant to be able to
// change; the rest are still tuned here.
// The walker count comes from the NPC REGISTRY, not from here: "how many
// people are on the sidewalk" belongs with the type the editor already
// authors. Everything else is the population table.
const TARGET = { ...SIM.population, pedestrians: npcType("walker").density?.target || 64 };
delete TARGET.buses;
// how many of that traffic are buses on the ruta urbana (see buses.js)
const BUSES_WANTED = SIM.population.buses;
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
// Where ambient traffic may run at main-road speed. From the generated
// vocabulary, and deliberately NOT the builder's "never yields" set: that one
// includes the Paseo, which is a road you stop for and also a promenade nobody
// crosses town on. Two names for two questions (enums/features.py says why).
const MAIN_ROAD = new Set(ROAD_ROLE.TRAFFIC_MAIN);

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
  // UN CARRO CUALQUIERA DOBLA AL AZAR; UNO CON RUMBO, HACIA SU DESTINO. `aim`
  // es el punto al que este vehículo va — hoy lo pone el bus con su próxima
  // parada. No es una búsqueda de camino: el cliente no tiene el grafo de
  // calles, sólo los tramos del tile que está mirando. Es una elección VORAZ en
  // cada cruce, que es suficiente para que un bus se lea yendo de una parada a
  // la otra en vez de vagando, y que degrada sola cuando el destino queda
  // detrás de una manzana.
  const aim = c.aim;
  if (!aim) return cands[(Math.random() * cands.length) | 0];
  let best = null, bestD = Infinity;
  for (const cand of cands) {
    const far = roadEndpoint(cand.road, cand.dir < 0);
    const d = Math.hypot(far.x - aim.x, far.y - aim.y);
    if (d < bestD) { bestD = d; best = cand; }
  }
  return best;
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

// Semantic editor routes are deliberately simpler than the OSM road graph:
// an authored vehicle walks the exact polyline and optionally loops it.
export function advanceEditorRoute(c, dt) {
  const points = c.editorRoute;
  if (!Array.isArray(points) || points.length < 2) return;
  let target = points[c.routeIndex || 1];
  const dx = target[0] - c.x, dy = target[1] - c.y;
  const d = Math.hypot(dx, dy);
  const step = c.v * dt;
  if (d <= Math.max(1, step)) {
    c.x = target[0]; c.y = target[1];
    c.routeIndex = (c.routeIndex || 1) + 1;
    if (c.routeIndex >= points.length) c.routeIndex = c.routeLoop === false ? points.length - 1 : 0;
    target = points[c.routeIndex];
  }
  const ndx = target[0] - c.x, ndy = target[1] - c.y;
  const nd = Math.hypot(ndx, ndy) || 1;
  c.ang = Math.atan2(ndy, ndx);
  c.x += ndx / nd * Math.min(step, nd);
  c.y += ndy / nd * Math.min(step, nd);
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
    // The ruta urbana is a FLOOR, not a dice roll: at 9% of main-road spawns a
    // bus was rare enough that the paradas it now serves (buses.js) would go
    // unvisited for minutes at a time. Keep two on the streets near the camera,
    // and roll for the rest of the heavy traffic as before.
    let nbus = 0;
    for (const t of traffic) if (t.kind === "bus") nbus++;
    const roll = Math.random();
    if (nbus < BUSES_WANTED) { car.kind = "bus"; car.w = 41; car.h = 14; car.color = "#e0762e"; car.v *= 0.85; }
    else if (roll < 0.15) { car.kind = "truck"; car.w = 33; car.h = 13; }
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
  // MID-acera, whatever the acera is: the depth is a world knob (ACERA_CELLS)
  // and a hardcoded 10 px put walkers on the outer edge once it narrowed.
  const baseOff = r.w / 2 + Math.max(4, ACERA_PX * 0.5);
  for (const side of Math.random() < 0.5 ? [1, -1] : [-1, 1]) {
    const x = pt.x - Math.sin(pt.ang) * baseOff * side;
    const y = pt.y + Math.cos(pt.ang) * baseOff * side;
    if (W.surfaceAt(x, y) !== SURFACE.ACERA) continue; // that side has no sidewalk here
    if (Math.hypot(x - _cam.x, y - _cam.y) > SPAWN_R) return null;
    return {
      road: r, s, side, baseOff, off: side * baseOff,
      v: (Math.random() < 0.5 ? 1 : -1) * npcSpeed("walker"),
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
// UN BANCO DE ATÚN. Out in the gulf a school working the surface is visible
// from a long way off — the water boils, the birds pile in above it, and every
// panga within sight converges on it. That whole picture is one entity here:
// the shoal drifts, the boats turn around its EDGE (nobody drives through the
// fish), and the gulls belong to it rather than to the ambient flock, so the
// three things can never drift apart into a school with no boats and boats
// circling nothing.
function spawnOneSchool() {
  const pt = sampleNear(_cam.x, _cam.y, [0], 520, KEEP_R);
  if (!pt) return null;
  // …and it has to be OPEN water, not a slot between two piers: sample the
  // ring around it before committing, or a school lands in the harbour and its
  // fleet orbits through the muelle.
  const r = 46 + Math.random() * 46;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    if (W.surfaceAt(pt.x + Math.cos(a) * (r + 70), pt.y + Math.sin(a) * (r + 70)) !== SURFACE.WATER) return null;
  }
  const fleet = [];
  const n = 2 + ((Math.random() * 2) | 0);
  for (let i = 0; i < n; i++) {
    fleet.push({
      ang: Math.random() * Math.PI * 2,
      rad: r + 26 + Math.random() * 30,
      v: (Math.random() < 0.5 ? -1 : 1) * (0.16 + Math.random() * 0.16),
      hue: 20 + Math.random() * 40,
      ph: Math.random() * Math.PI * 2,
    });
  }
  return {
    x: pt.x, y: pt.y, r, ph: Math.random() * Math.PI * 2,
    vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 9,
    fleet, taken: false,
  };
}

// LOS MUELLEROS — the people who used to fish off the Muelle de Cruceros.
//
// They are an EASTER EGG, not ambience: drive out to the end of the muelle and
// they are there, leaning on the rail with a caña over the side, the way the
// muelle was used before it was closed to it. That is the whole reason the
// pier is 630 px long and has nothing on it.
//
// Seeded per pier and only while the camera is near, like the balneario's
// swimmers — there are two muelles in the world and no reason to carry their
// people across the other 60 km of it.
const PIER_FISHER_GAP = 46;          // px of deck between them
//: aprons and ramps are not muelles. A bajada is a slope onto the sand and the
//: lancha's berth is a working pier; the two the people fish off are the ones
//: with a rail to lean on, which is exactly the styles that draw one.
const FISHABLE_PIER = new Set(["concrete", "timber"]);

function maintainPierFishers() {
  for (const P of W.PIERS || []) {
    if (!FISHABLE_PIER.has(P.style)) continue;
    const pts = P.pts;
    const mx = (pts[0] + pts[pts.length - 2]) / 2;
    const my = (pts[1] + pts[pts.length - 1]) / 2;
    const near = Math.hypot(mx - _cam.x, my - _cam.y) < SPAWN_R + 700;
    const seeded = pedestrians.some((pe) => pe.pier === P.id);
    if (near && !seeded) seedPierFishers(P);
    else if (!near && seeded) {
      for (let i = pedestrians.length - 1; i >= 0; i--) {
        if (pedestrians[i].pier === P.id) pedestrians.splice(i, 1);
      }
    }
  }
}

function seedPierFishers(P) {
  const pts = P.pts, half = P.w / 2;
  // Walk the deck's arclength so a muelle that bends (the faro's does, at 45°)
  // spaces them along the deck rather than along the screen.
  let side = 1;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3];
    const seg = Math.hypot(bx - ax, by - ay);
    if (seg < 1) continue;
    const ux = (bx - ax) / seg, uy = (by - ay) / seg;
    // THE LANDWARD END IS THE BUSY END OF A PIER IN A GAME — but it is also
    // where the connector road and the apron are, so start clear of it and let
    // them thin out toward the sea end, which is where you are heading.
    for (let s = 90; s < seg - 40; s += PIER_FISHER_GAP) {
      side = -side;
      const t = s / seg;
      // out to the edge, but inside the rail
      const ex = -uy * side * (half - 7), ey = ux * side * (half - 7);
      const x = ax + ux * s + ex, y = ay + uy * s + ey;
      if (W.surfaceAt(x, y) !== SURFACE.BRIDGE) continue;  // still on the deck
      pedestrians.push({
        x, y, ang: 0, v: 0,
        hue: 20 + ((s * 7) % 40),
        ph: (s * 0.13) % (Math.PI * 2),
        kind: "muellero", stationary: true, pier: P.id,
        // which way the caña goes: outboard, away from the deck's centreline
        face: side, nx: -uy * side, ny: ux * side,
      });
    }
  }
}

/** Drift a school and turn its fleet around it. */
export function advanceSchool(sc, dt) {
  sc.ph += dt * 1.1;
  sc.x += sc.vx * dt; sc.y += sc.vy * dt;
  // A shoal that drifted onto the beach would be a shoal on the beach. Turn it
  // back at the shore instead of letting the pool cull it — the school is rare
  // enough that losing one to the coastline reads as them never existing.
  if (W.surfaceAt(sc.x + sc.vx, sc.y + sc.vy) !== SURFACE.WATER) { sc.vx *= -1; sc.vy *= -1; }
  for (const b of sc.fleet) {
    b.ang += b.v * dt;
    b.x = sc.x + Math.cos(b.ang) * b.rad;
    b.y = sc.y + Math.sin(b.ang) * b.rad;
    // tangent, so she is drawn going the way she is actually turning
    b.a = b.ang + (b.v > 0 ? Math.PI / 2 : -Math.PI / 2);
  }
}

// Recycle far/dead entities and top each pool back up near the camera. Called
// each frame (cheap: a few samples). Arrays are the same shared state arrays.
function topUp(arr, target, make, isDead) {
  for (let i = arr.length - 1; i >= 0; i--) if (isDead(arr[i])) arr.splice(i, 1);
  let guard = 0;
  while (arr.length < target && guard++ < target * 3) { const e = make(); if (e) arr.push(e); }
}
// Stadium spectators (kind "fan"), CONTAINED so they never spill onto the
// streets or wander the city like ordinary peds. They WANDER THE PITCH, well
// inside it — never the perimeter.
//
// The perimeter walk this replaced looked like the fans were standing on the
// sidewalk: a field's ring is only FIELD_ACERA_CELLS deep (8 px), so a ring
// point 10 px further in still sat under the 20 px acera band the renderer
// paints over the block edge. FIELD_INSET is measured from the footprint edge
// and is wider than that band, so a fan is always visibly on the grass.
const FAN = npcType("fan");
const FIELD_INSET = FAN.inset ?? 26;   // px of clearance from the pitch edge
// HOW FAR APART A CROWD STANDS. A fan is drawn ~9 px wide with its shadow, so
// two of them within this read as one smudge — which is what a crowd packed
// onto a small cancha looked like. It is enforced twice, because once is not
// enough: at SPAWN time (a candidate point too near a neighbour is rejected)
// and while they WANDER, where they would otherwise drift into each other
// however well they were placed.
const FAN_GAP = FAN.gap ?? 17;
// Point-in-polygon on a flat [x,y,...] ring.
function inPoly(x, y, f) {
  let inside = false;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const xi = f[i], yi = f[i + 1], xj = f[j], yj = f[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Distance from (x,y) to the nearest edge of a flat [x,y,…] ring. A traced
// pitch is a staircase of many short segments, so "inside by `m` px" has to be
// a real distance test — shrinking the bbox would not follow a diagonal cuadra.
function distToPoly(x, y, f) {
  let best = Infinity;
  for (let i = 0, j = f.length - 2; i < f.length; j = i, i += 2) {
    const ax = f[j], ay = f[j + 1], bx = f[i], by = f[i + 1];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    let t = ((x - ax) * dx + (y - ay) * dy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (ax + dx * t), y - (ay + dy * t));
    if (d < best) best = d;
  }
  return best;
}
// True when the point is inside the pitch AND at least `m` px clear of its edge.
function deepInside(x, y, f, m) {
  return inPoly(x, y, f) && distToPoly(x, y, f) >= m;
}
// A random point WELL INSIDE the footprint (rejection-sampled on its bbox) and
// clear of everyone already standing there. Falls back through shallower insets
// AND a shrinking gap, so a small pitch still gets its crowd rather than none:
// the spacing is what a field can afford, not an absolute.
function fieldPoint(S) {
  for (const m of [FIELD_INSET, FIELD_INSET / 2, 0]) {
    for (const gap of [FAN_GAP, FAN_GAP * 0.6, 0]) {
      for (let i = 0; i < 40; i++) {
        const x = S.x0 + Math.random() * (S.x1 - S.x0);
        const y = S.y0 + Math.random() * (S.y1 - S.y0);
        if (!deepInside(x, y, S.footprint, m)) continue;
        if (gap && crowded(x, y, S, gap)) continue;
        return { x, y };
      }
    }
  }
  return { x: S.cx, y: S.cy };
}
// Is somebody already standing within `gap` of here, on this field?
function crowded(x, y, S, gap) {
  const g2 = gap * gap;
  for (const pe of pedestrians) {
    if (pe.stadium !== S) continue;
    const dx = pe.x - x, dy = pe.y - y;
    if (dx * dx + dy * dy < g2) return true;
  }
  return false;
}
// HOW MANY a field holds. A cancha de barrio is 60 px across and Lito Pérez
// 210: twelve people on the first is a scrum and on the second is empty. The
// count comes from the room there actually is, at one person per FAN_GAP box.
//: QUIÉN ESTÁ EN ESTA CANCHA, cuando el mundo no lo dice. Antes `"fan"` estaba
//: escrito cuatro veces acá, así que TODA cancha del mundo recibía la misma
//: multitud y no había forma de quitársela a una. Ahora el bloque lo autora en
//: `content/world/blocks.json`; esto es sólo lo que pasa si no dijo nada.
const DEFAULT_CROWD = [{ type: "fan" }];
const fieldCrowd = (S) => (Array.isArray(S.crowd) ? S.crowd : DEFAULT_CROWD);
function crowdSize(S, type = "fan", want) {
  // `count` de la instancia gana: una mascota es UNA, no una densidad.
  return want ?? npcCrowdSize(type, (S.x1 - S.x0) * (S.y1 - S.y0));
}
// Wander inside the field, turning back at the edge instead of leaving it. The
// turn-back happens at FIELD_INSET, not at the outline, so a fan never walks
// out onto the acera band the renderer draws over the block edge.
export function advanceFieldPed(pe, dt) {
  const S = pe.stadium;
  pe.ph += dt * 6;
  const nx = pe.x + Math.cos(pe.ang) * pe.v * dt;
  const ny = pe.y + Math.sin(pe.ang) * pe.v * dt;
  if (deepInside(nx, ny, S.footprint, pe.inset || 0)) { pe.x = nx; pe.y = ny; }
  else pe.ang += Math.PI * (0.6 + Math.random() * 0.8);
  if (Math.random() < 0.02) pe.ang += (Math.random() - 0.5) * 0.9;
  // KEEP APART. Spacing them at spawn is not enough — they wander, and two
  // random walks on one pitch meet. A gentle shove along the line between them
  // keeps the crowd legible without making it look choreographed.
  for (const other of pedestrians) {
    if (other === pe || other.stadium !== S) continue;
    const dx = pe.x - other.x, dy = pe.y - other.y;
    const d2 = dx * dx + dy * dy;
    if (d2 >= FAN_GAP * FAN_GAP || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), push = (FAN_GAP - d) * 0.5;
    const px = pe.x + (dx / d) * push, py = pe.y + (dy / d) * push;
    if (deepInside(px, py, S.footprint, pe.inset || 0)) { pe.x = px; pe.y = py; }
    else pe.ang = Math.atan2(-dy, -dx);   // pinned against the edge: turn away
  }
}


function maintainStadiumPeds() {
  const arr = W.FIELDS;
  if (!arr || !arr.length) return;
  for (const S of arr) {
    if (Math.hypot(S.cx - _cam.x, S.cy - _cam.y) > SPAWN_R + 400) continue;
    if (!S.footprint || S.footprint.length < 6) continue;
    // Una lista vacía significa SIN GENTE — borrarle la multitud a esta plaza
    // es una fila del JSON, no una rama acá.
    for (const entry of fieldCrowd(S)) {
      const type = entry.type;
      let n = 0;
      for (const pe of pedestrians) if (pe.stadium === S && pe.kind === type) n++;
      const want = crowdSize(S, type, entry.count);
      let guard = 0;
      while (n < want && guard++ < want * 3) {
        // real position NOW, or far() culls it before it is ever placed
        const q = fieldPoint(S);
        // the inset a fan RESPECTS is the one it actually spawned at — on a
        // small pitch fieldPoint falls back to a shallower one, and holding it
        // to FIELD_INSET afterwards would freeze it on the spot
        const inset = Math.min(FIELD_INSET, distToPoly(q.x, q.y, S.footprint));
        pedestrians.push({
          x: q.x, y: q.y, ang: Math.random() * Math.PI * 2, v: npcSpeed(type),
          hue: (Math.random() * 360) | 0, ph: Math.random() * Math.PI * 2,
          stadium: S, field: true, inset, kind: type,
        });
        n++;
      }
    }
  }
}

// Balneario Municipal: a sea-water inlet. Swimmers (kind "swimmer") bob inside
// its bbox and a leisure boat drifts back and forth — both CONTAINED, another
// NPC type distinct from city walkers and stadium fans.
const BALNEARIO_SWIMMERS = npcCrowdSize("swimmer", 0);
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
    if (!swimmerWater(x, y)) continue;        // in the water with the body clear of the kerb
    pedestrians.push({
      x, y, ang: Math.random() * Math.PI * 2, v: npcSpeed("swimmer"),
      hue: (Math.random() * 360) | 0, ph: Math.random() * Math.PI * 2,
      balneario: B, swim: true, kind: "swimmer",
    });
    n++;
  }
  let hasBoat = false;
  for (const b of boats) if (b.balneario) hasBoat = true;
  if (!hasBoat && W.surfaceAt(B.cx, B.cy) === SURFACE.WATER) {
    boats.push({
      x: B.cx, y: B.cy,
      vx: (Math.random() < 0.5 ? 1 : -1) * (6 + Math.random() * 4), vy: 0,
      kind: "panga", wake: 0, balneario: B, s: 0.7,
    });
  }
}
// Advance a swimmer: slow drift that stays on ACTUAL water (SURFACE.WATER),
// so it follows the inlet's real shape instead of the rectangular bbox — no
// more swimmers wandering onto the streets at the block corners.
// A swimmer's BODY has to clear the kerb, not just its centre point — testing
// the centre alone let them ride half-on the balneario's inner acera.
const SWIM_R = npcType("swimmer").radius ?? 6;
export function swimmerWater(x, y) {
  const wet = (px, py) => W.surfaceAt(px, py) === SURFACE.WATER;
  return wet(x, y) && wet(x + SWIM_R, y) && wet(x - SWIM_R, y) &&
         wet(x, y + SWIM_R) && wet(x, y - SWIM_R);
}
export function advanceSwimmer(pe, dt) {
  pe.ph += dt * 4;
  const nx = pe.x + Math.cos(pe.ang) * pe.v * dt;
  const ny = pe.y + Math.sin(pe.ang) * pe.v * dt;
  if (swimmerWater(nx, ny)) { pe.x = nx; pe.y = ny; }
  else pe.ang += Math.PI * (0.6 + Math.random() * 0.8);   // hit the shore → turn back into the water
  if (Math.random() < 0.02) pe.ang += (Math.random() - 0.5) * 0.8;
}

// ---- LA VIDA DE LA PLAYA Y DEL MALECÓN -----------------------------------
//
// Three crowds that all live on a SURFACE rather than inside a footprint, so
// they share one maintainer: where a type may stand comes from the registry
// (`npcSurfaceClasses`), and the sampler finds that ground near the camera the
// same way the vendors and the animals already do. That is what makes them
// world-wide for free — playeros turn up on Playitas and Caldera, not only on
// the Paseo, because the rule is "sand", not "the Paseo's sand".
const TAU = Math.PI * 2;
// kind, how many near the camera, how many of them are sitting still. The
// COUNT is the NPC registry's (it belongs to the type); the SITTING FRACTION is
// simulation.json's, and it is the whole trick — a beach where everybody is
// walking reads as a corridor.
const SURFACE_CROWDS = Object.entries(SIM.crowds)
  .filter(([kind]) => !kind.startsWith("_"))
  .map(([kind, c]) => [kind, npcType(kind).density?.target ?? 16, c.sitting]);
function maintainSurfaceCrowds() {
  for (const [kind, target, sitting] of SURFACE_CROWDS) {
    let n = 0;
    for (const pe of pedestrians) if (pe.kind === kind) n++;
    if (n >= target) continue;
    const classes = npcSurfaceClasses(kind);
    let guard = 0;
    while (n < target && guard++ < target * 3) {
      const p = sampleNear(_cam.x, _cam.y, classes, SPAWN_MIN, SPAWN_R);
      if (!p) break;          // no such ground near the camera: nowhere to be
      // A THIRD OF THEM ARE NOT GOING ANYWHERE. A beach where everybody is
      // walking reads as a corridor; the towels and the people sitting on the
      // bancas are what make it read as a place people are AT.
      const still = Math.random() < sitting;
      pedestrians.push({
        x: p.x, y: p.y, ang: Math.random() * TAU,
        v: still ? 0 : npcSpeed(kind),
        hue: (Math.random() * 360) | 0, ph: Math.random() * TAU,
        kind, cls: classes, stationary: still,
      });
      n++;
    }
  }
}

// LA MEJENGA. A cluster of `jugador` on the sand around a ball, and the ball is
// the point: fans wander, and a group of people wandering on a beach is a
// crowd, not a game. Everyone runs at the ball and whoever reaches it kicks it
// somewhere else, which is enough to read as fútbol playa from above.
const GAME_R = SIM.beachGames.radiusPx;  // px: the pitch they mark out
const GAMES_WANTED = SIM.beachGames.wanted;  // one in sight is an event; three is a tournament
function maintainBeachGames() {
  for (let i = beachGames.length - 1; i >= 0; i--) {
    const G = beachGames[i];
    if (Math.hypot(G.x - _cam.x, G.y - _cam.y) <= KEEP_R) continue;
    G.dead = true;                       // …and its players go with it
    for (const pe of pedestrians) if (pe.game === G) pe.dead = true;
    beachGames.splice(i, 1);
  }
  if (beachGames.length >= GAMES_WANTED) return;
  const p = sampleNear(_cam.x, _cam.y, [SURFACE.BEACH], SPAWN_MIN, SPAWN_R);
  if (!p) return;
  // THE WHOLE PITCH HAS TO BE SAND. A game started on a 20 px spit of beach
  // spends its life with the ball in the sea and the players against the kerb.
  for (const [dx, dy] of [[GAME_R, 0], [-GAME_R, 0], [0, GAME_R], [0, -GAME_R]]) {
    if (W.surfaceAt(p.x + dx, p.y + dy) !== SURFACE.BEACH) return;
  }
  const G = { x: p.x, y: p.y, r: GAME_R, ball: { x: p.x, y: p.y, vx: 0, vy: 0, ph: 0 } };
  beachGames.push(G);
  const n = npcCrowdSize("jugador", Math.PI * GAME_R * GAME_R);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, d = GAME_R * (0.35 + Math.random() * 0.5);
    pedestrians.push({
      x: G.x + Math.cos(a) * d, y: G.y + Math.sin(a) * d, ang: a + Math.PI,
      v: npcSpeed("jugador"), hue: (Math.random() * 360) | 0,
      ph: Math.random() * TAU, kind: "jugador", game: G,
    });
  }
}
// One player: run at the ball, and kick it when you get there. Contained by the
// game's own circle rather than by the sand, so a mejenga never drifts into the
// sea one player at a time.
export function advanceBeachPlayer(pe, dt) {
  const G = pe.game;
  if (!G || G.dead) { pe.dead = true; return; }
  pe.ph += dt * 8;
  const b = G.ball;
  const dx = b.x - pe.x, dy = b.y - pe.y;
  const d = Math.hypot(dx, dy) || 1;
  pe.ang = Math.atan2(dy, dx);
  if (d > 14) {
    const nx = pe.x + (dx / d) * pe.v * dt, ny = pe.y + (dy / d) * pe.v * dt;
    if (Math.hypot(nx - G.x, ny - G.y) < G.r) { pe.x = nx; pe.y = ny; }
  } else if (Math.random() < 0.3) {
    const a = Math.random() * TAU, kick = 90 + Math.random() * 70;
    b.vx = Math.cos(a) * kick; b.vy = Math.sin(a) * kick;
  }
}
// The ball itself, per game — it is not a pedestrian and has no advancer of its
// own in the ped loop.
export function advanceBeachGames(dt) {
  for (const G of beachGames) {
    const b = G.ball;
    b.x += b.vx * dt; b.y += b.vy * dt;
    const k = Math.max(0, 1 - 2.2 * dt);      // sand stops a ball fast
    b.vx *= k; b.vy *= k;
    const dx = b.x - G.x, dy = b.y - G.y, d = Math.hypot(dx, dy) || 1;
    if (d > G.r * 0.9) {
      b.x = G.x + (dx / d) * G.r * 0.9; b.y = G.y + (dy / d) * G.r * 0.9;
      b.vx = -b.vx * 0.6; b.vy = -b.vy * 0.6;
    }
    b.ph += Math.hypot(b.vx, b.vy) * dt * 0.06;
  }
}

export function maintainStreaming() {
  topUp(traffic, TARGET.traffic, spawnOneCar, (e) => e.dead || (!e.persistent && far(e)));
  maintainStadiumPeds();
  maintainBalneario();
  maintainPierFishers();
  maintainSurfaceCrowds();
  maintainBeachGames();
  topUp(trains, TARGET.trains, spawnOneTrain, (e) => Math.hypot(e.x - _cam.x, e.y - _cam.y) > KEEP_R + 600);
  topUp(pedestrians, TARGET.pedestrians, spawnOnePed, (e) => e.dead || (!e.persistent && far(e)));
  topUp(vendors, TARGET.vendors, spawnOneVendor, far);
  topUp(animals, TARGET.animals, spawnOneAnimal, (e) => e.dead || far(e));
  topUp(gulls, TARGET.gulls, spawnOneGull, far);
  topUp(boats, TARGET.boats, spawnOneBoat, (e) => Math.hypot(e.x - _cam.x, e.y - _cam.y) > KEEP_R + 400);
  topUp(schools, TARGET.schools, spawnOneSchool, (e) => Math.hypot(e.x - _cam.x, e.y - _cam.y) > KEEP_R + 600);
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
export function spawnAmbient() {
  parked.length = 0;
  const routes = new Map(
    W.EDITOR_FEATURES
      .filter((feature) => feature.type === "route" && feature.geometry?.kind === "line")
      .map((feature) => [feature.id, feature.geometry.points]),
  );
  for (const feature of W.EDITOR_FEATURES) {
    if (feature.type !== "placed-vehicle" || feature.geometry?.kind !== "point") continue;
    const properties = feature.properties || {};
    const vehicle = VEHICLES[properties.vehicleKey] || VEHICLES.scooter;
    const record = {
      editorId: feature.id,
      persistent: true,
      x: feature.geometry.point[0],
      y: feature.geometry.point[1],
      ang: (Number(properties.angle) || 0) * Math.PI / 180,
      color: feature.style?.color || vehicle.color,
      roof: vehicle.roof,
      w: vehicle.w,
      h: vehicle.h,
      kind: vehicle.kind,
      vehicleKey: properties.vehicleKey || "scooter",
    };
    if (properties.vehicleBehavior === "traffic" && routes.has(properties.routeId)) {
      const route = routes.get(properties.routeId);
      traffic.push({
        ...record,
        x: route[0][0],
        y: route[0][1],
        v: Number(properties.speed) || Math.min(vehicle.top, 90),
        editorRoute: route,
        routeIndex: 1,
        routeLoop: properties.routeLoop !== false,
      });
    } else {
      parked.push(record);
    }
  }
  for (const feature of W.NPCS || []) {
    const properties = feature.properties || {};
    const type = npcType(properties.npcType || "resident");
    // WHERE IT MAY STAND, checked once more at spawn. The build already refused
    // an impossible placement, but the world can be rebuilt under an authored
    // point — a cuadra becomes water, a parcel changes use — and a swimmer
    // standing on asphalt is worse than one who never appeared.
    const [x0, y0] = feature.geometry.point;
    const standing = npcMayStand(type.id, W.surfaceAt(x0, y0), properties.host);
    if (!standing.ok) continue;
    // The MOVEMENT is the type's; the feature may still say "this particular
    // one is standing still" by choosing the stationary movement itself.
    const movement = properties.npcMovement || type.movement || "stationary";
    const route = routes.get(properties.routeId);
    const npc = {
      editorId: feature.id,
      persistent: true,
      x: x0,
      y: y0,
      ang: (Number(properties.angle) || 0) * Math.PI / 180,
      v: movement === "stationary" ? 0 : Number(properties.speed) || npcSpeed(type.id),
      hue: Number(properties.hue) || 28,
      ph: Math.random() * Math.PI * 2,
      // WHERE IT MAY WANDER is where it may STAND: the type's surface hosts,
      // so a vecino placed on the acera cannot drift into the road.
      cls: Array.isArray(properties.surfaceClasses) ? properties.surfaceClasses : npcSurfaceClasses(type.id),
      editorNpc: true,
      npcType: type.id,
      drawStyle: properties.drawStyle || type.art || "person",
      color: feature.style?.color || properties.color || "#e85d75",
      scale: Number(properties.scale) || 1,
      stationary: movement === "stationary",
    };
    if (movement === "route" && route?.length >= 2) {
      npc.x = route[0][0]; npc.y = route[0][1];
      npc.editorRoute = route;
      npc.routeIndex = 1;
      npc.routeLoop = properties.routeLoop !== false;
    }
    pedestrians.push(npc);
  }
  vendors.length = 0;
  animals.length = 0;
}
export function spawnGulls() { gulls.length = 0; }
export function spawnBoats() { boats.length = 0; }
