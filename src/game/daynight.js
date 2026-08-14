// The sky, on a clock.
//
// Weather was a value you picked once and lived with: a stage names its own, an
// arcade run took whatever was authored, and Recorrer stayed sunny for as long
// as you drove. The peninsula deserves better than one hour of one day — the
// atardecer over the gulf is the thing people photograph.
//
// THERE IS NO GAME-TIME SCALE IN THIS GAME. `state.timeLeft -= dt` is real
// seconds, everywhere, so a "ten minute day" is ten minutes of playing. That is
// the right length for Recorrer, where a session is long and the change should
// arrive as a surprise rather than a strobe — and the wrong length for a
// three-minute Arcade run, which is why Arcade PICKS its sky instead of
// cycling: a run that ends before dusk is a run that never saw it.
//
// The cycle is the four weathers the renderer already paints, in the order the
// day actually goes. Storm is not part of it: it INTERRUPTS, the way it does on
// the Pacific, and hands the sky back where it left off.
import { state } from "./state.js";
import { pushFloat } from "./state.js";
import { t } from "../i18n/index.js";
import SIM from "../content/simulation.json" with { type: "json" };

//: a whole day, in real seconds. Four phases, so ~2.5 min each.
export const DAY_SECONDS = SIM.day.seconds;
//: the running order of a day. `sunny` is midday and gets the longest share.
const PHASES = SIM.day.phases.map((p) => ({ w: p.weather, share: p.share }));
//: how often a storm rolls in, and how long it stays.
const STORM_EVERY = SIM.day.stormEverySeconds;   // s, random inside the range
const STORM_LASTS = SIM.day.stormLastsSeconds;

const cycle = {
  on: false, t: 0, phase: -1,
  stormIn: 0, stormLeft: 0, before: null,
};

function rand([lo, hi]) { return lo + Math.random() * (hi - lo); }

/** Start (or stop) the clock. `at` is 0..1 through the day. */
export function setDayCycle(on, at = 0) {
  cycle.on = on;
  cycle.t = at * DAY_SECONDS;
  cycle.phase = -1;
  cycle.stormLeft = 0;
  cycle.before = null;
  cycle.stormIn = rand(STORM_EVERY);
  if (on) apply(true);
}

export function dayCycleOn() { return cycle.on; }

/** 0..1 through the day — for anything that wants a continuous hour. */
export function timeOfDay() {
  return cycle.on ? (cycle.t % DAY_SECONDS) / DAY_SECONDS : null;
}

function phaseAt(seconds) {
  let acc = 0;
  const u = (seconds % DAY_SECONDS) / DAY_SECONDS;
  for (let i = 0; i < PHASES.length; i++) {
    acc += PHASES[i].share;
    if (u < acc) return i;
  }
  return PHASES.length - 1;
}

function apply(silent) {
  const i = phaseAt(cycle.t);
  if (i === cycle.phase) return;
  cycle.phase = i;
  // A storm owns the sky while it lasts; the cycle keeps running underneath so
  // it hands back the right hour when the rain stops.
  if (!cycle.stormLeft) state.weather = PHASES[i].w;
  if (!silent && !cycle.stormLeft) {
    pushFloat(state.p.x, state.p.y - 60, t(`sky.${PHASES[i].w}`), "#f4d77a");
  }
}

export function updateDayCycle(dt) {
  if (!cycle.on) return;
  cycle.t += dt;
  if (cycle.stormLeft > 0) {
    cycle.stormLeft -= dt;
    if (cycle.stormLeft <= 0) {
      state.weather = PHASES[phaseAt(cycle.t)].w;      // back to the hour
      cycle.stormIn = rand(STORM_EVERY);
      pushFloat(state.p.x, state.p.y - 60, t("sky.clearing"), "#9fd7ef");
    }
    return;
  }
  apply(false);
  cycle.stormIn -= dt;
  if (cycle.stormIn <= 0) {
    cycle.before = state.weather;
    state.weather = "storm";
    cycle.stormLeft = rand(STORM_LASTS);
    pushFloat(state.p.x, state.p.y - 60, t("sky.storm"), "#9fd7ef");
  }
}
