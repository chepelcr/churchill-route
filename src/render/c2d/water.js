// EL MAR — el oleaje, las corrientes, la rompiente y las ondulaciones.
//
// Everything in this file exists because the water used to be a vertical
// gradient with flat horizontal shimmer lines: the same treatment for the open
// Pacific, for the 7 km estero and for the Balneario Municipal, and none of it
// moving in any direction. A sea that does not travel anywhere is the one thing
// a player reads instantly as scenery.
//
// FOUR THINGS, and they are deliberately different scales:
//
//   * EL OLEAJE (`drawSwell`) — long crests marching across the gulf, always
//     from the same quarter. The Pacific swell here runs ONSHORE FROM THE
//     SOUTH-WEST, so the crest lines run NW–SE and travel north-east; a second,
//     shorter cross-swell at ~26° to it keeps the surface from repeating. A
//     crest is a soft light BAND with a bright thread in it and a dark trough
//     behind, never a line.
//   * LAS CORRIENTES (`drawCurrents`) — a few long, faint filaments drifting
//     across the open water, much subtler than the estero's marked channel
//     (that is `drawCurrent` in estero.js, a MARK on a chart, not water). They
//     run at their own shallow angle so they never read as more swell.
//   * LA ROMPIENTE (`drawShoreBreak`) — the sea reaching the sand: a foam line
//     that surges up the beach and draws back, over a band of wet sand. It is
//     tied to `state.tide`, the same tide the estero level is built on, so at
//     pleamar the break sits up the beach and at bajamar it retreats and leaves
//     a wide wet apron behind it.
//   * LAS ONDULACIONES (`drawRipples`) — expanding rings from anything sitting
//     in the water. Born ON A CLOCK, never per frame.
//
// TWO RULES THIS FILE KEEPS:
//
//   * NO `Math.random` IN A DRAW CALL. Every scatter goes through `hash01`, and
//     the ripple emitter — which does carry state — is aged by ELAPSED TIME, so
//     re-rendering the same timestamp paints the same frame.
//   * THE WORK IS PROPORTIONAL TO THE VISIBLE AREA. Every pass walks the view
//     rectangle in world px, in coarse steps, and every per-feature pass culls
//     on its own AABB first.
import { WORLD2D as W } from "../../world2d/index.js";
import { SURFACE } from "../../game/surfaces.js";
import { boats, pedestrians, state } from "../../game/state.js";
import { ensureRenderCache } from "./cache.js";
import { aabbInView, ctx, hash01, weatherColors } from "./gfx.js";

const TAU = Math.PI * 2;

// ---- palette ---------------------------------------------------------------
// Derived from `weatherColors()` rather than invented: a crest is the water's
// own top colour lifted toward white, a trough is its bottom colour dropped
// toward black. That way sunset stays warm and night stays cold for free.
const WHITE = [255, 255, 255], BLACK = [0, 0, 0];
function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, k) {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
function rgba(c, a) {
  return `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a < 0 ? 0 : a > 1 ? 1 : a})`;
}
let palKey = "", pal = null;
function seaPalette() {
  const key = state.weather || "sunny";
  if (key === palKey && pal) return pal;
  const C = weatherColors();
  const top = rgbOf(C.waterTop), bot = rgbOf(C.waterBot), sand = rgbOf(C.sand);
  palKey = key;
  return (pal = {
    crest: mix(top, WHITE, 0.60),   // the lit face of a crest
    sheen: mix(top, WHITE, 0.34),   // the wide soft band around it
    cap: mix(top, WHITE, 0.92),     // whitecaps / foam
    trough: mix(bot, BLACK, 0.40),  // the shadow behind a crest
    wet: mix(sand, bot, 0.42),      // sand the sea just left
    ripple: mix(top, WHITE, 0.72),
  });
}

// ---- weather ---------------------------------------------------------------
// A storm is BIGGER, STEEPER, CLOSER-SPACED swell plus whitecaps — the single
// most legible "this is rough" cue there is. Night is low contrast with a
// moonlit sheen on the crest faces, so the sea is still legibly moving in the
// dark without turning into a light show.
const SEA = {
  sunny:  { len: 78, amp: 3.2, speed: 15, crest: 0.085, sheen: 0.050, trough: 0.055, caps: 0,    run: 4.6 },
  sunset: { len: 84, amp: 3.0, speed: 13, crest: 0.100, sheen: 0.055, trough: 0.065, caps: 0,    run: 4.9 },
  night:  { len: 74, amp: 2.6, speed: 12, crest: 0.042, sheen: 0.085, trough: 0.080, caps: 0,    run: 5.2 },
  storm:  { len: 52, amp: 6.2, speed: 27, crest: 0.150, sheen: 0.070, trough: 0.120, caps: 0.62, run: 3.0 },
};
function seaCfg() { return SEA[state.weather] || SEA.sunny; }
//: the editor's weather zones publish this; everything else leaves it at 1.
function intensity() {
  const v = state.weatherIntensity;
  return Number.isFinite(v) ? Math.max(0.15, Math.min(2, v)) : 1;
}
function tideLevel() { return Number.isFinite(state.tide) ? Math.max(0, Math.min(1, state.tide)) : 0.5; }

// ---- el oleaje -------------------------------------------------------------
// The swell comes FROM the south-west, so it travels north-east and its crests
// run NW–SE: `ang` is the crest line's direction, and the crests march toward
// -y in that rotated frame.
const SWELL_ANG = Math.PI / 4;          // NW–SE crest line (propagating NE)
const CROSS_ANG = SWELL_ANG + 0.46;     // ~26° off it, so the two interfere
const CREST_STEP = 22;                  // world px between samples along a crest
const scratch = new Float64Array(256);  // per-crest y offsets, reused

// One family of crests across a rotated view box of half-diagonal R.
function paintCrests(cx, cy, R, t, o) {
  const P = seaPalette();
  // the step never gets so fine that a very wide viewport overruns `scratch`
  const step = Math.max(12, o.step || CREST_STEP, (2 * R) / (scratch.length - 2));
  const n = Math.floor((2 * R) / step) + 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(o.ang);
  ctx.lineCap = "butt";
  ctx.lineJoin = "round";
  const off = -((t * o.speed) % o.len);
  const k0 = Math.ceil((-R - off) / o.len), k1 = Math.floor((R - off) / o.len);
  const wideW = o.len * 0.17, troughW = o.len * 0.30;
  const wideS = rgba(P.sheen, o.sheen), thinS = rgba(P.crest, o.crest);
  const troughS = rgba(P.trough, o.trough);
  for (let k = k0; k <= k1; k++) {
    const y = k * o.len + off;
    // the crest's own shape: two travelling sines along it, so no two crests in
    // view are the same line
    for (let j = 0; j < n; j++) {
      const x = -R + j * step;
      scratch[j] = Math.sin(x * 0.0115 + t * 0.9 + k * 1.7) * o.amp
                 + Math.sin(x * 0.031 - t * 1.35 + k * 0.6) * o.amp * 0.42;
    }
    // el seno — the shadow the crest ahead casts into the trough behind it
    if (o.trough > 0.004) {
      ctx.beginPath();
      for (let j = 0; j < n; j++) {
        const x = -R + j * step, yy = y + scratch[j] + o.len * 0.44;
        j ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
      }
      ctx.strokeStyle = troughS; ctx.lineWidth = troughW; ctx.stroke();
    }
    ctx.beginPath();
    for (let j = 0; j < n; j++) {
      const x = -R + j * step, yy = y + scratch[j];
      j ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
    }
    ctx.strokeStyle = wideS; ctx.lineWidth = wideW; ctx.stroke();   // the soft band
    ctx.strokeStyle = thinS; ctx.lineWidth = 1.4; ctx.stroke();     // its lit thread
    // LOS BORREGOS — short broken white marks that live and die ON the crest.
    // Deterministic: which mark exists is a hash of its slot and the CURRENT
    // time bucket, so the same timestamp paints the same caps.
    if (o.caps > 0.01) {
      ctx.strokeStyle = rgba(P.cap, o.caps);
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      for (let j = 1; j < n - 1; j += 2) {
        const seed = k * 37.1 + j * 7.3;
        const life = (t * 0.85 + hash01(seed)) % 1;
        if (life > 0.5) continue;
        const x = -R + j * step;
        const f = Math.sin((life / 0.5) * Math.PI);
        const half = (5 + hash01(seed * 3.7) * 9) * f;
        if (half < 1.2) continue;
        ctx.beginPath();
        ctx.moveTo(x - half, y + scratch[j]);
        ctx.lineTo(x + half, y + scratch[j] + 1.2);
        ctx.stroke();
      }
      ctx.lineCap = "butt";
    }
  }
  ctx.restore();
}

/**
 * The swell over a rectangle of water. `shelter` (0 open gulf … 1 fully
 * enclosed) shortens the wave and takes the caps off — an estero does not get
 * the same sea as the gulf outside it.
 */
function drawSwell(box, t, shelter = 0) {
  const cfg = seaCfg(), wi = intensity();
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  if (w <= 0 || h <= 0) return;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const s = 1 - 0.55 * shelter;
  const len = cfg.len * (1 - 0.42 * shelter);
  const R = Math.hypot(w, h) / 2 + len;
  paintCrests(cx, cy, R, t, {
    ang: SWELL_ANG, len, amp: cfg.amp * s * wi, speed: cfg.speed * s,
    crest: cfg.crest * wi, sheen: cfg.sheen * wi, trough: cfg.trough * (1 - 0.5 * shelter),
    caps: cfg.caps * wi * (1 - shelter), step: CREST_STEP,
  });
  // la mar cruzada: shorter, weaker, at an angle to the main swell
  paintCrests(cx, cy, R, t * 1.21, {
    ang: CROSS_ANG, len: len * 0.56, amp: cfg.amp * 0.45 * s * wi, speed: cfg.speed * 0.62 * s,
    crest: cfg.crest * 0.5 * wi, sheen: cfg.sheen * 0.5 * wi, trough: cfg.trough * 0.35,
    caps: 0, step: CREST_STEP * 0.8,
  });
}

// ---- las corrientes --------------------------------------------------------
// Long faint filaments that say the water is a MOVING BODY. They are dashed so
// each band reads as separate streaks rather than a ruled line, the dash offset
// slides them along their own axis, and the whole family drifts sideways very
// slowly. Alpha is deliberately near the floor: they must never compete with
// the swell, and there are only ever three or four of them in view.
const CUR_ANG = -0.16;      // their own shallow angle, not the swell's
const CUR_GAP = 150;        // world px between filaments
function drawCurrents(box, t) {
  const P = seaPalette(), wi = intensity();
  const w = box.x1 - box.x0, h = box.y1 - box.y0;
  if (w <= 0 || h <= 0) return;
  const R = Math.hypot(w, h) / 2 + CUR_GAP;
  ctx.save();
  ctx.translate((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
  ctx.rotate(CUR_ANG);
  ctx.lineCap = "round";
  ctx.setLineDash([250, 470]);
  ctx.lineDashOffset = -(t * 8) % 720;
  const drift = Math.sin(t * 0.05) * 22;
  for (let k = Math.ceil(-R / CUR_GAP); k <= Math.floor(R / CUR_GAP); k++) {
    const y = k * CUR_GAP + drift;
    ctx.beginPath();
    for (let x = -R; x <= R; x += 44) {
      const yy = y + Math.sin(x * 0.0034 + k * 2.1 + t * 0.11) * 15;
      x === -R ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
    }
    ctx.strokeStyle = rgba(P.sheen, 0.045 * wi); ctx.lineWidth = 11; ctx.stroke();
    ctx.strokeStyle = rgba(P.crest, 0.032 * wi); ctx.lineWidth = 2.6; ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// ---- las ondulaciones ------------------------------------------------------
// Rings spreading from anything sitting in the water. THE EMITTER IS A CLOCK,
// not a per-frame allocation: each source keeps its next-due time in a WeakMap
// and a ring is only born when that time passes, so at 60 fps a drifting panga
// costs about one ring and a half per second.
//
// The player's bow wave and wake are drawn in entities.js (`drawWake`) — these
// are a different thing: the rings that spread AROUND and BEHIND her and stay
// in the water after she has gone.
const RIPPLES = [];
const RIPPLE_MAX = 110;
const emitAt = new WeakMap();     // source object -> next emission time (s)
let clock = -1;

//: which water body a ring belongs to: -1 = the open sea (drawn under the land
//: pass), otherwise the index of the inland body whose clip it must be inside,
//: or the estero's fill would simply paint over it.
function bodyOf(x, y) {
  const rc = ensureRenderCache();
  for (let i = 0; i < rc.water.length; i++) {
    const a = rc.water[i].aabb;
    if (x < a.x0 || x > a.x1 || y < a.y0 || y > a.y1) continue;
    if (ctx.isPointInPath(rc.water[i].path, x, y)) return i;
  }
  return -1;
}

function emit(src, x, y, speed, scale, now, wi) {
  let due = emitAt.get(src);
  if (due === undefined || due > now + 5) due = now;    // first sight, or the clock restarted
  if (now < due) return;
  // A boat at rest still makes rings, just slower and smaller; under way she
  // makes them faster and leaves them behind her.
  const f = Math.min(1, speed / 90);
  emitAt.set(src, now + 0.62 - 0.40 * f);
  if (RIPPLES.length >= RIPPLE_MAX) RIPPLES.shift();
  RIPPLES.push({
    x, y, body: bodyOf(x, y),
    r: 2.5 + scale * 2, grow: 15 + 26 * f + 8 * wi,
    age: 0, ttl: 1.5 + scale * 0.8 + f * 0.5,
    a0: 0.20 + 0.22 * f, w: 1.5 + scale * 0.7,
  });
}

/**
 * Age the rings and let the sources drop new ones. Called once per frame from
 * the compositor, WITH THE WORLD TRANSFORM ALREADY SET (bodyOf hit-tests the
 * water paths in world coordinates).
 */
function updateWater(t, view) {
  const now = t * 0.001;
  const dt = clock < 0 ? 0 : Math.max(0, Math.min(0.1, now - clock));
  clock = now;
  for (let i = RIPPLES.length - 1; i >= 0; i--) {
    const rp = RIPPLES[i];
    rp.age += dt; rp.r += rp.grow * dt;
    if (rp.age >= rp.ttl) RIPPLES.splice(i, 1);
  }
  if (!view) return;
  const wi = intensity();
  const near = (x, y) => x > view.x0 - 120 && x < view.x1 + 120 && y > view.y0 - 120 && y < view.y1 + 120;
  // la lancha del jugador
  const veh = state.veh, p = state.p;
  if (veh && veh.medium === "water" && p && near(p.x, p.y)) {
    emit(p, p.x, p.y, p.speed || 0, 1.35, now, wi);
  }
  // las pangas y los ferries del ambiente
  for (const b of boats) {
    if (!near(b.x, b.y)) continue;
    const sp = Math.hypot(b.vx || 0, b.vy || 0);
    emit(b, b.x, b.y, sp * 3, b.kind === "ferry" ? 1.8 : 1, now, wi);
  }
}

/** Rings belonging to `body` (-1 = open sea). Callers clip first. */
function drawRipples(view, body) {
  if (!RIPPLES.length) return;
  const P = seaPalette();
  ctx.lineJoin = "round";
  for (const rp of RIPPLES) {
    if (rp.body !== body) continue;
    if (rp.x + rp.r < view.x0 || rp.x - rp.r > view.x1) continue;
    if (rp.y + rp.r < view.y0 || rp.y - rp.r > view.y1) continue;
    const k = rp.age / rp.ttl, fade = (1 - k) * (1 - k);
    ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.r, 0, TAU);
    ctx.strokeStyle = rgba(P.ripple, rp.a0 * fade);
    ctx.lineWidth = Math.max(0.6, rp.w * (1 - k * 0.55));
    ctx.stroke();
    if (rp.r > 9) {   // the little trough just inside the ring
      ctx.beginPath(); ctx.arc(rp.x, rp.y, rp.r * 0.86, 0, TAU);
      ctx.strokeStyle = rgba(P.trough, rp.a0 * fade * 0.55);
      ctx.lineWidth = 1.1; ctx.stroke();
    }
  }
}

// ---- la rompiente ----------------------------------------------------------
// Which stretches of a beach polygon actually face the sea. Worked out ONCE per
// beach from the drawn geometry itself — a sample one side is sea when it lands
// in neither a land polygon nor a beach polygon — and never from `surfaceAt`,
// which answers "open water" for any tile that has not streamed in yet and
// would happily cache a beach whose landward edge also breaks.
const shores = [];
const PROBE = 11;

function buildShore(i, poly, rc) {
  const n = poly.length / 2;
  const segs = [];
  for (let s = 0; s < n; s++) {
    const ax = poly[s * 2], ay = poly[s * 2 + 1];
    const bx = poly[((s + 1) % n) * 2], by = poly[((s + 1) % n) * 2 + 1];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    if (L < 1) { segs.push(null); continue; }
    let nx = -dy / L, ny = dx / L;
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    // ASK THE RASTER, NOT THE CANVAS. This was `isPointInPath` against the
    // cached land/beach Path2Ds, and it answered false for every probe on every
    // one of the 29 beaches — 370 passes, zero runs, so the whole shore break
    // silently drew nothing. `isPointInPath` measures against the CURRENT
    // transform, and this runs deep inside the camera transform with the paths
    // in world space; the surface grid is the authoritative answer to "is this
    // point sea", it is what physics uses, and it costs a tile lookup.
    const land = (px, py) => W.surfaceAt(px, py) !== SURFACE.WATER;
    const outA = !land(mx + nx * PROBE, my + ny * PROBE);
    const outB = !land(mx - nx * PROBE, my - ny * PROBE);
    if (outA === outB) { segs.push(null); continue; }   // both sea or both land: not a shoreline
    if (outB) { nx = -nx; ny = -ny; }
    segs.push({ nx, ny });
  }
  // stitch consecutive seaward segments into runs, with a per-vertex normal
  const runs = [];
  let start = 0;
  while (start < n && segs[start]) start++;             // begin at a break, so a run never wraps
  if (start >= n) start = 0;                            // the whole ring faces the sea
  let cur = null;
  for (let c = 0; c < n; c++) {
    const s = (start + c) % n, sg = segs[s];
    if (!sg) { cur = null; continue; }
    if (!cur) { cur = { pts: [], nrm: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity }; runs.push(cur); }
    const ax = poly[s * 2], ay = poly[s * 2 + 1];
    const bx = poly[((s + 1) % n) * 2], by = poly[((s + 1) % n) * 2 + 1];
    if (!cur.pts.length) { cur.pts.push(ax, ay); cur.nrm.push(sg.nx, sg.ny); }
    else {   // shared vertex: average the two segment normals so the band bends smoothly
      const k = cur.nrm.length - 2;
      const ux = cur.nrm[k] + sg.nx, uy = cur.nrm[k + 1] + sg.ny, m = Math.hypot(ux, uy) || 1;
      cur.nrm[k] = ux / m; cur.nrm[k + 1] = uy / m;
    }
    cur.pts.push(bx, by); cur.nrm.push(sg.nx, sg.ny);
    cur.x0 = Math.min(cur.x0, ax, bx); cur.x1 = Math.max(cur.x1, ax, bx);
    cur.y0 = Math.min(cur.y0, ay, by); cur.y1 = Math.max(cur.y1, ay, by);
  }
  for (const r of runs) { r.aabb = { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }; }
  const built = { runs, phase: hash01(i * 12.9 + 3.1) };
  // DO NOT CACHE AN EMPTY SHORE. `surfaceAt` answers 0 for a tile that has not
  // streamed in, so a beach traced before its tile was resident reads as all
  // sea and yields no runs — cached, that beach would stay breakless for the
  // rest of the session. Leaving it uncached costs one retrace per frame until
  // the ground is really there.
  if (runs.length) shores[i] = built;
  return built;
}

//: the run as a polyline pushed `off` px toward the sea (negative = up the sand)
function offsetRun(run, off) {
  const p = run.pts, nm = run.nrm;
  ctx.beginPath();
  for (let j = 0; j < p.length; j += 2) {
    const x = p[j] + nm[j] * off, y = p[j + 1] + nm[j + 1] * off;
    j ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
}

//: EL VAIVÉN — fast up the sand, slow back down, which is what a swash does and
//: what a plain sine does not.
function swash(u) {
  const f = u - Math.floor(u);
  if (f < 0.3) { const k = f / 0.3; return k * k * (3 - 2 * k); }
  const k = (f - 0.3) / 0.7;
  return 1 - k * k * (3 - 2 * k);
}

/**
 * The sea reaching the sand. Replaces the flat white rim the beach used to get:
 * a band of wet sand, a foam line whose reach oscillates, its bright leading
 * lip, and — outside it — the next wave already breaking.
 */
function drawShoreBreak(view, t) {
  const rc = ensureRenderCache();
  const polys = W.BEACHES || [];
  const P = seaPalette(), cfg = seaCfg(), wi = intensity();
  const tide = tideLevel();
  const storm = state.weather === "storm" ? wi : 0;
  // Where the mean waterline sits on this beach: up the sand at pleamar, out
  // past the polygon's own edge at bajamar.
  const tideOff = -(tide - 0.5) * 26;
  const runUp = 9 + storm * 8;
  const apron = 5 + (1 - tide) * 17 + storm * 4;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let i = 0, bi = 0; i < polys.length; i++) {
    const poly = polys[i];
    if (!poly || poly.length < 6) continue;
    const cache = rc.beach[bi++];
    if (!cache || !aabbInView(cache.aabb, view, 40)) continue;
    const sh = shores[i] || buildShore(i, poly, rc);
    if (!sh.runs.length) continue;
    // SECONDS, not milliseconds. `t` is the rAF timestamp in ms and `cfg.run`
    // is a wave PERIOD in seconds (~3-5 s, which is what a swash actually
    // takes), so dividing the raw value ran the swash at ~200 cycles a second:
    // the foam strobed every frame and averaged into a static smear, which is
    // why the beach looked like it had no waves at all.
    const T = t * 0.001;
    const s = swash(T / cfg.run + sh.phase);
    const reach = tideOff - runUp * s;                       // negative = up the sand
    const band = 4 + 5 * s + storm * 5;
    const s2 = swash(T / cfg.run + sh.phase + 0.52);          // the wave outside it
    for (const run of sh.runs) {
      if (!aabbInView(run.aabb, view, 60)) continue;
      // la arena mojada — clipped to the sand, so it can never wash into the sea
      ctx.save();
      ctx.clip(cache.path);
      offsetRun(run, -apron / 2 + Math.min(0, reach) * 0.5);
      ctx.strokeStyle = rgba(P.wet, 0.42);
      ctx.lineWidth = apron;
      ctx.stroke();
      ctx.restore();
      // la rompiente de afuera: the next one, still out in the water
      offsetRun(run, tideOff + 11 + storm * 12 - s2 * 5);
      ctx.strokeStyle = rgba(P.cap, (0.10 + 0.16 * s2) * (0.6 + storm));
      ctx.lineWidth = 2 + s2 * 2 + storm * 3;
      ctx.stroke();
      // la espuma — the body of water on the sand right now
      offsetRun(run, reach + band / 2);
      ctx.strokeStyle = rgba(P.cap, 0.20 + 0.26 * s + storm * 0.12);
      ctx.lineWidth = band;
      ctx.stroke();
      // …and its lip, the bright line the swash stops at
      offsetRun(run, reach);
      ctx.strokeStyle = rgba(P.cap, 0.22 + 0.44 * s);
      ctx.lineWidth = 1.2 + s * 1.1;
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---- el Balneario Municipal ------------------------------------------------
// The block that was turned into an inlet of the sea. It is 320 x 260 world px
// of water people are STANDING IN, so it gets none of the gulf's swell: small
// cross-ripples, a net of caustics, a bright rim where it meets the concrete,
// and the swimmers' own disturbance. No pool graphic — the world deliberately
// made this sea water, and `landmarks.js` `case "pool"` is label-only.
let balnIdx = -2;
function balnearioIndex() {
  if (balnIdx !== -2) return balnIdx;
  const B = W.BALNEARIO;
  balnIdx = -1;
  if (!B) return balnIdx;
  const rc = ensureRenderCache();
  for (let i = 0; i < rc.water.length; i++) {
    const a = rc.water[i].aabb;
    if (a.x0 >= B.x0 - 60 && a.x1 <= B.x1 + 60 && a.y0 >= B.y0 - 60 && a.y1 <= B.y1 + 60) { balnIdx = i; break; }
  }
  return balnIdx;
}
function isBalneario(bodyIndex) { return bodyIndex >= 0 && bodyIndex === balnearioIndex(); }

//: two short crossing wave trains — an enclosed basin chops, it does not swell
function balnRipples(box, t) {
  const P = seaPalette(), wi = intensity();
  const R = Math.hypot(box.x1 - box.x0, box.y1 - box.y0) / 2 + 20;
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const fams = [
    { ang: 0.36, len: 17, amp: 1.15, sp: 6.5, a: 0.115 },
    { ang: -0.92, len: 12, amp: 0.8, sp: -4.5, a: 0.075 },
  ];
  for (const f of fams) {
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(f.ang);
    ctx.strokeStyle = rgba(P.crest, f.a * wi);
    ctx.lineWidth = 1.1;
    const off = -((t * f.sp) % f.len);
    for (let k = Math.ceil((-R - off) / f.len); k <= Math.floor((R - off) / f.len); k++) {
      const y = k * f.len + off;
      ctx.beginPath();
      for (let x = -R; x <= R; x += 15) {
        const yy = y + Math.sin(x * 0.085 + t * 1.6 + k * 0.9) * f.amp;
        x === -R ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
}

//: LA RED DE LUZ. Every cell of a coarse lattice contributes one short curve to
//: ONE batched path — a caustic net is a hundred tiny strokes and a hundred
//: strokes is a hundred state changes, so they all go down together.
const CAUSTIC_GAP = 26;
function balnCaustics(box, t) {
  const P = seaPalette();
  const gx0 = Math.floor(box.x0 / CAUSTIC_GAP), gx1 = Math.ceil(box.x1 / CAUSTIC_GAP);
  const gy0 = Math.floor(box.y0 / CAUSTIC_GAP), gy1 = Math.ceil(box.y1 / CAUSTIC_GAP);
  ctx.beginPath();
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      const seed = gx * 31.7 + gy * 17.3;
      const ph = t * 0.7 + hash01(seed) * TAU;
      const f = Math.sin(ph);
      if (f < 0.12) continue;
      const x = (gx + 0.2 + hash01(seed * 1.7) * 0.6) * CAUSTIC_GAP;
      const y = (gy + 0.2 + hash01(seed * 2.9) * 0.6) * CAUSTIC_GAP;
      const a = hash01(seed * 5.3) * TAU;
      const L = (5 + hash01(seed * 7.1) * 7) * f;
      const dx = Math.cos(a) * L, dy = Math.sin(a) * L;
      ctx.moveTo(x - dx, y - dy);
      ctx.quadraticCurveTo(x - dy * 0.45, y + dx * 0.45, x + dx, y + dy);
    }
  }
  ctx.strokeStyle = rgba(P.cap, 0.10);
  ctx.lineWidth = 1.3;
  ctx.stroke();
}

//: the water a person standing in it pushes around
function balnSwimmers(view, t) {
  const P = seaPalette();
  for (const pe of pedestrians) {
    if (!pe.balneario) continue;
    if (pe.x < view.x0 - 20 || pe.x > view.x1 + 20 || pe.y < view.y0 - 20 || pe.y > view.y1 + 20) continue;
    const b = Math.sin(t * 2.2 + (pe.ph || 0));
    for (let i = 0; i < 2; i++) {
      const r = 3.6 + i * 3.2 + b * 1.1;
      ctx.beginPath(); ctx.arc(pe.x, pe.y + 1, r, 0, TAU);
      ctx.strokeStyle = rgba(P.crest, (0.24 - i * 0.11) * (0.6 + 0.4 * b));
      ctx.lineWidth = 1; ctx.stroke();
    }
  }
}

/** The balneario's own water pass. `body` is its render-cache entry. */
function paintBalneario(body, view, t, bodyIndex) {
  const a = body.aabb;
  const box = {
    x0: Math.max(view.x0, a.x0), y0: Math.max(view.y0, a.y0),
    x1: Math.min(view.x1, a.x1), y1: Math.min(view.y1, a.y1),
  };
  if (box.x1 <= box.x0 || box.y1 <= box.y0) return;
  const P = seaPalette();
  // THE BODY FILL IS OURS. This pass REPLACES `paintWaterBody` rather than
  // layering over it — the whole point is that a 320x260 px inlet people stand
  // in should not get the shimmer sized for a 7 km estuary — so if we do not
  // lay the water down, nothing does, and the balneario draws as whatever is
  // underneath it. It rendered as bare sand with a boat and six swimmers
  // sitting on it until this was put back.
  const C = weatherColors();
  const g = ctx.createLinearGradient(0, a.y0, 0, a.y1);
  g.addColorStop(0, C.waterTop); g.addColorStop(1, C.waterBot);
  ctx.fillStyle = g; ctx.fill(body.path);
  ctx.save();
  ctx.clip(body.path);
  balnRipples(box, t);
  balnCaustics(box, t);
  drawRipples(view, bodyIndex);
  balnSwimmers(view, t);
  // el borde: a bright band of shallow water against the concrete, inside only
  ctx.strokeStyle = rgba(P.crest, 0.16);
  ctx.lineWidth = 9; ctx.stroke(body.path);
  ctx.restore();
  ctx.strokeStyle = rgba(P.cap, 0.42 + 0.08 * Math.sin(t * 1.3));
  ctx.lineWidth = 1.3; ctx.stroke(body.path);
}

export {
  bodyOf, drawCurrents, drawRipples, drawShoreBreak, drawSwell,
  isBalneario, paintBalneario, updateWater,
};
