// Game-mode starts (story / arcade / explore) and world setters.
import { WORLD2D as W } from "../world2d/index.js";
import { state } from "./state.js";
import { VEHICLES } from "./vehicles.js";
import { spawnTraffic, spawnPedestrians, spawnGulls, spawnBoats } from "./spawns.js";
import { pickCustomer, pickCustomerNear } from "./delivery.js";
import { rebuildBarriers } from "./progress.js";
import { initTutorial } from "./tutorial.js";
import { economy } from "./economy.js";
import { t, stageBrief } from "../i18n/index.js";
import { analytics } from "../monetize/analytics.js";

// Resolve the run vehicle: enforce ownership (fall back to scooter) and apply
// the equipped paint by cloning — paintVehicle reads veh.color.
function resolveVehicle(key) {
  const k = economy.ownsVehicle(key) ? key : "scooter";
  const col = economy.equippedColor(k);
  return { key: k, veh: col ? { ...VEHICLES[k], color: col.hex } : VEHICLES[k] };
}
// Run-start economy state: reset the run wallet and consume any armed boosts
// (picked in the vehicle picker; each is one use).
function armRun() {
  state.runCoins = 0;
  state.icepackT = 0; state.headstartT = 0;
  const armed = state.armedBoosts || {};
  if (armed.icepack && economy.useBoost("icepack")) state.icepackT = 30;
  if (armed.headstart && economy.useBoost("headstart")) state.headstartT = 5;
  state.armedBoosts = null;
}

export function startStage(stageIdx, vehicleKey) {
  const stg = W.STAGES[stageIdx];
  state.stage = stg;
  state.stageIdx = stageIdx;
  state.mode = "story";
  state.weather = stg.weather;
  state.timeLeft = stg.timeLimit;
  state.stageDeliveries = 0;
  state.stageTarget = stg.targetDeliveries;
  const rv = resolveVehicle(vehicleKey || state.vehicleKey);
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  // place player near first kiosk of stage
  const k = W.landmarkById(stg.kiosks[0]);
  state.p = { x: k.x - 60, y: k.y, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
  // mutate cam, never replace: the renderer publishes zoom/vw/vh on it
  state.cam.x = state.p.x; state.cam.y = state.p.y; state.cam.shake = 0;
  state.storyTip = stageBrief(stg);
  rebuildBarriers(); // MVP wall (story has no progression barriers)
  state.district = null; state.districtToast = null;
  state.tutorial = null;
  // prime the streamed world on the spawn area so surfaces are resident before
  // the first physics/render frame (tiles keep loading via update() in the loop)
  W.update(state.cam.x, state.cam.y);
  W.ready(state.cam.x, state.cam.y, state.cam.vw || 1600, state.cam.vh || 1000);
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  pickCustomer();
  analytics.track("run_start", { mode: "story", stage_id: stg.id, vehicle: state.vehicleKey });
}

export function startArcade(opts = {}) {
  state.stage = null;
  state.stageIdx = 0;
  state.mode = "arcade";
  state.weather = opts.weather || "sunny";
  state.timeLeft = 180;
  const rv = resolveVehicle(opts.vehicleKey || state.vehicleKey);
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  const k0 = W.landmarkById("kios_paseo1");
  state.p = { x: k0.x - 60, y: k0.y, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
  state.cam.x = state.p.x; state.cam.y = state.p.y; state.cam.shake = 0;
  state.storyTip = t("tip.arcade");
  rebuildBarriers(); // MVP wall (arcade has no progression barriers)
  state.district = null; state.districtToast = null;
  state.tutorial = null;
  // prime the streamed world on the spawn area so surfaces are resident before
  // the first physics/render frame (tiles keep loading via update() in the loop)
  W.update(state.cam.x, state.cam.y);
  W.ready(state.cam.x, state.cam.y, state.cam.vw || 1600, state.cam.vh || 1000);
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  pickCustomer();
  analytics.track("run_start", { mode: "arcade", vehicle: state.vehicleKey });
}

export function startExplore(opts = {}) {
  state.stage = null;
  state.stageIdx = 0;
  state.mode = "explore";
  state.weather = opts.weather || "sunny";
  state.timeLeft = 999;
  const rv = resolveVehicle(opts.vehicleKey || state.vehicleKey);
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  // Spawn at El Faro start
  const f0 = W.landmarkById("faro");
  state.p = { x: f0.x + 60, y: f0.y, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
  state.cam.x = state.p.x; state.cam.y = state.p.y; state.cam.shake = 0;
  state.storyTip = t("tip.explore", { n: state.progress.unlocked.length });
  rebuildBarriers();
  state.district = null; state.districtToast = null;
  state.tutorial = null;
  // prime the streamed world on the spawn area so surfaces are resident before
  // the first physics/render frame (tiles keep loading via update() in the loop)
  W.update(state.cam.x, state.cam.y);
  W.ready(state.cam.x, state.cam.y, state.cam.vw || 1600, state.cam.vh || 1000);
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  pickCustomer();
  analytics.track("run_start", { mode: "explore", vehicle: state.vehicleKey });
}

// Tutorial: timerless guided run at the Paseo kiosk; the step machine in
// tutorial.js drives the HUD instructions and ends the run when complete.
export function startTutorial(opts = {}) {
  state.stage = null;
  state.stageIdx = 0;
  state.mode = "tutorial";
  state.weather = "sunny";
  state.timeLeft = 999;
  const rv = resolveVehicle(opts.vehicleKey || state.vehicleKey);
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  const k0 = W.landmarkById("kios_paseo1");
  state.p = { x: k0.x - 60, y: k0.y, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
  state.cam.x = state.p.x; state.cam.y = state.p.y; state.cam.shake = 0;
  state.storyTip = "";
  rebuildBarriers();
  state.district = null; state.districtToast = null;
  W.update(state.cam.x, state.cam.y);
  W.ready(state.cam.x, state.cam.y, state.cam.vw || 1600, state.cam.vh || 1000);
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  pickCustomerNear(k0.x, k0.y); // short, predictable first delivery
  initTutorial();
  analytics.track("run_start", { mode: "tutorial", vehicle: state.vehicleKey });
}

export function setWeather(w) { state.weather = w; }
export function setVehicle(k) {
  const rv = resolveVehicle(k);
  state.vehicleKey = rv.key; state.veh = rv.veh;
}
