import React, { useEffect, useState } from "react";
import { useT } from "../../i18n/index.js";

// Boot sequence (Hill-Climb style), shown on every launch:
//   phase 0 — Pacific Code Labs logo on dark navy (fade in/hold/out)
//   phase 1 — La Ruta del Churchill art + charge bar
// Tap advances a phase early. While it plays, attract mode streams the world
// behind it, so the charge bar covers real tile loading and the title screen
// appears instantly afterwards.
const LOGO_MS = 2200;
const LOAD_MS = 2400;

export default function BootScreen({ onDone }) {
  const t = useT();
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const tm = setTimeout(
      () => (phase === 0 ? setPhase(1) : onDone()),
      phase === 0 ? LOGO_MS : LOAD_MS
    );
    return () => clearTimeout(tm);
  }, [phase]);

  const skip = () => (phase === 0 ? setPhase(1) : onDone());

  return (
    <div className={"boot-screen" + (phase ? " load" : "")} onClick={skip}>
      {phase === 0 ? (
        <img className="boot-logo" src="/branding/pacific-code-labs.png" alt="Pacific Code Labs" />
      ) : (
        <>
          <img className="boot-art" src="/branding/ruta-churchill-loading.png" alt="La Ruta del Churchill" />
          <div className="boot-bar"><span style={{ animationDuration: LOAD_MS + "ms" }}></span></div>
          <div className="boot-loading">{t("boot.loading")}</div>
        </>
      )}
    </div>
  );
}
