import React, { useRef, useEffect } from "react";
import { Game } from "../game/index.js";
import Icon from "./Icon.jsx";

// One-finger point-to-drive: steering + throttle come from holding a finger
// on the play area (the canvas, attached by Game.attachCanvas) — the car
// steers toward it, its distance sets the speed, very far = turbo. Only the
// brake needs an on-screen pedal.
export default function TouchControls() {
  const brakeRef = useRef(null);
  useEffect(() => { Game.attachTouch(brakeRef.current); }, []);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) return null;
  return (
    <div className="touch-controls">
      <div ref={brakeRef} className="pedal brake"><Icon name="hand" size={30} /></div>
    </div>
  );
}
