// Attract mode: the live world drifts behind the menu screens. No player, no
// scoring — just the camera cruising the peninsula while traffic, pedestrians,
// gulls and boats go about their day (advanceEntities without interactions).
import { WORLD as W } from "../world/index.js";
import { state, traffic } from "./state.js";
import { spawnTraffic, spawnPedestrians, spawnGulls, spawnBoats } from "./spawns.js";
import { advanceEntities } from "./physics.js";

const CRUISE = 40;          // px/s camera drift along the spine
const MARGIN = 400;         // keep the sweep off the world edges

let phase = 0;

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
  const span = W.W - 2 * MARGIN;
  const u = (phase * CRUISE) % (2 * span);       // ping-pong Faro <-> Caldera
  const x = MARGIN + (u < span ? u : 2 * span - u);
  state.cam.x = x;
  state.cam.y = (W.topY(x) + W.botY(x)) / 2;     // follow the peninsula midline
  state.cam.shake = 0;
  advanceEntities(dt, false);
}
