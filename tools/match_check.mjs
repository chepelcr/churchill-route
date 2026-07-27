#!/usr/bin/env node
// Headless check on the cancha match (src/game/match.js).
//
// The render loop and the physics have no unit tests and the world module is
// Vite-only, so a match would normally only be checkable by eye in a browser.
// `match.js` deliberately imports nothing, which lets it be ticked here against
// REAL fields pulled out of the emitted manifest.
//
//   node tools/match_check.mjs
//
// Asserts, per field: the ball never leaves the pitch, goals land in a sane
// band, and the car can score. Exits non-zero on any failure.
import fs from "node:fs";
import { advanceMatch, carHitsMatch, createMatch, playable, startCheer, toFrame, toWorld }
  from "../src/game/match.js";

const manifest = JSON.parse(fs.readFileSync(new URL("../src/world2d/manifest.json", import.meta.url)));
const DT = 1 / 60;
let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log(`  FAIL ${msg}`); } };

// Deterministic RNG so a failure is reproducible.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const fields = [
  ...manifest.stadiums.map((s) => ({ ...s, name: "estadio" })),
  ...manifest.parcels
    .filter((p) => (p.use === "stadium" || p.use === "plaza") && !p.whole)
    .map((p) => ({
      cx: (p.x0 + p.x1) / 2, cy: (p.y0 + p.y1) / 2,
      ang: p.ang || 0, hw: p.hw, hh: p.hh, sport: p.sport,
      footprint: p.poly, name: p.name,
    })),
];
const play = fields.filter(playable);
console.log(`fields: ${fields.length}, playable: ${play.length}`);
check(play.length > 0, "no field is playable at all");
const courts = fields.filter((f) => f.sport === "basketball");
console.log(`  basketball courts: ${courts.length}, playable ${courts.filter(playable).length}`);
// A smoke world has one tiny court, so "none playable" is only a defect when
// the map actually carries a spread of them.
check(courts.length < 5 || courts.some(playable), "no basketball court is playable");
check(play.some((f) => f.sport === "soccer"), "no football pitch is playable");

// Tick every playable field for 3 simulated minutes.
const SECS = 180;
let totalGoals = 0, worstOut = 0;
const perField = [];
const gaps = [];
for (let i = 0; i < play.length; i++) {
  const F = play[i];
  const rnd = rng(1234 + i * 977);
  const m = createMatch(F, rnd);
  let last = 0, goals = 0;
  for (let t = 0; t < SECS; t += DT) {
    const goal = advanceMatch(m, DT, rnd);
    // the ball must stay on the pitch, always — measured in the field's frame
    const [bu, bv] = toFrame(F, m.ball.x, m.ball.y);
    worstOut = Math.max(worstOut, Math.abs(bu) - F.hw, Math.abs(bv) - F.hh);
    // …and so must every player
    for (const p of m.players) {
      const [pu, pv] = toFrame(F, p.x, p.y);
      worstOut = Math.max(worstOut, Math.abs(pu) - F.hw, Math.abs(pv) - F.hh);
    }
    if (goal) { gaps.push(t - last); last = t; goals++; totalGoals++; }
  }
  perField.push({ F, goals });
  if (goals === 0) console.log(`  no goal in ${SECS}s on ${F.sport} ${F.name || ""} ${F.hw}x${F.hh}`);
}
check(worstOut <= 0.51, `ball/player left the pitch by ${worstOut.toFixed(2)}px`);
check(totalGoals > 0, "nobody scored anywhere in 3 minutes");
// The metric that matters is the gap PER FIELD — a median over the pooled gaps
// hides a field that scores in bursts and then goes quiet for ten minutes,
// which is exactly what an earlier cut of the sim did.
const gapsPerField = perField.map(({ F, goals }) => ({
  F, gap: goals ? SECS / goals : Infinity,
}));
for (const { F, gap } of gapsPerField) {
  console.log(`  ${(F.name || F.sport).slice(0, 30).padEnd(30)} ${String(F.hw).padStart(6)}x${String(F.hh).padEnd(6)} ` +
              `a goal every ${gap === Infinity ? "never" : gap.toFixed(0) + "s"}`);
}
check(gapsPerField.every(({ gap }) => gap >= 15 && gap <= 90),
      `some field's goal interval is outside 15-90s`);

// The car can score: park it on the ball and shove it at a goal.
{
  const F = play.find((f) => f.sport === "soccer");
  const rnd = rng(7);
  const m = createMatch(F, rnd);
  let scored = false;
  for (let t = 0; t < 60 && !scored; t += DT) {
    // drive at the ball from the middle of the pitch, aimed down +u
    const [bx, by] = [m.ball.x, m.ball.y];
    const [cx, cy] = toWorld(F, toFrame(F, bx, by)[0] - 14, toFrame(F, bx, by)[1]);
    carHitsMatch(m, cx, cy, 260, 0);
    if (advanceMatch(m, DT, rnd)) scored = true;
  }
  check(scored, "the car could not score in 60s of shoving the ball");
  console.log(`car scoring on ${F.name || F.sport}: ${scored ? "ok" : "NO"}`);
}

// The celebration: while the coins are on the grass the ball is off the pitch
// and every player is drawn as a celebrating fan; when it lapses, both come
// back and play restarts from the centre. This is the part a screenshot cannot
// show, so it is checked here.
{
  const F = play.find((f) => f.sport === "soccer");
  const rnd = rng(11);
  const m = createMatch(F, rnd);
  const CHEER = 11;                       // physics passes its ACOIN_RAIN_TTL
  let scored = false;
  for (let t = 0; t < 240 && !scored; t += DT) if (advanceMatch(m, DT, rnd)) scored = true;
  check(scored, "no goal in 240s, cannot test the celebration");
  startCheer(m, CHEER);
  check(m.cheer === true, "the cheer did not start");
  check(m.players.every((p) => p.kind === "fan"), "a player is still a player mid-cheer");
  check(m.players.every((p) => p.hue !== undefined), "a celebrating player has no hue to wear");
  // half way through: still celebrating, nobody has kicked off
  for (let t = 0; t < CHEER / 2; t += DT) advanceMatch(m, DT, rnd);
  check(m.cheer === true, `the cheer ended early (pause ${m.pause.toFixed(2)})`);
  const phMoved = m.players.some((p) => p.ph > 0);
  check(phMoved, "the celebrating players are not animating");
  // …and out the far side. Stop on the frame it lapses: the kickoff happens on
  // that same frame, and a moment later the ball is in play and moving again.
  let t2 = 0;
  while (m.cheer && t2 < CHEER * 2) { advanceMatch(m, DT, rnd); t2 += DT; }
  check(m.cheer === false, "the cheer never ended");
  check(m.players.every((p) => p.kind === "player"), "a player never came back");
  check(Math.hypot(m.ball.x - F.cx, m.ball.y - F.cy) < 1, "the ball did not return to the centre");
  console.log(`celebration on ${F.name || F.sport}: ${CHEER}s, ball back at kickoff`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall match checks passed");
process.exit(failures ? 1 : 0);
