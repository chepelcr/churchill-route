// Cómo responde una lancha — the arcade hull, in one place.
//
// Until now the boat did not exist as a thing the code describes. It existed as
// nine `afloat ? … : …` ternaries scattered through `physics.js`, and every one
// of them was a SUBTRACTION from the car: no pivot, less turn, less turn again,
// no dead stop, a harder wall. Nowhere said what a lancha IS, so there was
// nowhere to make her good, and the sum of nine subtractions is exactly what
// the player reported — "too hard to drive, too slow, no dynamic turn".
//
// The worst of it was a genuine DEADLOCK, and it is worth writing down because
// every number below is aimed at it. `physics.js` gave a hull `pivot = 0` where
// a car gets `+1.5x turn` under 60 px/s, and then multiplied what was left by
// `0.25 + 0.75 * spdFac`. Stopped, she had a QUARTER of a turn rate already
// lower than any car's. Meanwhile the touch model damps the throttle by
// `0.35 + 0.65 * cos(e)`, so a finger behind the beam gave 0.35 throttle. No
// speed -> no turn -> no way to get speed pointing anywhere useful -> no speed.
// You could sit in the estero and grind.
//
// So this module keeps the ONE true thing about a hull — she needs flow over
// the rudder, so way is what buys you steering — and refuses the rest:
//
//   * SHE ALWAYS ANSWERS. `turnAt` bottoms out at 0.62, not 0.25, and the
//     shortfall is made up by the throttle rather than by speed: an outboard
//     pushes water past the rudder the instant you open it, which is a real
//     boat and also happens to be the thing that breaks the deadlock.
//   * SHE PIVOTS, LIKE A CAR. The deadlock used to be broken the other way —
//     `idleThrust` kept her making way at 22% throttle up to 95 px/s with the
//     controls untouched, so with no input she DROVE HERSELF and the whole
//     medium read as an auto-ride. The deadlock is real and still has to be
//     answered; the answer is the car's own: `pivot`, a spin-on-the-spot term
//     that fades out with speed. She turns where she sits, then leaves under
//     YOUR throttle. A hull with no way on having no steerage is true, and it
//     is also unplayable with a finger, which is why the car has this term.
//   * COMMITTING PAYS. Past `planeAt` she comes up on the plane — less drag,
//     more top end. "Hold the throttle" becomes a decision with a reward.
//   * THE BANK PUSHES BACK BEFORE IT HITS. `bankAssist` is the answer to "no
//     walls": the manglar is still solid (see `isWall` — surface classes are
//     append-only, so a class added later must be a wall to a hull by default),
//     but you feel it as a cushion and get nudged back into the channel instead
//     of being caught by it. And when you do touch, you GLANCE.
//
// Browser-free on purpose, exactly like `vehicles.js` and `surfaces.js`: the
// world is reached through a predicate the caller passes in, so this file can
// be imported by Node and never sees `window` or the tile streamer.

export const HULL = {
  //: turn authority as a fraction of `veh.turn`, by speed fraction. 0.62 dead
  //: in the water, peaking ~1.18 around half speed (where a planing hull really
  //: does bite hardest), easing to 1.15 flat out so top speed is not a spin.
  turnAt: (f) => 0.62 + 1.36 * f - 0.83 * f * f,
  //: …of which this much is yours with the engine shut. The rest is prop wash:
  //: open the throttle and the rudder gets water over it immediately.
  turnThrottle: 0.35,
  //: astern thrust swings the stern — the brake IS the drift verb on a hull.
  driftTurn: 1.55,
  //: …and it lets go of the water while it does. Replaces the car's 0.55.
  driftGrip: 0.35,

  //: spin-on-the-spot, as a fraction of `veh.turn`, fading out by `pivotTop`
  //: px/s. THE SAME TERM THE CAR HAS, and for the same reason: a tap has to
  //: point her before she moves, or steering means arcing forward first. It
  //: replaces `idleThrust` as the answer to no-speed/no-turn — the difference
  //: is that a pivot is something the player asked for and idle thrust was not.
  pivot: 1.5,
  pivotTop: 60,

  //: on the plane above this speed fraction: less drag, more top end.
  planeAt: 0.55,
  planeTop: 1.10,
  planeDrag: 0.62,
  //: rolling friction under power / coasting. The car's 0.4 / 1.8 stops a hull
  //: dead in her own length once `surfaceMul` is 1.0 on open water.
  fricOn: 0.25,
  fricOff: 0.55,

  //: the bank you feel before you touch it: how far out it pushes, and how hard.
  bankFeel: 46,
  bankPush: 520,
  //: a brush costs you way and turns you back down the channel; a ram still
  //: costs nearly everything, because it should.
  glanceKeep: 0.72,
  glanceBounce: 0.30,
  //: …and it swings the bow, but only half as far as it used to. This is a
  //: heading the player did not ask for, and at 0.9 rad/s a scrape down the
  //: mangrove was steering the boat more than the finger was.
  glanceYaw: 0.45,
  //: grip while in contact. The car's 0.15 is tuned for a kerb you can see and
  //: makes a hull skate along a ragged mangrove edge.
  wallGrip: 0.5,

  //: how fast she heels into a turn. Renderer-only.
  leanRate: 6.0,
  //: a hull may hang further over a ragged shore than a car may over a kerb.
  probeF: 0.62,
};

/**
 * Turn rate as a multiple of `veh.turn`.
 *
 * The two multipliers are deliberately NOT both speed: one is way (flow over
 * the rudder) and one is power (flow FROM the prop). A boat with no way but the
 * throttle open still answers, which is the case the old model got wrong.
 */
export function hullTurn(spdFac, throttle, boosting, braking) {
  const power = Math.max(throttle, boosting ? 1 : 0, 0);
  const wash = HULL.turnThrottle + (1 - HULL.turnThrottle) * Math.min(1, power);
  return HULL.turnAt(Math.min(1, Math.max(0, spdFac))) * wash
    * (braking ? HULL.driftTurn : 1);
}

/**
 * Pivot-in-place, as a multiple of `veh.turn` — added to `hullTurn`, not
 * multiplied, exactly as the car adds its own.
 *
 * This is the whole replacement for `idleThrust`: the deadlock was never that
 * she could not MOVE, it was that she could not POINT. Answer the pointing and
 * the throttle can stay the player's.
 */
export function hullPivot(speed) {
  return HULL.pivot * Math.max(0, 1 - Math.abs(speed) / HULL.pivotTop);
}

/** Rolling friction for a hull, lighter once she is up on the plane. */
export function hullFriction(powered, spdFac) {
  const base = powered ? HULL.fricOn : HULL.fricOff;
  return spdFac > HULL.planeAt ? base * HULL.planeDrag : base;
}

/** Top-speed multiplier: the plane is worth ~10%. */
export function hullTopMul(spdFac) {
  return spdFac > HULL.planeAt ? HULL.planeTop : 1;
}

/**
 * The cushion off the bank — softened, and it is now a BRAKE and not a thruster.
 *
 * Eight probes on a ring, an outward direction summed from every one that is
 * not water. What changed: it used to add `bankPush` along that direction
 * unconditionally, so a hull sitting still near the mangrove was accelerated by
 * the shore, and one running parallel to it was pushed along. That is
 * un-commanded motion, and it was half of what read as the boat driving itself.
 *
 * Now it can only CANCEL velocity that is heading INTO the bank, bounded by the
 * same budget. Stopped, it does nothing. Moving away, it does nothing. So the
 * bank still stops feeling like a fence — you are bled off it before you touch
 * it — without ever putting speed on the boat that the player did not ask for.
 *
 * @param {(x:number,y:number)=>boolean} isWater
 */
export function hullBankAssist(p, veh, dt, isWater) {
  const r = Math.max(veh.w, veh.h) * 0.9;
  let px = 0, py = 0;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const dx = Math.cos(a), dy = Math.sin(a);
    // Two samples out along each spoke, so a bank one probe away pushes harder
    // than one at arm's length and the cushion has a gradient instead of an
    // edge — an on/off push at a fixed radius reads as a second, invisible wall.
    for (let s = 1; s <= 2; s++) {
      const d = (r * s) / 2;
      if (isWater(p.x + dx * d, p.y + dy * d)) continue;
      const w = 1 - d / HULL.bankFeel;
      if (w <= 0) continue;
      px -= dx * w; py -= dy * w;
    }
  }
  if (!px && !py) return;
  const L = Math.hypot(px, py);
  const nx = px / L, ny = py / L;          // unit, pointing AWAY from the bank
  const vn = p.vx * nx + p.vy * ny;        // …so vn < 0 is closing with it
  if (vn >= 0) return;
  const budget = HULL.bankPush * Math.min(1, L) * dt;
  const cut = Math.min(-vn, budget);
  p.vx += nx * cut; p.vy += ny * cut;
}

/**
 * A glance off the bank, in place of the car's "remove all into-wall velocity".
 *
 * Keeps most of the tangential speed, gives a little of the normal back as a
 * bounce, and swings the bow off — so a 15° brush turns you back down the
 * channel having cost you ~28% of your way, while a square-on ram still stops
 * you. Returns the impact speed so the caller can shake the camera on the
 * hard ones only.
 */
export function hullGlance(p, nx, ny, dt) {
  const vn = p.vx * nx + p.vy * ny;
  const speed = Math.hypot(p.vx, p.vy);
  if (vn >= 0) return speed;
  const vt = p.vx * -ny + p.vy * nx;
  p.vx = -ny * vt * HULL.glanceKeep + nx * -vn * HULL.glanceBounce;
  p.vy = nx * vt * HULL.glanceKeep + ny * -vn * HULL.glanceBounce;
  p.a += Math.sign(vt || 1) * HULL.glanceYaw * dt;
  return speed;
}

/** Heel into the turn. Renderer-only — nothing in the sim reads `p.lean`. */
export function hullLean(p, turning, spdFac, dt) {
  const want = Math.max(-1, Math.min(1, turning * spdFac));
  p.lean = (p.lean || 0) + (want - (p.lean || 0)) * Math.min(1, dt * HULL.leanRate);
}
