// Input: keyboard, gamepad and touch. Exposes the shared `input` axis object
// that physics reads each frame, plus attachTouch() for the on-screen controls.

export const keys = {};
export const input = { up: 0, down: 0, left: 0, right: 0, brake: 0, boost: 0 };

let touchJoy = { active: false, dx: 0, dy: 0 };
let touchGas = false, touchBrake = false;

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
  if (touchJoy.active) {
    const dx = touchJoy.dx, dy = touchJoy.dy;
    if (Math.abs(dx) > 6) { if (dx > 0) input.right = Math.min(1, dx / 40); else input.left = Math.min(1, -dx / 40); }
    if (Math.abs(dy) > 6) { if (dy < 0) input.up = Math.min(1, -dy / 40); else input.down = Math.min(1, dy / 40); }
  }
  if (touchGas) input.up = 1;
  if (touchBrake) input.brake = 1;
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

export function attachTouch(joyEl, gasEl, brakeEl) {
  if (joyEl) {
    const upd = (e) => {
      const t = e.touches ? e.touches[0] : e;
      if (!t) return;
      const r = joyEl.getBoundingClientRect();
      touchJoy.active = true;
      touchJoy.dx = t.clientX - (r.left + r.width / 2);
      touchJoy.dy = t.clientY - (r.top + r.height / 2);
    };
    joyEl.addEventListener("touchstart", upd); joyEl.addEventListener("touchmove", upd);
    joyEl.addEventListener("touchend", () => { touchJoy.active = false; touchJoy.dx = touchJoy.dy = 0; });
  }
  if (gasEl) { gasEl.addEventListener("touchstart", () => touchGas = true); gasEl.addEventListener("touchend", () => touchGas = false); }
  if (brakeEl) { brakeEl.addEventListener("touchstart", () => touchBrake = true); brakeEl.addEventListener("touchend", () => touchBrake = false); }
}
