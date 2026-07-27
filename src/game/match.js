// The match on a cancha: two teams, one ball, and a goal that pays.
//
// Every field on the map used to hold a dozen NPCs celebrating nothing, and the
// coin rain was a CLOCK — a silver burst whenever the camera sat over a pitch
// and the cooldown had run out. Here the coins come from a goal, because there
// is a goal.
//
// BROWSER-FREE, like vehicles.js and surfaces.js, and for a sharper reason: the
// world module (src/world2d/index.js) uses `import.meta.glob`, which is Vite
// only, so anything importing it cannot run under Node. This file takes the
// field as a plain object and imports nothing, which is what lets the match be
// checked headlessly instead of by eye in a browser.
//
// The field is {cx, cy, ang, hw, hh, sport, footprint} — the frame the world
// emits for every parcel and both estadios. `hw` is the half-length ALONG the
// pitch, so the goals sit at ±hw and the halfway line is x = 0 in frame space.

export const TEAM_TONES = ["#e8452f", "#2f6fe8"];   // rojo y azul, como siempre

const PLAYER_V = 26;              // px/s — a jog at this scale
const BALL_DRAG = 2.4;            // per second
const TOUCH_R = 9;                // px — how close a player has to be to kick
const TOUCH_COOLDOWN = 0.45;      // s before the same ball can be struck again
const SHOOT_RANGE = 0.42;         // fraction of hw from goal before shooting
const RESET_PAUSE = 1.4;          // s of celebration before the kickoff
// A cancha is 60 px across and an estadio 200; a fixed ball speed crosses the
// small one in a blink, which is how the first cut scored every 1.4 s. Every
// speed here is a FRACTION OF THE PITCH, so a game paces the same on both.
const DRIBBLE = 0.55;             // touch power, in pitch half-lengths per second
const SHOT = 1.5;
const BALL_MAX_F = 2.2;
// The mouth, as a fraction of the pitch's half-width. A real goal is a small
// target: making it generous is the other half of why everything scored.
const MOUTH = 0.22;
const MOUTH_MIN = 8;
const KEEPER_R = 9;               // px — how close the ball must come to be saved
const KEEPER_V = 0.55;            // keeper speed, as a fraction of an outfielder's
// HOW OFTEN SOMEBODY SCORES IS A DIAL, not an emergent property.
//
// It was emergent first, and that does not survive this map: a cancha here is
// 60 px across and Lito Pérez 210, while a touch radius and a keeper's reach
// are absolute, so the same settings gave one field a goal every 6 s and
// another none in fifteen minutes. Nothing about the player's experience wants
// that — the match is scenery with a payoff, and the payoff has to be paced.
//
// So: the keeper saves everything until the clock runs out, and once it does
// the next attack goes in. What the player sees is a game being played and a
// goal now and then; what the code guarantees is the interval.
const GOAL_EVERY = [25, 45];      // s — the band a goal falls in
const PRESS_AFTER = 12;           // s past the clock before the ball is walked in

// Frame <-> world. The pitch's own axes: u along its length, v across it.
export function toFrame(F, x, y) {
  const ca = Math.cos(F.ang), sa = Math.sin(F.ang);
  const dx = x - F.cx, dy = y - F.cy;
  return [dx * ca + dy * sa, -dx * sa + dy * ca];
}
export function toWorld(F, u, v) {
  const ca = Math.cos(F.ang), sa = Math.sin(F.ang);
  return [F.cx + u * ca - v * sa, F.cy + u * sa + v * ca];
}

export function isCourt(sport) {
  return sport === "basketball";
}

// A field only holds a match if it is a sport we can play and there is room for
// one. Below that the cancha is scenery — which is also where the renderer
// stops drawing markings.
export function playable(F) {
  if (!F || !F.hw || !F.hh) return false;
  if (F.sport !== "soccer" && F.sport !== "basketball") return false;
  // Per SPORT, because a court is not a small pitch: a real cancha de basket is
  // 28x15 m, which lands at a 12 px half-width here. Gating both on a pitch's
  // 22 px ruled out all 17 courts on the map.
  return isCourt(F.sport) ? F.hw >= 14 && F.hh >= 7 : Math.min(F.hw, F.hh) >= 22;
}

// How many a side. A 28x14 px court cannot hold ten people without reading as a
// scrum, and Lito Pérez looks empty with four.
function roster(F) {
  return Math.max(2, Math.min(5, Math.round(Math.min(F.hw, F.hh) / 11)));
}

// The point a team is attacking, in FRAME coords. Soccer: the goal mouth on the
// far end line. Basketball: the hoop, which sits just inside it.
function target(F, team) {
  const sd = team ? 1 : -1;
  return isCourt(F.sport) ? [sd * (F.hw - 5), 0] : [sd * F.hw, 0];
}

export function createMatch(F, rnd = Math.random) {
  const m = {
    field: F, sport: F.sport, players: [], pause: 0, score: [0, 0],
    ball: { x: F.cx, y: F.cy, vx: 0, vy: 0 },
    clock: GOAL_EVERY[0] + rnd() * (GOAL_EVERY[1] - GOAL_EVERY[0]),
  };
  const n = roster(F);
  for (let team = 0; team < 2; team++) {
    for (let i = 0; i < n; i++) {
      // spread down the team's own half, off the centre line
      const u = (team ? 1 : -1) * F.hw * (0.15 + rnd() * 0.65);
      const v = (rnd() - 0.5) * F.hh * 1.5;
      const [x, y] = toWorld(F, u, v);
      m.players.push({
        x, y, team, ang: rnd() * Math.PI * 2, v: PLAYER_V, ph: rnd() * Math.PI * 2,
        kind: "player", match: m, scatter: 0,
        // One keeper a side. Without one the match is an unopposed shuttle —
        // whoever wins the ball walks it in, and every field scored every 5 s.
        // A keeper is both the honest fix and the one that looks right.
        keeper: i === 0 && !isCourt(F.sport),
      });
    }
  }
  return m;
}

// Keep a point inside the pitch, in FRAME space — the shape is a rectangle in
// its own frame, so this is a clamp rather than a polygon test. `pad` holds a
// player off the touchline the way FIELD_INSET holds a fan off the acera.
function clampFrame(F, u, v, pad) {
  const hu = Math.max(1, F.hw - pad), hv = Math.max(1, F.hh - pad);
  return [Math.max(-hu, Math.min(hu, u)), Math.max(-hv, Math.min(hv, v))];
}

/**
 * Advance one match. Returns null, or {team, x, y} when a goal was scored —
 * the caller turns that into the coin rain, the float and the sound.
 */
export function advanceMatch(m, dt, rnd = Math.random) {
  const F = m.field, b = m.ball;
  m.clock -= dt;
  const open = m.clock <= 0;      // the goal is live: the next attack goes in
  for (const p of m.players) p.ph += dt * 7;
  if (m.pause > 0) {                      // celebrating; kickoff when it lapses
    m.pause -= dt;
    if (m.pause <= 0) {
      b.x = F.cx; b.y = F.cy; b.vx = 0; b.vy = 0;
      m.clock = GOAL_EVERY[0] + rnd() * (GOAL_EVERY[1] - GOAL_EVERY[0]);
    }
    return null;
  }

  // Who is on the ball: nearest OUTFIELD player, and only if they are not being
  // shoved out of the way by the car. A keeper is handled separately — it holds
  // its line and clears, it does not go on a run.
  let carrier = null, best = Infinity;
  for (const p of m.players) {
    if (p.scatter > 0) { p.scatter -= dt; continue; }
    if (p.keeper) continue;
    const d = Math.hypot(p.x - b.x, p.y - b.y);
    if (d < best) { best = d; carrier = p; }
  }

  for (const p of m.players) {
    let tx, ty;
    if (p.scatter > 0) {                  // shoved: run the way you were pushed
      tx = p.x + Math.cos(p.ang) * 40; ty = p.y + Math.sin(p.ang) * 40;
    } else if (p.keeper) {
      // hold the line, tracking the ball across the mouth
      const [ou] = target(F, p.team ? 0 : 1);
      const [, bv0] = toFrame(F, b.x, b.y);
      const mouth = Math.max(MOUTH_MIN, F.hh * MOUTH);
      [tx, ty] = toWorld(F, ou * 0.92, Math.max(-mouth, Math.min(mouth, bv0)));
    } else if (p === carrier) {
      // GO TO THE BALL FIRST. Sending the carrier straight at the goal is what
      // made the first cut stand still: it walked off without the ball while
      // everyone else orbited, and the nearest player settled 15 px away —
      // never inside TOUCH_R, so nobody ever kicked anything.
      if (best > TOUCH_R * 0.7) { tx = b.x; ty = b.y; }
      else { const [gu, gv] = target(F, p.team); [tx, ty] = toWorld(F, gu, gv); }
    } else {
      // converge loosely on the ball — a small per-player offset keeps it a
      // game rather than ten dots on one point
      const a = (p.team * 2.1 + m.players.indexOf(p)) * 1.7;
      tx = b.x + Math.cos(a) * 18; ty = b.y + Math.sin(a) * 18;
    }
    const a = Math.atan2(ty - p.y, tx - p.x);
    p.ang = a;
    const sp = p.v * (p.keeper ? KEEPER_V : 1);
    let [u, v] = toFrame(F, p.x + Math.cos(a) * sp * dt, p.y + Math.sin(a) * sp * dt);
    [u, v] = clampFrame(F, u, v, 6);
    [p.x, p.y] = toWorld(F, u, v);
  }

  // The carrier's touch. Away from goal it is a DRIBBLE — a short push that
  // keeps the ball with the players — and only inside SHOOT_RANGE does it
  // become a shot. The cooldown stops five players stood over the ball from
  // striking it sixty times a second, which was the other reason play beelined.
  m.touch = Math.max(0, (m.touch || 0) - dt);
  if (carrier && best < TOUCH_R && !m.touch) {
    const [gu, gv] = target(F, carrier.team);
    const [cu] = toFrame(F, carrier.x, carrier.y);
    const near = open || Math.abs(cu - gu) < F.hw * SHOOT_RANGE;
    // AIM FOR A CORNER when shooting. Aimed at the middle of the mouth every
    // shot walks into the keeper's hands; a corner is what a shot is for.
    const mouth = Math.max(MOUTH_MIN, F.hh * MOUTH);
    const aimV = near ? (rnd() < 0.5 ? -1 : 1) * mouth * 0.8 : gv;
    const [gx, gy] = toWorld(F, gu, aimV);
    // aim tightens near the goal, but never to a certainty — a shot that misses
    // and rebounds off the end line is what a match is mostly made of
    const a = Math.atan2(gy - carrier.y, gx - carrier.x)
      + (rnd() - 0.5) * (near ? 0.5 : 1.3);
    const power = F.hw * (near ? SHOT : DRIBBLE);
    b.vx = Math.cos(a) * power; b.vy = Math.sin(a) * power;
    m.touch = TOUCH_COOLDOWN;
  }

  // If the clock has been up a long while and play is still stuck in a scrum,
  // walk the ball at the nearest goal. Without this a match that loses the ball
  // in a corner can sit there for minutes, and the coin rain with it.
  if (m.clock < -PRESS_AFTER) {
    const [bu0] = toFrame(F, b.x, b.y);
    const away = bu0 >= 0 ? 1 : -1;
    const [gx, gy] = toWorld(F, away * F.hw, 0);
    const a = Math.atan2(gy - b.y, gx - b.x);
    b.vx += Math.cos(a) * F.hw * 1.2 * dt; b.vy += Math.sin(a) * F.hw * 1.2 * dt;
  }

  // Ball: drag, then the pitch's own walls.
  const bmax = F.hw * BALL_MAX_F;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > bmax) { b.vx = b.vx / sp * bmax; b.vy = b.vy / sp * bmax; }
  const k = Math.max(0, 1 - BALL_DRAG * dt);
  b.vx *= k; b.vy *= k;
  let [bu, bv] = toFrame(F, b.x + b.vx * dt, b.y + b.vy * dt);

  // THE SAVE. A keeper close enough to the ball clears it upfield — the ball
  // never reaches the line, and the attack has to be rebuilt. This is what
  // turns a shuttle into a match.
  for (const p of m.players) {
    if (!p.keeper || p.scatter > 0) continue;
    const [bx, by] = toWorld(F, bu, bv);
    if (Math.hypot(p.x - bx, p.y - by) > KEEPER_R) continue;
    if (open) continue;                         // clock is up: it is going in
    const [ou] = target(F, p.team ? 0 : 1);       // its own goal is behind it
    const away = -Math.sign(ou) || 1;            // upfield, away from its own line
    const dir = F.ang + (away > 0 ? 0 : Math.PI) + (rnd() - 0.5) * 1.1;
    const power = F.hw * SHOT * 0.9;
    b.vx = Math.cos(dir) * power; b.vy = Math.sin(dir) * power;
    [bu, bv] = toFrame(F, p.x, p.y);
    m.touch = TOUCH_COOLDOWN;
    break;
  }

  // A goal: past the end line, within the mouth. Basketball scores on the hoop
  // instead, which is a point, so the test is a radius around it.
  for (let team = 0; team < 2; team++) {
    const [gu, gv] = target(F, team);
    const scored = isCourt(F.sport)
      ? Math.hypot(bu - gu, bv - gv) < Math.max(6, F.hh * 0.16)
      : (team ? bu >= gu : bu <= gu) && Math.abs(bv) < Math.max(MOUTH_MIN, F.hh * MOUTH);
    // THE CLOCK GOVERNS, whatever the sport. Gating only the keeper left the
    // basketball courts — which have no keeper — scoring every 4 s. A ball that
    // reaches the line early is a post, not a goal.
    if (!scored || !open) continue;
    m.score[team]++;
    m.pause = RESET_PAUSE;
    b.vx = 0; b.vy = 0;
    const [gx, gy] = toWorld(F, gu, gv);
    return { team, x: gx, y: gy };
  }

  // …otherwise bounce off the touchline and stay on the pitch.
  const hu = F.hw, hv = F.hh;
  if (bu < -hu || bu > hu) { b.vx = -b.vx * 0.6; b.vy *= 0.8; bu = Math.max(-hu, Math.min(hu, bu)); }
  if (bv < -hv || bv > hv) { b.vy = -b.vy * 0.6; b.vx *= 0.8; bv = Math.max(-hv, Math.min(hv, bv)); }
  [b.x, b.y] = toWorld(F, bu, bv);
  return null;
}

/**
 * The car, on the pitch. The ball takes an impulse from the car's velocity —
 * so you can score with it, coin rain and all — and the players nearby break
 * away rather than being driven through.
 */
export function carHitsMatch(m, px, py, vx, vy, r = 22) {
  if (m.pause > 0) return;
  const b = m.ball;
  if (Math.hypot(b.x - px, b.y - py) < r) {
    const a = Math.atan2(b.y - py, b.x - px);
    const power = Math.min(m.field.hw * BALL_MAX_F, m.field.hw * 0.7 + Math.hypot(vx, vy) * 0.6);
    b.vx = Math.cos(a) * power; b.vy = Math.sin(a) * power;
  }
  for (const p of m.players) {
    if (Math.hypot(p.x - px, p.y - py) > r * 1.8) continue;
    p.ang = Math.atan2(p.y - py, p.x - px);
    p.scatter = 1.1;
  }
}
