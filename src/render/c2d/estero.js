// La Travesía del Estero — the channel, and what is floating in it.
//
// Nothing here is emitted by the world: the buoys, the current and the
// obstacles are all a function of the lancha's route polyline, which the build
// already derived from the water raster. A channel that had to be authored
// would be a second copy of the crossing, and the first thing to go stale.
//
// The channel is drawn TWICE on purpose, because it has to answer two different
// questions at two different distances:
//
//   * la corriente — the water inside the lane is calmer and a shade lighter,
//     with streaks running along the route. That is what you read from far
//     away, and what tells you where the estero goes when the shore is a green
//     line on the horizon.
//   * las boyas — red to port, green to starboard, bobbing, blinking at night.
//     That is what you steer by up close, and what makes a bend legible before
//     you are in it.
import { ctx, hash01, roundRect } from "./gfx.js";
import { drawFisher, paintHull } from "./entities.js";
import { state } from "../../game/state.js";
import { LANE_HW, channels, crossingState, esteroThings } from "../../game/crossing.js";

const RED = "#e2503f", GREEN = "#3fa86a";

function inView(x, y, view, m = 60) {
  return !(x + m < view.x0 || x - m > view.x1 || y + m < view.y0 || y - m > view.y1);
}

// The lane: calmer water + current streaks, under everything that floats on it.
function drawCurrent(channel, view, t) {
  const pts = channel.pts;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = state.weather === "night" ? "rgba(120,180,210,0.10)" : "rgba(255,255,255,0.09)";
  ctx.lineWidth = LANE_HW * 2;
  ctx.stroke();
  // streaks: short dashes sliding along the lane, so the water reads as moving
  ctx.strokeStyle = state.weather === "night" ? "rgba(150,200,225,0.16)" : "rgba(255,255,255,0.20)";
  ctx.lineWidth = 2;
  ctx.setLineDash([26, 64]);
  ctx.lineDashOffset = -(t * 26) % 90;
  for (const off of [-0.55, 0, 0.55]) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      const [px, py] = pts[Math.max(0, i - 1)];
      const a = Math.atan2(y - py, x - px);
      const nx = x - Math.sin(a) * LANE_HW * off, ny = y + Math.cos(a) * LANE_HW * off;
      if (i === 0) ctx.moveTo(nx, ny); else ctx.lineTo(nx, ny);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// LAS BOYAS, FROM ABOVE. This buoy used to be drawn in ELEVATION — a float, a
// mast climbing up the screen, a lamp on top of it — inside a game where
// everything else on this water is seen looking straight down, and that is why
// it read as somebody else's asset floating next to our boats. From directly
// above, a channel buoy is a coloured disc in a ring of foam, with its radar
// reflector crossed over the top, leaning as the current takes it.
//
// The two are not only different COLOURS, because colour alone is the one thing
// a player may not be able to tell apart: port is a CAN (flat top — a square
// topmark) and starboard a NUN (conical — a round one), the shapes they really
// carry. Red to port and green to starboard on the outbound passage, which is
// real navigation and the thing this level asks you to read.
function drawBuoy(b, view, t) {
  if (!inView(b.x, b.y, view, 24)) return;
  const swell = Math.sin(t * 1.6 + b.ph);
  // she does not BOUNCE UP THE SCREEN — seen from above, the swell shows as the
  // body sliding inside its own ring of foam, and as the ring breathing.
  const lx = Math.cos(t * 0.7 + b.ph) * 2.2;
  const ly = Math.sin(t * 0.5 + b.ph * 1.7) * 1.4;
  const x = b.x + lx, y = b.y + ly;
  const R = 6 + swell * 0.25;
  const col = b.red ? RED : GREEN;
  const rim = b.red ? "#a8341f" : "#25764c";
  const pale = b.red ? "#f4a294" : "#9fdcbb";
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.20)";                     // her shadow on the water
  ctx.beginPath(); ctx.ellipse(b.x + 2, b.y + 5, R + 0.5, (R + 0.5) * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.40)";             // foam at the waterline
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(b.x, b.y + 1, R + 3.4 + swell * 0.9, (R + 3.4) * 0.58, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = rim;                                    // the can, rim first
  ctx.beginPath(); ctx.arc(x, y, R + 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.45)";               // where the sun lands on her
  ctx.beginPath();
  ctx.ellipse(x - R * 0.36, y - R * 0.42, R * 0.34, R * 0.22, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.7)";              // the radar reflector's plates
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x - R * 0.95, y); ctx.lineTo(x - R * 0.42, y);
  ctx.moveTo(x + R * 0.42, y); ctx.lineTo(x + R * 0.95, y);
  ctx.moveTo(x, y - R * 0.95); ctx.lineTo(x, y - R * 0.42);
  ctx.moveTo(x, y + R * 0.42); ctx.lineTo(x, y + R * 0.95);
  ctx.stroke();
  ctx.strokeStyle = pale;                                 // el tope: square to port…
  ctx.lineWidth = 1.2;
  if (b.red) ctx.strokeRect(x - R * 0.4, y - R * 0.4, R * 0.8, R * 0.8);
  else {                                                  // …conical to starboard
    ctx.beginPath(); ctx.arc(x, y, R * 0.44, 0, Math.PI * 2); ctx.stroke();
  }
  // at night they blink, out of phase with each other — the lantern is the one
  // thing you see of her, so it gets a halo on the water.
  const lit = state.weather === "night" && Math.sin(t * 2.4 + b.ph * 3) > 0.2;
  if (lit) {
    ctx.fillStyle = b.red ? "rgba(255,157,138,0.26)" : "rgba(143,240,182,0.26)";
    ctx.beginPath(); ctx.arc(x, y, R + 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = lit ? (b.red ? "#ff9d8a" : "#8ff0b6") : "rgba(255,255,255,0.55)";
  ctx.beginPath(); ctx.arc(x, y, lit ? 2.6 : 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// A panga working the channel, with her fisher aboard. She is drawn from
// `paintHull` — the SAME hull the port's own boats are drawn from — because she
// is the same boat: a panga you meet in the estero and a panga you meet off the
// Paseo have no business looking like different objects. What she does not have
// is a wake: she is working, not travelling, and she does NOT move out of your
// way, which is the whole reason she is an obstacle and not scenery.
function drawPanga(e, view, t) {
  const bob = Math.sin(t * 1.2 + e.ph) * 1.2;
  const L = 17, H = 6;
  ctx.save();
  ctx.translate(e.x, e.y + bob);
  ctx.rotate(e.a + Math.sin(t * 0.6 + e.ph) * 0.06);
  paintHull(ctx, L, H);
  ctx.fillStyle = "#3a6f8a";                                // the console, forward
  roundRect(ctx, L * 0.24, -H * 0.55, L * 0.3, H * 1.1, 1.5, true, false);
  ctx.fillStyle = "#8a5f33";                                // the thwart he sits on
  ctx.fillRect(-L * 0.42, -H * 0.72, 2.6, H * 1.44);
  ctx.strokeStyle = "#8a5f33";                              // the outboard, on her transom
  ctx.lineWidth = 1.6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-L + 1, 0); ctx.lineTo(-L - 3.5, 0); ctx.stroke();
  ctx.fillStyle = "#26222c";
  ctx.beginPath(); ctx.arc(-L - 4, 0, 1.6, 0, Math.PI * 2); ctx.fill();
  // El pescador rides HER FRAME — after the hull, still inside her transform,
  // so he leans and bobs with her instead of hovering over the spot she was.
  // His hue comes off the entity's own phase (hash01, never Math.random: the
  // frame has to be the same frame every time it is drawn).
  drawFisher({
    x: -L * 0.36, y: 0,
    hue: Math.round(hash01(e.ph * 12.9898 + 4.1) * 320),
    ph: t * 1.4 + e.ph,
  });
  ctx.restore();
}

// A banco de peces: a shoal under the surface. Silver flashes, no wake.
function drawFish(e, view, t) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.a + Math.sin(t * 0.8 + e.ph) * 0.3);
  ctx.fillStyle = e.taken ? "rgba(255,255,255,0.10)" : "rgba(180,225,240,0.30)";
  ctx.beginPath(); ctx.ellipse(0, 0, 30, 15, 0, 0, Math.PI * 2); ctx.fill();
  if (!e.taken) {
    ctx.fillStyle = "rgba(235,250,255,0.75)";
    for (let i = 0; i < 9; i++) {
      const a = e.ph + i * 0.7 + t * 1.4;
      const r = 6 + (i % 3) * 7;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * r, Math.sin(a) * r * 0.5, 2.6, 1.1, a, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Una horda de gaviotas crossing the channel: they take the VIEW, not health.
function drawGulls(e, view, t) {
  for (let i = 0; i < 11; i++) {
    const a = e.ph + i * 0.55;
    const x = e.x + Math.cos(a + t * 0.7) * (14 + i * 3.2);
    const y = e.y + Math.sin(a + t * 0.9) * (9 + i * 1.7) - Math.sin(t * 3 + i) * 3;
    const w = 3.4 + (i % 3) * 0.7;
    const flap = Math.sin(t * 9 + i * 1.3) * 1.8;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(x - w, y + flap); ctx.lineTo(x, y - 1); ctx.lineTo(x + w, y + flap);
    ctx.stroke();
  }
}

// Mangrove roots: half-submerged, hugging the bank. They are only in the way of
// a boat cutting the corner, which is exactly what they are for.
function drawRoots(e, view, t) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.a);
  ctx.strokeStyle = "rgba(58,42,26,0.85)";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  for (let i = -2; i <= 2; i++) {
    const h = 7 + ((i + 2) % 3) * 4 + Math.sin(t * 0.8 + e.ph + i) * 0.8;
    ctx.beginPath();
    ctx.moveTo(i * 6, 4);
    ctx.quadraticCurveTo(i * 6 + 3, -h * 0.5, i * 6 + (i % 2 ? 4 : -4), -h);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.25)";               // the waterline ring
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(0, 3, 16, 4, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// A remolino: rings of foam turning around a dark eye. Read at a distance by
// the ring, and up close by which WAY it turns — which is the information you
// need, because that is the side it will put you on.
function drawRemolino(e, view, t) {
  ctx.save();
  ctx.translate(e.x, e.y);
  // WHICH WAY she turns is the information you need, because that is the side
  // she will put you on. `pull` is the sim's, and is not one of the fields a
  // drawer may count on, so the sign falls back to the entity's own phase.
  const spin = e.pull !== undefined ? Math.sign(e.pull) || 1 : (hash01(e.ph) < 0.5 ? -1 : 1);
  ctx.rotate(e.ph + t * 0.9 * spin);
  ctx.fillStyle = "rgba(18,34,44,0.34)";
  ctx.beginPath(); ctx.arc(0, 0, e.r * 0.42, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const rr = e.r * (0.5 + i * 0.22);
    ctx.lineWidth = 2.4 - i * 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, rr, i * 1.7, i * 1.7 + Math.PI * 1.25);
    ctx.stroke();
  }
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  for (let i = 0; i < 6; i++) {
    const a = i * 1.05, rr = e.r * (0.55 + (i % 3) * 0.16);
    ctx.beginPath(); ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr, 1.5, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** The channel itself — drawn under the boats, over the water. */
export function drawChannel(view, t) {
  for (const channel of channels().values()) {
    const [x0, y0] = channel.pts[0];
    const [x1, y1] = channel.pts[channel.pts.length - 1];
    if (!inView((x0 + x1) / 2, (y0 + y1) / 2, view, Math.hypot(x1 - x0, y1 - y0) / 2 + 400)) continue;
    drawCurrent(channel, view, t);
    for (const b of channel.buoys) drawBuoy(b, view, t);
  }
}

/** Pangas, shoals, gulls and roots — only while a crossing is running. */
export function drawEstero(view, t) {
  if (!crossingState().active) return;
  for (const e of esteroThings) {
    if (!inView(e.x, e.y, view, 70)) continue;
    if (e.kind === "panga") drawPanga(e, view, t);
    else if (e.kind === "fish") drawFish(e, view, t);
    else if (e.kind === "gulls" && !e.taken) drawGulls(e, view, t);
    else if (e.kind === "roots") drawRoots(e, view, t);
    else if (e.kind === "remolino") drawRemolino(e, view, t);
  }
}
