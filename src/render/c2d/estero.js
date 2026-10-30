// La Travesía del Estero — the open-water course, and what is floating in it.
//
// Nothing here is emitted by the world: the buoys and obstacles are all a
// function of the lancha's route polyline, which the build
// already derived from the water raster. A channel that had to be authored
// would be a second copy of the crossing, and the first thing to go stale.
//
// The water itself stays open: no painted ribbon, limits or current streaks
// turn the estuary back into a corridor. Las boyas — red to port, green to
// starboard, bobbing and blinking at night — are the regatta course you steer.
import { ctx, hash01, weatherColors } from "./gfx.js";
import {
  actorAnimationValues, paintActor, resolveActorRecord,
} from "./actorShapes.js";
import { state } from "../../game/state.js";
import { bancoExposed, buoyWet, channels, crossingState, esteroThings, laneAt } from "../../game/crossing.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import ACTORS from "../../assets/actors.json" with { type: "json" };
import { alphaColor } from "./primitives.js";

// LA PALETA DE LOS OCHO ENCUENTROS vive en `materials.json` -> `estero`. Cuáles
// existen ya estaba tipado (`EsteroEncounterKind`); de qué color era cada uno,
// no. `mark` es la marca lateral de una boya — rojo a babor, verde a estribor —
// y eso no es decoración: dice por cuál lado del canal se pasa.
const E = MATERIALS.estero;
const mark = (b) => (b.red ? E.buoy.red : E.buoy.green);

function inView(x, y, view, m = 60) {
  return !(x + m < view.x0 || x - m > view.x1 || y + m < view.y0 || y - m > view.y1);
}

// Sample the measured route once for accurate view culling. The route bends and
// its centre moves between emitted vertices, so an endpoint-only bbox is not a
// trustworthy description of where the course is. This walk deliberately
// remains even though the old painted ribbon is gone: every visible mark still
// belongs to this measured course.
const LANE_STEP = 60;

// The course is static geometry, so cache the arclength walk on the channel.
function laneCache(ch) {
  if (ch._lanePts) return ch._lanePts;
  const pts = [];
  for (let s = 0; s <= ch.total; s += LANE_STEP) pts.push(laneAt(ch, s));
  ch._lanePts = pts;
  return ch._lanePts;
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
  const actor = resolveActorRecord(ACTORS, "esteroPanga");
  const motion = actorAnimationValues(actor.animations, { timeMs: t * 1000, phase: e.ph });
  ctx.save();
  ctx.translate(e.x, e.y + motion.bob);
  ctx.rotate(e.a + motion.yaw);
  paintActor(ctx, ACTORS, "esteroPanga", { phase: e.ph, timeMs: t * 1000 });
  // El pescador rides HER FRAME — after the hull, still inside her transform,
  // so he leans and bobs with her instead of hovering over the spot she was.
  // His hue comes off the entity's own phase (hash01, never Math.random: the
  // frame has to be the same frame every time it is drawn).
  paintActor(ctx, ACTORS, "fisher", {
    x: -17 * 0.36, y: 0,
    hue: Math.round(hash01(e.ph * 12.9898 + 4.1) * 320),
    phase: t * 1.4 + e.ph, timeMs: t * 1000,
  });
  ctx.restore();
}

// A banco de peces: a shoal under the surface. Silver flashes, no wake.
function drawFish(e, view, t) {
  paintActor(ctx, ACTORS, "esteroFish", {
    x: e.x, y: e.y,
    rotation: e.a + Math.sin(t * 0.8 + e.ph) * 0.3,
    phase: e.ph, timeMs: t * 1000, variant: e.taken ? "taken" : undefined,
  });
}

// Una horda de gaviotas crossing the channel: they take the VIEW, not health.
function drawGulls(e, view, t) {
  for (let i = 0; i < 11; i++) {
    const a = e.ph + i * 0.55;
    const x = e.x + Math.cos(a + t * 0.7) * (14 + i * 3.2);
    const y = e.y + Math.sin(a + t * 0.9) * (9 + i * 1.7) - Math.sin(t * 3 + i) * 3;
    const w = 3.4 + (i % 3) * 0.7;
    paintActor(ctx, ACTORS, "esteroGull", {
      x, y, phase: i, timeMs: t * 1000, wingW: w, negW: -w,
    });
  }
}

// Mangrove roots: half-submerged, hugging the bank. They are only in the way of
// a boat cutting the corner, which is exactly what they are for.
function drawRoots(e, view, t) {
  paintActor(ctx, ACTORS, "esteroRoots", {
    x: e.x, y: e.y, rotation: e.a, phase: e.ph, timeMs: t * 1000,
  });
}

// A remolino: rings of foam turning around a dark eye. Read at a distance by
// the ring, and up close by which WAY it turns — which is the information you
// need, because that is the side it will put you on.
function drawRemolino(e, view, t) {
  // WHICH WAY she turns is the information you need, because that is the side
  // she will put you on. `pull` is the sim's, and is not one of the fields a
  // drawer may count on, so the sign falls back to the entity's own phase.
  const spin = e.pull !== undefined ? Math.sign(e.pull) || 1 : (hash01(e.ph) < 0.5 ? -1 : 1);
  paintActor(ctx, ACTORS, "esteroRemolino", {
    x: e.x, y: e.y, rotation: e.ph + t * 0.9 * spin,
    phase: e.ph, timeMs: t * 1000, radius: e.r,
  });
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
  const waterline = E.banco.waterline;
  const ripples = E.banco.ripples;
  const aground = E.banco.aground;
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
  ctx.strokeStyle = alphaColor(waterline.rgb,
    waterline.alphaBase + waterline.alphaRange * expose);
  ctx.lineWidth = waterline.width;
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
    ctx.strokeStyle = alphaColor(ripples.rgb,
      ripples.alphaBase + ripples.alphaRange * expose);
    ctx.lineWidth = ripples.width;
    for (let i = 0; i < ripples.count; i++) {
      const k = (i + 1) / (ripples.count + 1);
      const ry = (k - 0.5) * Rd * 1.1;
      const rx = Rd * 1.2 * Math.sqrt(Math.max(0, 1 - (k - 0.5) * (k - 0.5) * 4));
      const j = (hash01(e.ph * 3.7 + i) - 0.5) * ripples.jitter;
      ctx.beginPath();
      ctx.moveTo(-rx * 0.8, ry + j);
      ctx.quadraticCurveTo(0, ry + j * ripples.curveJitter, rx * 0.8, ry + j);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  // AGROUND. The float text and the camera shake already say this loudly, so
  // all the bank does is churn: a little disturbed water working around her.
  if (e.aground) {
    const puls = 0.5 + 0.5 * Math.sin(t * 6 + e.ph);
    ctx.strokeStyle = alphaColor(aground.rgb,
      aground.alphaBase + aground.alphaRange * puls);
    ctx.lineWidth = aground.width;
    bankPath(e, Ro * (aground.radiusBase + aground.radiusRange * puls), 0.16); ctx.stroke();
    ctx.fillStyle = E.banco.dry;
    for (let i = 0; i < 5; i++) {
      const a = e.ph + i * 1.27 + t * 0.8;
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
  ctx.restore();
  paintActor(ctx, ACTORS, "esteroPescadorBoat", {
    x: e.x, y: e.y, rotation: e.a + Math.PI / 2, phase: e.ph, timeMs: t * 1000,
  });
}

// EL YATE. The set piece: a big white motor yacht steaming along the channel
// with two wake crests astern. She is drawn big on purpose — she has to read as
// something you go AROUND from far enough away to choose a side — and the wake
// is drawn as the two rings the collision pays out on, so "take the wake fast"
// is a thing you can see rather than a thing you find out.
function drawYate(e, view, t) {
  paintActor(ctx, ACTORS, "esteroYacht", {
    x: e.x, y: e.y, rotation: e.a, phase: e.ph, timeMs: t * 1000, radius: e.r,
  });
}

/** The regatta course: open water, marked only by its buoys. */
export function drawChannel(view, t) {
  for (const channel of channels().values()) {
    if (!laneCache(channel).some((q) => inView(q.x, q.y, view, q.hw + 60))) continue;
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
