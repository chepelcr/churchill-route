// One camera authority for every render backend.
//
// The simulation owns the unjittered target (`state.cam.x/y/rot/shake`). This
// module turns that target into ONE resolved frame: viewport, zoom, shake,
// affine projection and the rotated world-space cull box. Canvas2D, Pixi and
// Three receive that same record; none of them is allowed to roll its own
// random shake or reinterpret the camera independently.
import { state } from "../game/state.js";
import { tuning } from "../game/tuning.js";
import { MIN_ZOOM, VIEW_WIDTH_PX } from "../domain/units.js";

/** Responsive screen-pixels/world-pixel magnification. */
export function computeZoom(wCss, _hCss) {
  const framed = wCss / VIEW_WIDTH_PX;
  // Only a floor is clamped: a narrow screen shows less ground, never more.
  return Math.max(MIN_ZOOM, framed) * tuning.zoom;
}

/** Publish the viewport fields the simulation/input already read from cam. */
export function resizeCamera(wCss, hCss) {
  const zoom = computeZoom(wCss, hCss);
  state.cam.zoom = zoom;
  state.cam.vw = wCss;
  state.cam.vh = hCss;
  return zoom;
}

/**
 * Resolve one render frame. Call exactly once per game frame and share it.
 * `random` is injectable for small deterministic checks; production uses the
 * page's Math.random (the screenshot gate seeds that before mode startup).
 */
export function beginCameraFrame({
  viewportWidth = state.cam.vw || (typeof window !== "undefined" ? window.innerWidth : 1),
  viewportHeight = state.cam.vh || (typeof window !== "undefined" ? window.innerHeight : 1),
  padding = 40,
  random = Math.random,
} = {}) {
  const zoom = state.cam.zoom || computeZoom(viewportWidth, viewportHeight);
  const rotation = state.cam.rot || 0;
  const shake = state.cam.shake || 0;
  const shakeX = (random() - 0.5) * shake;
  const shakeY = (random() - 0.5) * shake;
  const x = state.cam.x + shakeX;
  const y = state.cam.y + shakeY;
  const worldWidth = viewportWidth / zoom;
  const worldHeight = viewportHeight / zoom;

  // The visible region is a rotated rectangle. Its AABB is the culling
  // contract shared by all layers; padding covers sprites that overhang it.
  const c = Math.cos(-rotation), s = Math.sin(-rotation);
  const hx = worldWidth / 2, hy = worldHeight / 2;
  const xs = [], ys = [];
  for (const [px, py] of [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]) {
    xs.push(x + px * c - py * s);
    ys.push(y + px * s + py * c);
  }
  const view = {
    x0: Math.min(...xs) - padding,
    x1: Math.max(...xs) + padding,
    y0: Math.min(...ys) - padding,
    y1: Math.max(...ys) + padding,
  };

  // Keep the historical fields for console diagnostics and old experiments,
  // but they are outputs now: another renderer must not generate them again.
  state.cam._sx = shakeX;
  state.cam._sy = shakeY;

  return {
    x, y, zoom, rotation, shakeX, shakeY,
    viewportWidth, viewportHeight, worldWidth, worldHeight, view,
  };
}

/** Canvas-compatible [a,b,c,d,e,f], including device-pixel scaling. */
export function cameraAffine(frame, dpr = 1) {
  const c = Math.cos(frame.rotation), s = Math.sin(frame.rotation);
  const z = frame.zoom;
  return [
    dpr * z * c,
    dpr * z * s,
    -dpr * z * s,
    dpr * z * c,
    dpr * (frame.viewportWidth / 2 - z * c * frame.x + z * s * frame.y),
    dpr * (frame.viewportHeight / 2 - z * s * frame.x - z * c * frame.y),
  ];
}

/** Project a ground-plane point into CSS screen pixels. */
export function worldToScreen(frame, worldX, worldY) {
  const c = Math.cos(frame.rotation), s = Math.sin(frame.rotation);
  const dx = worldX - frame.x, dy = worldY - frame.y;
  return [
    frame.viewportWidth / 2 + frame.zoom * (c * dx - s * dy),
    frame.viewportHeight / 2 + frame.zoom * (s * dx + c * dy),
  ];
}

export { VIEW_WIDTH_PX };
