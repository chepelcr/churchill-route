// Input: keyboard, gamepad and touch. Exposes the shared `input` axis object
// that physics reads each frame. Touch is "point-to-drive": hold a finger on
// the play area and the car steers toward it (attachAim + applyTouchAim),
// plus on-screen brake/boost pedals (attachTouch).

export const keys = {};
export const input = { up: 0, down: 0, left: 0, right: 0, brake: 0, boost: 0 };

// One aim finger tracked by touch identifier so a second finger can hold the
// brake/boost pedals at the same time. Coordinates are client (screen) px.
const touchAim = { active: false, x: 0, y: 0, id: null };
let touchBrake = false, touchBoost = false;

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    keys[e.key.toLowerCase()] = true;
    if ([" ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) e.preventDefault();
  });
  window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
}

export function readInput() {
  input.up    = (keys.w || keys.arrowup) ? 1 : 0;
  input.down  = (keys.s || keys.arrowdown) ? 1 : 0;
  input.left  = (keys.a || keys.arrowleft) ? 1 : 0;
  input.right = (keys.d || keys.arrowright) ? 1 : 0;
  input.brake = (keys[" "] || keys.shift) ? 1 : 0;
  input.boost = (keys.x) ? 1 : 0;
  if (touchBrake) input.brake = 1;
  if (touchBoost) input.boost = 1;
}

// Point-to-drive: steer the car toward the held finger. Runs after readInput
// so it max-merges with keyboard/gamepad. Works in SCREEN space (the camera
// transform is uniform scale+translate, so angles are preserved) — the car is
// projected to screen because the camera leads it (lookahead ≠ center).
export function applyTouchAim(cam, p) {
  if (!touchAim.active || !cam.zoom) return;
  const sx = (p.x - cam.x) * cam.zoom + cam.vw / 2;
  const sy = (p.y - cam.y) * cam.zoom + cam.vh / 2;
  const dx = touchAim.x - sx, dy = touchAim.y - sy;
  const d = Math.hypot(dx, dy);
  if (d < 24) return;                                  // dead zone: coast
  let e = Math.atan2(dy, dx) - p.a;
  e = Math.atan2(Math.sin(e), Math.cos(e));            // shortest angle diff
  const steer = Math.max(-1, Math.min(1, e / 0.35));   // full lock past ~20°
  if (steer > 0) input.right = Math.max(input.right, steer);
  else input.left = Math.max(input.left, -steer);
  let thr = Math.max(0, Math.min(1, (d - 48) / 96));   // far finger = faster
  thr *= 0.35 + 0.65 * Math.max(0, Math.cos(e));       // behind = slow U-turn
  input.up = Math.max(input.up, thr);
}

export function pollGamepad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (!p) continue;
    const lx = p.axes[0] || 0, ly = p.axes[1] || 0;
    if (Math.abs(lx) > 0.15) { if (lx > 0) input.right = Math.max(input.right, lx); else input.left = Math.max(input.left, -lx); }
    if (Math.abs(ly) > 0.15) { if (ly < 0) input.up = Math.max(input.up, -ly); else input.down = Math.max(input.down, ly); }
    if (p.buttons[0] && p.buttons[0].pressed) input.up = 1;
    if (p.buttons[2] && p.buttons[2].pressed) input.brake = 1;
    if (p.buttons[7] && p.buttons[7].value) input.up = Math.max(input.up, p.buttons[7].value);
    if (p.buttons[5] && p.buttons[5].pressed) input.boost = 1;
    break;
  }
}

// Claim ONE finger on the play canvas as the aim finger; pedals keep their
// own fingers (touches starting on a pedal never reach the canvas).
export function attachAim(canvasEl) {
  if (!canvasEl) return;
  canvasEl.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (touchAim.id === null && e.changedTouches.length) {
      const t = e.changedTouches[0];
      touchAim.id = t.identifier;
      touchAim.active = true;
      touchAim.x = t.clientX; touchAim.y = t.clientY;
    }
  }, { passive: false });
  const track = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchAim.id) { touchAim.x = t.clientX; touchAim.y = t.clientY; }
    }
  };
  const release = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchAim.id) { touchAim.id = null; touchAim.active = false; }
    }
  };
  canvasEl.addEventListener("touchmove", track, { passive: true });
  canvasEl.addEventListener("touchend", release);
  canvasEl.addEventListener("touchcancel", release);
}

export function attachTouch(brakeEl, boostEl) {
  const bind = (el, set) => {
    if (!el) return;
    el.addEventListener("touchstart", (e) => { e.preventDefault(); set(true); }, { passive: false });
    el.addEventListener("touchend", () => set(false));
    el.addEventListener("touchcancel", () => set(false));
  };
  bind(brakeEl, (v) => { touchBrake = v; });
  bind(boostEl, (v) => { touchBoost = v; });
}
