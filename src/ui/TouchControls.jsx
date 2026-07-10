import React, { useRef, useEffect } from "react";
import { Game } from "../game/index.js";

// Point-to-drive: steering/throttle come from holding a finger on the play
// area (attachAim on the canvas). Only the brake/drift and turbo pedals need
// on-screen buttons.
export default function TouchControls() {
  const brakeRef = useRef(null), boostRef = useRef(null);
  useEffect(() => { Game.attachTouch(brakeRef.current, boostRef.current); }, []);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) return null;
  return (
    <div className="touch-controls">
      <div ref={brakeRef} className="pedal brake">✋</div>
      <div ref={boostRef} className="pedal boost">⚡</div>
    </div>
  );
}
