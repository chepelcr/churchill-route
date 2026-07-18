// User-tunable gameplay settings (persisted to localStorage). Speed works
// like a sensitivity slider: it scales the vehicle's accel + top speed
// (70%–120%, default 100%). The melt budget and the tutorial's speed step
// compensate with it, so changing speed changes FEEL, not difficulty.
const KEY = "churchill_tuning_v1";

export const tuning = {
  speed: 1,
  load() {
    try {
      if (typeof localStorage === "undefined") return;
      const d = JSON.parse(localStorage.getItem(KEY) || "{}");
      if (typeof d.speed === "number" && d.speed >= 0.7 && d.speed <= 1.2) this.speed = d.speed;
    } catch { /* private mode */ }
  },
  setSpeed(v) {
    this.speed = Math.max(0.7, Math.min(1.2, v));
    try { localStorage.setItem(KEY, JSON.stringify({ speed: this.speed })); } catch { /* private mode */ }
  },
};
tuning.load();
