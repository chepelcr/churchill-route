// La Travesía del Estero — the lancha crossing, as a level.
//
// The boat already sailed herself: `ferries.js` advances her along a route the
// build derived from the water raster, and `carry()` moves the car with the
// deck. That is still what happens if you do nothing. This module is what
// happens when you take the tiller.
//
// THREE THINGS MAKE IT A LEVEL RATHER THAN A LONGER RIDE:
//
//   * you STEER. Advance along the route is yours (throttle), and so is the
//     lateral offset off it — the estero is 7 km of open water and the channel
//     is a lane inside it, not a rail.
//   * the channel is READABLE without a HUD arrow: buoys derived from the route
//     (red to port, green to starboard) and calmer water inside the lane. Both
//     are a pure function of the polyline, so nothing new is emitted.
//   * it can be FAILED. Three knocks and she swamps — in the level. In
//     Recorrer a knock only costs time, because there the estero is a place you
//     are visiting, not a route you are running.
//
// The obstacles are three different behaviours on purpose, not one collision:
// pangas cost you (they are moored, they do not move out of your way), fish
// schools PAY you for leaving the line, and gulls take the view away for a
// moment without touching you.
import { WORLD2D as W } from "../world2d/index.js";
import { state, pushFloat } from "./state.js";
import { t } from "../i18n/index.js";

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

let _channels = null;

/** Buoy pairs + the lane polyline for every ferry that has a channel.
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
    let s = BUOY_GAP * 0.5;
    while (s < total - 60) {
      const q = at(pts, cum, s);
      const gap = bendAt(pts, cum, s) ? BEND_GAP : BUOY_GAP;
      for (const side of [-1, 1]) {
        buoys.push({
          x: q.x - Math.sin(q.a) * LANE_HW * side,
          y: q.y + Math.cos(q.a) * LANE_HW * side,
          // Red to PORT, green to starboard, in the direction of the outbound
          // passage — the same convention the estero's own markers use.
          side, red: side > 0, ph: (s * 0.017) % (Math.PI * 2),
        });
      }
      s += gap;
    }
    _channels.set(f.id, { pts, cum, total, buoys });
  }
  return _channels;
}

export function channelOf(ferry) {
  return channels().get(ferry?.id) || null;
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

// ---- the crossing ---------------------------------------------------------
//: how hard the tiller answers, and how fast she runs at full throttle
const TURN = 0.55;              // px/s of lateral drift per unit of steer
const MAX_LATERAL = 78;         // px/s sideways at full lock
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
  level: false,                 // level rules (one way, damage) vs Recorrer
  knocks: 0, fish: 0, t: 0, offset: 0, done: null,
  lastNx: 0, lastNy: 0,
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
 * Steer the lancha for one frame.
 * @param {number} dt
 * @param {object} input  {steer, throttle} — the same axes the car reads
 * @returns {boolean} true while the crossing is running
 */
export function advanceCrossing(dt, input) {
  if (!_crossing.active) return false;
  const f = _crossing.ferry, ch = _crossing.channel;
  _crossing.t += dt;

  // THE TILLER. Advance along the route is the throttle; the lateral offset is
  // the steer. She keeps her own heading from the route, so the boat always
  // looks where she is going even while crabbing across the channel.
  const throttle = _crossing.level ? Math.max(0.35, input.throttle) : input.throttle;
  const back = _crossing.level ? 0 : Math.min(0, input.throttle);   // no reverse in the level
  f.s += f.v * (throttle + back) * dt;
  _crossing.offset += input.steer * MAX_LATERAL * TURN * dt * 4;
  _crossing.offset = Math.max(-SHALLOW_HW * 1.6, Math.min(SHALLOW_HW * 1.6, _crossing.offset));

  // THE SHALLOWS. Past the lane the water thins and the mangrove roots start;
  // she drags, and the roots are what actually knock her.
  const out = Math.abs(_crossing.offset) - LANE_HW;
  if (out > 0) {
    f.s -= f.v * dt * Math.min(0.55, out / (SHALLOW_HW * 2));
    _crossing.offset *= 1 - Math.min(0.9, dt * 0.6);
  }
  return true;
}

/** A knock: a panga, or a root. Returns true when it sank her. */
export function knock(what) {
  _crossing.knocks += 1;
  pushFloat(state.p.x, state.p.y - 40, t(`crossing.hit.${what}`), "#e85d75");
  if (_crossing.level && _crossing.knocks >= KNOCKS) {
    endCrossing("swamped");
    return true;
  }
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
      kind, s, off, ph: r() * Math.PI * 2, drift: (r() - 0.5) * 0.4,
      x: q.x - Math.sin(q.a) * off, y: q.y + Math.cos(q.a) * off, a: q.a,
      taken: false, r: kind === "panga" ? 26 : kind === "fish" ? 34 : 40,
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
}

/** Advance the estero's life and resolve what the boat ran into. */
export function advanceEstero(dt, ferry) {
  if (!_crossing.active) return;
  const ch = _crossing.channel;
  for (const e of esteroThings) {
    if (e.kind !== "roots") e.ph += dt * (e.kind === "gulls" ? 3.2 : 1.4);
    if (e.drift) {
      e.off += e.drift * dt * 12;
      if (Math.abs(e.off) > LANE_HW * 0.95) e.drift *= -1;
      const q = at(ch.pts, ch.cum, e.s);
      e.x = q.x - Math.sin(q.a) * e.off;
      e.y = q.y + Math.cos(q.a) * e.off;
    }
    if (e.taken) continue;
    // The boat's own footprint, not the player's: you are ON her.
    const d = Math.hypot(e.x - ferry.x, e.y - ferry.y);
    if (d > e.r + ferry.dl / 2) continue;
    if (e.kind === "fish") { e.taken = true; catchFish(3); }
    else if (e.kind === "gulls") { e.taken = true; state.gullBlind = 1.1; }
    else { e.taken = true; if (knock(e.kind)) return; }
  }
}
