// Dev-only PixiJS smoke viewer for the tiled planar world (Milestone C perf
// path). Same streamed world + same driving physics as viewer.js, but rendered
// through the WebGL World2DRenderer instead of Canvas2D — so we can compare feel
// and confirm the GPU path culls/streams correctly, especially zoomed out.
// Open /world2d-pixi.html on the dev server. Arrows/WASD drive · wheel zoom.
import { WORLD2D as W } from "./index.js";
import { VEHICLES } from "../game/vehicles.js";
import { makeCar, drive } from "./drive.js";
import { World2DRenderer } from "../render/pixi/World2DRenderer.js";

const canvas = document.getElementById("c");
const hud = document.getElementById("hud");

const spawnLm = W.landmarkById("kios_faro") || W.landmarkById("faro") || W.LANDMARKS[0];
const veh = VEHICLES.pickup;
const car = makeCar(spawnLm.x, spawnLm.y, 0);
const cam = { x: car.x, y: car.y, zoom: 0.7 };
window.__car = car; window.__cam = cam;

const keys = new Set();
addEventListener("keydown", (e) => { keys.add(e.key.toLowerCase()); if (e.key.startsWith("Arrow")) e.preventDefault(); }, { passive: false });
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  cam.zoom = Math.max(0.03, Math.min(6, cam.zoom * Math.exp(-e.deltaY * 0.0012)));
}, { passive: false });

// exposed for headless verification (rAF throttles in background tabs)
window.__keys = keys;
window.__step = (dt) => drive(car, veh, keys, dt, W);

const renderer = new World2DRenderer();

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (keys.has("=") || keys.has("+")) cam.zoom = Math.min(6, cam.zoom * (1 + dt));
  if (keys.has("-")) cam.zoom = Math.max(0.03, cam.zoom * (1 - dt));

  drive(car, veh, keys, dt, W);
  cam.x += (car.x - cam.x) * Math.min(1, dt * 6);
  cam.y += (car.y - cam.y) * Math.min(1, dt * 6);
  W.update(cam.x, cam.y);

  const nVisible = renderer.render(cam, car);

  const surf = W.surfaceAt(car.x, car.y), dist = W.districtAt(car.x, car.y);
  hud.textContent =
    `[pixi] world ${W.W}×${W.H}  tiles ${W.TCOLS}×${W.TROWS}   visible ${nVisible}\n` +
    `car ${car.x | 0},${car.y | 0}  speed ${car.speed | 0}  on=${W.CLASSES[surf]}  ${dist ? dist.short || dist.id : "-"}\n` +
    `zoom ${cam.zoom.toFixed(2)}   [arrows/WASD drive · space brake · +/- or wheel zoom]`;
  requestAnimationFrame(frame);
}

(async () => {
  await W.ready(car.x, car.y, 4000, 4000);
  await renderer.init(canvas, W);
  renderer.setVehicle(veh);
  window.__renderer = renderer;
  requestAnimationFrame(frame);
})();
