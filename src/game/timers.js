// EL RELOJ DE LA CORRIDA — how long a run lasts, and whether it has a clock at
// all.
//
// Two separate things used to be the same literal `180`, and one mode's clock
// was a lie.
//
// **`180` meant two things.** It was Arcade's three minutes AND the fallback
// length of a story stage, in `state.js`, in `startArcade`, in the smoke's
// expectation and in the editor's stage form. They are not one number: Arcade's
// three minutes is a game-design decision about a free-roam mode, and a stage's
// limit is authored per stage (`timeLimit`, 115..215 across the seven). Tuning
// the mode would have silently retuned every stage the editor created.
//
// **`999` was a magic near-infinity.** Recorrer and the tutorial both set the
// clock to 999 s, and Recorrer then counted it down and reset it to 999 when it
// hit zero — a treadmill nobody could see, since the HUD hides the timer in
// both modes. Meanwhile `delivery.js` paid 12 s per delivery into it and a
// knock in the estero took 3 s out of it. All of that was bookkeeping on a
// number with no consumer.
//
// So a run is TIMED or it is UNTIMED, and `timeLeft === UNTIMED` is the test —
// not a list of mode names, which is what the HUD used to ask. Everything that
// adds or spends time goes through `addTime`, which does nothing when there is
// no clock to spend.
//
// (These are seconds, not lengths, so they are deliberately NOT in
// `src/assets/world-units.json`, which is metres of ground. Their JSON home is
// `progression.json` — see the ROADMAP's mode-defaults row.)

/** Arcade: three minutes of free roam. */
export const ARCADE_DURATION_S = 180;

/**
 * What a story stage gets when the world authored no `timeLimit`.
 *
 * In practice every stage carries its own (115..215 s) and this is the editor's
 * starting value for a new one. It shares Arcade's number today and that is a
 * coincidence, not a contract.
 */
export const DEFAULT_STAGE_DURATION_S = 180;

/** No clock. Recorrer and the tutorial: you stop when you decide to. */
export const UNTIMED = null;

/** Does this run have a clock? */
export function isTimed(s) { return s.timeLeft !== UNTIMED; }

/**
 * Spend or bank seconds. A no-op on an untimed run — which is the whole point:
 * the callers (a delivery bonus, a gate, a knock, the rewarded-ad continue)
 * should not each have to know which modes have a clock.
 */
export function addTime(s, seconds) {
  if (!isTimed(s)) return;
  s.timeLeft = Math.max(0, s.timeLeft + seconds);
}

/** Seconds left, or 0 where there is no clock — for anything that SCORES time. */
export function timeRemaining(s) {
  return isTimed(s) ? Math.max(0, s.timeLeft) : 0;
}
