// Canvas2D shared graphics context + primitives.
//
// `ctx`/`canvas`/`dpr`/`ZOOM`/`lastT` are ESM LIVE BINDINGS: setupCanvas()
// and setLastT() reassign them here and every importer sees the new value,
// so the drawers can keep writing plain `ctx.fillStyle = ...`.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { tuning } from "../../game/tuning.js";

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
  return Math.max(2.2, z) * tuning.zoom;   // player setting: 0.6 far … 1.4 close
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


function label(x, y, text, fg, bg, size = 10) {
  ctx.font = `bold ${size}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  const w = ctx.measureText(text).width + size;
  const h = size + 4;
  ctx.fillStyle = bg; roundRect(ctx, x - w / 2, y - h * 0.64, w, h, 4, true, false);
  ctx.fillStyle = fg; ctx.fillText(text, x, y + size * 0.1);
}

// Tag for an AREA landmark (park, estadio, plaza, parcel). Three rules the
// long real names forced: the type is SMALLER than a point-landmark pill (a
// full "Parroquia Nuestra Señora de El Carmen" at pill size swamps its own
// cuadra), a long name WRAPS to two lines at the space nearest its middle
// rather than running off the block, and the stack sits nearer the centre of
// the area than its top edge — pinned to the top it read as floating off.
const AREA_WRAP = 15;          // chars before a name is split in two
const AREA_ALPHA = 0.62;       // semi-transparent: an area tag sits ON its own
                               // artwork (the church, the garden trees), so it
                               // has to be readable WITHOUT hiding what it names
function areaLabel(x0, y0, x1, y1, text, fg, bg) {
  const cx = (x0 + x1) / 2;
  let lines = [text];
  if (text.length > AREA_WRAP) {
    // break at the space closest to the middle, so both lines read evenly
    const mid = text.length / 2;
    let best = -1;
    for (let i = 0; i < text.length; i++)
      if (text[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    if (best > 0) lines = [text.slice(0, best), text.slice(best + 1)];
  }
  const lh = 7;
  const top = Math.min(y0 + (y1 - y0) * 0.30, (y0 + y1) / 2 - ((lines.length - 1) * lh) / 2);
  ctx.save();
  ctx.globalAlpha = AREA_ALPHA;
  for (let i = 0; i < lines.length; i++) label(cx, top + i * lh, lines[i], fg, bg, 5.5);
  ctx.restore();
}

// A parcel's or a field's OWN frame: {cx, cy, ang, hw, hh}.
//
// The world emits `hw`/`hh` — the real half-extents along `ang` — for every
// parcel it lays out as a rectangle, and for the two estadios. Use them.
// Deriving the size from the AXIS-ALIGNED bbox (P.x1 - P.x0) is wrong on any
// turned parcel: the bbox of a rotated rectangle is bigger than the rectangle,
// so the church, the schoolyard and the sponsor plate all came out oversized
// and spilled over their own kerb.
//
// The fallback is for shapes with no emitted frame — the hand-authored cuadras,
// whose polygons are raster-traced. It fits the polygon's extent along `ang`,
// which is honest; what it must never do is fit the ANGLE from those vertices
// (4 px staircase steps: a square-ish parcel lands on the contrary diagonal).
function parcelFrame(P) {
  if (P._pframe) return P._pframe;
  const ang = P.ang || 0;
  const cx = P.cx !== undefined ? P.cx : (P.x0 + P.x1) / 2;
  const cy = P.cy !== undefined ? P.cy : (P.y0 + P.y1) / 2;
  let hw = P.hw, hh = P.hh;
  if (hw === undefined || hw === null) {
    const f = P.footprint || P.poly;
    hw = 0; hh = 0;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    if (f) {
      for (let i = 0; i < f.length; i += 2) {
        const dx = f[i] - cx, dy = f[i + 1] - cy;
        hw = Math.max(hw, Math.abs(dx * ca + dy * sa));
        hh = Math.max(hh, Math.abs(-dx * sa + dy * ca));
      }
    } else {
      hw = (P.x1 - P.x0) / 2; hh = (P.y1 - P.y0) / 2;
    }
  }
  return (P._pframe = { cx, cy, ang, hw, hh });
}

// Deterministic 0..1 hash for scene scatter (no Math.random in draw paths)
function hash01(n) {
  const v = Math.sin(n) * 43758.5453;
  return v - Math.floor(v);
}

export {
  ACERA_PX, CUAD, CUADS_PER_VIEW, aabbInView, areaLabel, canvas, computeZoom,
  ctx, dpr, flatAABB, flatPath, hash01, label, lastT, parcelFrame, polyBBox,
  roundRect, setLastT, setupCanvas, weatherColors, ZOOM,
};
