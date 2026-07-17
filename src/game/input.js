// Input: keyboard, gamepad and touch. Exposes the shared `input` axis object
// that physics reads each frame. Touch scheme (v3, user-confirmed):
//  - LEFT thumb: a FIXED joystick (always visible, bottom-left) that controls
//    DIRECTION ONLY — the car steers toward the stick angle.
//  - RIGHT finger: touch the play area (the canvas); the finger's screen
//    DISTANCE to the vehicle is the throttle — near = slow, far = fast, and
//    very far engages the TURBO (button-free), like the original
//    point-to-drive throttle.
//  - Brake ✋ stays a pedal.

export const keys = {};
export const input = { up: 0, down: 0, left: 0, right: 0, brake: 0, boost: 0 };

// throttle finger (canvas) — distance mapping in css px
const THR_DEAD = 36;    // closer than this = coast
const THR_FULL = 170;   // this far = full throttle
const THR_TURBO = 235;  // beyond this = turbo

const joy = { active: false, id: null, dx: 0, dy: 0, r: 56 }; // fixed stick
const aim = { active: false, id: null, x: 0, y: 0 };          // throttle finger
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
  if (touchBrake) input.brake = 1;
}

// Touch → axes, run after readInput (max-merges with keyboard/gamepad).
// The camera transform is a uniform scale+translate, so a screen angle IS a
// world angle: steer toward the joystick direction; throttle from the aim
// finger's screen distance to the (projected) vehicle.
export function applyTouch(cam, p) {
  // steering: fixed joystick, direction only
  if (joy.active) {
    const mag = Math.hypot(joy.dx, joy.dy);
    if (mag > 10) {
      let e = Math.atan2(joy.dy, joy.dx) - p.a;
      e = Math.atan2(Math.sin(e), Math.cos(e));          // shortest angle diff
      const steer = Math.max(-1, Math.min(1, e / 0.35)); // full lock past ~20°
      if (steer > 0) input.right = Math.max(input.right, steer);
      else input.left = Math.max(input.left, -steer);
    }
  }
  // throttle: aim finger distance to the vehicle on screen
  if (aim.active) {
    const zoom = cam.zoom || 5.5;
    const vw = cam.vw || window.innerWidth, vh = cam.vh || window.innerHeight;
    const sx = (p.x - cam.x) * zoom + vw / 2;
    const sy = (p.y - cam.y) * zoom + vh / 2;
    const d = Math.hypot(aim.x - sx, aim.y - sy);
    if (d >= THR_DEAD) {
      const thr = Math.min(1, (d - THR_DEAD) / (THR_FULL - THR_DEAD));
      input.up = Math.max(input.up, thr);
      if (d > THR_TURBO) input.boost = 1;               // far finger = turbo
    }
  }
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

// The throttle finger lives on the play canvas (below all UI, exactly like
// the original point-to-drive), so buttons/joystick never fight it.
export function attachThrottle(canvasEl) {
  if (!canvasEl) return;
  canvasEl.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (aim.id === null && e.changedTouches.length) {
      const t = e.changedTouches[0];
      aim.id = t.identifier; aim.active = true;
      aim.x = t.clientX; aim.y = t.clientY;
    }
  }, { passive: false });
  const track = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === aim.id) { aim.x = t.clientX; aim.y = t.clientY; }
    }
  };
  const release = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === aim.id) { aim.id = null; aim.active = false; }
    }
  };
  canvasEl.addEventListener("touchmove", track, { passive: true });
  canvasEl.addEventListener("touchend", release);
  canvasEl.addEventListener("touchcancel", release);
}

// Fixed joystick: the base never moves; the knob follows the finger clamped
// to the ring radius. Direction only — extension is NOT speed.
export function attachJoystick(baseEl, knobEl) {
  if (!baseEl) return;
  const paint = () => {
    if (!knobEl) return;
    const mag = Math.hypot(joy.dx, joy.dy);
    const k = mag > joy.r ? joy.r / mag : 1;
    knobEl.style.transform = `translate(calc(${joy.dx * k}px - 50%), calc(${joy.dy * k}px - 50%))`;
    knobEl.classList.toggle("active", joy.active);
  };
  const center = () => {
    const r = baseEl.getBoundingClientRect();
    joy.r = r.width * 0.42;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  baseEl.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (joy.id === null && e.changedTouches.length) {
      const t = e.changedTouches[0], c = center();
      joy.id = t.identifier; joy.active = true;
      joy.dx = t.clientX - c.x; joy.dy = t.clientY - c.y;
      paint();
    }
  }, { passive: false });
  const track = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) {
        const c = center();
        joy.dx = t.clientX - c.x; joy.dy = t.clientY - c.y;
        paint();
      }
    }
  };
  const release = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joy.id) { joy.id = null; joy.active = false; joy.dx = joy.dy = 0; paint(); }
    }
  };
  // track/release on window so a finger sliding OFF the stick keeps steering
  window.addEventListener("touchmove", track, { passive: true });
  window.addEventListener("touchend", release);
  window.addEventListener("touchcancel", release);
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
