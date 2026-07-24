// Canvas2D shared graphics context + primitives.
//
// `ctx`/`canvas`/`dpr`/`ZOOM`/`lastT` are ESM LIVE BINDINGS: setupCanvas()
// and setLastT() reassign them here and every importer sees the new value,
// so the drawers can keep writing plain `ctx.fillStyle = ...`.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";

let canvas, ctx, dpr = 1;
// Camera zoom: >1 pulls the camera closer so streets/buildings read at
// city-exploration scale. Recomputed responsively per viewport in setupCanvas().
let ZOOM = 5.5;
// Latest render timestamp, for effects animated outside render()'s `t` scope
// (fountains, pools, the palms in drawFaroScene).
let lastT = 0;
function setLastT(v) { lastT = v; }
// Cuadrícula-based responsive zoom: frame at most CUADS_PER_VIEW cuadrículas
// so every device shows the same amount of city. Only a floor is clamped —
// narrow screens show FEWER cuadrículas (more detail), never more than 12.
const CUAD = (W.META && W.META.cuad) || 20;
// Camera framing is a RENDERER concern (tuned by feel, not a world rebuild):
// frame ~20 cuadrículas across so the road ahead is visible while driving.
// meta.cuadsPerView is advisory only.
const CUADS_PER_VIEW = 20;
const ACERA_PX = (W.META && W.META.aceraPx) || 8; // sidewalk depth per side
function computeZoom(wCss, hCss) {
  const z = wCss / (CUADS_PER_VIEW * CUAD);
  return Math.max(2.2, z);
}

function setupCanvas(c) {
  canvas = c; ctx = c.getContext("2d");
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    ZOOM = computeZoom(w, h);
    // publish the view transform for input (point-to-drive) + camera clamp
    state.cam.zoom = ZOOM; state.cam.vw = w; state.cam.vh = h;
  };
  resize(); window.addEventListener("resize", resize);
  // some mobile browsers report stale sizes at orientationchange time
  window.addEventListener("orientationchange", () => setTimeout(resize, 120));
  if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
  // entering/leaving fullscreen doesn't fire resize on all mobile browsers
  document.addEventListener("fullscreenchange", () => setTimeout(resize, 60));
  document.addEventListener("webkitfullscreenchange", () => setTimeout(resize, 60));
}

function weatherColors() {
  const w = state.weather;
  if (w === "storm")  return { sky1: "#3a4a5e", sky2: "#5a6a7e", waterTop: "#3b6f7a", waterBot: "#244b56", sand: "#a89870", land: "#8a9c70", tint: "rgba(40,55,80,0.35)" };
  if (w === "sunset") return { sky1: "#ff8b5a", sky2: "#ff3d80", waterTop: "#d28a6a", waterBot: "#7a4060", sand: "#f4c98b", land: "#cda06a", tint: "rgba(255,80,80,0.12)" };
  if (w === "night")  return { sky1: "#0e1530", sky2: "#222244", waterTop: "#1a2a44", waterBot: "#0a1428", sand: "#6a5a48", land: "#4a5040", tint: "rgba(10,10,30,0.45)" };
  return                   { sky1: "#9fd9ec", sky2: "#ffe6b3", waterTop: "#62c2c9", waterBot: "#2e8090", sand: "#f1d29a", land: "#cfb27a", tint: "rgba(255,235,200,0.04)" };
}


// ---- Drawing helpers ----
function roundRect(c, x, y, w, h, r, fill, stroke) {
  c.beginPath();
  c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r); c.closePath();
  if (fill) c.fill(); if (stroke) c.stroke();
}


function flatAABB(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    if (pts[i] < x0) x0 = pts[i];
    if (pts[i] > x1) x1 = pts[i];
    if (pts[i + 1] < y0) y0 = pts[i + 1];
    if (pts[i + 1] > y1) y1 = pts[i + 1];
  }
  return { x0, y0, x1, y1 };
}
function flatPath(pts, close) {
  const path = new Path2D();
  path.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
  if (close) path.closePath();
  return path;
}
// Same as flatAABB but returning the bare rect callers destructure — kept
// distinct so the render-cache entries keep their {aabb} shape.
const polyBBox = flatAABB;

function aabbInView(a, view, pad) {
  return !(a.x1 + pad < view.x0 || a.x0 - pad > view.x1 || a.y1 + pad < view.y0 || a.y0 - pad > view.y1);
}


function label(x, y, text, fg, bg) {
  ctx.font = "bold 10px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = bg; roundRect(ctx, x - w / 2, y - 9, w, 14, 4, true, false);
  ctx.fillStyle = fg; ctx.fillText(text, x, y + 1);
}

// Tag for an AREA landmark (park, estadio, balneario): the pill sits just
// INSIDE the area's own bounds at the top, so it reads as belonging to the
// place. Offsetting by half the block height instead — as every area drawer
// used to — floated the tag a cuadra NORTH, over the street.
function areaLabel(x0, y0, x1, y1, text, fg, bg) {
  label((x0 + x1) / 2, Math.min(y0 + 12, (y0 + y1) / 2), text, fg, bg);
}

// Deterministic 0..1 hash for scene scatter (no Math.random in draw paths)
function hash01(n) {
  const v = Math.sin(n) * 43758.5453;
  return v - Math.floor(v);
}

export {
  ACERA_PX, CUAD, CUADS_PER_VIEW, aabbInView, areaLabel, canvas, computeZoom,
  ctx, dpr, flatAABB, flatPath, hash01, label, lastT, polyBBox, roundRect,
  setLastT, setupCanvas, weatherColors, ZOOM,
};
