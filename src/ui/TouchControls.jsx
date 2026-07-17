import React, { useRef, useEffect } from "react";
import { Game } from "../game/index.js";

// Touch controls v3: a FIXED, always-visible joystick (bottom-left) steers —
// direction only. Speed comes from a second finger on the play area (its
// distance to the vehicle = throttle; very far = turbo), attached to the
// canvas by Game.attachCanvas. Brake ✋ stays a pedal.
export default function TouchControls() {
  const brakeRef = useRef(null), baseRef = useRef(null), knobRef = useRef(null);
  useEffect(() => {
    Game.attachTouch(brakeRef.current);
    Game.attachJoystick(baseRef.current, knobRef.current);
  }, []);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) return null;
  return (
    <div className="touch-controls">
      <div ref={baseRef} className="joy-fixed">
        <div className="joy-ring" />
        <div ref={knobRef} className="joy-knob" />
      </div>
      <div ref={brakeRef} className="pedal brake">✋</div>
    </div>
  );
}
