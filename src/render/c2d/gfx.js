// Canvas2D shared graphics context + primitives.
//
// `ctx`/`canvas`/`dpr`/`ZOOM`/`lastT` are ESM LIVE BINDINGS: setupCanvas()
// and setLastT() reassign them here and every importer sees the new value,
// so the drawers can keep writing plain `ctx.fillStyle = ...`.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { tuning } from "../../game/tuning.js";
import { MIN_ZOOM, VIEW_WIDTH_PX } from "../../domain/units.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };

let canvas, ctx, dpr = 1;
// Camera zoom: >1 pulls the camera closer so streets/buildings read at
// city-exploration scale. Recomputed responsively per viewport in setupCanvas().
let ZOOM = 5.5;
// Latest render timestamp, for effects animated outside render()'s `t` scope
// (fountains, pools, the palms in drawFaroScene).
let lastT = 0;
function setLastT(v) { lastT = v; }
// THE CAMERA FRAMES METRES OF GROUND, not cuadrículas.
//
// It used to be `CUADS_PER_VIEW * CUAD`, and that was the last place the
// cuadrícula did a job it has no business doing: CUAD is the coarse grid the
// BUILDER walks to find a manzana and cut synth lots on, so expressing the
// player's view in it meant a rescale of the block-detection grid resized
// everybody's screen too. `VIEW_WIDTH_PX` and `MIN_ZOOM` come from
// `src/assets/world-units.json` in metres and derive here; `meta.cuadsPerView`
// stays advisory, and `docs/RESCALE.md` step 0 is why.
const CUAD = W.CUAD;                       // still wanted: the debug grid
// The kerb, from the accessor that owns the manifest and its ONE legacy
// default. This used to fall back to 8 while the sim fell back to 12 — the
// renderer and the spawner disagreeing about where the sidewalk is.
const ACERA_PX = W.ACERA_PX;
function computeZoom(wCss, hCss) {
  const z = wCss / VIEW_WIDTH_PX;
  // Only a floor is clamped — a narrow screen shows LESS ground (more detail),
  // never more. See MIN_ZOOM: on a phone that floor, not the framing above, is
  // what decides how much road you see.
  return Math.max(MIN_ZOOM, z) * tuning.zoom;  // player setting: 0.6 far … 1.4 close
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
  // The per-weather palette lives in the shared material registry: five modules
  // read it — this one for the sky, `ground.js` for the playas and the land
  // base, `estero.js` for the mangrove's shoreline, `canvas2d.js` for the tint
  // over the finished frame, and `water.js`, which DERIVES the entire living-sea
  // palette from `waterTop`/`waterBot` rather than authoring one.
  return MATERIALS.weather[state.weather] || MATERIALS.weather.sunny;
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
// One Path2D carrying every closed ring of a raster-owned shape. Callers fill
// it with the even-odd rule so nested rings remain holes while disconnected
// outer rings still paint as part of the same parcel.
function flatMultiPath(polys) {
  const path = new Path2D();
  for (const pts of polys || []) {
    if (!pts || pts.length < 6) continue;
    path.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
    path.closePath();
  }
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
// whose polygons are raster-traced and vector-straightened. It fits the
// polygon's extent along `ang`, which is honest; what it must never do is fit
// the ANGLE from those vertices (a square-ish parcel is still degenerate).
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

// LA PARADITA used to be here, as raw Canvas calls. It is `props.parada` in
// world-props.json now, drawn by `c2d/props.js` — which cannot live in this file
// because gfx is the BOTTOM of the renderer and the shape interpreter sits on
// top of it.

export {
  ACERA_PX, CUAD, VIEW_WIDTH_PX, aabbInView, areaLabel, canvas, computeZoom,
  ctx, dpr, flatAABB, flatMultiPath, flatPath, hash01, label, lastT,
  parcelFrame, polyBBox, roundRect, setLastT, setupCanvas, weatherColors, ZOOM,
};
