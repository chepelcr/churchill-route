// Shared arcade driving against the tiled planar world (WORLD2D). Extracted from
// the canvas smoke viewer so the Pixi viewer (and, later, the Phase-4 shipped
// game) drive with the exact same physics model. Pure-ish: reads WORLD2D.surfaceAt
// for the per-class speed multiplier and water/land/acera walls; no rendering.
import { SURFACE_MUL } from "../game/surfaces.js";

// A car is the mutable pose+velocity the physics integrates.
export function makeCar(x, y, a = 0) {
  return { x, y, a, vx: 0, vy: 0, speed: 0 };
}

// walls: solid cuadra (land=1), acera/curb (6), AND water (0) — you stay on the
// streets / peninsula (replaces the corridor topY/botY bounds with water-as-wall).
export function isWall(W, x, y) {
  const c = W.surfaceAt(x, y);
  return c === 1 || c === 6 || c === 0;
}

// Integrate one step. `keys` is a Set of lowercased keys (arrows/WASD/space).
export function drive(car, veh, keys, dt, W) {
  const turning =
    (keys.has("arrowright") || keys.has("d") ? 1 : 0) -
    (keys.has("arrowleft") || keys.has("a") ? 1 : 0);
  const throttle =
    (keys.has("arrowup") || keys.has("w") ? 1 : 0) -
    (keys.has("arrowdown") || keys.has("s") ? 1 : 0) * 0.6;
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
  if (isWall(W, car.x, car.y)) {
    const okX = !isWall(W, car.x, py), okY = !isWall(W, px, car.y);
    if (okX && !okY) { car.y = py; car.vy = 0; }
    else if (okY && !okX) { car.x = px; car.vx = 0; }
    else if (!isWall(W, px, py)) { car.x = px; car.y = py; car.vx *= -0.1; car.vy *= -0.1; }
  }
  car.x = Math.max(12, Math.min(W.W - 12, car.x));
  car.y = Math.max(12, Math.min(W.H - 12, car.y));
  car.speed = Math.hypot(car.vx, car.vy);
  return car;
}
