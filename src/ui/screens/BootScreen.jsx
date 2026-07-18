import React, { useEffect, useRef, useState } from "react";
import { Application, Graphics } from "pixi.js";
import { useT } from "../../i18n/index.js";

// Boot sequence (Hill-Climb style), shown on every launch:
//   phase 0 — Pacific Code Labs logo over a LIVE PIXI WATER backdrop (the same
//             gradient + drifting sine shimmer the in-game gulf uses)
//   phase 1 — La Ruta del Churchill art + charge bar with the muelle ferry
//             riding the fill edge
//   out     — the whole screen fades away, revealing the attract world
// Tap advances a phase early. On mobile web the sequence HOLDS while the
// rotate overlay is up (same media query) and starts fresh once rotated.
const HOLD_MQ = "(pointer: coarse) and (orientation: portrait)";
const LOGO_MS = 2400;
const LOAD_MS = 2600;
const OUT_MS = 500;

export default function BootScreen({ onDone }) {
  const t = useT();
  const waterRef = useRef(null);
  const [hold, setHold] = useState(() => typeof window !== "undefined" && window.matchMedia(HOLD_MQ).matches);
  const [phase, setPhase] = useState(0); // 0 = logo, 1 = charge screen
  const [out, setOut] = useState(false); // final fade-out before onDone

  useEffect(() => {
    const mq = window.matchMedia(HOLD_MQ);
    const on = () => setHold(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Pixi water behind the whole boot sequence — same recipe as the game's
  // drawWaterAll: navy gradient (CSS) + sine shimmer polylines drifting.
  useEffect(() => {
    let app = null, destroyed = false;
    (async () => {
      try {
        const a = new Application();
        await a.init({
          canvas: waterRef.current, resizeTo: window, backgroundAlpha: 0,
          antialias: true, preference: "webgl",
        });
        if (destroyed) { a.destroy(true); return; }
        app = a;
        const g = new Graphics();
        a.stage.addChild(g);
        a.ticker.add(() => {
          const w = a.screen.width, h = a.screen.height;
          const tt = performance.now() * 0.0006;
          g.clear();
          for (let yy = 8; yy < h + 30; yy += 34) {
            g.moveTo(-12, yy);
            for (let xx = 0; xx < w + 24; xx += 24) {
              g.lineTo(xx, yy + Math.sin(tt + xx * 0.03 + yy * 0.03) * 4);
            }
            g.stroke({ width: 1.5, color: 0xffffff, alpha: 0.13 });
          }
        });
      } catch { /* no WebGL: the CSS gradient alone is fine */ }
    })();
    return () => { destroyed = true; try { app && app.destroy(true); } catch { /* torn down */ } };
  }, []);

  useEffect(() => {
    if (hold) return; // portrait on mobile: freeze until rotated
    const tm = out
      ? setTimeout(onDone, OUT_MS)
      : setTimeout(() => (phase === 0 ? setPhase(1) : setOut(true)), phase === 0 ? LOGO_MS : LOAD_MS);
    return () => clearTimeout(tm);
  }, [hold, phase, out]);

  const skip = () => {
    if (hold || out) return;
    if (phase === 0) setPhase(1); else setOut(true);
  };

  const barAnim = { animationDuration: (LOAD_MS - 350) + "ms", animationDelay: "300ms" };

  return (
    <div className={"boot-screen" + (phase ? " load" : "") + (out ? " out" : "")} onClick={skip}>
      <canvas ref={waterRef} className="boot-water" aria-hidden="true"></canvas>
      {!hold && (phase === 0 ? (
        <img className="boot-logo" src="/branding/pacific-code-labs.png" alt="Pacific Code Labs" />
      ) : (
        <>
          <img className="boot-art" src="/branding/ruta-churchill-loading.png" alt="La Ruta del Churchill" />
          <div className="boot-bar-wrap">
            <div className="boot-bar"><span style={barAnim}></span></div>
            {/* the muelle ferry rides the fill edge (same art as drawBoat) */}
            <div className="boot-boat" style={barAnim}>
              <svg width="54" height="26" viewBox="0 0 54 26" aria-hidden="true">
                <rect x="0" y="15" width="24" height="2" fill="rgba(255,255,255,0.4)" />
                <rect x="20" y="8" width="32" height="8" rx="1.5" fill="#fff" />
                <rect x="20" y="13" width="32" height="3" fill="#3a3540" />
                <rect x="33" y="2" width="6" height="8" rx="1" fill="#e85d75" />
              </svg>
            </div>
          </div>
          <div className="boot-loading">{t("boot.loading")}</div>
        </>
      ))}
    </div>
  );
}
