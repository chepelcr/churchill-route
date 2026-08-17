// Canvas2D shared graphics context + primitives.
//
// `ctx`/`canvas`/`dpr`/`ZOOM`/`lastT` are ESM LIVE BINDINGS: setupCanvas()
// and setLastT() reassign them here and every importer sees the new value,
// so the drawers can keep writing plain `ctx.fillStyle = ...`.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { skyBlend } from "../../game/daynight.js";
import { tuning } from "../../game/tuning.js";
import { MIN_ZOOM, VIEW_WIDTH_PX } from "../../domain/units.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import {
  areaLabel as rawAreaLabel, hash01, label as rawLabel, roundRect,
} from "./primitives.js";

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

// ---- EL CIELO ES UN CONTINUO, no cuatro estados -----------------------------
//
// `apply()` sólo actuaba al cruzar una frontera de fase, así que el atardecer
// aparecía DE UN CUADRO AL OTRO. La hora siempre fue continua; ahora la paleta
// también, mezclando las dos fases vecinas — y la tormenta entra por el mismo
// camino en vez de ser un quinto caso, que es lo que hace que el cielo se
// CIERRE en vez de saltar.
//
// El resultado se cachea por (from, to, k) redondeado: cinco módulos llaman a
// `weatherColors()` por cuadro y mezclar siete colores cada vez, cinco veces, es
// trabajo que nadie ve. El paso de redondeo (1/64) es más fino que lo que
// distingue el ojo en un lavado de pantalla completa.
const _mixCache = new Map();

function _hex(v) {
  const n = parseInt(v.slice(1), 16);
  return v.length === 4
    ? [((n >> 8) & 15) * 17, ((n >> 4) & 15) * 17, (n & 15) * 17]
    : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function _rgba(v) {
  const parts = v.slice(v.indexOf("(") + 1, -1).split(",").map(Number);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}
//: Mezcla dos colores del registro. Acepta hex y `rgba()` porque `tint` es
//: rgba y todo lo demás es hex — y un tinte mezclado como si fuera opaco es la
//: pantalla en negro.
function mixColor(a, b, k) {
  if (a === b) return a;
  const isA = a.startsWith("rgba") || a.startsWith("rgb");
  if (isA || b.startsWith("rgba") || b.startsWith("rgb")) {
    const [ar, ag, ab, aa] = isA ? _rgba(a) : [..._hex(a), 1];
    const [br, bg, bb, ba] = b.startsWith("rgb") ? _rgba(b) : [..._hex(b), 1];
    const m = (x, y) => Math.round(x + (y - x) * k);
    return `rgba(${m(ar, br)},${m(ag, bg)},${m(ab, bb)},${(aa + (ba - aa) * k).toFixed(3)})`;
  }
  const [ar, ag, ab] = _hex(a), [br, bg, bb] = _hex(b);
  const m = (x, y) => Math.round(x + (y - x) * k);
  return `#${((1 << 24) | (m(ar, br) << 16) | (m(ag, bg) << 8) | m(ab, bb)).toString(16).slice(1)}`;
}

function weatherColors() {
  // The per-weather palette lives in the shared material registry: five modules
  // read it — this one for the sky, `ground.js` for the playas and the land
  // base, `estero.js` for the mangrove's shoreline, `canvas2d.js` for the tint
  // over the finished frame, and `water.js`, which DERIVES the entire living-sea
  // palette from `waterTop`/`waterBot` rather than authoring one.
  const W = MATERIALS.weather;
  const { from, to, k } = skyBlend();
  const a = W[from] || W.sunny;
  if (!(k > 0)) return a;
  const b = W[to] || a;
  if (a === b) return a;
  const step = Math.round(k * 64) / 64;
  const key = `${from}>${to}@${step}`;
  const had = _mixCache.get(key);
  if (had) return had;
  const out = {};
  for (const field of Object.keys(a)) out[field] = mixColor(a[field], b[field] ?? a[field], step);
  _mixCache.set(key, out);
  return out;
}


// ---- Drawing helpers ----
// `roundRect`, `hash01`, `label` and `areaLabel` MOVED TO `primitives.js` — the
// four things `shapes.js` needed from here, and the only reason the shape
// interpreter could not be imported without the whole game behind it. They are
// re-exported below at their historical signatures so nothing else changed.


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


// The two label wrappers: they bind the SHARED `ctx` so every drawer in this
// renderer keeps calling `label(x, y, …)` exactly as before. `primitives.js`
// takes the context as its first argument, which is what lets `shapes.js` label
// onto whatever surface its caller handed it.
function label(x, y, text, fg, bg, size = 10) {
  return rawLabel(ctx, x, y, text, fg, bg, size);
}
function areaLabel(x0, y0, x1, y1, text, fg, bg) {
  return rawAreaLabel(ctx, x0, y0, x1, y1, text, fg, bg);
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

// LA PARADITA used to be here, as raw Canvas calls. It is `props.parada` in
// world-props.json now, drawn by `c2d/props.js` — which cannot live in this file
// because gfx is the BOTTOM of the renderer and the shape interpreter sits on
// top of it.

export {
  ACERA_PX, CUAD, VIEW_WIDTH_PX, aabbInView, areaLabel, canvas, computeZoom,
  ctx, dpr, flatAABB, flatMultiPath, flatPath, hash01, label, lastT,
  parcelFrame, polyBBox, roundRect, setLastT, setupCanvas, weatherColors, ZOOM,
};
