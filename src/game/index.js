// Game facade + main loop. Wires the simulation (physics) to the render
// backend and exposes the public API the React UI drives. Also mirrors the
// facade onto window.Game for the dev tweaks/deck host and debugging.
import { state, traffic, pedestrians, gulls, boats, schools } from "./state.js";
import { VEHICLES } from "./vehicles.js";
import { startArcade, startStage, startExplore, startTutorial, setWeather, setVehicle } from "./modes.js";
import { tutorialDone, tutorialStepKey } from "./tutorial.js";
import { attachTouch, attachThrottle } from "./input.js";
import { update } from "./physics.js";
import { setAttract, attractTick } from "./attract.js";
import { esteroThings } from "./crossing.js";
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
  if (state.running) update(dt);
  else if (state.attract) attractTick(dt);
  render(t);
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
  // The ambient pools. They are module arrays rather than fields on `state`,
  // which is right for the sim and means nothing outside it — a console, a
  // check in tools/ — can otherwise see whether they are populated at all.
  pools: () => ({ traffic, pedestrians, gulls, boats, schools }),
  tutorialDone, tutorialStepKey, setWeather, setVehicle, setTide,
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
