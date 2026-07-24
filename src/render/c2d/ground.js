// Ground layer: sea/inland water, the land base + park/plaza greens, the faro
// plaza commas and the kiosk access lanes. Painted before roads.
import { WORLD2D as W } from "../../world2d/index.js";
import { ensureRenderCache } from "./cache.js";
import { aabbInView, ctx, weatherColors } from "./gfx.js";

function drawWaterAll(view, t) {
  // Full background = water
  const C = weatherColors();
  const g = ctx.createLinearGradient(0, view.y0, 0, view.y1);
  g.addColorStop(0, C.waterTop); g.addColorStop(1, C.waterBot);
  ctx.fillStyle = g;
  ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
  // Shimmer lines
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  const tt = t * 0.0006;
  for (let yy = view.y0; yy < view.y1; yy += 26) {
    ctx.beginPath();
    for (let xx = view.x0; xx < view.x1; xx += 20) {
      const yo = Math.sin(tt + xx * 0.04 + yy * 0.03) * 2.2;
      if (xx === view.x0) ctx.moveTo(xx, yy + yo);
      else ctx.lineTo(xx, yy + yo);
    }
    ctx.stroke();
  }
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
  const rc = ensureRenderCache(), C = weatherColors();
  ctx.fillStyle = C.land; for (const l of rc.land) if (aabbInView(l.aabb, view, 4)) ctx.fill(l.path);
  // park / plaza cuadras: green IS their base ground colour (global manifest
  // outline polys, so no sand flash before a tile streams in) — waters, beach
  // wet line and streets all paint on top of it.
  for (const gp of W.GREENS || []) drawGreenPoly(gp, view);
  for (const pz of W.PLAZAS || []) drawPlazaGreen(pz, view);   // faro esplanade
  ctx.lineJoin = "round";
  for (const w of rc.water) if (aabbInView(w.aabb, view, 4)) paintWaterBody(w, view, t);
  // beach: sandy fill + a faint wet line along its seaward edge
  ctx.fillStyle = C.sand; for (const b of rc.beach) if (aabbInView(b.aabb, view, 4)) ctx.fill(b.path);
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1.5;
  for (const b of rc.beach) if (aabbInView(b.aabb, view, 4)) ctx.stroke(b.path);
}


// Green ground: one FLAT fill whose colour is chosen BY TYPE (pz[4]) — a
// civic plaza, a park lawn, or the marine park — instead of layering a
// texture over the base terrain. Rects tile the block edge-to-edge, so a
// single flat colour with square corners reads as one continuous area.
const GREEN_COLORS = { plaza: "#5ba362", park: "#4f9d5b", marine: "#46a98f", pool: "#5faec7", stadium: "#4f9d5b", esplanade: "#cbc6ba" };
function drawPlazaGreen(pz, view) {
  const [px, py, pw, ph] = pz;
  if (px + pw < view.x0 || px > view.x1 || py + ph < view.y0 || py > view.y1) return;
  ctx.fillStyle = GREEN_COLORS[pz[4]] || "#4f9d5b";
  ctx.fillRect(px, py, pw, ph);
}

// Park/plaza lawn: ONE outline polygon per green cuadra (raster-traced in the
// build, so it follows the acera inner edge — curves included). The same-
// colour stroke dilates the fill outward: the raster sidewalk ring is 20 px
// deep but the painted acera band only 8 px, so without it a 12 px sand strip
// shows between lawn and sidewalk. 14 px of dilation tucks the lawn a couple
// px UNDER the band (painted later, so it wins) and rounds the cell steps.
const GREEN_DILATE = 28;
function drawGreenPoly(gp, view) {
  let b = gp._aabb;
  if (!b) {
    const p = gp.pts;
    b = gp._aabb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (let i = 0; i < p.length; i += 2) {
      if (p[i] < b.x0) b.x0 = p[i]; if (p[i] > b.x1) b.x1 = p[i];
      if (p[i + 1] < b.y0) b.y0 = p[i + 1]; if (p[i + 1] > b.y1) b.y1 = p[i + 1];
    }
  }
  // Stadium pitches dilate like parks so the grass tucks under the sidewalk
  // (no bare sand ring); only the pool outline (unused now the Balneario is
  // water) stays at its exact edge.
  const m = (gp.type === "pool") ? 0 : GREEN_DILATE;
  if (b.x1 + m < view.x0 || b.x0 - m > view.x1 || b.y1 + m < view.y0 || b.y0 - m > view.y1) return;
  if (!gp._path) {
    const p = gp.pts, path = new Path2D();
    path.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]);
    path.closePath();
    gp._path = path;
  }
  const col = GREEN_COLORS[gp.type] || "#4f9d5b";
  ctx.fillStyle = col; ctx.fill(gp._path);
  if (m) {
    ctx.strokeStyle = col; ctx.lineWidth = m; ctx.lineJoin = "round";
    ctx.stroke(gp._path);
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

export { GREEN_COLORS, GREEN_DILATE, drawFaroCommas, drawGreenPoly, drawKioskPaths, drawLandBase, drawPlazaGreen, drawWaterAll, paintWaterBody };
