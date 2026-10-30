// User-tunable gameplay settings (persisted to localStorage).
//   speed — scales the vehicle's accel + top speed (70%–120%, default 100%).
//           The melt budget and the tutorial's speed step compensate with it,
//           so changing speed changes FEEL, not difficulty.
//   zoom  — how much city the camera frames, as a multiplier on the renderer's
//           ~20-cuadrícula default. BELOW 1 pulls the camera back (more street
//           ahead), above 1 pushes it in.
//   poiNames — draw the real Puntarenas business names over the map. On by
//           default (the map reads as the real port), off for a clean view.
// speed + zoom are offered up front during the tutorial; all three live in
// Settings' GAMEPLAY section.
const KEY = "churchill_tuning_v1";

export const tuning = {
  speed: 1,
  zoom: 1,
  poiNames: true,
  load() {
    try {
      if (typeof localStorage === "undefined") return;
      const d = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (typeof d.speed === "number" && d.speed >= 0.7 && d.speed <= 1.2) this.speed = d.speed;
      if (typeof d.zoom === "number" && d.zoom >= 0.6 && d.zoom <= 1.4) this.zoom = d.zoom;
      if (typeof d.poiNames === "boolean") this.poiNames = d.poiNames;
    } catch { /* private mode */ }
  },
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        speed: this.speed, zoom: this.zoom, poiNames: this.poiNames,
      }));
    } catch { /* private mode */ }
  },
  setPoiNames(v) { this.poiNames = !!v; this.save(); },
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
