// Tutorial: a guided, timerless run that teaches every control and the full
// delivery loop. A tiny step machine lives in `state.tutorial`; physics calls
// tutorialTick(dt) each frame and the HUD renders the current instruction
// (platform-aware: joystick wording on touch, keys on desktop).
import { state } from "./state.js";
import { input } from "./input.js";
import { sfx } from "./audio.js";
import { tuning } from "./tuning.js";
import PROGRESSION from "../content/progression.json" with { type: "json" };

const DONE_KEY = "churchill_tutorial_done_v1";
export function tutorialDone() {
  try { return localStorage.getItem(DONE_KEY) === "1"; } catch { return false; }
}
function markDone() {
  try { localStorage.setItem(DONE_KEY, "1"); } catch { /* private mode */ }
}

// THE STEPS ARE DATA — `src/content/progression.json` -> `tutorial`. Six teach,
// the seventh congratulates and ends the run as a win.
//
// What stays code is the GATE of each step: reading the input, accumulating the
// distance, noticing a delivery. What moved is the ORDER, the wording key and
// every threshold — "260 px driven and 1.6 radians turned" is a judgement about
// when somebody has understood steering, not an engine constant.
const STEPS = PROGRESSION.tutorial.steps;
export const TUT_TOTAL = STEPS.length;

//: Each gate answers "has this step been satisfied this frame?" for its own
//: step record. A step naming a gate that is not here is a step nobody can
//: pass — `tests/test_progression.py` is the gate on the gates.
const GATES = {
  driveAndTurn: (T, st, dt, S) => T.dist > S.distancePx && T.turn > S.turnRadians,
  // The speed target is scaled by `tuning.speed`, so the lesson still passes
  // for a player who has slowed the whole game down in Settings.
  holdSpeed: (T, st, dt, S) => {
    if (st.p.speed > S.speed * tuning.speed) { T.fast += dt; return T.fast > S.seconds; }
    return false;
  },
  holdBoost: (T, st, dt, S) => {
    if (input.boost) { T.boost += dt; return T.boost > S.seconds; }
    return false;
  },
  brakeAtSpeed: (T, st, dt, S) => {
    if (input.brake && st.p.speed > S.speed) { T.brake += dt; return T.brake > S.seconds; }
    return false;
  },
  carrying: (T, st) => !!st.carrying,
  delivered: (T, st, dt, S) => st.deliveries >= (S.count || 1),
  linger: (T, st, dt, S) => { T.doneT += dt; return T.doneT > S.seconds; },
};

export function initTutorial() {
  state.tutorial = {
    step: 0, total: TUT_TOTAL,
    dist: 0, turn: 0, fast: 0, boost: 0, brake: 0, doneT: 0,
    lastX: state.p.x, lastY: state.p.y, lastA: state.p.a,
  };
}

// i18n key of the current instruction (HUD looks it up with t())
export function tutorialStepKey() {
  const T = state.tutorial;
  if (!T) return null;
  const step = STEPS[Math.min(T.step, STEPS.length - 1)];
  if (!step) return null;
  // A step marked `platform` has two wordings: "hold the rim" and "hold X" are
  // the same lesson, and a phone must not be told about a keyboard.
  if (!step.platform) return step.key;
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  return `${step.key}.${coarse ? "touch" : "keys"}`;
}

function advance(T) {
  T.step += 1;
  sfx.play(PROGRESSION.tutorial.sound);
}

export function tutorialTick(dt) {
  const T = state.tutorial;
  if (!T || state.over) return;
  const p = state.p;
  // motion accumulators (distance driven + heading change)
  T.dist += Math.hypot(p.x - T.lastX, p.y - T.lastY);
  let da = p.a - T.lastA;
  T.turn += Math.abs(Math.atan2(Math.sin(da), Math.cos(da)));
  T.lastX = p.x; T.lastY = p.y; T.lastA = p.a;

  const step = STEPS[T.step];
  if (!step) return;
  const gate = GATES[step.gate];
  if (!gate) return;                       // an unimplemented gate cannot pass
  if (!gate(T, state, dt, step)) return;

  // The last step is the one that ENDS the run, and it ends it as a win so the
  // results screen says so.
  if (T.step >= STEPS.length - 1) {
    markDone();
    state.over = true; state.won = true;
    return;
  }
  advance(T);
}
