// La ruta urbana: the buses that actually STOP.
//
// A bus was already one of the shapes traffic could take (`kind:"bus"` in
// `spawnOneCar`), but it drove past every parada in the port without ever
// slowing down, and the 87 bus_stop nodes OSM has for Puntarenas were drawn as
// scenery and nothing else. A stop nobody uses is set dressing; a stop a bus
// pulls into, with people waiting at it who get on, is the town working.
//
// So this module is the behaviour that turns those two halves into one thing:
//
//   * the PARADAS come from the world (`W.SIGNS`, kind "bus"), which the build
//     seats on the acera beside its street and orients along it (see
//     `seat_bus_stops` in churchill/world/service/signs.py) — so a stop always
//     has a kerb to stand on and a direction to face;
//   * a bus reaching one brakes, opens its doors for a few seconds, drops
//     passengers who walk off down the sidewalk, and takes on whoever was
//     waiting there;
//   * the passengers are ORDINARY PEDS. They live in the same `pedestrians`
//     array as everyone else and are drawn by the same `drawPed`, so a person
//     who gets off a bus simply becomes a person walking the acera — which is
//     what the rail-bound ped model (`advancePed`) already knows how to do.
//
// The bus itself stays in `traffic`: it is a vehicle, it collides with the
// player and it follows the road network exactly like every other car. All this
// adds is what happens at the kerb.
import { WORLD2D as W } from "../world2d/index.js";
import { pedestrians } from "./state.js";
import { advanceCarOnRoad } from "./spawns.js";

// how far from the camera paradas stay staffed with people waiting
const STOP_KEEP_R = 1300;
const STOP_SPAWN_R = 1000;
// A bus starts braking this far from the parada and halts within HALT of it.
const BRAKE_R = 105;
const HALT_R = 15;
// …but only for a stop it is actually passing: a parada across a wide avenida,
// or one on a parallel street, is not this bus's business.
const LATERAL_R = 34;
const DWELL = [2.6, 4.4];         // seconds with the doors open
const WAITING_PER_STOP = 3;       // at most, and usually fewer
const ALIGHT_MAX = 2;
const QUIET_AFTER = 18;           // seconds a served parada takes to fill again
const CREEP = 10;                 // px/s the bus rolls at while pulling in

// ---------------------------------------------------------------- paradas ---
// The stop list, bucketed once into a coarse grid: `W.SIGNS` is a flat array of
// every piece of street furniture in the world, and the buses ask "what is near
// me" every frame.
const CELL = 256;
let _grid = null;
function stopGrid() {
  if (_grid) return _grid;
  _grid = new Map();
  for (const s of W.SIGNS || []) {
    if (s.kind !== "bus") continue;
    const k = ((s.x / CELL) | 0) * 65536 + ((s.y / CELL) | 0);
    let l = _grid.get(k); if (!l) { l = []; _grid.set(k, l); }
    l.push(s);
  }
  return _grid;
}
function stopsNear(x, y, r) {
  const g = stopGrid(), out = [];
  const c0 = ((x - r) / CELL) | 0, c1 = ((x + r) / CELL) | 0;
  const r0 = ((y - r) / CELL) | 0, r1 = ((y + r) / CELL) | 0;
  for (let c = c0; c <= c1; c++)
    for (let rr = r0; rr <= r1; rr++) {
      const l = g.get(c * 65536 + rr);
      if (!l) continue;
      for (const s of l) if (Math.hypot(s.x - x, s.y - y) <= r) out.push(s);
    }
  return out;
}

// --------------------------------------------------------------- the bus ----
// The stop this bus is pulling into, if any: near, ahead, and beside the lane
// it is in. `lastStop` keeps it from re-serving the parada it just left while
// it is still standing next to it.
function stopAhead(b) {
  let best = null;
  for (const s of stopsNear(b.x, b.y, BRAKE_R)) {
    if (s === b.lastStop) continue;
    const dx = s.x - b.x, dy = s.y - b.y;
    const ahead = dx * Math.cos(b.ang) + dy * Math.sin(b.ang);
    const side = -dx * Math.sin(b.ang) + dy * Math.cos(b.ang);
    if (ahead < -HALT_R || Math.abs(side) > LATERAL_R) continue;
    const d = Math.hypot(dx, dy);
    if (!best || d < best.d) best = { stop: s, d };
  }
  return best;
}

export function advanceBus(b, dt) {
  if (b.cruise === undefined) b.cruise = b.v;
  if (b.dwell > 0) {
    // Standing at the kerb: DO NOT advance. Calling the road walk with v=0
    // still trips its end-of-way handoff when the bus happens to have halted
    // at s=0, and the bus would hop to a connecting street with its doors open.
    b.dwell -= dt;
    b.v = 0;
    if (b.dwell <= 0) { b.v = b.cruise; b.doors = false; }
    return;
  }
  const target = stopAhead(b);
  if (target) {
    if (target.d <= HALT_R) { serveStop(b, target.stop); return; }
    // ease down to a crawl over the last BRAKE_R px
    b.v = Math.max(CREEP, b.cruise * (target.d - HALT_R) / BRAKE_R);
  } else {
    b.v = b.cruise;
    // once clear of it, the stop behind is fair game again (a route loops)
    if (b.lastStop && Math.hypot(b.lastStop.x - b.x, b.lastStop.y - b.y) > BRAKE_R * 1.6)
      b.lastStop = null;
  }
  advanceCarOnRoad(b, dt);
}

// Doors open: some people get off and walk away, and whoever was waiting here
// gets on. Both are the same handful of peds moving between two states.
function serveStop(b, stop) {
  b.dwell = DWELL[0] + Math.random() * (DWELL[1] - DWELL[0]);
  b.v = 0;
  b.doors = true;
  b.lastStop = stop;
  const door = { x: (b.x + stop.x) / 2, y: (b.y + stop.y) / 2 };
  for (const pe of pedestrians) {
    if (pe.bus && pe.phase === "wait" && pe.stop === stop) {
      pe.phase = "board"; pe.tx = door.x; pe.ty = door.y;
    }
  }
  // The parada goes quiet for a while: without this the maintainer refills it
  // to its target on the very next frame and the bus visibly boards a queue
  // that never shortens.
  stop._quiet = QUIET_AFTER;
  const n = Math.random() < 0.55 ? 1 + ((Math.random() * ALIGHT_MAX) | 0) : 0;
  for (let i = 0; i < n; i++) {
    pedestrians.push({
      x: door.x, y: door.y, kind: "passenger", bus: true, phase: "alight",
      tx: stop.x + (Math.random() - 0.5) * 10, ty: stop.y + (Math.random() - 0.5) * 10,
      stop, v: 16 + Math.random() * 8,
      hue: (Math.random() * 360) | 0, ph: Math.random() * Math.PI * 2, ang: 0,
    });
  }
}

// ----------------------------------------------------------- the waiting ----
// People at the paradas near the camera. A stop's crowd size is derived from
// its own coordinates rather than rolled fresh, so the same parada is always
// about as busy — driving past it twice does not reshuffle the town.
function wantAt(stop) {
  const h = ((stop.x * 73856093) ^ (stop.y * 19349663)) >>> 0;
  return h % (WAITING_PER_STOP + 1);
}
export function maintainBusStops(cx, cy, dt = 0) {
  const near = stopsNear(cx, cy, STOP_SPAWN_R);
  if (!near.length) return;
  const count = new Map();
  for (const pe of pedestrians)
    if (pe.bus && pe.phase === "wait") count.set(pe.stop, (count.get(pe.stop) || 0) + 1);
  for (const s of near) {
    if (s._quiet > 0) { s._quiet -= dt; continue; }
    let n = count.get(s) || 0;
    const want = wantAt(s);
    while (n < want) {
      // shoulder to shoulder along the acera, facing the street they came for
      const t = (n - (want - 1) / 2) * 6;
      pedestrians.push({
        x: s.x + Math.cos(s.ang || 0) * t, y: s.y + Math.sin(s.ang || 0) * t,
        kind: "passenger", bus: true, phase: "wait", stop: s, v: 15,
        hue: (Math.random() * 360) | 0, ph: Math.random() * Math.PI * 2,
        ang: (s.ang || 0) + Math.PI / 2,
      });
      n++;
    }
  }
  // people waiting at a parada the camera has left are recycled with everyone
  // else, but a boarding/alighting ped mid-walk is never culled here
  for (let i = pedestrians.length - 1; i >= 0; i--) {
    const pe = pedestrians[i];
    if (pe.bus && pe.phase === "wait" &&
        Math.hypot(pe.x - cx, pe.y - cy) > STOP_KEEP_R) pedestrians.splice(i, 1);
  }
}

// A passenger: standing at the kerb, walking to the door, or walking away from
// it. The last one ENDS the special case — the ped is handed to the ordinary
// rail-bound walk, so somebody who got off a bus is just somebody on the acera.
export function advancePassenger(pe, dt) {
  pe.ph += dt * (pe.phase === "wait" ? 2 : 6);
  if (pe.phase === "wait") return;
  const dx = pe.tx - pe.x, dy = pe.ty - pe.y;
  const d = Math.hypot(dx, dy);
  if (d > 1.5) {
    const k = Math.min(1, (pe.v * dt) / d);
    pe.x += dx * k; pe.y += dy * k;
    pe.ang = Math.atan2(dy, dx);
    return;
  }
  if (pe.phase === "board") { pe.dead = true; return; }   // aboard: gone
  joinTheSidewalk(pe);
}

// Hand an alighted passenger to `advancePed`: find the road its parada sits on,
// put it at the matching arclength on that side, and drop the bus fields. From
// the next frame it is an ordinary ped and nothing knows the difference.
function joinTheSidewalk(pe) {
  const s = pe.stop;
  let best = null;
  for (const t of W.visibleTiles(pe.x - 60, pe.y - 60, pe.x + 60, pe.y + 60))
    for (const r of t.roads) {
      if (r.cls === "pedestrian" || r.len < 60) continue;
      for (let i = 0; i < r.pts.length - 2; i += 2) {
        const ax = r.pts[i], ay = r.pts[i + 1];
        const dx = r.pts[i + 2] - ax, dy = r.pts[i + 3] - ay;
        const L2 = dx * dx + dy * dy || 1;
        let u = ((pe.x - ax) * dx + (pe.y - ay) * dy) / L2;
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        const qx = ax + dx * u, qy = ay + dy * u;
        const dd = Math.hypot(pe.x - qx, pe.y - qy);
        if (!best || dd < best.d) {
          best = { d: dd, road: r, s: r.cum[i / 2] + Math.hypot(dx, dy) * u,
                   side: (-dy * (pe.x - qx) + dx * (pe.y - qy)) >= 0 ? 1 : -1 };
        }
      }
    }
  if (!best) { pe.dead = true; return; }
  const baseOff = (s && s.hw ? s.hw : best.road.w / 2) + 10;
  // `kind` goes with the rest: what makes this an ordinary ped is that NOTHING
  // marks it as a passenger any more, drawing included.
  delete pe.kind; delete pe.bus; delete pe.phase; delete pe.tx; delete pe.ty;
  delete pe.stop;
  pe.road = best.road;
  pe.s = Math.max(10, Math.min(best.road.len - 10, best.s));
  pe.side = best.side; pe.baseOff = baseOff; pe.off = best.side * baseOff;
  pe.v = (Math.random() < 0.5 ? 1 : -1) * (14 + Math.random() * 12);
  pe.crossing = false; pe.crossPhase = 0;
}
