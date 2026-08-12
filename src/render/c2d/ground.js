// Ground layer: sea/inland water, the land base + park/plaza greens, the faro
// plaza commas and the kiosk access lanes. Painted before roads.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { ensureRenderCache } from "./cache.js";
import { CANOPY, canopyPath } from "./flora.js";
import { aabbInView, ctx, flatMultiPath, hash01, weatherColors } from "./gfx.js";
import {
  drawCurrents, drawRipples, drawShoreBreak, drawSwell, isBalneario,
  paintBalneario, updateWater,
} from "./water.js";

function drawWaterAll(view, t) {
  // Full background = water
  const C = weatherColors();
  const g = ctx.createLinearGradient(0, view.y0, 0, view.y1);
  g.addColorStop(0, C.waterTop); g.addColorStop(1, C.waterBot);
  ctx.fillStyle = g;
  ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
  // EL OLEAJE, replacing the flat shimmer rows that used to live here. They
  // ran dead horizontal at a fixed spacing, so the gulf read as a striped
  // surface rather than as water going somewhere.
  updateWater(t, view);
  drawSwell(view, t);
  drawCurrents(view, t);
  // …and the rings on the open sea, which belong UNDER the land pass: body -1
  // is the gulf, and anything inland is clipped inside its own body instead.
  drawRipples(view, -1);
}


// One inland water body (estuary / river): gradient fill, animated shimmer
// clipped to its shape, and a soft foam bank where it meets the land.
function paintWaterBody(w, view, t) {
  const C = weatherColors(), a = w.aabb;
  const g = ctx.createLinearGradient(0, a.y0, 0, a.y1);
  g.addColorStop(0, C.waterTop); g.addColorStop(1, C.waterBot);
  ctx.fillStyle = g; ctx.fill(w.path);
  // shimmer, clipped to the water
  ctx.save(); ctx.clip(w.path);
  ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1;
  const tt = t * 0.0006;
  const y0 = Math.max(view.y0, a.y0), y1 = Math.min(view.y1, a.y1);
  const x0 = Math.max(view.x0, a.x0), x1 = Math.min(view.x1, a.x1);
  for (let yy = y0; yy < y1; yy += 22) {
    ctx.beginPath();
    for (let xx = x0; xx < x1; xx += 18) {
      const yo = Math.sin(tt + xx * 0.05 + yy * 0.04) * 1.8;
      xx === x0 ? ctx.moveTo(xx, yy + yo) : ctx.lineTo(xx, yy + yo);
    }
    ctx.stroke();
  }
  ctx.restore();
  // foam bank: soft pale rim along the shoreline
  ctx.strokeStyle = "rgba(226,240,238,0.35)"; ctx.lineWidth = 2.5; ctx.stroke(w.path);
}

// Base land + inland waters (with river love) + beach, under the streets.
function drawLandBase(view, t) {
  const _pt0 = performance.now();
  const rc = ensureRenderCache(), C = weatherColors();
  ctx.fillStyle = C.land; for (const l of rc.land) if (aabbInView(l.aabb, view, 4)) ctx.fill(l.path);
  // park / plaza cuadras: green IS their base ground colour (global manifest
  // outline polys, so no sand flash before a tile streams in) — waters, beach
  // wet line and streets all paint on top of it.
  for (const gp of W.GREENS || []) drawGreenPoly(gp, view);
  for (const pz of W.PLAZAS || []) drawPlazaGreen(pz, view);   // faro esplanade
  drawSurfaceStyleGround(view);
  ctx.lineJoin = "round";
  for (let i = 0; i < rc.water.length; i++) {
    const w = rc.water[i];
    if (!aabbInView(w.aabb, view, 4)) continue;
    // THE BALNEARIO IS NOT THE ESTUARY. It is a city block of penned sea with
    // people standing in it, and the generic inland treatment — one gradient
    // and a shimmer sized for a 7 km channel — is what made it read as a flat
    // blue rectangle.
    if (isBalneario(i)) { paintBalneario(w, view, t, i); continue; }
    paintWaterBody(w, view, t);
    ctx.save(); ctx.clip(w.path); drawRipples(view, i); ctx.restore();
  }
  // beach: sandy fill + a faint wet line along its seaward edge
  // One even-odd fill of every ring, so the sand's HOLES stay holes — see the
  // note on `RC.sand` in cache.js. The per-ring AABBs are still the cull: if no
  // ring is in view there is no beach on screen and the fill is skipped.
  ctx.fillStyle = C.sand;
  if (rc.beach.some((b) => aabbInView(b.aabb, view, 4))) ctx.fill(rc.sand, "evenodd");
  // LA ROMPIENTE, over the sand and under the streets: the swash runs up the
  // beach and back, and where it reaches is a function of the tide.
  drawShoreBreak(view, t);
  if (window.__prof) window.__prof.land += performance.now() - _pt0;
}


// Green ground: one FLAT fill whose colour is chosen BY TYPE (pz[4]) — a
// civic plaza, a park lawn, or the marine park — instead of layering a
// texture over the base terrain. Rects tile the block edge-to-edge, so a
// single flat colour with square corners reads as one continuous area.
// `esplanade` is the faro's plazoleta and it is now the BASE COAT only: the
// stone it actually reads as is laid over it by `drawMalecon`, which draws the
// plazoleta as a band in its own grey (see ESPLANADE_COLORS in malecon.js).
// Kept as a flat fill underneath so a streaming seam can never show sand
// through the middle of it, and matched to that palette's `fill`.
const GREEN_COLORS = { plaza: "#5ba362", park: "#4f9d5b", marine: "#46a98f", pool: "#5faec7", stadium: "#4f9d5b", esplanade: "#c9c6bf" };
function drawPlazaGreen(pz, view) {
  const [px, py, pw, ph] = pz;
  if (px + pw < view.x0 || px > view.x1 || py + ph < view.y0 || py > view.y1) return;
  ctx.fillStyle = GREEN_COLORS[pz[4]] || "#4f9d5b";
  ctx.fillRect(px, py, pw, ph);
}

// Park/plaza lawn: one or more outline rings per green cuadra (raster-traced,
// then vector-straightened in the build so diagonal acera edges are direct).
// The same-colour stroke dilates ordinary greens outward so the lawn tucks a
// few px UNDER the sidewalk band (painted later, so it wins) instead of leaving
// a bare sand strip at the seam, and rounds off the 4 px raster steps.
const GREEN_DILATE = 28;
function drawGreenPoly(gp, view) {
  const polys = gp.polys && gp.polys.length ? gp.polys : [gp.pts];
  let b = gp._aabb;
  if (!b) {
    b = gp._aabb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of polys) {
      for (let i = 0; i < p.length; i += 2) {
        if (p[i] < b.x0) b.x0 = p[i]; if (p[i] > b.x1) b.x1 = p[i];
        if (p[i + 1] < b.y0) b.y0 = p[i + 1]; if (p[i + 1] > b.y1) b.y1 = p[i + 1];
      }
    }
  }
  // A stadium pitch stays at its exact edge — paintStadiumCuadras repaints it
  // over the acera band anyway, and a park-sized skirt would spill grass onto
  // the surrounding streets. The marine park also stays exact: dilating all
  // its rings would paint green back into the facility-parcel holes.
  const m = (gp.type === "marine" || gp.type === "pool" || gp.type === "stadium") ? 0 : GREEN_DILATE;
  if (b.x1 + m < view.x0 || b.x0 - m > view.x1 || b.y1 + m < view.y0 || b.y0 - m > view.y1) return;
  if (!gp._path) gp._path = flatMultiPath(polys);
  const col = GREEN_COLORS[gp.type] || "#4f9d5b";
  ctx.fillStyle = col; ctx.fill(gp._path, "evenodd");
  if (m) {
    ctx.strokeStyle = col; ctx.lineWidth = m; ctx.lineJoin = "round";
    ctx.stroke(gp._path);
  }
}

// EL MANGLAR — the frame of the estero, and the only plant in this world that
// stands in the water rather than beside it.
//
// From above a mangle is not a tree with a trunk (that is `paintTree`, and it is
// what a tree looks like on dry land): it is a dense dark-green mass with a
// ragged edge, sitting on a tangle of prop roots that the water goes through.
// So it is built the way the flora already is — a couple of stacked blobs in
// three greens over a shadow — with the roots and a mud apron UNDER the canopy
// instead of a trunk.
//
// THE TIDE TOUCHES IT, quietly. At pleamar the roots are under water: they show
// as a short dark blur and the canopy sits right down on the waterline. At
// bajamar half the root cage and a band of mud are out. It is scenery, not the
// subject — the reason it moves at all is that a mangrove whose roots never
// changed would be the one thing in the estero the tide did not reach.
const MANGROVE_R = 26;                       // when the world emits no radius

// The canopy blob is the ARBOLEDA'S, not the manglar's: `canopyPath` in
// flora.js is the one construction every crown in this world is built from, so
// a mangle and an almendro are the same hand at two scales. It used to be a
// private copy here, which is how the two drifted apart.
const manglePath = canopyPath;

function paintMangrove(m, tide, t) {
  const R = m.r || MANGROVE_R;
  const seed = hash01(m.x * 0.0173 + m.y * 0.0131);
  const wet = Math.max(0, Math.min(1, tide));
  const sway = Math.sin(t * 0.0004 + seed * 6.3) * 1.2;
  // el fango: the mud the roots stand in, out only at low water
  if (wet < 0.85) {
    ctx.fillStyle = `rgba(84,68,44,${(0.34 * (1 - wet)).toFixed(3)})`;
    manglePath(m.x, m.y + 1, R * 1.3, seed + 0.4, 0.18); ctx.fill();
  }
  ctx.fillStyle = "rgba(0,0,0,0.22)";                    // her shadow on the water
  manglePath(m.x + 3, m.y + 4, R * 0.95, seed, 0.2); ctx.fill();
  // las raíces zancudas: a cage of arching prop roots at the waterline. They
  // shorten and go dim as the water comes up over them.
  const legs = 7 + Math.round(hash01(seed * 13.7) * 4);
  const lr = R * (0.42 + 0.34 * (1 - wet));
  ctx.strokeStyle = `rgba(52,38,24,${(0.85 - 0.42 * wet).toFixed(3)})`;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  for (let i = 0; i < legs; i++) {
    const a = (i / legs) * Math.PI * 2 + seed * 2.1;
    const rr = lr * (0.72 + hash01(seed * 5.1 + i * 1.9) * 0.5);
    ctx.beginPath();
    ctx.moveTo(m.x + Math.cos(a) * R * 0.34, m.y + Math.sin(a) * R * 0.3);
    ctx.quadraticCurveTo(
      m.x + Math.cos(a) * rr * 0.8, m.y + Math.sin(a) * rr * 0.6,
      m.x + Math.cos(a) * rr, m.y + Math.sin(a) * rr * 0.88,
    );
    ctx.stroke();
  }
  // EL AGUA SE ARRIMA, NO SE DIBUJA. The waterline used to be a pale ring
  // stroked round the clump at 0.78 R — but the crown sits higher than that
  // ring and is only 0.82 R wide, so the ring came out from under it and read
  // as a WHITE OUTLINE drawn round every tree in the manglar. It is a FILL now:
  // a soft, slightly wider disc of shallow water under the canopy, which is
  // what the tide actually leaves there and has no edge to read as a line.
  ctx.fillStyle = `rgba(214,235,232,${(0.10 + 0.10 * wet).toFixed(3)})`;
  manglePath(m.x, m.y + 1, R * (0.84 + 0.1 * wet), seed + 1.7, 0.14); ctx.fill();
  // la copa: dense, dark, ragged — and lower on the water when the tide is in
  const cr = R * (0.82 + 0.12 * wet);
  const cy = m.y - R * 0.16 * (1 - wet);
  // …in the ARBOLEDA's palette, from its dark end: a mangle is the darkest
  // green in this world, but it is the same ramp as every other crown.
  ctx.fillStyle = CANOPY[0];
  manglePath(m.x + sway * 0.4, cy, cr, seed, 0.24); ctx.fill();
  ctx.fillStyle = CANOPY[1];
  manglePath(m.x - cr * 0.16 + sway * 0.6, cy - cr * 0.16, cr * 0.66, seed + 2.3, 0.26); ctx.fill();
  ctx.fillStyle = CANOPY[2];
  manglePath(m.x + cr * 0.24 + sway, cy - cr * 0.22, cr * 0.4, seed + 5.1, 0.28); ctx.fill();
}

// The mangrove banks. The world emits them as points ({x, y, r}); the accessor
// is optional on purpose, so this file is correct both before and after the
// build starts publishing them.
// PER TILE, like the trees and the palms beside them — not off a global array.
// The build distributes mangroves through `add_point`, so they arrive in the
// streamed tiles (1225 of them along the estero), and a flat `W.MANGROVES`
// would have to concatenate every resident tile's list on every frame to
// produce something the world never actually stores.
function drawMangroves(view, t) {
  const tiles = W.visibleTiles(view.x0, view.y0, view.x1, view.y1);
  if (!tiles.length) return;
  const tide = Number.isFinite(state.tide) ? state.tide : 0.5;
  ctx.save();
  ctx.lineJoin = "round";
  for (const tile of tiles) {
    const list = tile.mangroves;
    if (!list || !list.length) continue;
    for (const m of list) {
      const R = (m.r || MANGROVE_R) * 1.6;
      if (m.x + R < view.x0 || m.x - R > view.x1 || m.y + R < view.y0 || m.y - R > view.y1) continue;
      paintMangrove(m, tide, t);
    }
  }
  ctx.restore();
}

const SURFACE_PRESET_COLORS = {
  cuadra: "#e8d5a0",
  park: "#4f9d5b",
  plaza: "#cbc6ba",
  stadium: "#4f9d5b",
  balneario: "#2a7fa8",
  water: "#2a7fa8",
  beach: "#f4d77a",
  // The unpaved ground types. They are the same browns the road vectors use,
  // so an authored patch of barro and the calle de barro beside it are the
  // same surface to the eye as well as to the car.
  barro: "#9c7a4f",
  gravel: "#a99d8b",
};

function surfaceStylePath(style) {
  if (!style._path) style._path = flatMultiPath([style.pts]);
  if (!style._aabb) {
    const xs = style.pts.filter((_, i) => i % 2 === 0);
    const ys = style.pts.filter((_, i) => i % 2 === 1);
    style._aabb = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  return style._path;
}

// Semantic region material painted by the editor. Water itself is already in
// W.WATERS; this fill handles land/park/plaza custom materials.
function drawSurfaceStyleGround(view) {
  for (const style of W.SURFACE_STYLES || []) {
    const path = surfaceStylePath(style);
    if (!aabbInView(style._aabb, view, 4)) continue;
    if (style.groundPreset === "water" || style.groundPreset === "balneario") continue;
    ctx.fillStyle = style.groundColor || SURFACE_PRESET_COLORS[style.groundPreset] || SURFACE_PRESET_COLORS.cuadra;
    ctx.fill(path, "evenodd");
  }
}

// Repaint only the INSIDE band of a styled cuadra. Clipping to its polygon
// keeps the material off the street while a 2× stroke gives the requested
// width entirely on the inner side.
function drawSurfaceStyleAceras(view) {
  for (const style of W.SURFACE_STYLES || []) {
    if (!style.aceraColor || !style.aceraWidthCells) continue;
    const path = surfaceStylePath(style);
    if (!aabbInView(style._aabb, view, style.aceraWidthCells * W.CELL)) continue;
    ctx.save();
    ctx.clip(path, "evenodd");
    ctx.strokeStyle = style.aceraColor;
    ctx.lineWidth = style.aceraWidthCells * W.CELL * 2;
    ctx.lineJoin = "round";
    ctx.stroke(path);
    ctx.restore();
  }
}

// Faro plaza red comma "islands": all the SAME orientation, corner (tip)
// pointing NORTH, spread across the sand shape by the build (lm.commas). Drawn
// in the ground layer so the plaza's trees sit on top of them.
function drawFaroCommas(view) {
  const lm = W.landmarkById ? W.landmarkById("faro") : null;
  const commas = lm && lm.commas;
  if (!commas || !commas.length) return;
  ctx.fillStyle = "#c34a3c";
  const r = 7;
  for (let i = 0; i < commas.length; i++) {
    const cx = commas[i][0], cy = commas[i][1];
    if (cx < view.x0 - 20 || cx > view.x1 + 20 || cy < view.y0 - 20 || cy > view.y1 + 20) continue;
    // a COMMA (round head + an asymmetric hooking tail to a NORTH tip), not a
    // symmetric drop
    ctx.beginPath(); ctx.arc(cx, cy + r * 0.5, r * 0.6, 0, Math.PI * 2); ctx.fill();    // head (ball)
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.45, cy + r * 0.4);
    ctx.quadraticCurveTo(cx - r * 0.2, cy - r * 0.35, cx + r * 0.12, cy - r * 1.2);     // inner edge up to tip
    ctx.quadraticCurveTo(cx + r * 0.72, cy - r * 0.35, cx + r * 0.55, cy + r * 0.4);    // outer edge (hook) down
    ctx.closePath(); ctx.fill();
  }
}

// Kiosk access lanes → nearest street (drivable): a plain ASPHALT stub the
// same colour as the streets (no black casing), so every churchill stand reads
// as connected by a little paved lane.
function drawKioskPaths(view) {
  const paths = W.KIOSK_PATHS;
  if (!paths || !paths.length) return;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.strokeStyle = "#3a3540"; ctx.lineWidth = 28;                 // asphalt (as the streets)
  for (const p of paths) {
    const [x0, y0, x1, y1] = p.pts;
    if (Math.max(x0, x1) < view.x0 - 40 || Math.min(x0, x1) > view.x1 + 40 ||
        Math.max(y0, y1) < view.y0 - 40 || Math.min(y0, y1) > view.y1 + 40) continue;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
}

export {
  GREEN_COLORS, GREEN_DILATE, drawFaroCommas, drawGreenPoly, drawKioskPaths,
  drawLandBase, drawMangroves, drawPlazaGreen, drawSurfaceStyleAceras,
  drawSurfaceStyleGround, drawWaterAll, paintWaterBody,
};
