// Game-mode starts (story / arcade / explore) and world setters.
import { WORLD2D as W } from "../world2d/index.js";
import { STAGE_KIND, VEHICLE_MEDIUM } from "../domain/vocabulary.generated.js";
import { state, pushFloat } from "./state.js";
import { VEHICLES, vehicleMedium } from "./vehicles.js";
import { spawnTraffic, spawnPedestrians, spawnGulls, spawnBoats } from "./spawns.js";
import { ferries, resetFerries, routePoint } from "./ferries.js";
import { startCrossing, crossingCondition, resetCrossing } from "./crossing.js";
import { setTide } from "./tides.js";
import { setDayCycle } from "./daynight.js";
import { pickCustomer, pickCustomerNear } from "./delivery.js";
import { rebuildBarriers, bumpCrossingRuns } from "./progress.js";
import { initTutorial } from "./tutorial.js";
import { economy, FREE_VEHICLES, VEHICLE_PRICES } from "./economy.js";
import { t, stageBrief } from "../i18n/index.js";
import { analytics } from "../monetize/analytics.js";
import { resetEditorTriggers } from "./editorGameplay.js";
import { applyOwnedShopEffects, consumeEditorBoosts } from "./editorContent.js";

// Resolve the run vehicle: enforce ownership and apply the equipped paint by
// cloning — paintVehicle reads veh.color.
//
// THE FALLBACK IS PER MEDIUM, and that is not a nicety. It used to be the bare
// string "scooter", which is the right answer for every delivery in the game and
// the catastrophic one for the estero: a player who has not bought a boat would
// start the Travesía on a moped, inside a wall, in the middle of the water.
// FREE_VEHICLES is guaranteed to hold at least one entry per medium.
function freeVehicleFor(medium) {
  return FREE_VEHICLES.find((k) => vehicleMedium(k) === medium)
    || (medium === VEHICLE_MEDIUM.WATER ? "panga" : "scooter");
}
function resolveVehicle(key, medium = VEHICLE_MEDIUM.LAND) {
  const owned = economy.ownsVehicle(key) && vehicleMedium(key) === medium;
  const k = owned ? key : freeVehicleFor(medium);
  const col = economy.equippedColor(k);
  const painted = col ? { ...VEHICLES[k], color: col.hex } : VEHICLES[k];
  return { key: k, veh: applyOwnedShopEffects(k, painted, state.progress) };
}
//: the medium a run demands. A crossing stage is sailed; everything else driven.
export function stageMedium(stg) {
  return stg?.kind === STAGE_KIND.CROSSING
    ? VEHICLE_MEDIUM.WATER : VEHICLE_MEDIUM.LAND;
}

//: how far along the route the player's boat starts.
//: NOT at the berth cell itself: the berth is the SHORELINE — the last water
//: cell before the sand, chosen by the build so a ferry could lie alongside —
//: so starting exactly on it puts half the hull in a wall and the solver spends
//: the opening second shoving her off the beach. A little way out is clear
//: water on a line the build already proved navigable.
const START_OUT_PX = 70;

/** The player's pose on the start line of a crossing, or null if there is no
 *  route to start on.
 *
 *  NULL IS A REAL ANSWER, not a defensive habit. A lancha only reaches the
 *  manifest if the build's water flood found a navigable line between her two
 *  ends; when it does not, `place_lanchas` warns and emits no ferry at all. So
 *  a crossing stage can legitimately ship pointing at a boat that is not there,
 *  and reading `.x` off the undefined it resolves to threw a TypeError inside
 *  `startStage` — which is the freeze-shaped failure this codebase keeps
 *  getting bitten by, from a world change nobody would think to re-test the UI
 *  against. */
function startAtBerth(f) {
  if (!f || !f.pts || f.pts.length < 2) return null;
  const q = routePoint(f, START_OUT_PX);
  return { x: q.x, y: q.y, a: q.a };
}

// ---- Recorrer: taking the lancha -------------------------------------------
// In a stage the crossing IS the level, so the boat is what you picked in the
// menu. In Recorrer you arrive by road, and the muelle is a place where the
// road runs out — so the swap happens there, in the world, rather than in a
// screen. Park on the pier, and you get into your own lancha; land at Pitahaya,
// and you get your car back. That is why the car key is STASHED rather than
// re-derived: a player who drove out in a bought pickup must not come home in
// the free scooter.
export function takeTheLancha(ferry, vehicleKey = null) {
  if (!ferry) return false;
  state.landVehicleKey = state.vehicleKey;
  const rv = resolveVehicle(vehicleKey || bestOwnedBoat(), VEHICLE_MEDIUM.WATER);
  state.vehicleKey = rv.key; state.veh = rv.veh;
  const q = startAtBerth(ferry);
  state.p.x = q.x; state.p.y = q.y; state.p.a = q.a;
  state.p.vx = 0; state.p.vy = 0; state.p.speed = 0; state.p.drift = 0;
  pushFloatSafe(t("crossing.take"));
  startCrossing(ferry, { level: false });
  return true;
}

/** Back onto the road at whichever shore she was left at. */
export function leaveTheLancha() {
  const key = state.landVehicleKey || "scooter";
  const rv = resolveVehicle(key, VEHICLE_MEDIUM.LAND);
  state.vehicleKey = rv.key; state.veh = rv.veh;
  state.landVehicleKey = null;
  // The apron at either end is stamped ROAD, so the nearest drivable cell IS
  // the ramp the build paved — no separate landing point has to be authored.
  const spot = W.reachablePointNear(state.p.x, state.p.y, 320);
  state.p.x = spot.x; state.p.y = spot.y;
  state.p.vx = 0; state.p.vy = 0; state.p.speed = 0; state.p.drift = 0;
}

// ---- the offer at the muelle ------------------------------------------------
// Parking at the berth used to put you straight into a boat the game chose for
// you. It picks the hull now, which is the same decision every other run in the
// game gets to make — and it matters more here than in a menu, because the
// three lanchas handle so differently that "which one am I crossing in" IS the
// difficulty setting.
//
// Physics only RAISES the offer; the UI owns the rest. The sim must not know
// what a screen is, and the player must not be dropped into a picker by driving
// past — hence the decline, which stands until they leave the berth.

/** The ferry currently being offered, or null. */
export function offeredLancha() {
  return ferries().find((f) => f.id === state.lanchaOffer) || null;
}

/** Take the offered lancha in `vehicleKey` (or the best one owned). */
export function acceptLancha(vehicleKey = null) {
  const f = offeredLancha();
  state.lanchaOffer = null;
  return f ? takeTheLancha(f, vehicleKey) : false;
}

/** "Not now" — remembered so the offer does not reopen on the next frame while
 *  the car is still sitting on the muelle. Cleared when they drive away. */
export function declineLancha() {
  state.lanchaDeclined = state.lanchaOffer;
  state.lanchaOffer = null;
}

//: the best boat the player actually owns — the default the picker opens on,
//: and what a caller that does not care gets.
function bestOwnedBoat() {
  const boats = Object.keys(VEHICLES)
    .filter((k) => vehicleMedium(k) === VEHICLE_MEDIUM.WATER && economy.ownsVehicle(k))
    .sort((a, b) => (VEHICLE_PRICES[b] || 0) - (VEHICLE_PRICES[a] || 0));
  return boats[0] || "panga";
}

function pushFloatSafe(text) {
  pushFloat(state.p.x, state.p.y - 44, text, "#9fd7ef");
}
// Player start beside a kiosk: use the build-authored `spawn` (snapped to the
// nearest drivable street), never the kiosk's beach-facing icon position — that
// dropped the car onto the sand beside sand kiosks.
function spawnAtKiosk(k) {
  // NULL IS REACHABLE. A crossing stage carries `kiosks: []`, so if its ferry
  // fails to resolve the fallback path arrives here with `landmarkById(undefined)`
  // — and the old `{ x: k.x - 60 }` threw a TypeError out of `startStage`
  // itself, which is the freeze-shaped failure this codebase keeps meeting.
  if (!k) return null;
  const sp = k.spawn;
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
  resetCrossing();
  const stg = W.STAGES[stageIdx];
  state.stage = stg;
  state.stageIdx = stageIdx;
  state.mode = "story";
  state.weather = stg.weather;
  setDayCycle(false);          // a stage's sky is part of its brief
  // …EXCEPT THE TRAVESÍA, whose sky and tide ARE the brief. The estero is a
  // different course at bajamar than at pleamar and a different one again in an
  // aguacero, so the crossing rotates through its four conditions by attempt
  // rather than naming one in the world. The day clock still stays off: a
  // three-minute run that cycled the whole day would strobe, and the point is
  // that this run has an hour, not that it has all of them.
  const crossCond = stg.kind === STAGE_KIND.CROSSING
    ? crossingCondition(bumpCrossingRuns(stg.id)) : null;
  if (crossCond) {
    state.weather = crossCond.weather;
    setTide(crossCond.tide);
  } else {
    setTide(0.5);
  }
  state.timeLeft = stg.timeLimit;
  state.stageDeliveries = 0;
  state.stageTarget = stg.targetDeliveries;
  const rv = resolveVehicle(authoredVehicle("story", vehicleKey), stageMedium(stg));
  state.vehicleKey = rv.key; state.veh = rv.veh;
  armRun();
  state.score = 0; state.combo = 1; state.comboTimer = 0;
  state.deliveries = 0; state.perfect = 0;
  state.carrying = null; state.pendingOrder = null;
  state.floats = []; state.particles = []; state.arcadeCoins = [];
  state.over = false; state.won = false; state.running = true; state.paused = false;
  state.usedAdContinue = false;
  // A CROSSING STAGE STARTS AT THE BERTH, AS THE BOAT. There is no kiosk to
  // spawn beside and no delivery to make: the level is the estero, and the
  // player IS the lancha — a water-medium vehicle out of the picker, not a car
  // parked on somebody else's deck. The berth and the heading still come from
  // the world's ferry record, because that is where the build put the muelle.
  const crossingFerry = stg.kind === STAGE_KIND.CROSSING
    ? ferries().find((f) => f.id === stg.ferry) : null;
  let sp;
  if (crossingFerry) {
    const q = { x: crossingFerry.x, y: crossingFerry.y, a: crossingFerry.a };
    sp = authoredSpawn("story", q);
  } else {
    // place player near first kiosk of stage (on its street-snapped spawn)
    const k = W.landmarkById((stg.kiosks || [])[0]);
    sp = authoredSpawn("story", spawnAtKiosk(k));
  }
  // Last resort: a stage that resolved neither a boat nor a kiosk still has to
  // put the player SOMEWHERE, because everything below dereferences the pose.
  if (!sp) sp = { x: state.p?.x || W.W * 0.5, y: state.p?.y || W.H * 0.5, a: 0 };
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
    // THE LANCHA HERSELF IS SENT AWAY. She used to be the thing you rode, and
    // leaving her sitting on the start line would put a 86x34 px hull on top of
    // the player's own boat — she is scenery at the far shore now, where the
    // real one waits between passages.
    crossingFerry.phase = "docked";
    crossingFerry.far = true;
    crossingFerry.s = crossingFerry.total;   // advanceFerries re-poses her there
    const nudge = startAtBerth(crossingFerry);
    if (nudge) {
      state.p.x = nudge.x; state.p.y = nudge.y; state.p.a = nudge.a;
      state.cam.x = state.p.x; state.cam.y = state.p.y;
    }
    startCrossing(crossingFerry, { level: true });
  } else if (stg.kind === STAGE_KIND.CROSSING) {
    // The stage says "sail to Pitahaya" and the world shipped no boat to sail:
    // the build could not find navigable water between the two ends and warned
    // instead of emitting a ferry. Say so, once, where somebody will see it —
    // and leave the run standing rather than throwing out of the mode start.
    console.warn(`[crossing] stage ${stg.id} wants ferry '${stg.ferry}', which this world does not contain`);
    state.storyTip = stageBrief(stg);
  } else {
    pickCustomer();
  }
  analytics.track("run_start", { mode: "story", stage_id: stg.id, vehicle: state.vehicleKey });
}

export function startArcade(opts = {}) {
  resetCrossing();
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
  resetCrossing();
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
  resetCrossing();
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
  // Honour the medium the KEY asks for, not the run's: this is the picker and
  // the console setter, and both are choosing a vehicle rather than a stage.
  const rv = resolveVehicle(k, vehicleMedium(k));
  state.vehicleKey = rv.key; state.veh = rv.veh;
}
