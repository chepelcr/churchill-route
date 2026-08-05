// La marea — the tide, on the same clock as the sky.
//
// The Gulf of Nicoya has a big tide: three metres between pleamar and bajamar
// on a spring, and the Estero de Puntarenas is shallow enough that the water
// genuinely leaves. At bajamar the bancos de arena come out of the channel and
// the navigable water narrows to a thread; at pleamar they are under you and
// the estero is wide open. That is a real thing about this place, and it is
// also the best difficulty knob the crossing has, because it changes the SHAPE
// of the course rather than the numbers on it.
//
// THREE DECISIONS WORTH KNOWING:
//
//   * THE TIDE IS A FUNCTION OF TIME, NOT A SIMULATION. One cosine on the day
//     clock. Two highs and two lows per day, like the real semidiurnal tide,
//     and no state to get out of step with a reload.
//   * IT RIDES THE DAY CLOCK WHEN THERE IS ONE, AND ITS OWN WHEN THERE IS NOT.
//     `daynight.js` only runs its clock in Recorrer; a stage picks a fixed sky
//     so a three-minute run never strobes. The crossing still wants the water
//     to move under it, so when the day clock is off the tide runs on the run's
//     own elapsed time from a phase the run chose.
//   * A STORM RAISES IT. Storm surge is the reason a bad night is dangerous
//     rather than merely dark: the banks are covered, so the lane is wide, and
//     everything in it is moving. High water is not the easy case.
import { state } from "./state.js";
import { DAY_SECONDS, dayCycleOn, timeOfDay } from "./daynight.js";

//: a full tidal cycle in real seconds — TWO of them per day, which is what
//: makes it semidiurnal like the real gulf.
export const TIDE_PERIOD = DAY_SECONDS / 2;

//: how much a storm piles the water up, on top of the astronomical tide.
//: Enough to drown the banks a bajamar would have exposed, never enough on its
//: own to make a low tide read as a high one.
const STORM_SURGE = 0.28;

//: how fast the surge arrives and leaves. A storm that raised the water
//: instantly would pop the banks out of existence mid-turn.
const SURGE_RATE = 0.35;

const tide = {
  t: 0,             // own clock, used when the day clock is off
  phase: 0,         // 0..1, where in the cycle this run starts
  surge: 0,         // current storm contribution, eased toward its target
  level: 0.5,
  rising: true,
};

/**
 * Start (or restart) the tide at a given WATER LEVEL.
 *
 * The argument is the level you want, not a phase, and the phase is solved for
 * it — because every caller thinks in water. Naming a phase instead was a real
 * bug for about ten minutes: a condition authored as "half tide at sunset" with
 * `0.45` started at 0.97, nearly full, because 0.45 of the way round a cosine
 * is very nearly the top of it. The level is the thing the level designer means.
 *
 * She always starts on the FLOOD (rising), which is the half of the cycle where
 * the estero is filling — a run begun at bajamar therefore gets easier as it
 * goes, and one begun near pleamar tops out and starts to drain under you.
 *
 * @param {number} level 0 (bajamar) .. 1 (pleamar)
 */
export function setTide(level = 0.5) {
  const l = Math.max(0, Math.min(1, level));
  tide.t = 0;
  // level = 0.5 - 0.5·cos(2πu)  ⇒  u = acos(1 - 2·level) / 2π
  tide.phase = Math.acos(1 - 2 * l) / (Math.PI * 2);
  tide.surge = 0;
  tide.level = l;
  tide.rising = true;
}

//: the tide with no weather in it, 0 (bajamar) .. 1 (pleamar).
function astronomical(seconds) {
  // Ride the day clock where there is one, so the tide and the sky agree in
  // Recorrer; otherwise the run's own elapsed time.
  const u = dayCycleOn()
    ? (timeOfDay() * DAY_SECONDS) / TIDE_PERIOD + tide.phase
    : seconds / TIDE_PERIOD + tide.phase;
  return 0.5 - 0.5 * Math.cos(u * Math.PI * 2);
}

export function updateTide(dt) {
  tide.t += dt;
  const prev = tide.level;
  const target = state.weather === "storm" ? STORM_SURGE : 0;
  tide.surge += (target - tide.surge) * Math.min(1, dt * SURGE_RATE);
  tide.level = Math.max(0, Math.min(1, astronomical(tide.t) + tide.surge));
  if (Math.abs(tide.level - prev) > 1e-5) tide.rising = tide.level > prev;
  state.tide = tide.level;
  state.tideRising = tide.rising;
}

/** 0 (bajamar, banks out) .. 1 (pleamar, everything under water). */
export function tideLevel() { return tide.level; }
export function tideRising() { return tide.rising; }

//: the four names a porteño would actually use, for the HUD and the brief.
export function tideName(level = tide.level) {
  if (level < 0.22) return "baja";
  if (level > 0.78) return "alta";
  return tide.rising ? "subiendo" : "bajando";
}

/**
 * How much of the marked channel is actually navigable right now, 0..1.
 *
 * THE LANE NARROWS AT LOW WATER, and this is the knob the whole level turns on.
 * The buoys do not move — they mark the channel, not the water — so at bajamar
 * you are threading a lane visibly narrower than the one the marks describe,
 * which is exactly the read a real pilot makes. It never closes completely:
 * a crossing you cannot make is not a difficulty setting.
 */
export function navigableFraction(level = tide.level) {
  // THE MARKED CHANNEL HAS TO STAY MOSTLY SAILABLE. At 0.55 a bajamar left the
  // navigable water at 58 px against buoys set at 105, so a boat steering dead
  // centre between the marks was still in the shallows and dragging — the level
  // read as "the boat is slow", not as "you are off the line", which is the
  // opposite of what a channel is for. The floor is the width of the promise
  // the buoys make; the tide narrows it enough to be felt, not enough to lie.
  return 0.72 + 0.28 * level;
}
