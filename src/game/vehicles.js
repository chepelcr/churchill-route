// Vehicle stats — pure data (also imported by tools/gen-inventory.mjs).
// accel/top in px/s, turn in rad/s, grip 0..1, melt = churchill melt-rate mult.
// Relaxed cruise tuning: slower top speeds + higher grip than the original
// arcade values, so driving the puerto feels smooth and unhurried rather than
// frenetic. accel/top in px/s, turn in rad/s, grip 0..1, melt = melt-rate mult.
export const VEHICLES = {
  bici:    { name: "Bicicleta + cooler",  accel: 185, top: 200, turn: 3.4, grip: 0.90, melt: 0.7, color: "#2e8bd6", roof: "#ffe6b3", w: 22, h: 14, kind: "bike" },
  scooter: { name: "Scooter retro",        accel: 245, top: 255, turn: 3.05, grip: 0.85, melt: 1.0, color: "#e85d75", roof: "#fff",   w: 24, h: 14, kind: "bike" },
  tuktuk:  { name: "Tuk-tuk porteño",      accel: 220, top: 235, turn: 2.8, grip: 0.82, melt: 0.9, color: "#f3c969", roof: "#3a3a48", w: 28, h: 18, kind: "car"  },
  cart:    { name: "Mini carrito helado",  accel: 200, top: 215, turn: 2.55, grip: 0.80, melt: 0.55, color: "#fff",  roof: "#e85d75", w: 30, h: 18, kind: "car"  },
  pickup:  { name: "Pickup pescador",      accel: 275, top: 300, turn: 2.45, grip: 0.78, melt: 1.1, color: "#6fbf99", roof: "#4a3a2a", w: 34, h: 20, kind: "car"  },
  turbo:   { name: "Turbo Churchill Kart", accel: 360, top: 390, turn: 3.05, grip: 0.72, melt: 1.3, color: "#ff3d80", roof: "#fff36b", w: 26, h: 16, kind: "car"  },
};
