// Game-mode starts (story / arcade / explore) and world setters.
import { WORLD as W } from "../world/index.js";
import { state } from "./state.js";
import { VEHICLES } from "./vehicles.js";
import { spawnTraffic, spawnPedestrians, spawnGulls, spawnBoats } from "./spawns.js";
import { pickCustomer } from "./delivery.js";
import { rebuildBarriers } from "./progress.js";

export function startStage(stageIdx, vehicleKey) {
  const stg = W.STAGES[stageIdx];
  state.stage = stg;
  state.stageIdx = stageIdx;
  state.mode = "story";
  state.weather = stg.weather;
  state.timeLeft = stg.timeLimit;
  state.stageDeliveries = 0;
  state.stageTarget = stg.targetDeliveries;
  state.vehicleKey = vehicleKey || state.vehicleKey;
  state.veh = VEHICLES[state.vehicleKey];
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  // place player near first kiosk of stage
  const k = W.landmarkById(stg.kiosks[0]);
  state.p = { x: k.x - 60, y: k.y, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
  state.cam = { x: state.p.x, y: state.p.y, shake: 0 };
  state.storyTip = stg.brief;
  state.barriers = [];
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  pickCustomer();
}

export function startArcade(opts = {}) {
  state.stage = null;
  state.stageIdx = 0;
  state.mode = "arcade";
  state.weather = opts.weather || "sunny";
  state.timeLeft = 180;
  state.vehicleKey = opts.vehicleKey || state.vehicleKey;
  state.veh = VEHICLES[state.vehicleKey];
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  const k0 = W.landmarkById("kios_paseo1");
  state.p = { x: k0.x - 60, y: k0.y, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
  state.cam = { x: state.p.x, y: state.p.y, shake: 0 };
  state.storyTip = "Modo Arcade: cantidad y velocidad. Combo no decae si seguís entregando.";
  state.barriers = [];
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  pickCustomer();
}

export function startExplore(opts = {}) {
  state.stage = null;
  state.stageIdx = 0;
  state.mode = "explore";
  state.weather = opts.weather || "sunny";
  state.timeLeft = 999;
  state.vehicleKey = opts.vehicleKey || state.vehicleKey;
  state.veh = VEHICLES[state.vehicleKey];
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  // Spawn at El Faro start
  const f0 = W.landmarkById("faro");
  state.p = { x: f0.x + 60, y: f0.y, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
  state.cam = { x: state.p.x, y: state.p.y, shake: 0 };
  const unlockedNames = state.progress.unlocked.length;
  state.storyTip = `Modo Recorrer · ${unlockedNames} zonas desbloqueadas. Limpiá etapas para abrir más.`;
  rebuildBarriers();
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  pickCustomer();
}

export function setWeather(w) { state.weather = w; }
export function setVehicle(k) { state.vehicleKey = k; state.veh = VEHICLES[k]; }
