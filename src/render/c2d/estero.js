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
import { ctx, hash01, roundRect, weatherColors } from "./gfx.js";
import { drawFisher, paintHull } from "./entities.js";
import { state } from "../../game/state.js";
import { LANE_HW, bancoExposed, channels, crossingState, esteroThings } from "../../game/crossing.js";
import { navigableFraction } from "../../game/tides.js";

const RED = "#e2503f", GREEN = "#3fa86a";

function inView(x, y, view, m = 60) {
  return !(x + m < view.x0 || x - m > view.x1 || y + m < view.y0 || y - m > view.y1);
}

/**
 * How much of the marked channel is water RIGHT NOW, 0.55..1.
 *
 * A running crossing publishes it on `state.crossing.laneFrac`, and that is the
 * number the physics is using this frame, so the drawing cannot disagree with
 * it. Outside a crossing the channel is still drawn (the lancha's route is part
 * of the estero at every hour), and there the tide on `state` goes through the
 * SAME published mapping rather than a copy of its constants.
 */
function laneFraction() {
  const c = state.crossing;
  if (c && c.active && Number.isFinite(c.laneFrac)) return c.laneFrac;
  return navigableFraction(Number.isFinite(state.tide) ? state.tide : 0.5);
}

// One polyline offset `off` px to starboard of the route, as a fresh path.
function lanePolyline(pts, off) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const [px, py] = pts[Math.max(0, i - 1)];
    const a = Math.atan2(y - py, x - px);
    const nx = x - Math.sin(a) * off, ny = y + Math.cos(a) * off;
    if (i === 0) ctx.moveTo(nx, ny); else ctx.lineTo(nx, ny);
  }
}

// The lane: calmer water + current streaks, under everything that floats on it.
//
// TWO WIDTHS, AND THE GAP BETWEEN THEM IS THE LEVEL. The buoys mark a SURVEYED
// channel: it is the same channel at every hour, so the faint envelope and its
// two dashed limits never move. The water inside it does — at bajamar the
// navigable band shrinks to a little over half the marked width — and it is the
// bright band, because that is the water you can actually use. Reading the
// difference between what the marks promise and what the tide gives you is the
// pilotage this crossing is about, so it has to be visible, not inferred.
function drawCurrent(channel, view, t) {
  const pts = channel.pts;
  const night = state.weather === "night";
  const frac = laneFraction();
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // el canal balizado — wide, faint, fixed
  lanePolyline(pts, 0);
  ctx.strokeStyle = night ? "rgba(120,180,210,0.05)" : "rgba(255,255,255,0.045)";
  ctx.lineWidth = LANE_HW * 2;
  ctx.stroke();
  // …and its two limits, dashed, so the envelope reads as a MARK and not as
  // water. They run through the buoys, which is where they belong.
  ctx.setLineDash([16, 24]);
  ctx.lineDashOffset = 0;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = night ? "rgba(160,210,235,0.34)" : "rgba(255,255,255,0.30)";
  for (const side of [-1, 1]) { lanePolyline(pts, LANE_HW * side); ctx.stroke(); }
  ctx.setLineDash([]);
  // el agua navegable — narrower at low water, and this is the band you steer in
  lanePolyline(pts, 0);
  ctx.strokeStyle = night ? "rgba(120,180,210,0.13)" : "rgba(255,255,255,0.12)";
  ctx.lineWidth = LANE_HW * 2 * frac;
  ctx.stroke();
  // …and its own two edges, solid, because the boundary between the water that
  // is there and the water that is only on the chart is the thing being read
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = night ? "rgba(170,220,240,0.22)" : "rgba(255,255,255,0.24)";
  for (const side of [-1, 1]) { lanePolyline(pts, LANE_HW * frac * side); ctx.stroke(); }
  // streaks: short dashes sliding along the lane, so the water reads as moving.
  // They ride the NAVIGABLE width, so the current visibly closes in on the
  // centreline as the estero empties.
  ctx.strokeStyle = night ? "rgba(150,200,225,0.16)" : "rgba(255,255,255,0.20)";
  ctx.lineWidth = 2;
  ctx.setLineDash([26, 64]);
  ctx.lineDashOffset = -(t * 26) % 90;
  for (const off of [-0.55, 0, 0.55]) {
    lanePolyline(pts, LANE_HW * frac * off);
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

// UN BANCO DE ARENA — the only thing in the estero that comes and goes.
//
// It is drawn from the SAME sand the Pacific beaches are painted with
// (`weatherColors().sand`, the colour `drawLandBase` fills the playas with), so
// a bar in the channel and the beach at Puntarenita read as one material at one
// hour of one day. That consistency is the point: the bank is the shore coming
// up through the water, not a new object appearing in it.
//
// HOW MUCH IS SHOWING IS THE INFORMATION. A bank whose `depth` the tide has just
// dropped below is barely breaking the surface — a wet smear with no dry sand on
// it at all — and at a dead low the same bank is high and dry with a pale,
// rippled crown. Scaling the drawn extent by how far BELOW `depth` the water has
// gone is what makes the estuary look like it is emptying and filling instead of
// popping banks in and out of existence, and it is also an honest warning: a
// bank you can only just see is one you can only just touch.
//
//: how far below a bank's `depth` the tide must fall for it to be fully out
const BANK_SPAN = 0.26;
//: the shoal's own outline, ragged like wet sand and stable per bank (hash01 off
//: the entity's phase — never Math.random, the frame must be the same frame).
//: Drawn as a closed curve through the midpoints of the sample polygon: a
//: straight-sided 18-gon 80 px across reads as a gemstone, and the thing being
//: drawn is a heap of sand.
//: The extents stay INSIDE `e.r`, because `e.r` is the circle the sim grounds
//: you on — sand you can see but not touch is worse than the other way round.
function bankPath(e, R, wob, n = 18) {
  const px = [], py = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = R * (1 - wob + wob * 2 * hash01(e.ph * 7.31 + i * 2.77));
    // banks lie ALONG the flow — the current is what built them
    px.push(Math.cos(a) * rr * 1.04);
    py.push(Math.sin(a) * rr * 0.74);
  }
  ctx.beginPath();
  ctx.moveTo((px[n - 1] + px[0]) / 2, (py[n - 1] + py[0]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    ctx.quadraticCurveTo(px[i], py[i], (px[i] + px[j]) / 2, (py[i] + py[j]) / 2);
  }
  ctx.closePath();
}

function drawBanco(e, level, t) {
  const expose = Math.max(0, Math.min(1, (e.depth - level) / BANK_SPAN));
  const C = weatherColors();
  // the wet shoal (what the water has uncovered) and the dry crown inside it.
  // At the moment of breaking the surface the crown is almost nothing and the
  // whole bank is a wet stain; at a dead bajamar it is most of the bar.
  const Ro = e.r * (0.5 + 0.5 * expose);
  const Rd = Ro * (0.16 + 0.64 * expose);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(e.a);
  // her shadow, on the water side
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.save(); ctx.translate(3, 5); bankPath(e, Ro, 0.1); ctx.fill(); ctx.restore();
  // wet sand: the beach colour, darkened. The alpha carries the last of the
  // fade, so a bank going under does not vanish on a frame boundary.
  ctx.globalAlpha = 0.55 + 0.45 * Math.min(1, expose * 3);
  ctx.fillStyle = C.sand;
  bankPath(e, Ro, 0.1); ctx.fill();
  ctx.fillStyle = "rgba(28,58,72,0.32)";
  bankPath(e, Ro, 0.1); ctx.fill();
  // the bright line where the water meets it — brightest when it is well out
  ctx.strokeStyle = `rgba(255,255,255,${(0.28 + 0.42 * expose).toFixed(3)})`;
  ctx.lineWidth = 1.6;
  bankPath(e, Ro, 0.1); ctx.stroke();
  // A WET RING THAT LINGERS: the crown dries from the middle outward, so the
  // band between it and the waterline stays dark long after the bar is out —
  // and is the whole bank while the tide is still coming off it.
  if (Rd > 3) {
    ctx.fillStyle = C.sand;
    bankPath(e, Rd, 0.14); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.26)";      // dry, pale, sun-bleached
    bankPath(e, Rd, 0.14); ctx.fill();
    // ripples: the wind's corrugation on dry sand, along the bar
    ctx.strokeStyle = `rgba(255,255,255,${(0.10 + 0.16 * expose).toFixed(3)})`;
    ctx.lineWidth = 0.9;
    for (let i = 0; i < 4; i++) {
      const k = (i + 1) / 5;
      const ry = (k - 0.5) * Rd * 1.1;
      const rx = Rd * 1.2 * Math.sqrt(Math.max(0, 1 - (k - 0.5) * (k - 0.5) * 4));
      const j = (hash01(e.ph * 3.7 + i) - 0.5) * 2;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.8, ry + j);
      ctx.quadraticCurveTo(0, ry + j * 2.2, rx * 0.8, ry + j);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  // AGROUND. The float text and the camera shake already say this loudly, so
  // all the bank does is churn: a little disturbed water working around her.
  if (e.aground) {
    const puls = 0.5 + 0.5 * Math.sin(t * 0.006 + e.ph);
    ctx.strokeStyle = `rgba(255,255,255,${(0.16 + 0.14 * puls).toFixed(3)})`;
    ctx.lineWidth = 1.4;
    bankPath(e, Ro * (1.06 + 0.04 * puls), 0.16); ctx.stroke();
    ctx.fillStyle = "rgba(226,214,186,0.45)";
    for (let i = 0; i < 5; i++) {
      const a = e.ph + i * 1.27 + t * 0.0008;
      const rr = Ro * (0.9 + hash01(e.ph + i * 5.1) * 0.3);
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rr * 1.2, Math.sin(a) * rr * 0.8, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
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

/** Pangas, shoals, gulls, roots and los bancos — only while a crossing runs. */
export function drawEstero(view, t) {
  if (!crossingState().active) return;
  const level = Number.isFinite(state.tide) ? state.tide : 0.5;
  // LOS BANCOS FIRST, in a pass of their own: a bank is GROUND, and everything
  // else in this list floats. A panga worked into the same 300 px of channel
  // has to be drawn ON the bar, and list order is spawn order, not depth.
  for (const e of esteroThings) {
    if (e.kind !== "banco" || !inView(e.x, e.y, view, 90)) continue;
    if (bancoExposed(e, level)) drawBanco(e, level, t);   // covered = nothing
  }
  for (const e of esteroThings) {
    if (e.kind === "banco" || !inView(e.x, e.y, view, 70)) continue;
    if (e.kind === "panga") drawPanga(e, view, t);
    else if (e.kind === "fish") drawFish(e, view, t);
    else if (e.kind === "gulls" && !e.taken) drawGulls(e, view, t);
    else if (e.kind === "roots") drawRoots(e, view, t);
    else if (e.kind === "remolino") drawRemolino(e, view, t);
  }
}
