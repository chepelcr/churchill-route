// Vehicle stats — pure data (also imported by tools/gen-inventory.mjs).
// accel/top in px/s, turn in rad/s, grip 0..1, melt = churchill melt-rate mult.
export const VEHICLES = {
  bici:    { name: "Bicicleta + cooler",  accel: 240, top: 270, turn: 3.5, grip: 0.86, melt: 0.7, color: "#2e8bd6", roof: "#ffe6b3", w: 22, h: 14, kind: "bike" },
  scooter: { name: "Scooter retro",        accel: 330, top: 350, turn: 3.1, grip: 0.78, melt: 1.0, color: "#e85d75", roof: "#fff",    w: 24, h: 14, kind: "bike" },
  tuktuk:  { name: "Tuk-tuk porteño",      accel: 290, top: 320, turn: 2.8, grip: 0.74, melt: 0.9, color: "#f3c969", roof: "#3a3a48", w: 28, h: 18, kind: "car"  },
  cart:    { name: "Mini carrito helado",  accel: 260, top: 290, turn: 2.5, grip: 0.7,  melt: 0.55, color: "#fff",   roof: "#e85d75", w: 30, h: 18, kind: "car"  },
  pickup:  { name: "Pickup pescador",      accel: 370, top: 410, turn: 2.4, grip: 0.68, melt: 1.1, color: "#6fbf99", roof: "#4a3a2a", w: 34, h: 20, kind: "car"  },
  turbo:   { name: "Turbo Churchill Kart", accel: 500, top: 540, turn: 3.2, grip: 0.62, melt: 1.3, color: "#ff3d80", roof: "#fff36b", w: 26, h: 16, kind: "car"  },
};
