import React, { useRef, useEffect } from "react";
import { Game } from "../game/index.js";

export default function TouchControls() {
  const joyRef = useRef(null), gasRef = useRef(null), brakeRef = useRef(null);
  useEffect(() => { Game.attachTouch(joyRef.current, gasRef.current, brakeRef.current); }, []);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) return null;
  return (
    <div className="touch-controls">
      <div ref={joyRef} className="joy"></div>
      <div ref={brakeRef} className="pedal brake">✋</div>
      <div ref={gasRef} className="pedal gas">▶</div>
    </div>
  );
}
