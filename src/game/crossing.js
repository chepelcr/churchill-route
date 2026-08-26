// La Travesía del Estero — the estero crossing, as a RACE.
//
// This file used to drive the boat. The lancha sailed herself along the route
// `ferries.js` walks, the player owned a throttle and a ±78 px lateral offset,
// and the obstacles were tested against the BOAT's circle rather than against
// anybody's steering. That is a ride with a wobble in it, and it read as one.
//
// Now the player IS the boat — an ordinary water-medium vehicle out of
// `vehicles.js`, colliding with the world through the same capsule solver as
// every car — and this module stopped being a driver and became a RACE
// DIRECTOR. It answers four questions and nothing else:
//
//   * WHERE AM I ON THE COURSE?  `projectToRoute` puts the free-swimming boat
//     back onto the route polyline as an arclength. Everything downstream —
//     progress, gates, the finish, sailing the wrong way — is that one number.
//   * WHAT HAVE I PASSED THROUGH?  The buoys already come in PAIRS, one per
//     side at the same arclength, so a gate costs no new geometry: it is a pair
//     promoted.
//
//     THIS FILE USED TO REFUSE A HUD ARROW — "el estero son 5,7 km de agua
//     abierta y la navegación tiene que ser diegética". That rule was written
//     when the boat was on a rail and could not get lost. Freed, the same 5,7 km
//     of open water stopped reading as a place to explore and started reading
//     as a corridor you were being shoved down, because the only thing telling
//     you where the channel was were the marks themselves and a drag that
//     punished you for missing them. The arrow REPLACES the drag: point at the
//     next pair of buoys and the estero can be open water again, because you
//     can leave the line and find your way back.
//   * WHAT HAVE I HIT?  `advanceEstero` resolves the four obstacle behaviours
//     against the PLAYER now, not against a ferry that is no longer steering.
//   * IS IT OVER?  `endCrossing` — see the note on the win path below.
//
// THE OBSTACLES ARE FOUR DIFFERENT BEHAVIOURS ON PURPOSE, not one collision.
// Pangas cost you and they MOVE, working across the channel the way the
// balneario's launch does, so they have to be read rather than memorised. Fish
// schools PAY you for leaving the racing line. Gulls take the view away without
// touching you. Remolinos are not a collision at all — they are a current that
// keeps working on you the whole time you are in one.
//
// THE WIN PATH IS THE BUG THIS REWRITE EXISTS TO FIX. `endCrossing(CROSSING_OUTCOME.LANDED)`
// used to set `_crossing.done` and NOTHING IN THE CODEBASE READ IT.
// `delivery.js` held the only `state.won = true`, gated on deliveries, and s8
// has `targetDeliveries: 0` — so the level could only ever end by its own
// timeout, always as a loss. Landing at Pitahaya and sinking in the mangrove
// were the same outcome. `finish()` below is where that is put right.
import { WORLD2D as W } from "../world2d/index.js";
import { SURFACE } from "./surfaces.js";
import { CROSSING_OUTCOME, ESTERO_ENCOUNTER, STAGE_KIND } from "../domain/vocabulary.generated.js";
import { CHANNEL_PITCH, TANGENT_SPAN } from "../domain/units.js";
import { addTime, timeRemaining } from "./timers.js";
import { state, pushFloat } from "./state.js";
import { t } from "../i18n/index.js";
import { markStageCleared, unlockDistrict } from "./progress.js";
import { tideLevel } from "./tides.js";

// ---- the lane -------------------------------------------------------------
//: THE FALLBACK half-width, in world px, and nothing else any more.
//:
//: This used to BE the lane: one constant, 105 px, so 210 px between the marks
//: for the whole 5,7 km. The estero is not 210 px wide for the whole 5,7 km —
//: measured off the shipped world, the corridor is under 240 px for 68 % of the
//: route and drops to 80 px off el Centro — so 82 of the 170 buoys stood on dry
//: mangrove and 16 of the 22 gates had a mark ashore. The marked channel was
//: lying about where the water was, which is the one thing a marked channel
//: must not do.
//:
//: The world measures it now and ships it per arclength (`manifest.ferries[].
//: channel`). This survives as the answer for a world built before that field
//: existed: a stale `src/world2d/` must still boot and still be playable.
export const LANE_HW = 105;
//: the marked lane pulls in this far from the real water's edge, so a buoy is
//: IN the channel rather than on its bank.
const BUOY_MARGIN = 24;
//: …but never further in than this FRACTION of the water there is. A fixed
//: margin on a narrow reach would put the two marks on top of each other.
const LANE_MIN_FRAC = 0.6;
//: THERE IS NO MINIMUM WIDTH, and there was: `LANE_MIN_HW = 64` clamped the
//: lane UP so the marks stayed readable where the estero got thin. Readable
//: marks standing on mangrove are worse than narrow ones standing on water,
//: and that clamp is precisely how seven of them ended up ashore. The lane is
//: now always a fraction of the room the world measured, so a buoy is inside
//: the water BY CONSTRUCTION.
const LANE_MAX_HW = 190; // authored course half-width across the open basin
//: buoys every this many px of arclength, and half that through a bend
const BUOY_GAP = 260;
const BEND_GAP = 130;
//: a turn sharper than this (radians between legs) counts as a bend
const BEND_ANG = 0.35;

//: a GATE every this many px of arclength. Not every Nth PAIR, which is what
//: this used to be: the buoy spacing halves through a bend, so counting pairs
//: made the gates bunch up exactly where the course was already busiest and
//: stretch out over the long straights where a checkpoint would have been
//: worth something. Arclength gives ~15 evenly spaced decisions.
const GATE_GAP = 900;
//: …and every Nth of those is a PORTÓN DE IMPULSO: through the middle of the
//: mouth and it pays a full boost. Wide still counts — precision is rewarded,
//: imprecision is not punished, which is the arcade rule.
const BOOST_GATE_EVERY = 3;
//: how much of the gate mouth counts as "through the middle".
const BOOST_GATE_BAND = 0.3;
//: seconds banked for passing through a gate the right way round
const GATE_BONUS = 6;
//: how far past the last gate the landing counts as reached
const FINISH_PAD = 120;
//: beyond this the compass leads along the channel instead of sighting the
//: gate, and this is how far ahead it looks when it does.
const ARROW_LEAD = 900;
const ARROW_STEP = 500;
//: how far past a gate's arclength before it counts as missed rather than
//: still-being-approached. A boat crabbing across the channel can sit level
//: with a gate for a second before she goes through it.
const GATE_MISS_PAD = 90;

let _channels = null;

/** Buoy pairs, gates and the lane polyline for every ferry that has a channel.
 *  Derived from the route: the world emits no buoys, and does not need to. */
export function channels() {
  if (_channels) return _channels;
  _channels = new Map();
  for (const f of W.FERRIES || []) {
    if (!f.oneWay) continue;              // the gulf ferries sail open water
    const pts = [];
    for (let i = 0; i < f.route.length; i += 2) pts.push([f.route[i], f.route[i + 1]]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const total = cum[cum.length - 1] || 1;
    const ch = { pts, cum, total, chan: f.channel || null, buoys: [], gates: [] };
    const buoys = ch.buoys, gates = ch.gates;
    let s = BUOY_GAP * 0.5;
    let lastGateS = -Infinity;
    // …and the last pair stops well short of the landing. The final 120 px is
    // `FINISH_PAD` and the landing itself is SHORE on purpose — a buoy there is
    // a mark standing on the ramp you are aiming at.
    while (s < total - 260) {
      // EVERY MARK IS PLACED THROUGH `laneAt`, which is the whole fix: it puts
      // the pair on the measured water at that arclength instead of at a
      // constant offset from a polyline that may be running up the bank.
      const q = laneAt(ch, s);
      const gap = bendAt(pts, cum, s) ? BEND_GAP : BUOY_GAP;
      // A GATE IS A PAIR PROMOTED, not a new object in the world. The two
      // buoys are already at the same arclength on opposite sides, so the gate
      // is the segment between them and it is drawn for free by drawing them.
      const isGate = s - lastGateS >= GATE_GAP;
      const side1 = [], side2 = [];
      for (const side of [-1, 1]) {
        const b = {
          x: q.x - Math.sin(q.a) * q.hw * side,
          y: q.y + Math.cos(q.a) * q.hw * side,
          // Red to PORT, green to starboard, in the direction of the outbound
          // passage — the same convention the estero's own markers use.
          side, red: side > 0, ph: (s * 0.017) % (Math.PI * 2), gate: isGate,
        };
        buoys.push(b);
        (side < 0 ? side1 : side2).push(b);
      }
      if (isGate) {
        lastGateS = s;
        gates.push({
          s, index: gates.length,
          ax: side1[0].x, ay: side1[0].y,
          bx: side2[0].x, by: side2[0].y,
          cx: q.x, cy: q.y, hw: q.hw,
          boost: gates.length % BOOST_GATE_EVERY === 0,
          taken: false, missed: false,
        });
      }
      s += gap;
    }
    _channels.set(f.id, ch);
  }
  return _channels;
}

/** Linear read into a per-arclength array emitted by the build. */
function lerpArr(arr, u) {
  if (!arr || !arr.length) return null;
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(u)));
  const j = Math.min(arr.length - 1, i + 1);
  const k = Math.max(0, Math.min(1, u - i));
  return arr[i] + (arr[j] - arr[i]) * k;
}

/**
 * …but the WIDTH is read as the NARROWER of the two samples it falls between.
 *
 * The build measures the channel every 40 px and the marks go in every 260, so
 * a buoy almost always lands BETWEEN two samples — and interpolating a width
 * across a bend claims the average of two places while standing in neither.
 * That is the last three marks that were still ashore after the lane itself
 * became honest. Between two soundings you trust the shallower one, which is
 * what any pilot does and costs a few px of lane where the estero is turning.
 */
function minArr(arr, u) {
  if (!arr || !arr.length) return null;
  const i = Math.max(0, Math.min(arr.length - 1, Math.floor(u)));
  const j = Math.min(arr.length - 1, i + 1);
  return Math.min(arr[i], arr[j]);
}

/**
 * The centre of the navigable water at arclength `s`, and how wide it is there.
 *
 * `at()` still exists and is still right — it is the arclength math on the
 * polyline. This is the thing that turns an arclength into a PLACE, and
 * everything that puts an object in the estero goes through it: buoys, gates,
 * pangas, yates, remolinos, bancos and the drawn lane. That is what stops the
 * course being scattered across the mangrove.
 *
 * `off` matters as much as `hw`. Douglas-Peucker is allowed to move the route
 * up to its tolerance, so a chord across a bend cuts to the inside of the real
 * channel; the build measures how far the water's centre actually lies to
 * starboard and this puts the lane back on it.
 *
 * Falls back to the old constant when the world shipped no `channel` — see
 * `LANE_HW`.
 */
//: the lane's heading is measured over this much arclength either side, NOT
//: from the segment the point happens to land on. It HAS to match the build's
//: `TANGENT_SPAN`: the world measured the channel across a smoothed normal, so
//: a client placing the marks across the raw segment normal is putting them on
//: a different line from the one that was sounded. The route averages ~23 px a
//: segment and the disagreement is easily a few degrees — which at 150 px out
//: is the difference between the middle of the channel and the mangrove.
//:
//: So it is no longer written down twice. Both ends read the metres in
//: `src/assets/world-units.json` and derive their own px (2026-08-14).

export function laneAt(ch, s) {
  const q = at(ch.pts, ch.cum, s);
  const c = ch.chan;
  if (!c || !c.hw || !c.hw.length) return { x: q.x, y: q.y, a: q.a, hw: LANE_HW };
  const b = at(ch.pts, ch.cum, s - TANGENT_SPAN);
  const f = at(ch.pts, ch.cum, s + TANGENT_SPAN);
  q.a = Math.atan2(f.y - b.y, f.x - b.x);
  const u = s / (c.pitch || CHANNEL_PITCH);
  const off = lerpArr(c.off, u) || 0;
  const room = minArr(c.hw, u) || LANE_HW;
  // INSIDE THE WATER BY CONSTRUCTION: pull in by the margin, but never past a
  // fraction of the room or wider than the room itself. The water may open much
  // farther after the estuary flood; the authored cap keeps the marks a useful
  // regatta course instead of scattering them across the whole basin.
  const measuredHw = Math.min(room,
    Math.max(room - BUOY_MARGIN, room * LANE_MIN_FRAC));
  const hw = Math.min(measuredHw, LANE_MAX_HW);
  return { x: q.x - Math.sin(q.a) * off, y: q.y + Math.cos(q.a) * off, a: q.a, hw };
}

export function channelOf(ferry) {
  return channels().get(ferry?.id) || null;
}

// ---- the conditions a crossing is sailed in --------------------------------
// THE ESTERO IS NOT THE SAME PLACE TWICE, and the four rows below are the level
// design. Weather and tide are ONE choice, not two, because they interact: a
// storm piles the water up, so the hard run is not the one with the least water
// but the one with the most. Sailing the same 5,7 km at bajamar and at pleamar in
// an aguacero are two different courses on one polyline, which is the cheapest
// real variety this level can have.
//
// THE ROTATION IS BY ATTEMPT, NOT RANDOM. You meet all four in your first four
// crossings, in an order that teaches them — the calm low water first, where
// the banks are visible and the channel explains itself, and the storm last.
// Random would hand a beginner the aguacero and call it bad luck.
export const CROSSING_CONDITIONS = [
  // bajamar: the banks are OUT, the lane is a thread, and the water is flat.
  { id: "bajamar", weather: "sunny", tide: 0.08 },
  // media marea al atardecer: the postcard, and an honest middle.
  { id: "atardecer", weather: "sunset", tide: 0.45 },
  // pleamar de noche: everything is covered, so the lane is wide — and you
  // cannot see any of it. The buoys are lit, which is suddenly the point.
  { id: "pleamar", weather: "night", tide: 0.9 },
  // aguacero: high water AND a surge on top. Wide, black, and all of it moving.
  { id: "aguacero", weather: "storm", tide: 0.7 },
];

/** The conditions the nth attempt at a crossing is sailed in. */
export function crossingCondition(n = 0) {
  const i = ((n % CROSSING_CONDITIONS.length) + CROSSING_CONDITIONS.length)
    % CROSSING_CONDITIONS.length;
  return CROSSING_CONDITIONS[i];
}

/** How many gates a crossing stage has, for the brief.
 *  DERIVED, like the buoys themselves — the world emits a route and the gate
 *  count falls out of it, so the number on the brief can never disagree with
 *  the number in the water. Returns 0 for a stage that is not a crossing. */
export function gateCount(stage) {
  if (stage?.kind !== STAGE_KIND.CROSSING) return 0;
  return channels().get(stage.ferry)?.gates.length || 0;
}

function at(pts, cum, s) {
  const u = Math.max(0, Math.min(cum[cum.length - 1], s));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < u) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const k = (u - cum[i - 1]) / seg;
  const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
  return { x: ax + (bx - ax) * k, y: ay + (by - ay) * k, a: Math.atan2(by - ay, bx - ax) };
}

function bendAt(pts, cum, s) {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  if (i < 2 || i >= pts.length - 1) return false;
  const a0 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
  const a1 = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]);
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d) > BEND_ANG;
}

/** Signed distance from the lane centre at arclength `s`. */
export function laneOffset(channel, s, x, y) {
  // FROM THE LANE'S CENTRE, not the polyline's. They are no longer the same
  // point: the build measures how far to starboard the water actually centres
  // (`off`), so a boat sailing dead down the middle of the marked channel can
  // read 30 px off the route. The portón de impulso tests "through the middle
  // of the mouth", and the mouth is between the two buoys.
  const q = laneAt(channel, s);
  return (x - q.x) * -Math.sin(q.a) + (y - q.y) * Math.cos(q.a);
}

/**
 * Put a free-swimming boat back on the course.
 *
 * THIS IS THE FUNCTION THE WHOLE RACE RESTS ON. When the boat sailed the route
 * on rails her arclength was an input — the throttle wrote it. Now she goes
 * where she is steered, so the arclength has to be RECOVERED: the nearest point
 * on the polyline, which gives progress, the finish test, the gate ordering and
 * wrong-way detection from one projection.
 *
 * Every segment is tested. The estero doubles back on itself, so tracking a
 * "current segment" and searching outward from it locks onto the wrong leg
 * where the channel folds — and a boat that reads as 80% done while sitting in
 * the first bend is worse than one that costs a few dozen dot products.
 *
 * @returns {{s:number, offset:number, ax:number, ay:number}} arclength, signed
 *   lateral offset from the centreline, and the closest point itself.
 */
export function projectToRoute(channel, x, y) {
  const { pts, cum } = channel;
  let best = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let k = l2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0;
    k = k < 0 ? 0 : k > 1 ? 1 : k;
    const qx = ax + dx * k, qy = ay + dy * k;
    const d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy);
    if (!best || d2 < best.d2) {
      const len = Math.sqrt(l2) || 1;
      best = {
        d2, s: cum[i - 1] + k * len, ax: qx, ay: qy,
        // signed: positive is to starboard of the outbound heading
        offset: ((x - qx) * -(dy / len) + (y - qy) * (dx / len)),
      };
    }
  }
  return best || { s: 0, offset: 0, ax: x, ay: y };
}

// ---- the crossing ---------------------------------------------------------
const KNOCKS = 3;               // …and she swamps

// THE STATE IS REACHED THROUGH `crossingState()`, and the NAME matters. An
// export called `crossing` from a module called `crossing.js` collided in the
// bundle and left the binding in a TEMPORAL DEAD ZONE: the dev server was clean,
// an unminified build was clean, and the shipped one threw "Cannot access 's'
// before initialization" on the first frame — which reads as a freeze, not as an
// error. `node tools/smoke.mjs` caught it, for the fourth time in this file's
// history of that exact class of bug.
const _crossing = {
  active: false, ferry: null, channel: null,
  level: false,                 // level rules (gates, damage) vs Recorrer
  knocks: 0, fish: 0, t: 0, offset: 0, done: null,
  s: 0, progress: 0, gateIndex: 0, gates: 0, wrongWay: false,
  // el impulso, and what earns it
  boost: 0, near: 0, streak: 0, streakT: 0, bestStreak: 0, jumps: 0,
  // the last gate passed, as a respawn pose — see `respawn()`
  checkpoint: null,
};

export function crossingState() { return _crossing; }

export function startCrossing(ferry, { level = false } = {}) {
  const channel = channelOf(ferry);
  if (!channel) return false;
  _crossing.active = true;
  _crossing.ferry = ferry;
  _crossing.channel = channel;
  _crossing.level = level;
  _crossing.knocks = 0;
  _crossing.fish = 0;
  _crossing.t = 0;
  _crossing.offset = 0;
  _crossing.done = null;
  _crossing.s = 0;
  _crossing.progress = 0;
  _crossing.gateIndex = 0;
  _crossing.gates = channel.gates.length;
  _crossing.wrongWay = false;
  _crossing.boost = 0;
  _crossing.near = 0; _crossing.streak = 0; _crossing.streakT = 0;
  _crossing.bestStreak = 0; _crossing.jumps = 0;
  // THE START LINE IS A CHECKPOINT, and leaving it null was a silent killer.
  // `respawn()` used to call `endCrossing(CROSSING_OUTCOME.SWAMPED)` when there was nothing to
  // go back to — and NOTHING IN THIS CODEBASE READS `done`. So sinking before
  // the first gate did not end the run, it HOLLOWED it: `advanceCrossing`
  // returned false, the compass went blank, the obstacles froze, the finish
  // became unreachable, and the player sailed a dead estero until the clock ran
  // out with no idea why. The same class of bug this file's header says the
  // rewrite existed to fix, one function further down.
  //
  // `modes.js` poses `state.p` and nudges her `START_OUT_PX` down the route
  // BEFORE calling `startCrossing`, so the pose is already the start line here.
  _crossing.checkpoint = { x: state.p.x, y: state.p.y, a: state.p.a };
  for (const g of channel.gates) { g.taken = false; g.missed = false; }
  state.crossing = _crossing;
  spawnEstero(channel);
  return true;
}

export function endCrossing(reason) {
  _crossing.active = false;
  _crossing.done = reason;
  state.crossing = _crossing;
}

/**
 * Forget the crossing entirely. Called by every mode start.
 *
 * A CROSSING OUTLIVES THE RUN IT BELONGED TO otherwise, and nothing else clears
 * it: `endCrossing` only fires on landing, sinking or sailing home, so quitting
 * the Travesía from the pause menu and starting Recorrer left `active` true.
 * The estero then kept ticking over the top of the new run — obstacles resolved
 * against a player nowhere near them, the lane dragged on open road, and a
 * shoal of tuna in the gulf paid into a fish counter for a level that was no
 * longer being played, which is how this was found.
 */
export function resetCrossing() {
  _crossing.active = false;
  _crossing.done = null;
  _crossing.ferry = null;
  _crossing.channel = null;
  _crossing.knocks = 0;
  _crossing.fish = 0;
  _crossing.t = 0;
  _crossing.gateIndex = 0;
  _crossing.progress = 0;
  _crossing.checkpoint = null;
  esteroThings.length = 0;
  state.crossing = _crossing;
}

/**
 * The race is over and she made it.
 *
 * THIS IS THE PATH THAT DID NOT EXIST. Everything here mirrors what
 * `delivery.js` does on a stage clear — the same order, the same analytics
 * event, the same stretch-unlock of the next stage's district — because a
 * crossing cleared is a stage cleared, and the results screen, the stage
 * carousel and the save file must not be able to tell the difference.
 */
function finish() {
  endCrossing(CROSSING_OUTCOME.LANDED);
  pushFloat(state.p.x, state.p.y - 40, t("crossing.landed"), "#9fd7ef");
  if (!_crossing.level || !state.stage) return;   // Recorrer: arriving is its own reward
  // Time left and fish caught ARE the score here: there are no deliveries to
  // total, and a crossing that scored zero would rank last on the results
  // screen no matter how well it was sailed.
  // Time and fish were the whole score, which paid for exactly the timid line.
  // The rozadas, the streak and the gates are in it now, so sailing it WELL
  // beats sailing it safely.
  state.score += Math.round(timeRemaining(state) * 10
    + _crossing.fish * 25
    + (_crossing.near || 0) * 15
    + (_crossing.bestStreak || 0) * 50
    + _crossing.gateIndex * 40);
  state.won = true;
  state.over = true;
  markStageCleared(state.stage.id, state.score);
  recordCrossing(state.stage.id, _crossing);
  if (state.stage.unlock) unlockDistrict(state.stage.unlock);
  const nextS = W.STAGES[state.stageIdx + 1];
  if (nextS && nextS.unlock) unlockDistrict(nextS.unlock);
}

/** Best time and best catch, beside the stage records in the same save. */
function recordCrossing(stageId, c) {
  const p = state.progress;
  if (!p) return;
  if (!p.crossings || typeof p.crossings !== "object") p.crossings = {};
  const prev = p.crossings[stageId] || {};
  const secs = Math.round(c.t * 10) / 10;
  p.crossings[stageId] = {
    // A LOWER time is better, so an absent record must not win the comparison.
    bestTime: prev.bestTime ? Math.min(prev.bestTime, secs) : secs,
    bestFish: Math.max(prev.bestFish || 0, c.fish),
    bestStreak: Math.max(prev.bestStreak || 0, c.bestStreak || 0),
  };
}

/**
 * Put her back at the last gate she passed.
 *
 * A sinking used to end the run outright, which in a 5,7 km race means the last
 * ten seconds can throw away four minutes. The gates are checkpoints precisely
 * so that they can be respawn points — that is what makes taking a risk at a
 * bend a decision rather than a gamble.
 */
function respawn() {
  const p = state.p;
  _crossing.knocks = 0;
  // A RESPAWN NEVER ENDS THE CROSSING. It used to, when there was no checkpoint,
  // by calling `endCrossing(CROSSING_OUTCOME.SWAMPED)` — see `startCrossing` for what that
  // actually did to the run. There is always a checkpoint now (the start line),
  // and this last-resort fallback is the head of the route rather than a way
  // out of the level: the clock is the only thing that ends a crossing badly.
  const cp = _crossing.checkpoint || (() => {
    const ch = _crossing.channel;
    const q = ch ? at(ch.pts, ch.cum, 0) : { x: p.x, y: p.y, a: p.a };
    return { x: q.x, y: q.y, a: q.a };
  })();
  p.x = cp.x; p.y = cp.y; p.a = cp.a;
  p.vx = 0; p.vy = 0; p.speed = 0; p.drift = 0;
  // The gate test is a SEGMENT between this frame's pose and last frame's, so a
  // teleport has to forget where she was: otherwise the jump back to the
  // checkpoint sweeps a line across half the estero and credits every gate it
  // happens to cross on the way.
  p.prevX = p.x; p.prevY = p.y;
  state.cam.shake = Math.max(state.cam.shake, 4);
  pushFloat(p.x, p.y - 40, t("crossing.swamped"), "#e85d75");
}

/**
 * Advance the race for one frame. The boat is driven by the ordinary physics
 * before this runs; all that happens here is reading where she got to.
 *
 * @param {number} dt
 * @param {object} p  the player pose (state.p)
 * @returns {boolean} true while the crossing is running
 */
export function advanceCrossing(dt, p) {
  if (!_crossing.active) return false;
  const ch = _crossing.channel;
  _crossing.t += dt;

  // published for the HUD and the renderer: both want the tide the CROSSING is
  // being sailed at, and neither should have to import the tide module to
  // learn it while a crossing is the only place it changes the gameplay.
  _crossing.tide = tideLevel();
  // THE LANE NO LONGER SHRINKS UNDER YOU. `laneFrac` was `0.72 + 0.28·level`
  // off the tide, and it drove the BRIGHT band in the renderer while physics
  // never read it — so on the pleamar and aguacero attempts, which start near
  // high water and fall for the whole run, the drawn channel visibly closed in
  // on you from the first second to the last, and there was nothing you could
  // do about it because it was not real. It is gone; the lane is drawn at the
  // width the world measured. The tide keeps the job it can actually do: the
  // bancos de arena come out of the water at low tide (`bancoExposed`).
  const prevS = _crossing.s;
  // the streak is a WINDOW, not a counter: stop brushing things and it lapses.
  if (_crossing.streakT > 0) {
    _crossing.streakT -= dt;
    if (_crossing.streakT <= 0) _crossing.streak = 0;
  }
  const near = projectToRoute(ch, p.x, p.y);
  _crossing.s = near.s;
  _crossing.offset = near.offset;
  _crossing.progress = Math.max(0, Math.min(1, near.s / ch.total));
  // Sailing back down the channel. Judged on ARCLENGTH rather than on heading:
  // the estero bends hard enough that a boat correctly rounding a bar is
  // pointing back the way she came for a second or two, and flagging that
  // would cry wolf exactly when the player is doing the difficult thing well.
  _crossing.wrongWay = _crossing.level && near.s < prevS - 40 * dt;

  // THE GATES. Tested as a segment crossing between frames rather than as a
  // proximity check: at 340 px/s a fast hull covers 5 px a frame and a radius
  // test around a 210 px gate mouth either misses her or fires when she passes
  // OUTSIDE the pair, which is the one thing a gate must never reward.
  // Gates are the LEVEL's, not Recorrer's.
  for (const g of _crossing.level ? ch.gates : []) {
    if (g.taken) continue;
    if (segmentsCross(p.prevX ?? p.x, p.prevY ?? p.y, p.x, p.y, g.ax, g.ay, g.bx, g.by)) {
      g.taken = true;
      _crossing.gateIndex = Math.max(_crossing.gateIndex, g.index + 1);
      _crossing.checkpoint = { x: near.ax, y: near.ay, a: p.a };
      if (_crossing.level) {
        addTime(state, GATE_BONUS);
        addBoost(GATE_BOOST);
        // EL PORTÓN DE IMPULSO: through the middle of the mouth and she fills
        // the tank. Wide still takes the gate, the time and the checkpoint —
        // the precision is a bonus, never a toll.
        if (g.boost) {
          const off = Math.abs(laneOffset(ch, g.s, p.x, p.y) - 0);
          if (off < (g.hw || LANE_HW) * BOOST_GATE_BAND) {
            _crossing.boost = 1;
            state.score += 80;
            pushFloat(p.x, p.y - 62, t("crossing.boostReady"), "#ffd166");
          }
        }
        // one knock back every two gates: an arcade water level should not have
        // a death spiral, and three strikes over 5,7 km is one.
        if (g.index % 2 === 1) _crossing.knocks = Math.max(0, _crossing.knocks - 1);
        // The float is the REWARD, the tip is the RULE. Two channels, so the
        // "+6s" popping off the bow never has to compete with the explanation
        // of why sinking from here will not cost you the whole passage.
        pushFloat(p.x, p.y - 40, t("crossing.gateBonus", { s: GATE_BONUS }), "#9fd7ef");
        state.storyTip = t("crossing.checkpoint");
      }
      continue;
    }
    // MISSED: past its arclength and never through it, so she went round the
    // outside. Said out loud once, because a gate that costs you six seconds in
    // silence reads as the bonus being broken rather than as a line you blew.
    if (!g.missed && _crossing.level && near.s > g.s + GATE_MISS_PAD) {
      g.missed = true;
      pushFloat(p.x, p.y - 40, t("crossing.gateMissed"), "#e85d75");
    }
  }
  p.prevX = p.x; p.prevY = p.y;
  // Sailing back down the channel is worth saying, because in 5,7 km of open
  // water with the shore a green line on both sides it is genuinely possible
  // to do it for a while without noticing.
  if (_crossing.wrongWay) state.storyTip = t("crossing.wrongWay");

  // NO DRAG FOR LEAVING THE LINE. This used to bleed your speed the moment you
  // left the navigable band, and that one rule is what made 5,7 km of open
  // estuary feel like a fenced corridor: the water outside the marks was
  // rendered, reachable and pointless, so the level was a ride between two
  // hedges. The compass (`crossingTarget`) replaces it — you can go anywhere on
  // the water, and the arrow brings you back to the next pair of buoys.
  //
  // The estuary still costs you for being off the line, but through the WORLD
  // rather than through a rule: the banks are mangrove you have to go round,
  // the roots are out there, and at low water the bancos de arena are real
  // ground you can strand on. Those are places, not a penalty field.

  // The finish is the far end of the route, not a landing collision: the apron
  // at Pitahaya is stamped ROAD and therefore a WALL to a hull, so waiting for
  // her to touch it would wait forever.
  //
  // ARRIVING ENDS IT IN BOTH MODES. `finish()` decides what arriving MEANS —
  // a stage clear under level rules, just a landing in Recorrer — but gating
  // the call on `level` left a Recorrer crossing running for ever, and it is
  // the end of the crossing that hands the player back their car.
  if (near.s >= ch.total - FINISH_PAD) finish();
  return true;
}

/** Do the two segments AB and CD cross? Standard orientation test. */
function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const o = (px, py, qx, qy, rx, ry) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(ax, ay, bx, by, cx, cy), o2 = o(ax, ay, bx, by, dx, dy);
  const o3 = o(cx, cy, dx, dy, ax, ay), o4 = o(cx, cy, dx, dy, bx, by);
  return o1 !== o2 && o3 !== o4;
}

/** A knock: a panga, or a root. Returns true when it sank her. */
export function knock(what) {
  _crossing.knocks += 1;
  pushFloat(state.p.x, state.p.y - 40, t(`crossing.hit.${what}`), "#e85d75");
  state.cam.shake = Math.max(state.cam.shake, 3);
  if (_crossing.level && _crossing.knocks >= KNOCKS) { respawn(); return true; }
  // In Recorrer a knock only costs time, because there the estero is a place
  // you are visiting, not a route you are running.
  if (!_crossing.level) addTime(state, -3);
  return false;
}

export function catchFish(n) {
  _crossing.fish += n;
  addBoost(FISH_BOOST);
  pushFloat(state.p.x, state.p.y - 40, `+${n} 🐟`, "#9fd7ef");
}

// ---- el impulso: the economy that makes this a game -----------------------
//
// THE OLD LEVEL HAD NOTHING TO WANT. It had a clock, three lives and a list of
// things not to touch, so the optimal line was the timid one — stay in the
// middle, go round everything wide, wait it out. An arcade water level has to
// pay you for the opposite, and the cheapest honest way to do that is to make
// GOING CLOSE the thing that earns the speed you need to go fast.
//
// So: brush something without touching it and you bank impulso; take a gate,
// jump a yate's wake, or catch a shoal and you bank more; and impulso is what
// the turbo spends. Nothing here punishes — a miss just does not pay.
const NEAR_R = 30;             // px of clearance that counts as a rozada
const NEAR_BOOST = 0.16;
const GATE_BOOST = 0.30;
const JUMP_BOOST = 0.25;
const FISH_BOOST = 0.12;
const BOOST_DRAIN = 0.45;      // per second held
const STREAK_WINDOW = 4;       // s to keep a streak alive

export function addBoost(v) {
  const was = _crossing.boost || 0;
  _crossing.boost = Math.min(1, was + v);
  if (was < 1 && _crossing.boost >= 1) state.storyTip = t("crossing.boostReady");
}

/** Is there impulso to burn? Asked by physics before it lets the turbo fire. */
export function boostReady() {
  return !_crossing.active || (_crossing.boost || 0) > 0.05;
}

/** Burn it. Called by physics on the frames the turbo is actually running. */
export function spendBoost(dt) {
  if (!_crossing.active) return;
  _crossing.boost = Math.max(0, (_crossing.boost || 0) - BOOST_DRAIN * dt);
}

/** Distance from a point to a segment — the pescador's net is a segment. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let k = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  k = k < 0 ? 0 : k > 1 ? 1 : k;
  return Math.hypot(px - (ax + dx * k), py - (ay + dy * k));
}

/**
 * A rozada: passed close, did not touch.
 *
 * Rides the distance the caller already computed, so it costs one comparison
 * per entity. Only fires once per entity per approach (`nearT`), or holding
 * station beside a moored panga would print money.
 */
function nearMiss(e, d, reach) {
  const edge = d - (e.r || 24) - reach;
  if (edge > 0 && edge < NEAR_R) {
    if (e.nearT) return;
    e.nearT = 1;
    _crossing.near = (_crossing.near || 0) + 1;
    _crossing.streak = (_crossing.streakT > 0 ? _crossing.streak || 0 : 0) + 1;
    _crossing.streakT = STREAK_WINDOW;
    _crossing.bestStreak = Math.max(_crossing.bestStreak || 0, _crossing.streak);
    addBoost(NEAR_BOOST);
    state.score += 15 * _crossing.streak;
    pushFloat(state.p.x, state.p.y - 40,
      _crossing.streak > 1 ? `${t("crossing.nearMiss")} x${_crossing.streak}`
        : t("crossing.nearMiss"), "#9fd7ef");
  } else if (edge > NEAR_R * 2) {
    e.nearT = 0;
  }
}

// ---- what lives in the estero --------------------------------------------
export const esteroThings = [];

function rng(seed) {
  // Deterministic per crossing: the same estero every time you sail it, so a
  // record means something. Not Math.random.
  let x = seed;
  return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

// EVERY OFFSET BELOW IS A FRACTION OF THE LANE AT THAT ARCLENGTH, never of a
// constant. That one change is what puts the estero's life ON the estero: at
// `LANE_HW` a third of the pangas, half the roots and a quarter of the
// remolinos were sitting on dry mangrove, drawn and collidable, which is how a
// channel comes to feel like a corridor full of invisible walls.
function place(list, ch, s, off, rest) {
  const q = laneAt(ch, s);
  list.push({ s, off, x: q.x - Math.sin(q.a) * off, y: q.y + Math.cos(q.a) * off,
    a: q.a, taken: false, ...rest });
}

function spawnEstero(ch) {
  esteroThings.length = 0;
  const r = rng(0x1a5c4a);   // "lancha", near enough
  // THE FIRST REACH TEACHES. Full density from the start is how a course reads
  // as unfair rather than hard, so the opening 2 000 px runs at quarter rate.
  const dense = (s) => (s < 2000 ? 4 : s < 3500 ? 2 : 1);
  let s = 500;
  while (s < ch.total - 400) {
    const hw = laneAt(ch, s).hw;
    const roll = r();
    const side = r() < 0.5 ? -1 : 1;
    const off = (0.25 + r() * 0.75) * hw * side;
    const kind = roll < 0.42 ? "panga" : roll < 0.78 ? "fish" : "gulls";
    // PANGAS MOVE, and they move like the balneario's launch: straight across
    // and back, turning at the edge of the lane. A moored obstacle is a slalom
    // you learn once; one working her way across the channel is something you
    // have to read every time.
    place(esteroThings, ch, s, off, {
      kind, hw,
      ph: r() * Math.PI * 2,
      drift: kind === "panga" ? (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.8)
        : (r() - 0.5) * 0.4,
      r: kind === "panga" ? 26 : kind === "fish" ? 34 : 40,
    });
    s += 420 * dense(s);
  }

  // LOS PESCADORES — a moored panga with a NET streaming off her to a float.
  // The hazard is the LINE BETWEEN TWO THINGS, which is a gap to read rather
  // than a disc to dodge, and it is the only obstacle here that asks you to
  // choose a side of the channel a long way out. Fouling it costs you your way
  // and not a knock: a net is an embarrassment, not a holing.
  for (let sp = 900; sp < ch.total - 600; sp += 700) {
    const hw = laneAt(ch, sp).hw;
    const side = r() < 0.5 ? -1 : 1;
    const anchor = (0.55 + r() * 0.4) * hw * side;
    const reach = (0.35 + r() * 0.25) * hw * 2;
    place(esteroThings, ch, sp, anchor, {
      kind: ESTERO_ENCOUNTER.PESCADOR, hw, ph: r() * Math.PI * 2, drift: 0, r: 24,
      // the far end of the net, as a lane offset — the renderer and the
      // collision both read it, so the drawn line IS the line you can foul
      netOff: anchor - reach * side, netSide: side,
    });
  }

  // LOS YATES — the set piece. A big motor yacht running ALONG the channel with
  // two wake crests astern of her: a solid to go round, and a wake that PAYS if
  // you take it fast. A hazard that can be worth points is what keeps an
  // obstacle course from being a list of things not to do.
  for (let sy = 1600; sy < ch.total - 900; sy += 1100) {
    const hw = laneAt(ch, sy).hw;
    if (hw < 130) continue;              // no room to pass her: don't put her there
    const side = r() < 0.5 ? -1 : 1;
    place(esteroThings, ch, sy, (0.2 + r() * 0.35) * hw * side, {
      kind: ESTERO_ENCOUNTER.YATE, hw, ph: r() * Math.PI * 2, drift: 0, r: 52,
      run: (r() < 0.5 ? -1 : 1) * (120 + r() * 60),   // px/s along the channel
      wake: 0,
    });
  }
  // REMOLINOS. They used to be storm-only, which meant that the one obstacle
  // with a genuinely different verb — it PULLS, so the line you were holding
  // stops being the line you are on — was absent from the level as it normally
  // shipped. They are in every crossing now, and a storm simply brings more.
  // Mid-channel on purpose: a hazard hugging the bank would just be roots.
  const stormy = state.weather === "storm";
  for (let sr = 700; sr < ch.total - 500; sr += (stormy ? 520 : 900)) {
    const hw = laneAt(ch, sr).hw;
    // …and the pull is halved now that the hull is an arcade boat. At the old
    // 26-48 a remolino could take a slow panga's line away entirely, which is a
    // current you cannot answer rather than one you have to.
    place(esteroThings, ch, sr, (r() - 0.5) * hw * 1.1, {
      kind: ESTERO_ENCOUNTER.REMOLINO, hw, ph: r() * Math.PI * 2, drift: 0, r: 52,
      pull: (r() < 0.5 ? -1 : 1) * (16 + r() * 14) * (stormy ? 1.4 : 1),
    });
  }

  // The roots MARK THE BANK. They used to sit at `LANE_HW + 18`, which on a
  // reach where the real water was 80 px wide put them well inland — drawn on
  // mangrove, and only reachable by a boat that was already aground. On the
  // measured lane they land where they belong: just outside the marks, in the
  // way of a boat that cuts the corner and nobody else.
  for (let sk = 380; sk < ch.total - 300; sk += 190) {
    const hw = laneAt(ch, sk).hw;
    for (const side of [-1, 1]) {
      place(esteroThings, ch, sk, (hw + 10 + r() * 20) * side, {
        kind: ESTERO_ENCOUNTER.ROOTS, hw, ph: r() * Math.PI * 2, drift: 0, r: 22,
      });
    }
  }

  // LOS BANCOS DE ARENA — the tide's own obstacle, and the only one that is
  // not always there. Each carries the water level it dries out at (`depth`),
  // so a bajamar crossing is threading a channel full of them and a pleamar one
  // sails straight over. They are placed EVERY time and hidden by the tide
  // rather than spawned by it: the estero is the same estero at every hour, and
  // a bank you grounded on last run has to be in the same place this run even
  // if today you float over it.
  //
  // Grounding is its own verb. A panga is a collision and roots are damage; a
  // bank is the boat stopping being a boat for a moment — she drags to a crawl
  // and you have to work her off. That is why it does not cost a knock unless
  // you drive onto it hard.
  for (let sb = 620; sb < ch.total - 420; sb += 330) {
    const hw = laneAt(ch, sb).hw;
    const side = r() < 0.5 ? -1 : 1;
    // KEPT NEAR THE CENTRELINE. Out at 0.95 of the lane a bank sat where the
    // estero often is not, and it is also the least interesting place to put
    // one: a hazard against the bank is just the shallows again, while one you
    // have to go round is a decision. `bancoExposed` still has the final say —
    // and now that the lane IS the water, it has much less to veto.
    place(esteroThings, ch, sb, (0.15 + r() * 0.45) * hw * side, {
      kind: ESTERO_ENCOUNTER.BANCO, hw, ph: r() * Math.PI * 2, drift: 0,
      // the shallowest sit high and are out at almost any tide; the deepest
      // only show at a real bajamar, which is what makes low water read as a
      // different course rather than the same one with more scenery
      depth: 0.28 + r() * 0.5,
      r: 34 + r() * 30,
      aground: false,
    });
  }
}

/**
 * Where the next pair of buoys is — the crossing's objective, for the compass.
 *
 * The MOUTH of the gate, not a buoy: aiming at one mark would steer you into
 * it, and what you actually want is the water between them. Falls through to
 * the landing once every gate is behind you, so the arrow never goes blank on
 * the last leg.
 *
 * ONLY IN THE LEVEL. In Recorrer the estero is somewhere you went, not a course
 * you are running: no gates, no arrow, no objective — take the lancha out and
 * go wherever the water goes, including out to the gulf.
 */
export function crossingTarget() {
  if (!_crossing.active || !_crossing.level) return null;
  const ch = _crossing.channel;
  if (!ch) return null;
  for (const g of ch.gates) {
    if (g.taken) continue;
    // FOLLOW THE BUOYS, DON'T CUT TO THE MARK. A gate can be 900 px down the
    // channel, and an arrow pointing straight at it across two bends says
    // "cut the corner" — which on this estero means the mangrove. While it is
    // still far, aim at the LANE a little way ahead instead; the arrow then
    // traces the channel and only becomes a gate sight when the gate is the
    // next thing you have to do.
    const lead = g.s - _crossing.s;
    const q = lead > ARROW_LEAD
      ? laneAt(ch, Math.min(_crossing.s + ARROW_STEP, g.s))
      : { x: (g.ax + g.bx) / 2, y: (g.ay + g.by) / 2 };
    return { x: q.x, y: q.y, gate: g.index + 1, gates: ch.gates.length };
  }
  const end = at(ch.pts, ch.cum, ch.total);
  return { x: end.x, y: end.y, gate: ch.gates.length, gates: ch.gates.length, finish: true };
}

/**
 * Is this bank out of the water at the current tide?
 *
 * IT ALSO HAS TO BE IN THE WATER AT ALL. `LANE_HW` is 105 px, so the marked
 * channel is 210 px wide — wider than the estero itself in the reach beside
 * Puntarenas — and `spawnEstero` scatters banks across most of that. Without
 * this test a bajamar painted sand on top of a cuadra of buildings, and the sim
 * grounded you on it, which is the worse half: a bank you cannot see but can
 * hit. Renderer and collision both come through here, so they cannot disagree.
 *
 * TESTED LAZILY, NOT AT SPAWN, because of streaming: `surfaceAt` answers WATER for
 * a tile that is not resident yet, so a bank vetted at `startCrossing` — when
 * only the berth's tiles are loaded — would pass on faith and turn out to be
 * sitting on a beach by the time you got there. Asked at the moment it matters,
 * the tile under it is always loaded.
 */
/**
 * Is this buoy actually floating?
 *
 * THE LAST 2 %, AND THE SAME TRICK `bancoExposed` USES. The world measures the
 * channel and the marks are placed inside it, so they are on water by
 * construction — but the sounding is every 40 px along a simplified line and,
 * even over the opened basin, the sharpest bends need not agree to the pixel.
 * Two of 122 came out on mangrove in the last emitted world.
 *
 * A mark standing on the bank is worse than a missing mark: it tells you the
 * channel is somewhere it is not. So it is simply not drawn. TESTED LAZILY, at
 * draw time, for the reason `bancoExposed` documents — `surfaceAt` answers
 * WATER for a tile that has not streamed in, so asking at `channels()` time would
 * pass on faith over the whole route.
 *
 * This is a backstop, NOT the fix. `tools/smoke_crossing.mjs` holds the real
 * line: no GATE mark may ever be suppressed, and if the count of suppressed
 * buoys climbs, the channel data has regressed and the test says so.
 */
export function buoyWet(b) {
  return W.surfaceAt(b.x, b.y) === SURFACE.WATER;
}

export function bancoExposed(e, level = tideLevel()) {
  if (e.kind !== "banco" || level >= e.depth) return false;
  return W.surfaceAt(e.x, e.y) === SURFACE.WATER;
}

/**
 * Advance the estero's life and resolve what the PLAYER ran into.
 *
 * The footprint tested is the boat the player is driving — her own half-length
 * out of `veh` — where it used to be the ferry's, because the ferry was the
 * thing being steered. That swap is the whole difference between dodging and
 * watching something be dodged for you.
 */
export function advanceEstero(dt, p, veh) {
  if (!_crossing.active) return;
  const ch = _crossing.channel;
  const reach = Math.max(veh?.w || 30, veh?.h || 12) / 2;
  for (const e of esteroThings) {
    if (e.kind === ESTERO_ENCOUNTER.REMOLINO) e.ph += dt * 1.9;
    else if (e.kind !== "roots") e.ph += dt * (e.kind === ESTERO_ENCOUNTER.GULLS ? 3.2 : 1.4);
    if (e.drift) {
      e.off += e.drift * dt * 12;
      // she turns at the edge of HER lane, not at a constant — a panga working
      // across a 90 px reach must not swing out to 200 px and beach herself.
      if (Math.abs(e.off) > (e.hw || LANE_HW) * 0.95) e.drift *= -1;
      const q = laneAt(ch, e.s);
      e.x = q.x - Math.sin(q.a) * e.off;
      e.y = q.y + Math.cos(q.a) * e.off;
    }
    // LOS YATES steam along the channel and turn at each end of their beat, so
    // the gap you were going to take closes while you approach it.
    if (e.kind === ESTERO_ENCOUNTER.YATE) {
      e.s += e.run * dt;
      if (e.s < 600 || e.s > ch.total - 600) e.run *= -1;
      const q = laneAt(ch, e.s);
      e.x = q.x - Math.sin(q.a) * e.off;
      e.y = q.y + Math.cos(q.a) * e.off;
      e.a = q.a + (e.run < 0 ? Math.PI : 0);
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      // THE WAKE PAYS. Two crests astern of her: cross one with way on and she
      // throws you (boost + score); cross it slowly and she just slews you.
      const wakeD = Math.abs(d - (e.r + 46));
      if (wakeD < 18) {
        const sp = Math.hypot(p.vx, p.vy);
        if (sp > 200 && !e.wakeT) {
          e.wakeT = 1;
          addBoost(JUMP_BOOST);
          _crossing.jumps = (_crossing.jumps || 0) + 1;
          state.score += 60;
          pushFloat(p.x, p.y - 40, t("crossing.jump"), "#9fd7ef");
        } else if (sp <= 200) {
          p.a += (e.run > 0 ? 1 : -1) * dt * 0.8;
        }
      } else if (wakeD > 40) {
        e.wakeT = 0;
      }
      if (d < e.r + reach && !e.taken) {
        e.taken = true;
        const k = d > 0.001 ? 1 / d : 0;
        p.vx += (p.x - e.x) * k * 120;
        p.vy += (p.y - e.y) * k * 120;
        if (knock("yate")) return;
      } else if (d > e.r + reach + 30) {
        e.taken = false;                 // she moves: she can hit you twice
      }
      nearMiss(e, d, reach);
      continue;
    }
    // EL PESCADOR — the boat is nothing, the NET is the obstacle. Tested as the
    // distance to a SEGMENT, because that is what it is: a line across part of
    // the channel with a gap beside it, read from a long way off.
    if (e.kind === ESTERO_ENCOUNTER.PESCADOR) {
      const q = laneAt(ch, e.s);
      const fx = q.x - Math.sin(q.a) * e.netOff, fy = q.y + Math.cos(q.a) * e.netOff;
      e.fx = fx; e.fy = fy;
      const d = segDist(p.x, p.y, e.x, e.y, fx, fy);
      if (d < reach + 8) {
        // Fouling a net is an embarrassment, not a holing: it takes your way
        // off and costs you nothing else. No knock — the one soft barrier here.
        p.vx *= 0.55; p.vy *= 0.55;
        if (!e.fouled) {
          e.fouled = true;
          pushFloat(p.x, p.y - 40, t("crossing.hit.red"), "#e8c07a");
          state.cam.shake = Math.max(state.cam.shake, 1.5);
        }
      } else if (d > reach + 40) {
        e.fouled = false;
      }
      nearMiss(e, d, reach);
      continue;
    }
    // A remolino is not a collision: it is a current. It keeps working on you
    // the whole time you are in it, and it is never "taken". Now that the
    // player is a free body it can finally do BOTH things it was written to
    // do — pull her off her line, and twist her head round. The spin used to
    // be computed into a field nobody read.
    if (e.kind === ESTERO_ENCOUNTER.REMOLINO) {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < e.r + reach) {
        const grip = 1 - Math.min(1, d / (e.r + reach));
        const nx = -Math.sin(e.a), ny = Math.cos(e.a);
        p.vx += nx * e.pull * grip * dt * 6;
        p.vy += ny * e.pull * grip * dt * 6;
        p.a += Math.sign(e.pull) * grip * dt * 1.1;
      }
      continue;
    }
    // A BANK IS GROUND, NOT AN IMPACT — and it is only there at low water.
    // It is never "taken": you can sit on it, work her off, and put her back on
    // it two seconds later, which is exactly what running aground is like.
    if (e.kind === ESTERO_ENCOUNTER.BANCO) {
      const exposed = bancoExposed(e);
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      const on = exposed && d < e.r + reach;
      if (on) {
        const speed = Math.hypot(p.vx, p.vy);
        // She drags to a crawl: the sand takes the way off her fast, and the
        // deeper she is into the bank the worse it grips.
        const bite = 1 - Math.min(0.92, (1 - d / (e.r + reach)) * 3.2 * dt);
        p.vx *= bite; p.vy *= bite;
        if (!e.aground) {
          e.aground = true;
          pushFloat(p.x, p.y - 40, t("crossing.aground"), "#e8c07a");
          state.cam.shake = Math.max(state.cam.shake, 2);
          // Driving ONTO a bank at speed is a different event from drifting
          // onto one: that is a grounding hard enough to open her up.
          if (_crossing.level && speed > 220 && knock("banco")) return;
        }
      } else if (e.aground && (!exposed || d > e.r + reach + 12)) {
        e.aground = false;                     // off it — hysteresis, not a flicker
      }
      continue;
    }
    if (e.taken) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    // A rozada is only worth something against a thing that could have HURT
    // you, so the shoal and the gulls — which pay and blind, but never knock —
    // are not part of the streak.
    if (e.kind === ESTERO_ENCOUNTER.PANGA) nearMiss(e, d, reach);
    if (d > e.r + reach) continue;
    if (e.kind === ESTERO_ENCOUNTER.FISH) { e.taken = true; catchFish(3); }
    // …and the blind is shorter. 1.1 s at the old hull speed was a beat; at an
    // arcade boat's it is most of a bend taken with the screen full of gulls.
    else if (e.kind === ESTERO_ENCOUNTER.GULLS) { e.taken = true; state.gullBlind = 0.7; }
    else {
      e.taken = true;
      // A panga you clip should also SHOVE you — she is a boat with mass, and
      // a hit that only ticked a counter read as a scoring event rather than
      // as a collision.
      const k = d > 0.001 ? 1 / d : 0;
      p.vx += (p.x - e.x) * k * 90;
      p.vy += (p.y - e.y) * k * 90;
      if (knock(e.kind)) return;
    }
  }
}
