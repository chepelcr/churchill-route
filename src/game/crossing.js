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
//     promoted. That is why the course is readable with no HUD arrow, which was
//     the original design rule and is still the best thing about the level.
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
// THE WIN PATH IS THE BUG THIS REWRITE EXISTS TO FIX. `endCrossing("landed")`
// used to set `_crossing.done` and NOTHING IN THE CODEBASE READ IT.
// `delivery.js` held the only `state.won = true`, gated on deliveries, and s8
// has `targetDeliveries: 0` — so the level could only ever end by its own
// timeout, always as a loss. Landing at Pitahaya and sinking in the mangrove
// were the same outcome. `finish()` below is where that is put right.
import { WORLD2D as W } from "../world2d/index.js";
import { state, pushFloat } from "./state.js";
import { t } from "../i18n/index.js";
import { markStageCleared, unlockDistrict } from "./progress.js";
import { navigableFraction, tideLevel } from "./tides.js";

// ---- the lane -------------------------------------------------------------
//: half-width of the navigable channel, in world px. Wider than the boat by a
//: lot: the lane is where it is SAFE, not where you are allowed.
export const LANE_HW = 105;
//: buoys every this many px of arclength, and half that through a bend
const BUOY_GAP = 300;
const BEND_GAP = 150;
//: a turn sharper than this (radians between legs) counts as a bend
const BEND_ANG = 0.35;

//: how far off the lane centre you may be before the shallows start
const SHALLOW_HW = LANE_HW * 1.35;

//: every Nth buoy pair is a GATE. Not every pair: a gate at each of ~40 pairs
//: is a checkbox list, not a course. At 4 the estero gives ~10 of them, which
//: is a lap's worth of decisions over a 7 km crossing.
const GATE_EVERY = 4;
//: seconds banked for passing through a gate the right way round
const GATE_BONUS = 6;
//: how far past the last gate the landing counts as reached
const FINISH_PAD = 120;
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
    const buoys = [];
    const gates = [];
    let s = BUOY_GAP * 0.5;
    let pair = 0;
    while (s < total - 60) {
      const q = at(pts, cum, s);
      const gap = bendAt(pts, cum, s) ? BEND_GAP : BUOY_GAP;
      // A GATE IS A PAIR PROMOTED, not a new object in the world. The two
      // buoys are already at the same arclength on opposite sides, so the gate
      // is the segment between them and it is drawn for free by drawing them.
      const isGate = pair % GATE_EVERY === 0;
      const side1 = [], side2 = [];
      for (const side of [-1, 1]) {
        const b = {
          x: q.x - Math.sin(q.a) * LANE_HW * side,
          y: q.y + Math.cos(q.a) * LANE_HW * side,
          // Red to PORT, green to starboard, in the direction of the outbound
          // passage — the same convention the estero's own markers use.
          side, red: side > 0, ph: (s * 0.017) % (Math.PI * 2), gate: isGate,
        };
        buoys.push(b);
        (side < 0 ? side1 : side2).push(b);
      }
      if (isGate) {
        gates.push({
          s, index: gates.length,
          ax: side1[0].x, ay: side1[0].y,
          bx: side2[0].x, by: side2[0].y,
          taken: false, missed: false,
        });
      }
      s += gap;
      pair += 1;
    }
    _channels.set(f.id, { pts, cum, total, buoys, gates });
  }
  return _channels;
}

export function channelOf(ferry) {
  return channels().get(ferry?.id) || null;
}

// ---- the conditions a crossing is sailed in --------------------------------
// THE ESTERO IS NOT THE SAME PLACE TWICE, and the four rows below are the level
// design. Weather and tide are ONE choice, not two, because they interact: a
// storm piles the water up, so the hard run is not the one with the least water
// but the one with the most. Sailing the same 7 km at bajamar and at pleamar in
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
  if (stage?.kind !== "crossing") return 0;
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
  const q = at(channel.pts, channel.cum, s);
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
  _crossing.checkpoint = null;
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
  endCrossing("landed");
  pushFloat(state.p.x, state.p.y - 40, t("crossing.landed"), "#9fd7ef");
  if (!_crossing.level || !state.stage) return;   // Recorrer: arriving is its own reward
  // Time left and fish caught ARE the score here: there are no deliveries to
  // total, and a crossing that scored zero would rank last on the results
  // screen no matter how well it was sailed.
  state.score += Math.round(Math.max(0, state.timeLeft) * 10 + _crossing.fish * 25);
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
  };
}

/**
 * Put her back at the last gate she passed.
 *
 * A sinking used to end the run outright, which in a 7 km race means the last
 * ten seconds can throw away four minutes. The gates are checkpoints precisely
 * so that they can be respawn points — that is what makes taking a risk at a
 * bend a decision rather than a gamble.
 */
function respawn() {
  const cp = _crossing.checkpoint;
  const p = state.p;
  _crossing.knocks = 0;
  if (!cp) { endCrossing("swamped"); return; }
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
  _crossing.laneFrac = navigableFraction();
  const prevS = _crossing.s;
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
  for (const g of ch.gates) {
    if (g.taken) continue;
    if (segmentsCross(p.prevX ?? p.x, p.prevY ?? p.y, p.x, p.y, g.ax, g.ay, g.bx, g.by)) {
      g.taken = true;
      _crossing.gateIndex = Math.max(_crossing.gateIndex, g.index + 1);
      _crossing.checkpoint = { x: near.ax, y: near.ay, a: p.a };
      if (_crossing.level) {
        state.timeLeft += GATE_BONUS;
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
  // Sailing back down the channel is worth saying, because in 7 km of open
  // water with the shore a green line on both sides it is genuinely possible
  // to do it for a while without noticing.
  if (_crossing.wrongWay) state.storyTip = t("crossing.wrongWay");

  // THE SHALLOWS, AND THE TIDE MOVES THEM. Past the navigable water the estero
  // thins and the mangrove roots start. She is a free body now, so this cannot
  // be a subtraction from an arclength she no longer owns — it is DRAG on her
  // actual velocity, which she feels as the boat going heavy the moment she
  // leaves the water that is there today.
  //
  // THE BUOYS DO NOT MOVE. They mark the CHANNEL, which is a surveyed thing;
  // the water inside it is what comes and goes. So at bajamar you are threading
  // a lane visibly narrower than the marks describe, and reading that gap is
  // the pilotage the level is actually about.
  const laneHW = LANE_HW * navigableFraction();
  const out = Math.abs(near.offset) - laneHW;
  if (out > 0) {
    const k = Math.max(0, 1 - Math.min(0.9, (out / (SHALLOW_HW * 2)) * dt * 2.2));
    p.vx *= k; p.vy *= k;
  }

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
  if (!_crossing.level) state.timeLeft = Math.max(0, state.timeLeft - 3);
  return false;
}

export function catchFish(n) {
  _crossing.fish += n;
  pushFloat(state.p.x, state.p.y - 40, `+${n} 🐟`, "#9fd7ef");
}

// ---- what lives in the estero --------------------------------------------
export const esteroThings = [];

function rng(seed) {
  // Deterministic per crossing: the same estero every time you sail it, so a
  // record means something. Not Math.random.
  let x = seed;
  return () => (x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
}

function spawnEstero(ch) {
  esteroThings.length = 0;
  const r = rng(0x1a5c4a);   // "lancha", near enough
  const step = 260;
  for (let s = 500; s < ch.total - 400; s += step) {
    const q = at(ch.pts, ch.cum, s);
    const roll = r();
    const side = r() < 0.5 ? -1 : 1;
    const off = (0.25 + r() * 0.75) * LANE_HW * side;
    const kind = roll < 0.42 ? "panga" : roll < 0.78 ? "fish" : "gulls";
    esteroThings.push({
      // PANGAS MOVE, and they move like the balneario's launch: straight across
      // and back, turning at the edge of the lane. A moored obstacle is a
      // slalom you learn once; one working her way across the channel is
      // something you have to read every time.
      kind, s, off,
      ph: r() * Math.PI * 2,
      drift: kind === "panga" ? (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.8)
        : (r() - 0.5) * 0.4,
      x: q.x - Math.sin(q.a) * off, y: q.y + Math.cos(q.a) * off, a: q.a,
      taken: false, r: kind === "panga" ? 26 : kind === "fish" ? 34 : 40,
    });
  }
  // REMOLINOS. They used to be storm-only, which meant that the one obstacle
  // with a genuinely different verb — it PULLS, so the line you were holding
  // stops being the line you are on — was absent from the level as it normally
  // shipped. They are in every crossing now, and a storm simply brings more.
  // Mid-channel on purpose: a hazard hugging the bank would just be roots.
  const stormy = state.weather === "storm";
  for (let s = 700; s < ch.total - 500; s += (stormy ? 520 : 900)) {
    const q = at(ch.pts, ch.cum, s);
    const off = (r() - 0.5) * LANE_HW * 1.1;
    esteroThings.push({
      kind: "remolino", s, off, ph: r() * Math.PI * 2, drift: 0, r: 52,
      x: q.x - Math.sin(q.a) * off, y: q.y + Math.cos(q.a) * off, a: q.a,
      pull: (r() < 0.5 ? -1 : 1) * (26 + r() * 22) * (stormy ? 1.4 : 1),
      taken: false,
    });
  }

  // The roots: they hug the bank, so they are only in the way of a boat that
  // cuts the corner. Placed just outside the lane, on both sides.
  for (let s = 380; s < ch.total - 300; s += 190) {
    for (const side of [-1, 1]) {
      const q = at(ch.pts, ch.cum, s);
      const off = (LANE_HW + 18 + r() * 26) * side;
      esteroThings.push({
        kind: "roots", s, off, ph: r() * Math.PI * 2, drift: 0, r: 22,
        x: q.x - Math.sin(q.a) * off, y: q.y + Math.cos(q.a) * off, a: q.a, taken: false,
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
  for (let s = 620; s < ch.total - 420; s += 330) {
    const q = at(ch.pts, ch.cum, s);
    const side = r() < 0.5 ? -1 : 1;
    // KEPT NEAR THE CENTRELINE. Out at 0.95 of the lane a bank sat where the
    // estero often is not — the marked channel is wider than the water beside
    // el Centro — and it is also the least interesting place to put one: a
    // hazard against the bank is just the shallows again, while one you have to
    // go round is a decision. `bancoExposed` still has the final say.
    const off = (0.15 + r() * 0.45) * LANE_HW * side;
    esteroThings.push({
      kind: "banco", s, off, ph: r() * Math.PI * 2, drift: 0,
      // the shallowest sit high and are out at almost any tide; the deepest
      // only show at a real bajamar, which is what makes low water read as a
      // different course rather than the same one with more scenery
      depth: 0.28 + r() * 0.5,
      r: 34 + r() * 30,
      x: q.x - Math.sin(q.a) * off, y: q.y + Math.cos(q.a) * off, a: q.a,
      taken: false, aground: false,
    });
  }
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
 * TESTED LAZILY, NOT AT SPAWN, because of streaming: `surfaceAt` answers 0 for
 * a tile that is not resident yet, so a bank vetted at `startCrossing` — when
 * only the berth's tiles are loaded — would pass on faith and turn out to be
 * sitting on a beach by the time you got there. Asked at the moment it matters,
 * the tile under it is always loaded.
 */
export function bancoExposed(e, level = tideLevel()) {
  if (e.kind !== "banco" || level >= e.depth) return false;
  return W.surfaceAt(e.x, e.y) === 0;
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
    if (e.kind === "remolino") e.ph += dt * 1.9;
    else if (e.kind !== "roots") e.ph += dt * (e.kind === "gulls" ? 3.2 : 1.4);
    if (e.drift) {
      e.off += e.drift * dt * 12;
      if (Math.abs(e.off) > LANE_HW * 0.95) e.drift *= -1;
      const q = at(ch.pts, ch.cum, e.s);
      e.x = q.x - Math.sin(q.a) * e.off;
      e.y = q.y + Math.cos(q.a) * e.off;
    }
    // A remolino is not a collision: it is a current. It keeps working on you
    // the whole time you are in it, and it is never "taken". Now that the
    // player is a free body it can finally do BOTH things it was written to
    // do — pull her off her line, and twist her head round. The spin used to
    // be computed into a field nobody read.
    if (e.kind === "remolino") {
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
    if (e.kind === "banco") {
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
    if (d > e.r + reach) continue;
    if (e.kind === "fish") { e.taken = true; catchFish(3); }
    else if (e.kind === "gulls") { e.taken = true; state.gullBlind = 1.1; }
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
