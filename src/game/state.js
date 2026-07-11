// Shared mutable game state + world-entity arrays.
// These are module singletons (one game instance) imported by the spawn,
// physics, delivery and render modules.
import { VEHICLES } from "./vehicles.js";

export const state = {
  running: false, paused: false, over: false, won: false,
  attract: false,           // menu attract mode: world lives, no player

  mode: "arcade",           // arcade | story | explore
  stageIdx: 0,              // index into WORLD.STAGES
  weather: "sunny",
  timeOfDay: 0.55,
  vehicleKey: "scooter", veh: VEHICLES.scooter,
  p: { x: 1500, y: 760, a: 0, vx: 0, vy: 0, speed: 0, drift: 0 },
  // the renderer publishes zoom/vw/vh on cam — mutate it, never replace it
  cam: { x: 1500, y: 760, shake: 0 },
  carrying: null,
  pendingOrder: null,
  score: 0, combo: 1, comboTimer: 0,
  deliveries: 0, perfect: 0,
  timeLeft: 180,
  storyTip: "",
  particles: [], floats: [],
  rainT: 0,
  // Active stage data
  stage: null,
  stageDeliveries: 0,
  stageTarget: 0,
  // Set at startup by game/index.js (loadProgress) and by mode starts.
  progress: null,
  barriers: [],
};

// ----- World entities (advanced by physics, drawn by the renderer) ----------
export const traffic = [];      // moving cars/buses/trucks on main roads
export const pedestrians = [];  // strollers on the paseo + aceras
export const gulls = [];        // seagulls over the water
export const boats = [];        // ferries + pangas offshore
export const parked = [];       // static cars along curbs
export const vendors = [];      // street vendor carts on the aceras
export const animals = [];      // dogs/cats wandering across streets

export function pushFloat(x, y, text, color) {
  state.floats.push({ x, y, text, color, t: 0, ttl: 1.6 });
}
