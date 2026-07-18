// Tutorial: a guided, timerless run that teaches every control and the full
// delivery loop. A tiny step machine lives in `state.tutorial`; physics calls
// tutorialTick(dt) each frame and the HUD renders the current instruction
// (platform-aware: joystick wording on touch, keys on desktop).
import { state } from "./state.js";
import { input } from "./input.js";
import { sfx } from "./audio.js";
import { tuning } from "./tuning.js";

const DONE_KEY = "churchill_tutorial_done_v1";
export function tutorialDone() {
  try { return localStorage.getItem(DONE_KEY) === "1"; } catch { return false; }
}
function markDone() {
  try { localStorage.setItem(DONE_KEY, "1"); } catch { /* private mode */ }
}

// steps 0..5 teach, step 6 congratulates then ends the run
export const TUT_TOTAL = 7;

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
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  const io = coarse ? "touch" : "keys";
  switch (T.step) {
    case 0: return `tut.steer.${io}`;
    case 1: return `tut.speed.${io}`;
    case 2: return `tut.turbo.${io}`;
    case 3: return `tut.brake.${io}`;
    case 4: return "tut.pickup";
    case 5: return "tut.deliver";
    default: return "tut.done";
  }
}

function advance(T) {
  T.step += 1;
  sfx.play("perfect");
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

  switch (T.step) {
    case 0: // steer: drive a bit and actually turn
      if (T.dist > 260 && T.turn > 1.6) advance(T);
      break;
    case 1: // speed: hold near top speed for a beat (tops lowered 2026-07-18)
      if (p.speed > 170 * tuning.speed) { T.fast += dt; if (T.fast > 0.8) advance(T); }
      break;
    case 2: // turbo: hold boost (rim push / X / gamepad RB)
      if (input.boost) { T.boost += dt; if (T.boost > 0.6) advance(T); }
      break;
    case 3: // brake/drift at speed
      if (input.brake && p.speed > 70) { T.brake += dt; if (T.brake > 0.4) advance(T); }
      break;
    case 4: // pick up at the kiosk
      if (state.carrying) advance(T);
      break;
    case 5: // deliver before it melts
      if (state.deliveries >= 1) advance(T);
      break;
    default: // congratulate, then end the run as a win
      T.doneT += dt;
      if (T.doneT > 4) {
        markDone();
        state.over = true; state.won = true;
      }
  }
}
