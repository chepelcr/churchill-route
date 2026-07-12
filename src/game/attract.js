// Attract mode: the live world drifts behind the menu screens. No player, no
// scoring — just the camera cruising the peninsula while traffic, pedestrians,
// gulls and boats go about their day (advanceEntities without interactions).
import { WORLD2D as W } from "../world2d/index.js";
import { state, traffic } from "./state.js";
import { spawnTraffic, spawnPedestrians, spawnGulls, spawnBoats, setSpawnCamera, maintainStreaming } from "./spawns.js";
import { advanceEntities } from "./physics.js";

const CRUISE = 40;          // px/s camera drift along the peninsula

let phase = 0;

// Cruise line: Faro kiosk -> Caldera, along the town's diagonal. Resolved from
// the POIs (falls back to the known planar anchors) so it tracks the 2-D map.
function cruiseAnchors() {
  const faro = W.landmarkById("kios_faro") || W.landmarkById("faro");
  const cald = W.landmarkById("kios_caldera") || W.landmarkById("caldera_blvd");
  return {
    a: faro ? { x: faro.x, y: faro.y } : { x: 12290, y: 9854 },
    b: cald ? { x: cald.x, y: cald.y } : { x: 36000, y: 21000 },
  };
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
  const { a, b } = cruiseAnchors();
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const u = (phase * CRUISE) % (2 * span);       // ping-pong Faro <-> Caldera
  const t = (u < span ? u : 2 * span - u) / span;
  state.cam.x = a.x + (b.x - a.x) * t;
  state.cam.y = a.y + (b.y - a.y) * t;
  state.cam.shake = 0;
  W.update(state.cam.x, state.cam.y);
  setSpawnCamera(state.cam.x, state.cam.y);
  maintainStreaming();
  advanceEntities(dt, false);
}
