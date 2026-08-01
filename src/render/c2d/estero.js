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
import { ctx } from "./gfx.js";
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

function drawBuoy(b, view, t) {
  if (!inView(b.x, b.y, view, 24)) return;
  const bob = Math.sin(t * 1.6 + b.ph) * 1.6;
  const y = b.y + bob;
  ctx.fillStyle = "rgba(0,0,0,0.20)";
  ctx.beginPath(); ctx.ellipse(b.x + 2, b.y + 5, 7, 2.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = b.red ? RED : GREEN;                    // the float
  ctx.beginPath(); ctx.ellipse(b.x, y, 6, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.75)";               // waterline band
  ctx.fillRect(b.x - 6, y - 1, 12, 1.6);
  ctx.fillStyle = b.red ? "#f0806f" : "#6fd097";          // the mast
  ctx.fillRect(b.x - 1, y - 13, 2, 8);
  // at night they blink, out of phase with each other
  const lit = state.weather === "night" && Math.sin(t * 2.4 + b.ph * 3) > 0.2;
  ctx.fillStyle = lit ? (b.red ? "#ff9d8a" : "#8ff0b6") : "rgba(255,255,255,0.5)";
  ctx.beginPath(); ctx.arc(b.x, y - 14, lit ? 2.6 : 1.5, 0, Math.PI * 2); ctx.fill();
}

// A moored panga with its fisher: she does NOT move out of your way, which is
// the whole reason she is an obstacle and not scenery.
function drawPanga(e, view, t) {
  const bob = Math.sin(t * 1.2 + e.ph) * 1.2;
  ctx.save();
  ctx.translate(e.x, e.y + bob);
  ctx.rotate(e.a + Math.sin(t * 0.6 + e.ph) * 0.06);
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fillRect(-17, -5, 34, 12);
  ctx.fillStyle = "#e6e2d6";                                    // hull
  ctx.beginPath();
  ctx.moveTo(19, 0); ctx.lineTo(9, -7); ctx.lineTo(-16, -6);
  ctx.lineTo(-16, 6); ctx.lineTo(9, 7);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#3a6f8a"; ctx.fillRect(-14, -4, 26, 2);      // gunwale stripe
  ctx.fillStyle = "#8a5f33"; ctx.fillRect(-8, -3, 7, 6);        // thwart
  ctx.restore();
  // el pescador, with his line in the water
  const fx = e.x - Math.cos(e.a) * 4, fy = e.y - Math.sin(e.a) * 4 + bob;
  ctx.fillStyle = "#f4d77a"; ctx.fillRect(fx - 2, fy - 8, 4, 6);
  ctx.fillStyle = "#e8b98a";
  ctx.beginPath(); ctx.arc(fx, fy - 10, 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(fx + 2, fy - 9);
  ctx.lineTo(fx + 13, fy + 6 + Math.sin(t * 2 + e.ph) * 1.5);
  ctx.stroke();
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
  ctx.rotate(e.ph + t * (e.pull > 0 ? 0.9 : -0.9));
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
