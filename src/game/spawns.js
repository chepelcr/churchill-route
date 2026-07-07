// World-entity spawning: traffic, pedestrians, ambient life (parked cars,
// vendor carts, stray animals), gulls and boats. Fills the shared arrays in
// state.js; physics advances them each frame.
import { WORLD as W } from "../world/index.js";
import { traffic, pedestrians, gulls, boats, parked, vendors, animals } from "./state.js";

// Place a traffic car at its road arclength position (+ lane offset)
export function placeCar(t) {
  const pt = W.roadPointAt(t.roadIdx, t.s);
  const nx = -Math.sin(pt.ang), ny = Math.cos(pt.ang);
  t.x = pt.x + nx * t.lane;
  t.y = pt.y + ny * t.lane;
  t.ang = t.dir > 0 ? pt.ang : pt.ang + Math.PI;
}

export function spawnTraffic() {
  traffic.length = 0;
  const palette = ["#9bc4d4", "#f4d77a", "#e85d75", "#6fbf99", "#caa089", "#fff", "#3a3a48", "#f08a5d"];
  for (let ri = 0; ri < W.ROADS.length; ri++) {
    const r = W.ROADS[ri];
    const main = r.cls === "trunk" || r.cls === "trunk_link" || r.cls === "primary";
    if (!main && r.cls !== "secondary") continue;
    const len = W.roadLength(ri);
    // density ∝ road length: main roads densest
    const spacing = main ? 200 : 340;
    const n = Math.floor(len / (spacing + Math.random() * 100));
    for (let k = 0; k < n && traffic.length < 240; k++) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const car = {
        roadIdx: ri, s: Math.random() * len, dir,
        lane: (dir > 0 ? 1 : -1) * Math.max(8, r.w * 0.22),
        v: main ? 70 + Math.random() * 40 : 48 + Math.random() * 28,
        color: palette[Math.floor(Math.random() * palette.length)],
        w: main ? 38 : 32, h: main ? 18 : 16,
        kind: "car",
        x: 0, y: 0, ang: 0,
      };
      if (main) {
        const roll = Math.random();
        if (roll < 0.15) { car.kind = "truck"; car.w = 46; car.h = 18; }
        else if (roll < 0.24) { car.kind = "bus"; car.w = 56; car.h = 19; car.color = "#e0762e"; car.v *= 0.85; }
      }
      placeCar(car);
      traffic.push(car);
    }
  }
}

// The Paseo de los Turistas (matched by name — it is a principal street now,
// no longer a special class). Used for the densest pedestrian + vendor life.
let paseoRoadIdxs = null;
export function getPaseoRoads() {
  if (!paseoRoadIdxs) {
    paseoRoadIdxs = [];
    for (let i = 0; i < W.ROADS.length; i++) {
      if ((W.ROADS[i].name || "").toLowerCase().includes("paseo de los turistas")) paseoRoadIdxs.push(i);
    }
  }
  return paseoRoadIdxs;
}

// Pedestrians walk the aceras (sidewalks) of the streets; some cross the road.
export function spawnPedestrians() {
  pedestrians.length = 0;
  function addPed(ri, s) {
    const r = W.ROADS[ri];
    const baseOff = r.w / 2 + 4;            // on the acera band beside the curb
    const side = Math.random() < 0.5 ? -1 : 1;
    const pe = {
      roadIdx: ri, s, side, baseOff, off: side * baseOff,
      v: (Math.random() < 0.5 ? 1 : -1) * (14 + Math.random() * 12),
      crossing: false, crossPhase: 0,
      hue: Math.floor(Math.random() * 360), ph: Math.random() * Math.PI * 2,
      x: 0, y: 0,
    };
    const pt = W.roadPointAt(ri, s);
    pe.x = pt.x - Math.sin(pt.ang) * pe.off;
    pe.y = pt.y + Math.cos(pt.ang) * pe.off;
    pedestrians.push(pe);
  }
  const WALK_CLS = {
    residential: 1, unclassified: 1, living_street: 1,
    tertiary: 1, tertiary_link: 1, secondary: 1,
    primary: 1, primary_link: 1, trunk: 1, trunk_link: 1,
  };
  const paseo = new Set(getPaseoRoads());
  for (let ri = 0; ri < W.ROADS.length && pedestrians.length < 260; ri++) {
    const r = W.ROADS[ri];
    if (!WALK_CLS[r.cls] && !paseo.has(ri)) continue;
    const dense = paseo.has(ri);              // busiest on the Paseo aceras
    for (let s = 20; s < r.len - 20;) {
      addPed(ri, s);
      s += dense ? 22 + Math.random() * 20 : 130 + Math.random() * 150;
    }
  }
  spawnAmbient();
}

// Ambient city life: parked cars along curbs, vendor carts, stray animals
export function spawnAmbient() {
  // No parked cars cluttering the streets — keep the driving lanes clear.
  parked.length = 0; vendors.length = 0; animals.length = 0;
  const kiosks = W.LANDMARKS.filter(l => l.type === "kiosk");
  // vendor carts with parasols: along the Paseo aceras + around every kiosk
  for (const ri of getPaseoRoads()) {
    const r = W.ROADS[ri];
    for (let s = 60; s < r.len - 60; s += 120 + Math.random() * 90) {
      const pt = W.roadPointAt(ri, s);
      const off = (Math.random() < 0.5 ? -1 : 1) * (r.w / 2 + 6); // on the acera
      vendors.push({ x: pt.x - Math.sin(pt.ang) * off, y: pt.y + Math.cos(pt.ang) * off,
                     hue: 10 + Math.floor(Math.random() * 160), ph: Math.random() * 6 });
    }
  }
  for (const k of kiosks) {
    vendors.push({ x: k.x + 34, y: k.y + 12, hue: 330, ph: Math.random() * 6 });
  }
  // animals: dogs/cats that amble across streets in town
  for (let i = 0; i < 14; i++) {
    const ri = Math.floor(Math.random() * W.ROADS.length);
    const r = W.ROADS[ri];
    if (!r || r.len < 100) { i--; continue; }
    const s = 40 + Math.random() * (r.len - 80);
    const pt = W.roadPointAt(ri, s);
    animals.push({ x: pt.x, y: pt.y, tx: pt.x, ty: pt.y, roadIdx: ri, s,
                   pause: Math.random() * 4, cat: Math.random() < 0.4,
                   ph: Math.random() * 6 });
  }
}

export function updateAnimals(dt) {
  for (const a of animals) {
    a.ph += dt * 5;
    if (a.pause > 0) { a.pause -= dt; continue; }
    const dx = a.tx - a.x, dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) {
      // pick a new spot: cross the street or wander along it
      const r = W.ROADS[a.roadIdx];
      a.s = Math.max(20, Math.min(r.len - 20, a.s + (Math.random() - 0.5) * 120));
      const pt = W.roadPointAt(a.roadIdx, a.s);
      const off = (Math.random() < 0.5 ? -1 : 1) * (r.w / 2 + 6 + Math.random() * 8);
      a.tx = pt.x - Math.sin(pt.ang) * off;
      a.ty = pt.y + Math.cos(pt.ang) * off;
      a.pause = 1 + Math.random() * 5;
    } else {
      const sp = a.cat ? 34 : 26;
      a.x += (dx / d) * sp * dt;
      a.y += (dy / d) * sp * dt;
    }
  }
}

export function spawnGulls() {
  gulls.length = 0;
  for (let i = 0; i < 26; i++) {
    gulls.push({
      x: Math.random() * W.W,
      y: (Math.random() < 0.5 ? -40 - Math.random() * 200 : W.H + Math.random() * 200),
      vx: (Math.random() < 0.5 ? 1 : -1) * (40 + Math.random() * 50),
      vy: (Math.random() - 0.5) * 20,
      ph: Math.random() * Math.PI * 2,
    });
  }
  // map them to actual water above/below peninsula at draw time
  for (const g of gulls) {
    const top = W.topY(g.x);
    const bot = W.botY(g.x);
    if (g.y < top) g.y = Math.max(0, top - 30 - Math.random() * 200);
    else g.y = Math.min(W.H, bot + 30 + Math.random() * 200);
  }
}

export function spawnBoats() {
  boats.length = 0;
  // Ferries / pangas — rejection-sample open water anywhere on the map
  for (let i = 0; i < 11; i++) {
    let x = 0, y = 0, ok = false;
    for (let tries = 0; tries < 200 && !ok; tries++) {
      x = 200 + Math.random() * (W.W - 400);
      y = 40 + Math.random() * (W.H - 80);
      ok = W.inWater(x, y) && W.inWater(x, y - 24) && W.inWater(x, y + 24);
    }
    if (!ok) continue;
    boats.push({
      x, y,
      vx: (Math.random() < 0.5 ? 1 : -1) * (10 + Math.random() * 14),
      kind: i < 2 ? "ferry" : "panga",
      wake: 0,
    });
  }
}
