// User-tunable gameplay settings (persisted to localStorage).
//   speed — scales the vehicle's accel + top speed (70%–120%, default 100%).
//           The melt budget and the tutorial's speed step compensate with it,
//           so changing speed changes FEEL, not difficulty.
//   zoom  — how much city the camera frames, as a multiplier on the renderer's
//           ~20-cuadrícula default. BELOW 1 pulls the camera back (more street
//           ahead), above 1 pushes it in.
//   poiNames — draw the real Puntarenas business names over the map. On by
//           default (the map reads as the real port), off for a clean view.
//   frameRate — 60 or 30 frames per second (`effects.json → frameRate`). At 30
//           the loop draws every other rAF: half the work and an EVEN beat,
//           which on a phone that cannot hold 60 reads smoother. `null` = the
//           platform default.
//   resolution — how many canvas pixels per CSS pixel, capped by the device
//           (`effects.json → resolution`). The single biggest knob on a phone:
//           everything the renderer fills costs per pixel. `null` = the
//           platform default (lower in the APK), so a player who never touched
//           it follows that default if it is ever retuned.
// speed + zoom are offered up front during the tutorial; all four live in
// Settings' GAMEPLAY section.
import EFFECTS from "../assets/effects.json" with { type: "json" };

const KEY = "churchill_tuning_v1";
const RES = EFFECTS.resolution;
const FPS = EFFECTS.frameRate;
const isNative = () => typeof window !== "undefined" && !!window.Capacitor?.isNativePlatform?.();

export const tuning = {
  speed: 1,
  zoom: 1,
  poiNames: true,
  resolution: null,
  /** the level in effect: the player's pick, or this platform's default */
  resolutionLevel() { return this.resolution || (isNative() ? RES.defaultNative : RES.defaultWeb); },
  /** canvas px per CSS px for the level in effect (the device's own ratio still caps it) */
  resolutionScale() { return RES.levels[this.resolutionLevel()] || RES.levels[RES.defaultWeb]; },
  resolutionLevels: Object.keys(RES.levels),
  frameRate: null,
  /** the frame cap in effect (fps): the player's pick, or this platform's default */
  frameRateCap() { return this.frameRate || (isNative() ? FPS.defaultNative : FPS.defaultWeb); },
  frameRateLevels: FPS.levels,
  load() {
    try {
      if (typeof localStorage === "undefined") return;
      const d = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (typeof d.speed === "number" && d.speed >= 0.7 && d.speed <= 1.2) this.speed = d.speed;
      if (typeof d.zoom === "number" && d.zoom >= 0.6 && d.zoom <= 1.4) this.zoom = d.zoom;
      if (typeof d.poiNames === "boolean") this.poiNames = d.poiNames;
      if (typeof d.resolution === "string" && d.resolution in RES.levels) this.resolution = d.resolution;
      if (FPS.levels.includes(d.frameRate)) this.frameRate = d.frameRate;
    } catch { /* private mode */ }
  },
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        speed: this.speed, zoom: this.zoom, poiNames: this.poiNames, resolution: this.resolution, frameRate: this.frameRate,
      }));
    } catch { /* private mode */ }
  },
  setPoiNames(v) { this.poiNames = !!v; this.save(); },
  setFrameRate(fps) {
    if (!FPS.levels.includes(fps)) return;
    this.frameRate = fps;
    this.save();
  },
  setResolution(level) {
    if (!(level in RES.levels)) return;
    this.resolution = level;
    this.save();
    // the canvas is sized on resize — re-run it so the new density applies now
    if (typeof window !== "undefined") window.dispatchEvent(new Event("resize"));
  },
  setSpeed(v) {
    this.speed = Math.max(0.7, Math.min(1.2, v));
    this.save();
  },
  setZoom(v) {
    this.zoom = Math.max(0.6, Math.min(1.4, v));
    this.save();
    // the renderer computes its framing on resize — re-run that path so the
    // new zoom applies immediately instead of on the next orientation change
    if (typeof window !== "undefined") window.dispatchEvent(new Event("resize"));
  },
};
tuning.load();
