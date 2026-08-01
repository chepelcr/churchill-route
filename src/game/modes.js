// Game-mode starts (story / arcade / explore) and world setters.
import { WORLD2D as W } from "../world2d/index.js";
import { state } from "./state.js";
import { VEHICLES } from "./vehicles.js";
import { spawnTraffic, spawnPedestrians, spawnGulls, spawnBoats } from "./spawns.js";
import { ferries, resetFerries } from "./ferries.js";
import { startCrossing } from "./crossing.js";
import { setDayCycle } from "./daynight.js";
import { pickCustomer, pickCustomerNear } from "./delivery.js";
import { rebuildBarriers } from "./progress.js";
import { initTutorial } from "./tutorial.js";
import { economy } from "./economy.js";
import { t, stageBrief } from "../i18n/index.js";
import { analytics } from "../monetize/analytics.js";
import { resetEditorTriggers } from "./editorGameplay.js";
import { applyOwnedShopEffects, consumeEditorBoosts } from "./editorContent.js";

// Resolve the run vehicle: enforce ownership (fall back to scooter) and apply
// the equipped paint by cloning — paintVehicle reads veh.color.
function resolveVehicle(key) {
  const k = economy.ownsVehicle(key) ? key : "scooter";
  const col = economy.equippedColor(k);
  const painted = col ? { ...VEHICLES[k], color: col.hex } : VEHICLES[k];
  return { key: k, veh: applyOwnedShopEffects(k, painted, state.progress) };
}
// Player start beside a kiosk: use the build-authored `spawn` (snapped to the
// nearest drivable street), never the kiosk's beach-facing icon position — that
// dropped the car onto the sand beside sand kiosks.
function spawnAtKiosk(k) {
  const sp = k && k.spawn;
  return sp ? { x: sp[0], y: sp[1] } : { x: k.x - 60, y: k.y };
}
function editorPlayer(mode) {
  return W.EDITOR_FEATURES.find((feature) => {
    if (!["player", "spawn"].includes(feature.type) || feature.geometry?.kind !== "point") return false;
    const playerMode = feature.properties?.playerMode || "all";
    return playerMode === "all" || playerMode === mode;
  }) || null;
}
function authoredSpawn(mode, fallback, explicit = null) {
  if (explicit && Number.isFinite(explicit.x) && Number.isFinite(explicit.y)) return explicit;
  const feature = editorPlayer(mode);
  if (!feature) return fallback;
  return {
    x: feature.geometry.point[0],
    y: feature.geometry.point[1],
    a: (Number(feature.properties?.angle) || 0) * Math.PI / 180,
  };
}
function authoredVehicle(mode, requested) {
  return requested || editorPlayer(mode)?.properties?.vehicleKey || state.vehicleKey;
}
function authoredWeather(fallback = "sunny") {
  return W.EDITOR_CONTENT?.world?.weather?.default || fallback;
}
// Run-start economy state: reset the run wallet and consume any armed boosts
// (picked in the vehicle picker; each is one use).
function armRun() {
  state.runCoins = 0;
  state.icepackT = 0; state.headstartT = 0;
  const armed = state.armedBoosts || {};
  if (armed.icepack && economy.useBoost("icepack")) state.icepackT = 30;
  if (armed.headstart && economy.useBoost("headstart")) state.headstartT = 5;
  consumeEditorBoosts(
    Object.fromEntries(Object.entries(armed).filter(([id]) => id !== "icepack" && id !== "headstart")),
    economy,
    state,
  );
  state.armedBoosts = null;
}

export function startStage(stageIdx, vehicleKey) {
  const stg = W.STAGES[stageIdx];
  state.stage = stg;
  state.stageIdx = stageIdx;
  state.mode = "story";
  state.weather = stg.weather;
  setDayCycle(false);          // a stage's sky is part of its brief
  state.timeLeft = stg.timeLimit;
  state.stageDeliveries = 0;
  state.stageTarget = stg.targetDeliveries;
  const rv = resolveVehicle(authoredVehicle("story", vehicleKey));
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = []; state.arcadeCoins = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  // A CROSSING STAGE STARTS ABOARD. There is no kiosk to spawn beside and no
  // delivery to make: the level is the estero, so the player begins parked on
  // the lancha's deck with her already under way, under level rules (one
  // direction, three knocks and she swamps).
  const crossingFerry = stg.kind === "crossing"
    ? ferries().find((f) => f.id === stg.ferry) : null;
  let sp;
  if (crossingFerry) {
    const q = { x: crossingFerry.x, y: crossingFerry.y, a: crossingFerry.a };
    sp = authoredSpawn("story", q);
  } else {
    // place player near first kiosk of stage (on its street-snapped spawn)
    const k = W.landmarkById(stg.kiosks[0]);
    sp = authoredSpawn("story", spawnAtKiosk(k));
  }
  state.p = { x: sp.x, y: sp.y, a: sp.a || 0, vx: 0, vy: 0, speed: 0, drift: 0 };
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
  resetFerries();   // both ferries home and available again every run
  resetEditorTriggers();
  if (crossingFerry) {
    // She is already sailing: the level is the passage, not the wait for it.
    crossingFerry.phase = "out";
    state.p.x = crossingFerry.x; state.p.y = crossingFerry.y; state.p.a = crossingFerry.a;
    state.cam.x = state.p.x; state.cam.y = state.p.y;
    startCrossing(crossingFerry, { level: true });
  } else {
    pickCustomer();
  }
  analytics.track("run_start", { mode: "story", stage_id: stg.id, vehicle: state.vehicleKey });
}

export function startArcade(opts = {}) {
  state.stage = null;
  state.stageIdx = 0;
  state.mode = "arcade";
  // ARCADE PICKS ITS SKY. Three minutes is shorter than any phase of the day,
  // so a cycle here would either never turn or strobe; the run says what it
  // wants and keeps it. `cycle` is offered for anyone who wants the turn.
  state.weather = opts.weather || authoredWeather();
  setDayCycle(Boolean(opts.cycle), opts.dayAt ?? 0);
  state.timeLeft = 180;
  const rv = resolveVehicle(authoredVehicle("arcade", opts.vehicleKey));
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = []; state.arcadeCoins = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  const k0 = W.landmarkById("kios_paseo1");
  { const _sp = authoredSpawn("arcade", spawnAtKiosk(k0)); state.p = { x: _sp.x, y: _sp.y, a: _sp.a || 0, vx: 0, vy: 0, speed: 0, drift: 0 }; }
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
  resetFerries();   // both ferries home and available again every run
  resetEditorTriggers();
  pickCustomer();
  analytics.track("run_start", { mode: "arcade", vehicle: state.vehicleKey });
}

export function startExplore(opts = {}) {
  state.stage = null;
  state.stageIdx = 0;
  state.mode = "explore";
  // RECORRER GETS A DAY. Ten real minutes for a full turn — sunny, atardecer,
  // night, amanecer — with a storm rolling in now and then and handing the sky
  // back where it left off. An explicit `weather` still wins: asking for one
  // and getting a cycle would be a bug, not a feature.
  state.weather = opts.weather || authoredWeather();
  setDayCycle(!opts.weather, Math.random());
  state.timeLeft = 999;
  const rv = resolveVehicle(authoredVehicle("explore", opts.vehicleKey));
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = []; state.arcadeCoins = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  // Spawn on the faro muelle by default. The world editor may provide an exact
  // generated-world point for a one-click playtest.
  const editorSpawn = Number.isFinite(opts.x) && Number.isFinite(opts.y)
    ? { x: opts.x, y: opts.y }
    : null;
  const kf = W.landmarkById("kios_faro"), f0 = W.landmarkById("faro");
  const fallback = (kf && kf.spawn) ? { x: kf.spawn[0], y: kf.spawn[1] } : null;
  const sp = authoredSpawn("explore", fallback, editorSpawn);
  state.p = sp ? { x: sp.x ?? sp[0], y: sp.y ?? sp[1], a: sp.a ?? opts.angle ?? 0, vx: 0, vy: 0, speed: 0, drift: 0 }
               : { x: f0.x + 60, y: f0.y, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 };
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
  resetFerries();   // both ferries home and available again every run
  resetEditorTriggers();
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
  const rv = resolveVehicle(authoredVehicle("tutorial", opts.vehicleKey));
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = []; state.arcadeCoins = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  const k0 = W.landmarkById("kios_paseo1");
  { const _sp = authoredSpawn("tutorial", spawnAtKiosk(k0)); state.p = { x: _sp.x, y: _sp.y, a: _sp.a || 0, vx: 0, vy: 0, speed: 0, drift: 0 }; }
  state.cam.x = state.p.x; state.cam.y = state.p.y; state.cam.shake = 0;
  state.storyTip = "";
  rebuildBarriers();
  state.district = null; state.districtToast = null;
  W.update(state.cam.x, state.cam.y);
  W.ready(state.cam.x, state.cam.y, state.cam.vw || 1600, state.cam.vh || 1000);
  spawnTraffic(); spawnPedestrians(); spawnGulls(); spawnBoats();
  resetFerries();   // both ferries home and available again every run
  resetEditorTriggers();
  pickCustomerNear(k0.x, k0.y); // short, predictable first delivery
  initTutorial();
  analytics.track("run_start", { mode: "tutorial", vehicle: state.vehicleKey });
}

export function setWeather(w) { state.weather = w; }
export function setVehicle(k) {
  const rv = resolveVehicle(k);
  state.vehicleKey = rv.key; state.veh = rv.veh;
}
