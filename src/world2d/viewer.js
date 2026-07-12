// Dev-only smoke viewer for the tiled planar world (Milestone D, Phase 2 verify).
// Streams tiles via WORLD2D, renders the surface grid (per-tile cached canvas) +
// roads/buildings/POIs with a free pan/zoom camera. NOT part of the shipped game
// — open /world2d.html on the dev server to eyeball the 2-D world & streaming.
import { WORLD2D as W } from "./index.js";

const CLASS_COLOR = {
  0: "#2a7fa8", // water
  1: "#e8d5a0", // land
  2: "#f4d77a", // beach
  3: "#3a3540", // road
  4: "#f08a5d", // paseo
  5: "#8c8c8c", // bridge
  6: "#cec7b2", // acera
};

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const hud = document.getElementById("hud");

function resize() {
  canvas.width = Math.floor(window.innerWidth * devicePixelRatio);
  canvas.height = Math.floor(window.innerHeight * devicePixelRatio);
}
resize();
window.addEventListener("resize", resize);

// camera: world point at screen center + pixels-per-world-unit zoom
const faro = W.landmarkById("faro") || W.LANDMARKS[0];
const cam = { x: faro ? faro.x : W.W / 2, y: faro ? faro.y : W.H / 2, zoom: 0.5 };
window.__cam = cam; // exposed for dev driving / screenshots

// input
const keys = new Set();
addEventListener("keydown", (e) => keys.add(e.key.toLowerCase()));
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const f = Math.exp(-e.deltaY * 0.0012);
  cam.zoom = Math.max(0.03, Math.min(6, cam.zoom * f));
}, { passive: false });
let mouse = { x: 0, y: 0 };
canvas.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });

// per-tile cached surface canvas (cols×rows, 1px per cell), drawn scaled
const tileCanvas = new WeakMap();
function surfaceCanvas(t) {
  let cv = tileCanvas.get(t);
  if (cv) return cv;
  cv = document.createElement("canvas");
  cv.width = t.cols; cv.height = t.rows;
  const g = cv.getContext("2d");
  const img = g.createImageData(t.cols, t.rows);
  for (let i = 0; i < t.grid.length; i++) {
    const c = CLASS_COLOR[t.grid[i]] || "#f0f";
    const r = parseInt(c.slice(1, 3), 16), gg = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
    img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  tileCanvas.set(t, cv);
  return cv;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const pan = 700 / cam.zoom * dt;
  if (keys.has("arrowleft") || keys.has("a")) cam.x -= pan;
  if (keys.has("arrowright") || keys.has("d")) cam.x += pan;
  if (keys.has("arrowup") || keys.has("w")) cam.y -= pan;
  if (keys.has("arrowdown") || keys.has("s")) cam.y += pan;
  cam.x = Math.max(0, Math.min(W.W, cam.x));
  cam.y = Math.max(0, Math.min(W.H, cam.y));

  W.update(cam.x, cam.y);

  const cw = canvas.width, ch = canvas.height, z = cam.zoom * devicePixelRatio;
  // world→screen: sx = (wx - cam.x)*z + cw/2
  const viewX0 = cam.x - cw / 2 / z, viewY0 = cam.y - ch / 2 / z;
  const viewX1 = cam.x + cw / 2 / z, viewY1 = cam.y + ch / 2 / z;

  ctx.fillStyle = "#12303e"; // out-of-tile backdrop
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = false;

  const S = (wx, wy) => [(wx - cam.x) * z + cw / 2, (wy - cam.y) * z + ch / 2];

  const vts = W.visibleTiles(viewX0, viewY0, viewX1, viewY1);
  for (const t of vts) {
    const [sx, sy] = S(t.x, t.y);
    ctx.drawImage(surfaceCanvas(t), sx, sy, t.cols * W.CELL * z, t.rows * W.CELL * z);
  }
  // buildings
  ctx.fillStyle = "rgba(120,80,55,.85)";
  for (const t of vts) for (const b of t.buildings) {
    const p = b.pts; ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) { const [x, y] = S(p[i], p[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.fill();
  }
  // roads (thin overlay so the grid class still reads)
  ctx.strokeStyle = "rgba(20,18,24,.5)"; ctx.lineCap = "round";
  for (const t of vts) for (const r of t.roads) {
    const p = r.pts; if (p.length < 4) continue;
    ctx.lineWidth = Math.max(1, r.w * z); ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) { const [x, y] = S(p[i], p[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
  // POIs
  for (const l of W.LANDMARKS) {
    if (l.x < viewX0 || l.x > viewX1 || l.y < viewY0 || l.y > viewY1) continue;
    const [x, y] = S(l.x, l.y);
    ctx.fillStyle = l.type === "kiosk" ? "#ffd23f" : "#e84855";
    ctx.beginPath(); ctx.arc(x, y, 5 * devicePixelRatio, 0, 7); ctx.fill();
  }
  for (const c of W.CUSTOMERS) {
    if (c.x < viewX0 || c.x > viewX1 || c.y < viewY0 || c.y > viewY1) continue;
    const [x, y] = S(c.x, c.y);
    ctx.fillStyle = "#22d3ee"; ctx.beginPath(); ctx.arc(x, y, 4 * devicePixelRatio, 0, 7); ctx.fill();
  }

  // cursor surface probe
  const wx = (mouse.x * devicePixelRatio - cw / 2) / z + cam.x;
  const wy = (mouse.y * devicePixelRatio - ch / 2) / z + cam.y;
  const cls = W.surfaceAt(wx, wy);
  const dist = W.districtAt(wx, wy);
  let resident = 0; for (const _ of vts) resident++;
  hud.textContent =
    `world ${W.W}×${W.H}  tiles ${W.TCOLS}×${W.TROWS}\n` +
    `cam ${cam.x | 0},${cam.y | 0}  zoom ${cam.zoom.toFixed(2)}\n` +
    `cursor ${wx | 0},${wy | 0}  surf=${W.CLASSES[cls]}  ${dist ? dist.short || dist.id : "-"}\n` +
    `visible tiles ${resident}   [WASD/arrows pan · wheel zoom]`;

  requestAnimationFrame(frame);
}

(async () => {
  await W.ready(cam.x, cam.y, 4000, 4000);
  requestAnimationFrame(frame);
})();
