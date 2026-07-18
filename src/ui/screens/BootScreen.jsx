import React, { useEffect, useState } from "react";
import { useT } from "../../i18n/index.js";

// Boot sequence (Hill-Climb style), shown on every launch:
//   phase 0 — Pacific Code Labs logo on dark navy (fade in/hold/out)
//   phase 1 — La Ruta del Churchill art + charge bar (staggered entrance)
//   out     — the whole screen fades away, revealing the attract world
// Tap advances a phase early. While it plays, attract mode streams the world
// behind it, so the charge bar covers real tile loading.
//
// On mobile web the sequence HOLDS (dark screen, no timers) while the rotate
// overlay is up — same media query — and starts fresh once the phone is
// rotated to landscape, so nobody misses the logos behind the overlay.
const HOLD_MQ = "(pointer: coarse) and (orientation: portrait)";
const LOGO_MS = 2400;
const LOAD_MS = 2600;
const OUT_MS = 500;

export default function BootScreen({ onDone }) {
  const t = useT();
  const [hold, setHold] = useState(() => typeof window !== "undefined" && window.matchMedia(HOLD_MQ).matches);
  const [phase, setPhase] = useState(0); // 0 = logo, 1 = charge screen
  const [out, setOut] = useState(false); // final fade-out before onDone

  useEffect(() => {
    const mq = window.matchMedia(HOLD_MQ);
    const on = () => setHold(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
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

  return (
    <div className={"boot-screen" + (phase ? " load" : "") + (out ? " out" : "")} onClick={skip}>
      {!hold && (phase === 0 ? (
        <img className="boot-logo" src="/branding/pacific-code-labs.png" alt="Pacific Code Labs" />
      ) : (
        <>
          <img className="boot-art" src="/branding/ruta-churchill-loading.png" alt="La Ruta del Churchill" />
          <div className="boot-bar">
            <span style={{ animationDuration: (LOAD_MS - 350) + "ms", animationDelay: "300ms" }}></span>
          </div>
          <div className="boot-loading">{t("boot.loading")}</div>
        </>
      ))}
    </div>
  );
}
