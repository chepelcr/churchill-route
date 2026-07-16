// Input: keyboard, gamepad and touch. Exposes the shared `input` axis object
// that physics reads each frame. Touch is a one-finger virtual JOYSTICK
// (attachJoystick): the stick angle steers, the stick extension is a speed
// delimiter (short push = cruise, full push = top speed) and pushing PAST the
// rim engages the turbo — so mobile needs no turbo button, only brake.

export const keys = {};
// `limit` caps the vehicle top speed (0..1); keyboard/gamepad leave it at 1,
// the joystick lowers it with a short stick push.
export const input = { up: 0, down: 0, left: 0, right: 0, brake: 0, boost: 0, limit: 1 };

// One joystick finger tracked by touch identifier so a second finger can hold
// the brake pedal at the same time. Coordinates are client (screen) px.
const joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
const JOY_R = 64;        // stick extension (css px) for full throttle
const JOY_BOOST_R = 96;  // push past this to engage the turbo
let touchBrake = false;

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
  input.limit = 1;
  if (touchBrake) input.brake = 1;
}

// Joystick → axes. Runs after readInput so it max-merges with keyboard/
// gamepad. The stick works in SCREEN space, and the camera transform is a
// uniform scale+translate, so a screen angle IS a world angle: steer the car
// toward the stick direction.
export function applyTouchJoystick(p) {
  if (!joy.active) return;
  const mag = Math.hypot(joy.dx, joy.dy);
  if (mag < 10) return;                                // dead zone: coast
  let e = Math.atan2(joy.dy, joy.dx) - p.a;
  e = Math.atan2(Math.sin(e), Math.cos(e));            // shortest angle diff
  const steer = Math.max(-1, Math.min(1, e / 0.35));   // full lock past ~20°
  if (steer > 0) input.right = Math.max(input.right, steer);
  else input.left = Math.max(input.left, -steer);
  const m01 = Math.min(1, mag / JOY_R);                // stick extension 0..1
  const thr = m01 * (0.35 + 0.65 * Math.max(0, Math.cos(e))); // behind = slow U-turn
  input.up = Math.max(input.up, thr);
  input.limit = Math.min(input.limit, 0.45 + 0.55 * m01);     // finger = speed cap
  if (mag > JOY_BOOST_R) input.boost = 1;                     // past the rim = turbo
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

// Dynamic-origin joystick: the stick base appears where the finger lands in
// the zone (left side of the screen), the knob follows the finger, clamped to
// the boost rim. The zone claims ONE finger; the brake pedal keeps its own.
export function attachJoystick(zoneEl, baseEl, knobEl) {
  if (!zoneEl) return;
  const paint = () => {
    if (!baseEl) return;
    baseEl.style.display = joy.active ? "" : "none";
    baseEl.style.left = `${joy.ox}px`;
    baseEl.style.top = `${joy.oy}px`;
    if (knobEl) {
      const mag = Math.hypot(joy.dx, joy.dy);
      const k = mag > JOY_BOOST_R ? JOY_BOOST_R / mag : 1;
      knobEl.style.transform = `translate(calc(${joy.dx * k}px - 50%), calc(${joy.dy * k}px - 50%))`;
      knobEl.classList.toggle("turbo", mag > JOY_BOOST_R);
    }
  };
  zoneEl.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (joy.id === null && e.changedTouches.length) {
      const t = e.changedTouches[0];
      joy.id = t.identifier; joy.active = true;
      joy.ox = t.clientX; joy.oy = t.clientY; joy.dx = joy.dy = 0;
      paint();
    }
  }, { passive: false });
  const track = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        joy.dx = t.clientX - joy.ox; joy.dy = t.clientY - joy.oy;
        paint();
      }
    }
  };
  const release = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) { joy.id = null; joy.active = false; joy.dx = joy.dy = 0; paint(); }
    }
  };
  zoneEl.addEventListener("touchmove", track, { passive: true });
  zoneEl.addEventListener("touchend", release);
  zoneEl.addEventListener("touchcancel", release);
  paint();
}

export function attachTouch(brakeEl) {
  const bind = (el, set) => {
    if (!el) return;
    el.addEventListener("touchstart", (e) => { e.preventDefault(); set(true); }, { passive: false });
    el.addEventListener("touchend", () => set(false));
    el.addEventListener("touchcancel", () => set(false));
  };
  bind(brakeEl, (v) => { touchBrake = v; });
}
