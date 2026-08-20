// La Ruta del Churchill — Canvas2D render backend.
//
// This file is the COMPOSITOR: it owns the camera transform and the draw
// ORDER, one layer per call. Every drawer lives in ./c2d/* (ground, streets,
// structures, landmarks, entities, hud), sharing the live `ctx` binding from
// ./c2d/gfx.js. The Pixi backend (src/render/pixi) is the WebGL alternative
// behind Renderer.js.
// The game loop (src/game/index.js) calls setupCanvas(canvas) then render(t).
import { WORLD2D as W } from "../world2d/index.js";
import { vehicleEffects } from "../game/vehicles.js";
import {
  state, traffic, pedestrians, gulls, boats, parked, vendors, animals, trains, schools,
  beachGames,
} from "../game/state.js";
import { content } from "../content/remote.js";
import {
  canvas, ctx, dpr, ZOOM, setLastT, setupCanvas, weatherColors,
} from "./c2d/gfx.js";
import { drawMangroves, drawWaterAll } from "./c2d/ground.js";
import { drawWorld2D } from "./c2d/world.js";
import { drawNightLights, setLightZoom } from "./c2d/nightlights.js";
import { drawTornado } from "./c2d/tornado.js";
import { lightning, lightsOn, stormForce, stormLevel } from "../game/daynight.js";
import { drawBarriers, drawSigns } from "./c2d/streets.js";
import { drawBridge, drawFerries, drawPiers } from "./c2d/structures.js";
import { drawChannel, drawEstero } from "./c2d/estero.js";
import { drawLandmark, drawLote, drawParcels } from "./c2d/landmarks.js";
import { drawAttractions } from "./c2d/attractions.js";
import {
  drawAnimal, drawArcadeCoin, drawBeachBall, drawBoat, drawCar, drawGull, drawPed, drawSchool,
  drawPlayer, drawPlayerCarrying, drawTargetCustomer, drawTrain, drawVendor,
  paintVehicle,
} from "./c2d/entities.js";
import {
  drawCompass, drawCrossingHud, drawDebugGrid, drawGullBlind, drawMinimap,
  drawNightVignette, drawPoiNames, drawPoiTags, drawRain,
} from "./c2d/hud.js";
import { drawEditorWorld } from "./c2d/editorWorld.js";
import HUD from "../assets/hud.json" with { type: "json" };
import { alphaColor } from "./c2d/primitives.js";
import { paintSpeedLines } from "./c2d/systemShapes.js";

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
    const _pt0 = performance.now();
    drawWaterAll(view, t);
    if (window.__prof) { window.__prof.water += performance.now() - _pt0; window.__prof.n++; }
    // Boats (behind land) — the Balneario boat is drawn LATER, above its
    // inner-water fill (which drawWorld2D paints), or it'd be hidden.
    for (const b of boats) {
      if (b.balneario || b.x < view.x0 - 80 || b.x > view.x1 + 80) continue;
      drawBoat(b);
    }
    // LOS BANCOS DE ATÚN, with the land pass: a school works the surface out in
    // the gulf and the pangas that found it turn around its edge. They sit here
    // with the ambient boats because they are the same kind of thing — offshore
    // life on open water, behind the coastline.
    for (const sc of schools) {
      if (sc.x < view.x0 - 240 || sc.x > view.x1 + 240
        || sc.y < view.y0 - 240 || sc.y > view.y1 + 240) continue;
      drawSchool(sc, t);
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
  // El manglar: ground, so it goes with the world pass — over the land
  // silhouette (it grows out of the bank, not behind it) and under the channel,
  // the boats and everything the crossing floats on top of them.
  drawMangroves(view, t);
  drawChannel(view, t); // la corriente + las boyas: the estero's navigable lane
  drawPiers(view);      // the muelles, each a polyline deck over the water
  drawBridge(view);
  drawFerries(view);   // the two ferries + their berths, over the water
  drawEstero(view, t); // pangas, cardúmenes, gaviotas y raíces — sólo en travesía
  drawBarriers(view);
  drawSigns(view);      // ALTO, semáforos, paradas, zebras, topes
  drawEditorWorld(view, "elements");
  drawParcels(view);   // church + sponsor slots (their ground is in the acera pass)
  // La feria del malecón — the rides and DJ Urtech, with the landmarks because
  // that is what they are: things standing on ground somebody else painted.
  drawAttractions(view, t);
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
  // Sponsored lotes from the remote content (billboards / storefronts).
  // A lote that claims a PARCEL has no coordinates of its own — drawParcels
  // paints it inside that parcel's slot, so it must not also be drawn here.
  for (const lo of content.lotes) {
    if (lo.parcel) continue;
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
    // …and the ball each mejenga is played with, among its players
    for (const G of beachGames) {
      if (G.ball.x < view.x0 - 20 || G.ball.x > view.x1 + 20) continue;
      drawBeachBall(G);
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

  // EL TORNADO, sobre el mundo y bajo la interfaz: es una cosa del mundo, con
  // posición propia, y hay que poder verlo llegar por encima de la calle.
  drawTornado(view);

  // Debug coordinate grid (topmost world-space layer)
  if (state.debug) { drawDebugGrid(view, ZOOM); drawPoiNames(view, ZOOM); }

  // Overlays
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const C = weatherColors();
  // LOS POZOS DE LUZ SON DE LA NOCHE **Y DE LA TORMENTA**. Un cielo cerrado a
  // mediodía prende el alumbrado, y si el compositor sólo mirara el nombre del
  // clima esas lámparas se dibujarían sin abrir su pozo — el mismo error que
  // tenía la noche, otra vez.
  const lit = lightsOn();
  if (lit) {
    // LA NOCHE ES UNA CAPA QUE LAS LÁMPARAS PERFORAN, no una manta. El tinte
    // plano sigue siendo lo que se ve LEJOS de un poste — que es como el juego
    // se ha visto siempre — pero deja de ser la última palabra. Sin alumbrado
    // en la vista, `drawNightLights` pinta exactamente el mismo tinte y nada
    // cambia, que es lo que mantiene honesto el cambio.
    setLightZoom(ZOOM);
    drawNightLights(vw, vh, view, C.tint,
                    (wx, wy) => [(wx - cam.x) * ZOOM + vw / 2, (wy - cam.y) * ZOOM + vh / 2]);
  } else {
    ctx.fillStyle = C.tint; ctx.fillRect(0, 0, vw, vh);
  }
  // LA LLUVIA ENTRA CON LA RAMPA, no con el nombre: primero el cielo plomizo,
  // después el agua. Antes caía a plomo en el mismo cuadro en que el clima
  // cambiaba, que es lo que hacía que una tormenta se sintiera un interruptor.
  const storm = stormLevel();
  if (storm > 0) drawRain(vw, vh, t, stormForce());
  if (state.weather === "night") drawNightVignette(vw, vh);
  // EL RELÁMPAGO va encima de TODO —del tinte, de la lluvia, del viñeteado—
  // porque un relámpago ilumina la escena entera y no una capa de ella. Dura
  // fracciones de segundo, así que es lo único de la tormenta que se dibuja como
  // un destello y no como un estado.
  const bolt = lightning();
  if (bolt > 0) {
    const flash = HUD.weather.lightning;
    ctx.fillStyle = alphaColor(flash.rgb, bolt * flash.alphaMax);
    ctx.fillRect(0, 0, vw, vh);
  }
  // The estero's gulls go over the CAMERA, so they belong up here with the
  // weather and not in the world pass — a bird that crossed you is between you
  // and everything, including the boat.
  drawGullBlind(vw, vh, t);

  if (!state.attract) {
    drawMinimap(vw, vh, t);
    drawCompass(vw, vh);
    drawCrossingHud(vw, vh);
  }

  // EL VIENTO DE VELOCIDAD. The one vehicle effect drawn in SCREEN space, which
  // is why it lives up here in the overlay pass with the minimap and the rain
  // rather than in `drawPlayer` with the wake and the swirls — and why it sat
  // at the bottom of this function for a year with no name on it. It is a
  // selectable effect now (`src/assets/effects.json` -> `speedLines`); a
  // vehicle that does not list it simply does not draw it.
  if (!state.attract) {
    for (const { id, effect, cfg } of vehicleEffects(state.vehicleKey)) {
      if (id !== "speedLines" || effect.layer !== "screen") continue;
      paintSpeedLines(ctx, vw, vh, cfg, state.p.speed);
    }
  }
}

export { setupCanvas, render, paintVehicle, setOverlayMode, setPixiLandmarks };
