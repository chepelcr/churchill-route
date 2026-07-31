// La Ruta del Churchill — Canvas2D render backend.
//
// This file is the COMPOSITOR: it owns the camera transform and the draw
// ORDER, one layer per call. Every drawer lives in ./c2d/* (ground, streets,
// structures, landmarks, entities, hud), sharing the live `ctx` binding from
// ./c2d/gfx.js. The Pixi backend (src/render/pixi) is the WebGL alternative
// behind Renderer.js.
// The game loop (src/game/index.js) calls setupCanvas(canvas) then render(t).
import { WORLD2D as W } from "../world2d/index.js";
import {
  state, traffic, pedestrians, gulls, boats, parked, vendors, animals, trains,
} from "../game/state.js";
import { content } from "../content/remote.js";
import {
  canvas, ctx, dpr, ZOOM, setLastT, setupCanvas, weatherColors,
} from "./c2d/gfx.js";
import { drawWaterAll } from "./c2d/ground.js";
import { drawWorld2D } from "./c2d/world.js";
import { drawBarriers, drawSigns } from "./c2d/streets.js";
import { drawBridge, drawFaroPier, drawFerries, drawPier } from "./c2d/structures.js";
import { drawLandmark, drawLote, drawParcels } from "./c2d/landmarks.js";
import {
  drawAnimal, drawArcadeCoin, drawBoat, drawCar, drawGull, drawPed,
  drawPlayer, drawPlayerCarrying, drawTargetCustomer, drawTrain, drawVendor,
  paintVehicle,
} from "./c2d/entities.js";
import {
  drawCompass, drawDebugGrid, drawMinimap, drawNightVignette, drawPoiNames,
  drawPoiTags, drawRain,
} from "./c2d/hud.js";
import { drawEditorWorld } from "./c2d/editorWorld.js";

// ---- Main render ----------------------------------------------------------
// Overlay mode (legacy full-hybrid experiment): Pixi draws the world +
// entities below this canvas. Kept for testing; the shipped balance is
// canvas2d world + a Pixi LANDMARKS layer above (see setPixiLandmarks).
let OVERLAY = false;
function setOverlayMode(v) { OVERLAY = !!v; }
// When true, the Pixi layer above draws landmark STRUCTURES (stadium
// gradas + tunnel roof); canvas2d then only paints their ground (césped).
let PIXI_LANDMARKS = false;
function setPixiLandmarks(v) { PIXI_LANDMARKS = !!v; }
// Landmark types the Pixi layer now owns (kept in sync with scene.js
// _MIGRATED) — canvas skips these when the Pixi layer is active. Empty for
// now: the church→Pixi pilot wasn't visible, so canvas draws all landmarks
// until the Pixi landmark path is verified.
const PIXI_MIGRATED = new Set();

function render(t) {
  if (!ctx) return;
  setLastT(t);
  const cw = canvas.width, ch = canvas.height;
  const vw = cw / dpr, vh = ch / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, vw, vh);

  // Camera — publish the jitter so the Pixi landmarks layer above shakes in
  // lockstep (in legacy overlay mode, reuse the jitter Pixi computed first)
  const shake = state.cam.shake;
  let sx, sy;
  if (OVERLAY && state.cam._sx !== undefined) { sx = state.cam._sx; sy = state.cam._sy; }
  else {
    sx = (Math.random() - 0.5) * shake; sy = (Math.random() - 0.5) * shake;
    state.cam._sx = sx; state.cam._sy = sy;
  }
  const cam = { x: state.cam.x + sx, y: state.cam.y + sy };
  const wvw = vw / ZOOM, wvh = vh / ZOOM;
  const view = { x0: cam.x - wvw/2 - 40, x1: cam.x + wvw/2 + 40, y0: cam.y - wvh/2 - 40, y1: cam.y + wvh/2 + 40 };

  // World transform (zoomed)
  ctx.translate(vw/2, vh/2);
  ctx.scale(ZOOM, ZOOM);
  ctx.translate(-cam.x, -cam.y);

  if (!OVERLAY) {
    // Sky/water everywhere (drawn in world coords across viewport)
    drawWaterAll(view, t);
    // Boats (behind land) — the Balneario boat is drawn LATER, above its
    // inner-water fill (which drawWorld2D paints), or it'd be hidden.
    for (const b of boats) {
      if (b.balneario || b.x < view.x0 - 80 || b.x > view.x1 + 80) continue;
      drawBoat(b);
    }
    // Painterly 2-D world from resident tiles: land silhouette + road strokes +
    // buildings + palms/trees (replaces the corridor's global-array drawers).
    drawWorld2D(view, t);
    drawEditorWorld(view, "districts");
    drawPoiTags(view, ZOOM);   // real business names, small, over the ground
  }
  // Hand-drawn set pieces the painterly pass doesn't cover: the Muelle de
  // Cruceros deck (its BRIDGE surface cells are drivable but not painted by
  // the vector road pass) and the Mata de Limón suspension bridge.
  drawPier(view);
  drawFaroPier(view);
  drawBridge(view);
  drawFerries(view);   // the two ferries + their berths, over the water
  drawBarriers(view);
  drawSigns(view);      // ALTO, semáforos, paradas, zebras, topes
  drawEditorWorld(view, "elements");
  drawParcels(view);   // church + sponsor slots (their ground is in the acera pass)
  // Landmarks (the bridge has its own drawer)
  for (const lm of W.LANDMARKS) {
    // Area landmarks can span well beyond their anchor (Parque Marino's exact
    // residual is multi-component). Cull their emitted extent, not only the
    // label point, or a valid pool disappears while its lawn is still visible.
    const lhw = (lm.w || 0) / 2, lhh = (lm.h || 0) / 2;
    if (lm.x + lhw < view.x0 - 60 || lm.x - lhw > view.x1 + 60) continue;
    if (lm.y + lhh < view.y0 - 160 || lm.y - lhh > view.y1 + 160) continue;
    if (lm.type === "bridge") continue; // the Mata bridge has its own drawer (drawBridge)
    if (PIXI_LANDMARKS && PIXI_MIGRATED.has(lm.type)) continue; // Pixi draws these now
    drawLandmark(lm);
  }
  // Sponsored lotes from the remote content (billboards / storefronts)
  for (const lo of content.lotes) {
    if (lo.x < view.x0 - 60 || lo.x > view.x1 + 60 || lo.y < view.y0 - 60 || lo.y > view.y1 + 60) continue;
    drawLote(lo);
  }
  // Pedestrians, traffic (Pixi's in hybrid mode)
  if (!OVERLAY) {
    // Balneario boat: above the inlet water, below the swimmers.
    for (const b of boats) {
      if (!b.balneario || b.x < view.x0 - 80 || b.x > view.x1 + 80) continue;
      drawBoat(b);
    }
    for (const pe of pedestrians) {
      if (pe.x < view.x0 - 20 || pe.x > view.x1 + 20) continue;
      drawPed(pe);
    }
    for (const pk of parked) {
      if (pk.x < view.x0 - 20 || pk.x > view.x1 + 20 || pk.y < view.y0 - 20 || pk.y > view.y1 + 20) continue;
      drawCar(pk);
    }
    for (const vn of vendors) {
      if (vn.x < view.x0 - 20 || vn.x > view.x1 + 20 || vn.y < view.y0 - 20 || vn.y > view.y1 + 20) continue;
      drawVendor(vn, t);
    }
    for (const an of animals) {
      if (an.x < view.x0 - 20 || an.x > view.x1 + 20 || an.y < view.y0 - 20 || an.y > view.y1 + 20) continue;
      drawAnimal(an);
    }
    for (const car of traffic) {
      if (car.x < view.x0 - 20 || car.x > view.x1 + 20) continue;
      drawCar(car);
    }
    for (const tr of trains) {
      if (tr.x < view.x0 - 140 || tr.x > view.x1 + 140 || tr.y < view.y0 - 140 || tr.y > view.y1 + 140) continue;
      drawTrain(tr, t);
    }
  }
  // Arcade collectable coins on the streets
  if (!state.attract && state.arcadeCoins && state.arcadeCoins.length) {
    for (const c of state.arcadeCoins) {
      if (c.x < view.x0 - 20 || c.x > view.x1 + 20 || c.y < view.y0 - 20 || c.y > view.y1 + 20) continue;
      drawArcadeCoin(c, t);
    }
  }
  // Particles
  for (const pt of state.particles) {
    ctx.globalAlpha = Math.max(0, pt.life);
    ctx.fillStyle = pt.c;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Active delivery target, then player (neither exists in attract mode).
  // Hybrid: Pixi draws the player body/shadow; only the carrying bar stays.
  if (!state.attract) {
    drawTargetCustomer(t);
    if (OVERLAY) drawPlayerCarrying(state.p, state.veh);
    else drawPlayer(state.p, state.veh);
  }
  // True over-player layer. Covered lanes and stadium roofs live here while
  // physics independently decides whether the vehicle may drive below them.
  drawEditorWorld(view, "roofs");
  // Gulls above
  if (!OVERLAY) for (const g of gulls) {
    if (g.x < view.x0 - 30 || g.x > view.x1 + 30) continue;
    drawGull(g);
  }
  // Floats
  for (const f of state.floats) {
    ctx.globalAlpha = Math.max(0, 1 - f.t / f.ttl);
    ctx.fillStyle = f.color;
    ctx.font = "bold 12px 'Space Grotesk', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  // Debug coordinate grid (topmost world-space layer)
  if (state.debug) { drawDebugGrid(view, ZOOM); drawPoiNames(view, ZOOM); }

  // Overlays
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const C = weatherColors();
  ctx.fillStyle = C.tint; ctx.fillRect(0, 0, vw, vh);
  if (state.weather === "storm") drawRain(vw, vh, t);
  if (state.weather === "night") drawNightVignette(vw, vh);

  if (!state.attract) {
    drawMinimap(vw, vh, t);
    drawCompass(vw, vh);
  }

  if (!state.attract && state.p.speed > 240) {
    ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1;
    for (let i = 0; i < 12; i++) {
      const y = Math.random() * vh, len = 40 + Math.random() * 60;
      ctx.beginPath(); ctx.moveTo(vw - 20 - len, y); ctx.lineTo(vw - 20, y); ctx.stroke();
    }
  }
}

export { setupCanvas, render, paintVehicle, setOverlayMode, setPixiLandmarks };
