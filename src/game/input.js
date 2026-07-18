// Input: keyboard, gamepad and touch. Exposes the shared `input` axis object
// that physics reads each frame. Touch is ONE-FINGER point-to-drive (the
// original scheme, back by popular demand): hold a finger on the play area
// and the car steers TOWARD it; the finger's distance to the vehicle is the
// throttle — near = slow, far = fast, very far = TURBO. Brake ✋ is a pedal.

export const keys = {};
// snapT: brief "go THERE now" window opened when the drive finger is lifted and
// placed again — tighter steering + extra turn authority (physics reads it).
// While the finger is merely held, the base drift feel is untouched.
export const input = { up: 0, down: 0, left: 0, right: 0, brake: 0, boost: 0, snapT: 0 };

// drive finger (canvas) — distance mapping in css px
const THR_DEAD = 30;    // closer than this = coast
const THR_FULL = 170;   // this far = full throttle
const THR_TURBO = 235;  // beyond this = turbo

const aim = { active: false, id: null, x: 0, y: 0 };          // drive finger
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
// Point-to-drive: the camera transform is a uniform scale+translate, so a
// screen angle IS a world angle — project the car to screen, steer toward
// the finger, throttle by distance (behind-the-car damping keeps U-turns
// controllable), turbo past the far threshold.
export function applyTouch(cam, p) {
  if (!aim.active) return;
  const zoom = cam.zoom || 5.5;
  const vw = cam.vw || window.innerWidth, vh = cam.vh || window.innerHeight;
  const sx = (p.x - cam.x) * zoom + vw / 2;
  const sy = (p.y - cam.y) * zoom + vh / 2;
  const dx = aim.x - sx, dy = aim.y - sy;
  const d = Math.hypot(dx, dy);
  if (d < THR_DEAD) return;                            // dead zone: coast
  let e = Math.atan2(dy, dx) - p.a;
  e = Math.atan2(Math.sin(e), Math.cos(e));            // shortest angle diff
  const snap = input.snapT > 0;
  if (snap && Math.abs(e) < 0.2) input.snapT = 0;      // facing the finger: snap done
  const steer = Math.max(-1, Math.min(1, e / (snap ? 0.28 : 0.35))); // full lock past ~16°/20°
  if (steer > 0) input.right = Math.max(input.right, steer);
  else input.left = Math.max(input.left, -steer);
  let thr = Math.min(1, (d - THR_DEAD) / (THR_FULL - THR_DEAD));
  thr *= snap ? 0.55 + 0.45 * Math.max(0, Math.cos(e)) // snap: keep pace through the pivot
              : 0.35 + 0.65 * Math.max(0, Math.cos(e)); // held: behind = slow U-turn (drift feel)
  input.up = Math.max(input.up, thr);
  if (d > THR_TURBO && Math.cos(e) > 0.3) input.boost = 1; // far & ahead = turbo
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

// The drive finger lives on the play canvas (below all UI), so HUD buttons
// and the brake pedal never fight it.
export function attachThrottle(canvasEl) {
  if (!canvasEl) return;
  canvasEl.addEventListener("touchstart", (e) => {
    e.preventDefault();
    if (aim.id === null && e.changedTouches.length) {
      const t = e.changedTouches[0];
      aim.id = t.identifier; aim.active = true;
      aim.x = t.clientX; aim.y = t.clientY;
      input.snapT = 0.6; // fresh finger = snap-turn window
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

export function attachTouch(brakeEl) {
  const bind = (el, set) => {
    if (!el) return;
    el.addEventListener("touchstart", (e) => { e.preventDefault(); set(true); }, { passive: false });
    el.addEventListener("touchend", () => set(false));
    el.addEventListener("touchcancel", () => set(false));
  };
  bind(brakeEl, (v) => { touchBrake = v; });
}
