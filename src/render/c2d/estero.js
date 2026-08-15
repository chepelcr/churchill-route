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
import { LANE_HW, bancoExposed, buoyWet, channels, crossingState, esteroThings, laneAt } from "../../game/crossing.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };

// LA PALETA DE LOS OCHO ENCUENTROS vive en `materials.json` -> `estero`. Cuáles
// existen ya estaba tipado (`EsteroEncounterKind`); de qué color era cada uno,
// no. `mark` es la marca lateral de una boya — rojo a babor, verde a estribor —
// y eso no es decoración: dice por cuál lado del canal se pasa.
const E = MATERIALS.estero;
const mark = (b) => (b.red ? E.buoy.red : E.buoy.green);

function inView(x, y, view, m = 60) {
  return !(x + m < view.x0 || x - m > view.x1 || y + m < view.y0 || y - m > view.y1);
}

// THE LANE IS DRAWN AT THE WIDTH THE WORLD MEASURED. There used to be two
// widths here — a fixed "marked channel" envelope and, inside it, a bright
// "navigable" band scaled by the tide — and the gap between them was described
// as the pilotage this crossing is about. It was not: physics never read the
// fraction, and because a run starts on the flood, the bright band simply
// closed in on the player for the whole of the pleamar and aguacero attempts.
// One band now, at `laneAt(ch, s).hw`, which is real: it opens out in the gulf
// and narrows through the mangrove because THE ESTERO DOES.
//
// Sampled along the route rather than per vertex, because the width and the
// centre both vary between vertices now.
const LANE_STEP = 60;

// …AND IT IS BUILT ONCE. The lane is static geometry — the route, the measured
// half-width and the offset are all world data — but sampling it costs an
// `at()` walk of the arclength table per point, and the fill alone wants ~240
// of them. Rebuilding six of these polylines every frame was ~1 700 `laneAt`
// calls and a quarter of a million comparisons per frame, for a shape that
// never changes. Cached on the channel object, the same way the renderer caches
// road and building paths.
function laneCache(ch) {
  if (ch._lane) return ch._lane;
  const pts = [];
  for (let s = 0; s <= ch.total; s += LANE_STEP) pts.push(laneAt(ch, s));
  const at = (off) => {
    const p = new Path2D();
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i];
      const x = q.x - Math.sin(q.a) * q.hw * off;
      const y = q.y + Math.cos(q.a) * q.hw * off;
      if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
    }
    return p;
  };
  // the ribbon: starboard limit out, port limit back, closed
  const band = new Path2D();
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    const x = q.x - Math.sin(q.a) * q.hw, y = q.y + Math.cos(q.a) * q.hw;
    if (i === 0) band.moveTo(x, y); else band.lineTo(x, y);
  }
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i];
    band.lineTo(q.x + Math.sin(q.a) * q.hw, q.y - Math.cos(q.a) * q.hw);
  }
  band.closePath();
  ch._lane = {
    band,
    limits: [at(-1), at(1)],
    streaks: [at(-0.55), at(0), at(0.55)],
  };
  return ch._lane;
}

// The lane: calmer water + current streaks, under everything that floats on it.
//
// ONE WIDTH, AND IT IS THE REAL ONE. See the note on `laneCache` for the two
// widths that used to be here and why the second was a lie. What is drawn now
// is the measured channel: a soft band of calmer water between the marks, its
// two limits, and streaks sliding down it. It widens in the gulf and closes
// through the mangrove because the water does, so reading it ahead is worth
// something — which is what the old bright band was reaching for and could not
// deliver, because it moved with the clock instead of with the place.
function drawCurrent(channel, view, t) {
  const night = state.weather === "night";
  const L = laneCache(channel);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // el canal — a soft fill between the two limits. A stroke down the centre
  // would be wrong now that the width varies, so it is a filled ribbon.
  const CH = night ? E.channel.night : E.channel.day;
  ctx.fillStyle = CH.wash;
  ctx.fill(L.band);
  // …and its two limits, solid, running through the buoys where they belong.
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = CH.strong;
  for (const p of L.limits) ctx.stroke(p);
  // streaks: short dashes sliding along the lane, so the water reads as moving.
  ctx.strokeStyle = CH.faint;
  ctx.lineWidth = 2;
  ctx.setLineDash([26, 64]);
  ctx.lineDashOffset = -(t * 26) % 90;
  for (const p of L.streaks) ctx.stroke(p);
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
  // a mark on the bank says the channel is where it is not — see `buoyWet`
  if (!buoyWet(b)) return;
  const swell = Math.sin(t * 1.6 + b.ph);
  // she does not BOUNCE UP THE SCREEN — seen from above, the swell shows as the
  // body sliding inside its own ring of foam, and as the ring breathing.
  const lx = Math.cos(t * 0.7 + b.ph) * 2.2;
  const ly = Math.sin(t * 0.5 + b.ph * 1.7) * 1.4;
  const x = b.x + lx, y = b.y + ly;
  const R = 6 + swell * 0.25;
  const MARK = mark(b);
  const col = MARK.body, rim = MARK.rim, pale = MARK.pale;
  ctx.save();
  ctx.fillStyle = E.buoy.shadow;                          // her shadow on the water
  ctx.beginPath(); ctx.ellipse(b.x + 2, b.y + 5, R + 0.5, (R + 0.5) * 0.42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = E.buoy.foam;                          // foam at the waterline
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(b.x, b.y + 1, R + 3.4 + swell * 0.9, (R + 3.4) * 0.58, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = rim;                                    // the can, rim first
  ctx.beginPath(); ctx.arc(x, y, R + 1.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = E.buoy.hilite;                          // where the sun lands on her
  ctx.beginPath();
  ctx.ellipse(x - R * 0.36, y - R * 0.42, R * 0.34, R * 0.22, -0.6, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = E.buoy.reflector;                     // the radar reflector's plates
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
    ctx.fillStyle = MARK.halo;
    ctx.beginPath(); ctx.arc(x, y, R + 7, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = lit ? MARK.lamp : E.buoy.lampOff;
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
  ctx.fillStyle = E.panga.console;                          // the console, forward
  roundRect(ctx, L * 0.24, -H * 0.55, L * 0.3, H * 1.1, 1.5, true, false);
  ctx.fillStyle = E.panga.thwart;                           // the thwart he sits on
  ctx.fillRect(-L * 0.42, -H * 0.72, 2.6, H * 1.44);
  ctx.strokeStyle = E.panga.outboard;                       // the outboard, on her transom
  ctx.lineWidth = 1.6; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-L + 1, 0); ctx.lineTo(-L - 3.5, 0); ctx.stroke();
  ctx.fillStyle = E.panga.figure;
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
  ctx.fillStyle = e.taken ? E.fish.taken : E.fish.boil;
  ctx.beginPath(); ctx.ellipse(0, 0, 30, 15, 0, 0, Math.PI * 2); ctx.fill();
  if (!e.taken) {
    ctx.fillStyle = E.fish.flash;
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
    ctx.strokeStyle = E.gulls.wings;
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
  ctx.strokeStyle = E.roots.wood;
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  for (let i = -2; i <= 2; i++) {
    const h = 7 + ((i + 2) % 3) * 4 + Math.sin(t * 0.8 + e.ph + i) * 0.8;
    ctx.beginPath();
    ctx.moveTo(i * 6, 4);
    ctx.quadraticCurveTo(i * 6 + 3, -h * 0.5, i * 6 + (i % 2 ? 4 : -4), -h);
    ctx.stroke();
  }
  ctx.strokeStyle = E.roots.waterline;                      // the waterline ring
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
  ctx.fillStyle = E.remolino.well;
  ctx.beginPath(); ctx.arc(0, 0, e.r * 0.42, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = E.remolino.swirl;
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const rr = e.r * (0.5 + i * 0.22);
    ctx.lineWidth = 2.4 - i * 0.5;
    ctx.beginPath();
    ctx.arc(0, 0, rr, i * 1.7, i * 1.7 + Math.PI * 1.25);
    ctx.stroke();
  }
  ctx.fillStyle = E.remolino.foam;
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
  ctx.fillStyle = E.banco.shadow;
  ctx.save(); ctx.translate(3, 5); bankPath(e, Ro, 0.1); ctx.fill(); ctx.restore();
  // wet sand: the beach colour, darkened. The alpha carries the last of the
  // fade, so a bank going under does not vanish on a frame boundary.
  ctx.globalAlpha = 0.55 + 0.45 * Math.min(1, expose * 3);
  ctx.fillStyle = C.sand;
  bankPath(e, Ro, 0.1); ctx.fill();
  ctx.fillStyle = E.banco.wet;
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
    ctx.fillStyle = E.banco.foam;                  // dry, pale, sun-bleached
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
    ctx.fillStyle = E.banco.dry;
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

// EL PESCADOR. The boat is scenery; the NET is the obstacle, so the net is what
// the drawing is about — a line of corks from her stern to a marker float,
// spanning part of the channel. Read it from a long way off and you pick the
// side with the gap; read it late and you are in it. Drawn as the segment the
// collision actually tests (`segDist` on the same two points), because a hazard
// whose picture and whose hitbox are different shapes is the worst kind.
function drawPescador(e, view, t) {
  const fx = e.fx ?? e.x, fy = e.fy ?? e.y;
  ctx.save();
  // the net: a taut line with corks bobbing along it
  ctx.strokeStyle = E.pescador.net;
  ctx.lineWidth = 1.6;
  ctx.setLineDash([7, 7]);
  ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(fx, fy); ctx.stroke();
  ctx.setLineDash([]);
  const n = 7;
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const cx = e.x + (fx - e.x) * k, cy = e.y + (fy - e.y) * k;
    const bob = Math.sin(t * 2.1 + e.ph + i) * 1.4;
    ctx.fillStyle = E.pescador.float;
    ctx.beginPath(); ctx.arc(cx, cy + bob, 2.6, 0, Math.PI * 2); ctx.fill();
  }
  // the marker float at the far end
  ctx.fillStyle = E.pescador.buoy;
  ctx.beginPath(); ctx.arc(fx, fy, 4.2, 0, Math.PI * 2); ctx.fill();
  // …and the panga herself, with her man in her. `drawFisher` is not reused
  // here on purpose: it paints in WORLD coordinates (it is written for the
  // muellero on the pier rail), so inside this rotated frame it would draw
  // itself somewhere else entirely. He is two shapes; the net is the obstacle.
  ctx.translate(e.x, e.y); ctx.rotate(e.a + Math.PI / 2);
  paintHull(ctx, 26, 10, E.pescador.topsides);
  ctx.fillStyle = E.pescador.figure;               // seated, facing his net
  ctx.beginPath(); ctx.arc(0, -1, 3.1, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = E.pescador.hat;
  ctx.beginPath(); ctx.arc(0, -5.4, 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// EL YATE. The set piece: a big white motor yacht steaming along the channel
// with two wake crests astern. She is drawn big on purpose — she has to read as
// something you go AROUND from far enough away to choose a side — and the wake
// is drawn as the two rings the collision pays out on, so "take the wake fast"
// is a thing you can see rather than a thing you find out.
function drawYate(e, view, t) {
  ctx.save();
  // the wake crests, behind her
  ctx.strokeStyle = E.yate.wake;
  ctx.lineWidth = 2.5;
  for (const rr of [e.r + 46, e.r + 74]) {
    ctx.beginPath();
    ctx.arc(e.x, e.y, rr + Math.sin(t * 2 + e.ph) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.translate(e.x, e.y); ctx.rotate(e.a);
  // hull: a long flare-bowed white thing with a dark sheer line
  ctx.fillStyle = E.yate.topsides;
  ctx.beginPath();
  ctx.moveTo(52, 0); ctx.quadraticCurveTo(22, -17, -34, -14);
  ctx.lineTo(-42, 0); ctx.lineTo(-34, 14);
  ctx.quadraticCurveTo(22, 17, 52, 0);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = E.yate.sheer; ctx.lineWidth = 1.4; ctx.stroke();
  // superstructure + flybridge
  ctx.fillStyle = E.yate.cabin;
  roundRect(ctx, -18, -10, 34, 20, 4, true, false);
  ctx.fillStyle = E.yate.windows;
  roundRect(ctx, -8, -6, 18, 12, 3, true, false);
  // prop wash
  ctx.fillStyle = E.yate.rail;
  ctx.beginPath();
  ctx.ellipse(-48, 0, 10 + Math.sin(t * 6 + e.ph) * 2, 6, 0, 0, Math.PI * 2);
  ctx.fill();
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
    else if (e.kind === "pescador") drawPescador(e, view, t);
    else if (e.kind === "yate") drawYate(e, view, t);
  }
}
