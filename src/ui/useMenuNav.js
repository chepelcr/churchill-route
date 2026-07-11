// Menu navigation: arrows/Enter/Escape + gamepad dpad/stick/A/B drive a
// focused index over a (possibly grid-shaped) list of menu items. The game's
// pollGamepad only runs while state.running, so menus own the pad here —
// with edge detection and a repeat gate, which driving input doesn't need.
import { useState, useEffect, useRef } from "react";
import { sfx } from "../game/audio.js";

const REPEAT_MS = 220;

export function useMenuNav({ count, cols = 1, onSelect, onBack }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef({});
  ref.current = { idx, count, cols, onSelect, onBack };

  useEffect(() => {
    const move = (dir) => {
      const { idx, count, cols } = ref.current;
      const delta = dir === "left" ? -1 : dir === "right" ? 1 : dir === "up" ? -cols : cols;
      const next = Math.max(0, Math.min(count - 1, idx + delta));
      if (next !== idx) { setIdx(next); sfx.play("menu_move"); }
      return next !== idx;
    };

    const onKey = (e) => {
      const k = e.key;
      const dir = k === "ArrowLeft" ? "left" : k === "ArrowRight" ? "right"
                : k === "ArrowUp" ? "up" : k === "ArrowDown" ? "down" : null;
      if (dir) { e.preventDefault(); move(dir); return; }
      if (k === "Enter" || k === " ") { e.preventDefault(); ref.current.onSelect?.(ref.current.idx); }
      else if (k === "Escape" || k === "Backspace") { e.preventDefault(); ref.current.onBack?.(); }
    };
    window.addEventListener("keydown", onKey);

    // Gamepad: edge-detect + hold-repeat
    let raf, prev = {}, lastMove = 0;
    const poll = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const p = Array.from(pads).find(Boolean);
      if (p) {
        const now = performance.now();
        const pressed = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
        const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
        const dirs = {
          left: pressed(14) || ax < -0.5, right: pressed(15) || ax > 0.5,
          up: pressed(12) || ay < -0.5, down: pressed(13) || ay > 0.5,
        };
        for (const d in dirs) {
          if (dirs[d] && (!prev[d] || now - lastMove > REPEAT_MS)) { move(d); lastMove = now; }
          prev[d] = dirs[d];
        }
        const a = pressed(0), b = pressed(1);
        if (a && !prev.a) ref.current.onSelect?.(ref.current.idx);
        if (b && !prev.b) ref.current.onBack?.();
        prev.a = a; prev.b = b;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);

    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(raf); };
  }, []);

  return [idx, setIdx];
}
