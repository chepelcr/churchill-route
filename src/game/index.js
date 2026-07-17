// Game facade + main loop. Wires the simulation (physics) to the render
// backend and exposes the public API the React UI drives. Also mirrors the
// facade onto window.Game for the dev tweaks/deck host and debugging.
import { state } from "./state.js";
import { VEHICLES } from "./vehicles.js";
import { startArcade, startStage, startExplore, startTutorial, setWeather, setVehicle } from "./modes.js";
import { tutorialDone, tutorialStepKey } from "./tutorial.js";
import { attachTouch, attachThrottle } from "./input.js";
import { update } from "./physics.js";
import { setAttract, attractTick } from "./attract.js";
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
  tutorialDone, tutorialStepKey, setWeather, setVehicle,
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
