// Ground layer: sea/inland water, the land base + park/plaza greens, the faro
// plaza commas and the kiosk access lanes. Painted before roads.
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import FLORA from "../../assets/flora.json" with { type: "json" };
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import WATER from "../../assets/water.json" with { type: "json" };
import PROPS from "../../assets/world-props.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { SURFACE } from "../../game/surfaces.js";
import { ensureRenderCache } from "./cache.js";
import {
  floraSeed, paintFloraSpecies, resolveFloraMixSpecies,
} from "./floraShapes.js";
import { aabbInView, ctx, flatMultiPath, textureScale, weatherColors } from "./gfx.js";
import { overlayTexture, paintScatter } from "./materials.js";
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
  const I = WATER.inland, S = I.shimmer;
  const C = weatherColors(), a = w.aabb;
  const g = ctx.createLinearGradient(0, a.y0, 0, a.y1);
  g.addColorStop(0, C.waterTop); g.addColorStop(1, C.waterBot);
  ctx.fillStyle = g; ctx.fill(w.path);
  // shimmer, clipped to the water
  ctx.save(); ctx.clip(w.path);
  ctx.strokeStyle = S.color; ctx.lineWidth = S.lineWidth;
  const tt = t * S.timeScale;
  const y0 = Math.max(view.y0, a.y0), y1 = Math.min(view.y1, a.y1);
  const x0 = Math.max(view.x0, a.x0), x1 = Math.min(view.x1, a.x1);
  for (let yy = y0; yy < y1; yy += S.rowGap) {
    ctx.beginPath();
    for (let xx = x0; xx < x1; xx += S.sampleStep) {
      const yo = Math.sin(tt + xx * S.xFrequency + yy * S.yFrequency) * S.amplitude;
      xx === x0 ? ctx.moveTo(xx, yy + yo) : ctx.lineTo(xx, yy + yo);
    }
    ctx.stroke();
  }
  ctx.restore();
  // foam bank: soft pale rim along the shoreline
  ctx.strokeStyle = I.bank.color; ctx.lineWidth = I.bank.lineWidth; ctx.stroke(w.path);
}

// Base land + inland waters (with river love) + beach, under the streets.
function drawLandBase(view, t) {
  const _pt0 = performance.now();
  const rc = ensureRenderCache(), C = weatherColors();
  // EL SUELO YA NO ES UN HEX. La tierra se rellena con su color de siempre y
  // encima le pasa su grano — manchas grandes y suaves, porque a este zoom una
  // manzana entera cabe en pantalla y un relleno liso se lee como cartón. Sin
  // textura autorada el segundo pase no ocurre y el cuadro sale como ayer.
  const tex = textureScale();
  ctx.fillStyle = C.land;
  for (const l of rc.land) if (aabbInView(l.aabb, view, 4)) ctx.fill(l.path);
  // EL SUELO DECIDE, NO EL POLÍGONO — `surfaceAt` es una consulta al tile y
  // además excluye de una vez las calles, la arena y las aceras, que es más de
  // lo que la silueta de la tierra sabe. Es la misma contención que
  // `paintWoods` usa para plantar un bosque.
  paintScatter(ctx, "land", view, (x, y) => W.surfaceAt(x, y) === SURFACE.LAND, tex);
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
  if (rc.beach.some((b) => aabbInView(b.aabb, view, 4))) {
    ctx.fill(rc.sand, "evenodd");
    overlayTexture(ctx, "sand", tex, () => ctx.fill(rc.sand, "evenodd"));
  }
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
const GREEN_COLORS = MATERIALS.green;
//: Cuáles de esos verdes son CÉSPED de verdad. `pool` es agua y
//: `esplanade` es la piedra del faro; ninguna de las dos se peina.
const GRASS_GREENS = new Set(["park", "plaza", "stadium", "marine"]);
function drawPlazaGreen(pz, view) {
  const [px, py, pw, ph] = pz;
  if (px + pw < view.x0 || px > view.x1 || py + ph < view.y0 || py > view.y1) return;
  const col = GREEN_COLORS[pz[4]] || GREEN_COLORS.park;
  ctx.fillStyle = col;
  ctx.fillRect(px, py, pw, ph);
  if (GRASS_GREENS.has(pz[4])) {
    overlayTexture(ctx, "grass", textureScale(), () => ctx.fillRect(px, py, pw, ph));
  }
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
  const col = GREEN_COLORS[gp.type] || GREEN_COLORS.park;
  ctx.fillStyle = col; ctx.fill(gp._path, "evenodd");
  // EL PASTO SE PEINA, EL AGUA NO. `GREEN_COLORS` cubre también la piscina del
  // balneario y la plazoleta del faro, y una brizna de césped sobre el agua o
  // sobre la piedra sería el registro dibujando lo que no es.
  if (GRASS_GREENS.has(gp.type)) {
    overlayTexture(ctx, "grass", textureScale(), () => ctx.fill(gp._path, "evenodd"));
  }
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
// Exact mangrove identities and zonation are JSON. The builder currently emits
// only waterline clumps, so every unlabelled point resolves through the authored
// channel-edge mix; a future emitted `k` can name a surveyed specimen directly.
const MANGROVE_MIX = FLORA.mangroveMixes[FLORA.defaults.mangroveMix];
const MANGROVE_SPECIES = MANGROVE_MIX.weights.map(([id]) => {
  const record = FLORA.species[id];
  if (!record) throw new Error(`unknown channel-edge mangrove species: ${id}`);
  return record;
});
const MANGROVE_R = Math.max(...MANGROVE_SPECIES.map((record) => record.r));

function mangroveSpecies(m) {
  const id = m.k || resolveFloraMixSpecies(
    MANGROVE_MIX.weights,
    floraSeed(m.x + MANGROVE_R, m.y - MANGROVE_R),
  );
  const record = FLORA.species[id];
  if (!record) throw new Error(`unknown mangrove species: ${id}`);
  return record;
}

export function paintMangrove(m, tide, t) {
  const record = mangroveSpecies(m);
  paintFloraSpecies(ctx, record, FLORA.forms[record.form], {
    x: m.x,
    y: m.y,
    s: 1,
    radius: m.r || record.r,
    seed: floraSeed(m.x, m.y),
    tide,
    tMs: t,
    shadowModel: EFFECTS.sunShadow,
  });
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

const SURFACE_PRESET_COLORS = MATERIALS.terrain;

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
  const faro = PROPS.scenes.faro, P = faro.comma;
  ctx.fillStyle = faro.palette.comma;
  const r = P.radius;
  for (let i = 0; i < commas.length; i++) {
    const cx = commas[i][0], cy = commas[i][1];
    if (cx < view.x0 - 20 || cx > view.x1 + 20 || cy < view.y0 - 20 || cy > view.y1 + 20) continue;
    // a COMMA (round head + an asymmetric hooking tail to a NORTH tip), not a
    // symmetric drop
    ctx.beginPath(); ctx.arc(cx, cy + r * P.headY, r * P.headR, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + r * P.innerX, cy + r * P.innerY);
    ctx.quadraticCurveTo(cx + r * P.innerControlX, cy + r * P.innerControlY,
      cx + r * P.tipX, cy + r * P.tipY);
    ctx.quadraticCurveTo(cx + r * P.outerControlX, cy + r * P.outerControlY,
      cx + r * P.outerX, cy + r * P.outerY);
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
  ctx.strokeStyle = MATERIALS.street.asphalt;
  ctx.lineWidth = MATERIALS.street.kioskPathWidth;
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
