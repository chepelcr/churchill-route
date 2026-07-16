import React, { useRef, useEffect } from "react";
import { Game } from "../game/index.js";

// One-finger virtual joystick (left zone): stick angle steers, stick extension
// caps the speed, pushing past the rim engages the turbo. Only the brake needs
// an on-screen pedal.
export default function TouchControls() {
  const brakeRef = useRef(null), zoneRef = useRef(null), baseRef = useRef(null), knobRef = useRef(null);
  useEffect(() => {
    Game.attachTouch(brakeRef.current);
    Game.attachJoystick(zoneRef.current, baseRef.current, knobRef.current);
  }, []);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) return null;
  return (
    <div className="touch-controls">
      <div ref={zoneRef} className="joy-zone">
        <div ref={baseRef} className="joy-base" style={{ display: "none" }}>
          <div className="joy-ring" />
          <div ref={knobRef} className="joy-knob" />
        </div>
      </div>
      <div ref={brakeRef} className="pedal brake">✋</div>
    </div>
  );
}
