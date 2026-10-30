// Attract mode: the live world drifts behind the menu screens. No player, no
// scoring — just the camera cruising the peninsula while traffic, pedestrians,
// gulls and boats go about their day (advanceEntities without interactions).
import { WORLD2D as W } from "../world2d/index.js";
import { state, traffic } from "./state.js";
import { spawnTraffic, spawnPedestrians, spawnGulls, spawnBoats, setSpawnCamera, maintainStreaming } from "./spawns.js";
import { advanceEntities } from "./physics.js";

const CRUISE = 40;          // px/s camera drift along the peninsula

let phase = 0;
let _route = null;

// Cruise ROUTE: a polyline through the town, not a straight line across it. The
// old version interpolated Faro -> Caldera, and since the coast bends south at
// the Cocal that chord left the spit almost immediately — the menu spent its
// whole loop over open gulf. These waypoints are landmarks on the peninsula's
// own axis (kiosks, the parroquia, the estadios, the catedral, the mercado), so
// the drift stays over streets and inside the MVP-open districts.
const CRUISE_STOPS = [
  ["kios_faro", 12041, 10059],   // La Punta
  ["carmenig", 13430, 9958],     // Parroquia del Carmen
  ["estadio", 14327, 9874],      // Lito Pérez
  ["tioga", 14010, 10046],       // Paseo de los Turistas
  ["kios_paseo1", 15414, 10154],
  ["catedral", 15034, 9642],     // the civic block
  ["mercado", 15734, 9218],      // Centro
  ["estadio_playitas", 16184, 9432],
  ["kios_play", 16530, 9518],    // Playitas, just short of the MVP wall
];

// Waypoints + cumulative arclength, resolved once the world is loaded.
function cruiseRoute() {
  if (_route) return _route;
  const pts = CRUISE_STOPS.map(([id, fx, fy]) => {
    const lm = W.landmarkById(id);
    return lm ? { x: lm.x, y: lm.y } : { x: fx, y: fy };
  });
  const cum = [0];
  for (let i = 1; i < pts.length; i++)
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1] || 1;
  _route = { pts, cum, total };
  return _route;
}

// Point at arclength `s` along the route.
function cruisePoint(s) {
  const { pts, cum, total } = cruiseRoute();
  const u = Math.max(0, Math.min(total, s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < u) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (u - cum[i - 1]) / seg;
  return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t,
           y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
}

export function setAttract(on) {
  state.attract = on;
  if (!on) return;
  if (traffic.length === 0) {
    spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  }
  state.weather = "sunset";   // menu backdrop; every mode start overrides it
}

export function attractTick(dt) {
  phase += dt;
  const { total } = cruiseRoute();
  const u = (phase * CRUISE) % (2 * total);      // ping-pong Faro <-> Playitas
  const q = cruisePoint(u < total ? u : 2 * total - u);
  state.cam.x = q.x;
  state.cam.y = q.y;
  state.cam.shake = 0;
  W.update(state.cam.x, state.cam.y);
  setSpawnCamera(state.cam.x, state.cam.y);
  maintainStreaming();
  advanceEntities(dt, false);
}
