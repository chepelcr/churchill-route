// Dev-only smoke viewer for the tiled planar world (Milestone D, Phase 2/3/4
// verify). Streams tiles via WORLD2D, renders the surface grid + roads/buildings/
// POIs, and drives a car with the GAME's physics model against WORLD2D.surfaceAt
// (proving the real 2-D Puntarenas is traversable). NOT part of the shipped game
// — open /world2d.html on the dev server. Arrows/WASD drive · +/- or wheel zoom.
import { WORLD2D as W } from "./index.js";
import { SURFACE_MUL } from "../game/surfaces.js";
import { VEHICLES } from "../game/vehicles.js";

const CLASS_COLOR = {
  0: "#2a7fa8", 1: "#e8d5a0", 2: "#f4d77a", 3: "#3a3540",
  4: "#f08a5d", 5: "#8c8c8c", 6: "#cec7b2",
};

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");
function resize() {
  canvas.width = Math.floor(innerWidth * devicePixelRatio);
  canvas.height = Math.floor(innerHeight * devicePixelRatio);
}
resize(); addEventListener("resize", resize);

// spawn the car at the Faro kiosk (a reachable street point)
const spawnLm = W.landmarkById("kios_faro") || W.landmarkById("faro") || W.LANDMARKS[0];
const veh = VEHICLES.pickup;
const car = { x: spawnLm.x, y: spawnLm.y, a: 0, vx: 0, vy: 0, speed: 0 };
const cam = { x: car.x, y: car.y, zoom: 0.7 };
window.__car = car; window.__cam = cam;

const keys = new Set();
addEventListener("keydown", (e) => { keys.add(e.key.toLowerCase()); if (e.key.startsWith("Arrow")) e.preventDefault(); }, { passive: false });
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam.zoom = Math.max(0.03, Math.min(6, cam.zoom * Math.exp(-e.deltaY * 0.0012)));
}, { passive: false });

// per-tile cached surface canvas (cols×rows @1px/cell), blitted scaled
const tileCanvas = new WeakMap();
function surfaceCanvas(t) {
  let cv = tileCanvas.get(t); if (cv) return cv;
  cv = document.createElement("canvas"); cv.width = t.cols; cv.height = t.rows;
  const g = cv.getContext("2d"), img = g.createImageData(t.cols, t.rows);
  for (let i = 0; i < t.grid.length; i++) {
    const c = CLASS_COLOR[t.grid[i]] || "#f0f";
    img.data[i * 4] = parseInt(c.slice(1, 3), 16);
    img.data[i * 4 + 1] = parseInt(c.slice(3, 5), 16);
    img.data[i * 4 + 2] = parseInt(c.slice(5, 7), 16);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0); tileCanvas.set(t, cv); return cv;
}

// walls: solid cuadra (land), acera/curb, AND water — you stay on the streets /
// peninsula (replaces the corridor topY/botY bounds with 2-D water-as-wall).
const isWall = (x, y) => { const c = W.surfaceAt(x, y); return c === 1 || c === 6 || c === 0; };

function drive(dt) {
  const turning = (keys.has("arrowright") || keys.has("d") ? 1 : 0) - (keys.has("arrowleft") || keys.has("a") ? 1 : 0);
  const throttle = (keys.has("arrowup") || keys.has("w") ? 1 : 0) - (keys.has("arrowdown") || keys.has("s") ? 1 : 0) * 0.6;
  const brake = keys.has(" ");

  const surf = W.surfaceAt(car.x, car.y);
  const surfaceMul = SURFACE_MUL[surf] !== undefined ? SURFACE_MUL[surf] : 0.78;
  const turnRate = veh.turn * (0.4 + Math.min(1, Math.abs(car.speed) / veh.top) * 0.9);
  car.a += turning * turnRate * dt * (brake ? 1.35 : 1);
  car.vx += Math.cos(car.a) * veh.accel * throttle * dt;
  car.vy += Math.sin(car.a) * veh.accel * throttle * dt;

  const hx = Math.cos(car.a), hy = Math.sin(car.a);
  const fwd = car.vx * hx + car.vy * hy, side = -car.vx * hy + car.vy * hx;
  const grip = veh.grip * (brake ? 0.55 : 1);
  const kept = side * (1 - Math.min(1, grip * dt * 6));
  car.vx = hx * fwd - hy * kept; car.vy = hy * fwd + hx * kept;

  const fric = throttle ? 0.4 : 1.8, sp = Math.hypot(car.vx, car.vy);
  if (sp > 0.1) { const k = Math.max(0, sp - fric * (1 / surfaceMul) * dt * 60) / sp; car.vx *= k; car.vy *= k; }
  const top = veh.top * surfaceMul, sp2 = Math.hypot(car.vx, car.vy);
  if (sp2 > top) { car.vx *= top / sp2; car.vy *= top / sp2; }

  const px = car.x, py = car.y;
  car.x += car.vx * dt; car.y += car.vy * dt;
  if (isWall(car.x, car.y)) {
    const okX = !isWall(car.x, py), okY = !isWall(px, car.y);
    if (okX && !okY) { car.y = py; car.vy = 0; }
    else if (okY && !okX) { car.x = px; car.vx = 0; }
    else if (!isWall(px, py)) { car.x = px; car.y = py; car.vx *= -0.1; car.vy *= -0.1; }
  }
  car.x = Math.max(12, Math.min(W.W - 12, car.x));
  car.y = Math.max(12, Math.min(W.H - 12, car.y));
  car.speed = Math.hypot(car.vx, car.vy);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (keys.has("=") || keys.has("+")) cam.zoom = Math.min(6, cam.zoom * (1 + dt));
  if (keys.has("-")) cam.zoom = Math.max(0.03, cam.zoom * (1 - dt));
  drive(dt);
  cam.x += (car.x - cam.x) * Math.min(1, dt * 6);
  cam.y += (car.y - cam.y) * Math.min(1, dt * 6);
  W.update(cam.x, cam.y);

  const cw = canvas.width, ch = canvas.height, z = cam.zoom * devicePixelRatio;
  const vx0 = cam.x - cw / 2 / z, vy0 = cam.y - ch / 2 / z, vx1 = cam.x + cw / 2 / z, vy1 = cam.y + ch / 2 / z;
  ctx.fillStyle = "#12303e"; ctx.fillRect(0, 0, cw, ch); ctx.imageSmoothingEnabled = false;
  const S = (wx, wy) => [(wx - cam.x) * z + cw / 2, (wy - cam.y) * z + ch / 2];

  const vts = W.visibleTiles(vx0, vy0, vx1, vy1);
  for (const t of vts) { const [sx, sy] = S(t.x, t.y); ctx.drawImage(surfaceCanvas(t), sx, sy, t.cols * W.CELL * z, t.rows * W.CELL * z); }
  ctx.fillStyle = "rgba(120,80,55,.85)";
  for (const t of vts) for (const b of t.buildings) { const p = b.pts; ctx.beginPath(); for (let i = 0; i < p.length; i += 2) { const [x, y] = S(p[i], p[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.fill(); }
  for (const l of W.LANDMARKS) { if (l.x < vx0 || l.x > vx1 || l.y < vy0 || l.y > vy1) continue; const [x, y] = S(l.x, l.y); ctx.fillStyle = l.type === "kiosk" ? "#ffd23f" : "#e84855"; ctx.beginPath(); ctx.arc(x, y, 5 * devicePixelRatio, 0, 7); ctx.fill(); }
  for (const c of W.CUSTOMERS) { if (c.x < vx0 || c.x > vx1 || c.y < vy0 || c.y > vy1) continue; const [x, y] = S(c.x, c.y); ctx.fillStyle = "#22d3ee"; ctx.beginPath(); ctx.arc(x, y, 4 * devicePixelRatio, 0, 7); ctx.fill(); }

  // car
  const [csx, csy] = S(car.x, car.y);
  ctx.save(); ctx.translate(csx, csy); ctx.rotate(car.a);
  ctx.fillStyle = veh.color; const cwid = veh.w * z, chei = veh.h * z;
  ctx.fillRect(-cwid / 2, -chei / 2, cwid, chei);
  ctx.fillStyle = veh.roof; ctx.fillRect(-cwid * 0.15, -chei / 2, cwid * 0.4, chei);
  ctx.restore();

  const surf = W.surfaceAt(car.x, car.y), dist = W.districtAt(car.x, car.y);
  hud.textContent =
    `world ${W.W}×${W.H}  tiles ${W.TCOLS}×${W.TROWS}   visible ${vts.length}\n` +
    `car ${car.x | 0},${car.y | 0}  speed ${car.speed | 0}  on=${W.CLASSES[surf]}  ${dist ? dist.short || dist.id : "-"}\n` +
    `zoom ${cam.zoom.toFixed(2)}   [arrows/WASD drive · space brake · +/- or wheel zoom]`;
  requestAnimationFrame(frame);
}

// exposed for dev-driving verification (rAF is throttled in background tabs)
window.__keys = keys; window.__step = drive;
(async () => { await W.ready(car.x, car.y, 4000, 4000); requestAnimationFrame(frame); })();
