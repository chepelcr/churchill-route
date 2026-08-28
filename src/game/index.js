// Game facade + main loop. Wires the simulation (physics) to the render
// backend and exposes the public API the React UI drives. Also mirrors the
// facade onto window.Game for the dev tweaks/deck host and debugging.
import { state, traffic, pedestrians, gulls, boats, schools } from "./state.js";
import { VEHICLES } from "./vehicles.js";
import { startArcade, startStage, startExplore, startTutorial, setWeather, setVehicle,
  crossTheEstero, declinePassage } from "./modes.js";
import { esteroMuelles } from "./ferries.js";
import { tutorialDone, tutorialStepKey } from "./tutorial.js";
import { attachTouch, attachThrottle } from "./input.js";
import { update } from "./physics.js";
import { setAttract, attractTick } from "./attract.js";
import { channels, esteroThings, laneAt } from "./crossing.js";
import { setTide } from "./tides.js";
import { loadProgress, saveProgress, rebuildBarriers } from "./progress.js";
import { setupCanvas, render } from "../render/Renderer.js";

// Progression is loaded once at module init (before any mode start).
state.progress = loadProgress();

// ----- Loop ----------------------------------------------------------------
let lastT = 0;
function loop(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;
  const prof = typeof window !== "undefined" ? window.__prof : null;
  const updateStarted = prof ? performance.now() : 0;
  if (state.running) update(dt);
  else if (state.attract) attractTick(dt);
  if (prof) prof.update = (prof.update || 0) + performance.now() - updateStarted;
  // EL RENDERER CUENTA EN SEGUNDOS, igual que el sim. `t` viene de rAF en
  // MILISEGUNDOS y aquí se convertía sólo para `dt`, así que el render recibía
  // ms y cada dibujante decidía por su cuenta qué unidad creía tener: unos
  // convertían local (`t * 0.001`), otros venían afinados en ms (`t * 0.006`) y
  // muchos en segundos (`t * 0.7`, o el `spin` de la feria en vueltas/segundo).
  // Estos últimos corrían MIL VECES rápido — la rueda de Chicago daba 1200 rpm
  // y el resto hacía alias, que se lee como ruido y no como un error.
  render(t / 1000);
  requestAnimationFrame(loop);
}

let attached = false;
function attachCanvas(c) {
  if (attached) return;
  attached = true;
  setupCanvas(c);
  attachThrottle(c); // one-finger point-to-drive: steer + distance throttle
  requestAnimationFrame((t) => { lastT = t; loop(t); });
}

export const Game = {
  state, VEHICLES, startArcade, startStage, startExplore, startTutorial,
  // The estero's contents, for the console and for the checks in tools/. The
  // obstacles are a module array rather than state, so without this the only
  // way to assert anything about the tide is to infer it from the boat.
  crossingThings: () => esteroThings,
  // …and the derived course itself. The buoys, the gates and the measured lane
  // are computed from the route at runtime, so the only way a check in tools/
  // can assert that a mark is standing ON WATER is to be handed them.
  crossingChannel: (id) => channels().get(id) || null,
  crossingLaneAt: (id, s) => {
    const ch = channels().get(id);
    return ch ? laneAt(ch, s) : null;
  },
  // The ambient pools. They are module arrays rather than fields on `state`,
  // which is right for the sim and means nothing outside it — a console, a
  // check in tools/ — can otherwise see whether they are populated at all.
  pools: () => ({ traffic, pedestrians, gulls, boats, schools }),
  tutorialDone, tutorialStepKey, setWeather, setVehicle, setTide,
  // la puerta del muelle: el sim levanta la oferta, la UI la contesta.
  // `esteroMuelles` sale por aquí porque es lo único con lo que un check puede
  // AFIRMAR EL LUGAR además del hecho — un punto del mundo se ancla en la ruta
  // que el mundo emite, nunca en un píxel escrito a mano.
  crossTheEstero, declinePassage, esteroMuelles,
  attachCanvas, attachTouch, setAttract,
  pause: () => { state.paused = !state.paused; },
  quit: () => { state.running = false; state.over = false; state.won = false; },
  resetProgress: () => {
    // wipe the save and rebuild the fresh default (economy fields included
    // via ensureEconomy inside loadProgress)
    try { localStorage.removeItem("churchill_progress_v1"); } catch (e) {}
    state.progress = loadProgress();
    saveProgress(); rebuildBarriers();
  },
};

if (typeof window !== "undefined") window.Game = Game;
