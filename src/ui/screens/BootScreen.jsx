import React, { useEffect, useRef, useState } from "react";
import { Application, Graphics } from "pixi.js";
import { useT } from "../../i18n/index.js";
import { sfx } from "../../game/audio.js";
import { UI_SCREEN } from "../../domain/vocabulary.generated.js";
import Slots from "../Slots.jsx";
import BrandTitle from "../BrandTitle.jsx";
import Ferry from "../../../brand/Ferry.jsx";
import pacificLogo from "../../assets/branding/pacific-code-labs-reverse.webp?inline";
import churchillLogo from "../../assets/branding/churchill-boot.webp?inline";
import identity from "../../../brand/identity.json";

// Boot sequence (Hill-Climb style), shown on every launch:
//   phase 0 — Pacific Code Labs logo over a LIVE PIXI WATER backdrop (the same
//             gradient + drifting sine shimmer the in-game gulf uses)
//   phase 1 — La Ruta del Churchill title + charge bar with the muelle ferry
//             riding the fill edge
//   out     — the whole screen fades away, revealing the attract world
// The sequence plays in full once the rotate prompt is cleared.
const LOGO_MS = 2400;
const LOAD_MS = 2600;
const OUT_MS = 500;

export default function BootScreen({ hold, onDone }) {
  const t = useT();
  const waterRef = useRef(null);
  const [phase, setPhase] = useState(0); // 0 = logo, 1 = charge screen
  const [out, setOut] = useState(false); // final fade-out before onDone

  useEffect(() => {
    // Download the title face during the studio phase without delaying boot.
    const face = getComputedStyle(document.documentElement).getPropertyValue("--font-display");
    document.fonts?.load(`400 1em ${face}`, identity.titleLines.join(" ")).catch(() => {});
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
    if (hold) return;
    const tm = out
      ? setTimeout(onDone, OUT_MS)
      : setTimeout(() => (phase === 0 ? setPhase(1) : setOut(true)), phase === 0 ? LOGO_MS : LOAD_MS);
    return () => clearTimeout(tm);
  }, [hold, phase, out]);

  // The ferry pulls out of the muelle as the puerto loads: one short blast,
  // one long. Autoplay policy silently drops any sound before the first
  // gesture, so if the context has not unlocked yet we arm it for the next
  // tap/key — and only while THIS screen is up, so the horn can never honk
  // later out of context.
  useEffect(() => {
    if (phase !== 1 || hold) return;
    if (sfx.ready) { sfx.play("horn"); return; }
    let done = false;
    const onGesture = () => {
      if (done) return;
      done = true;
      // the audio module's own listener unlocks on this same gesture; let it
      // land first, then sound
      setTimeout(() => sfx.play("horn"), 60);
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("touchend", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      done = true;
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("touchend", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [phase, hold]);

  const barAnim = { animationDuration: (LOAD_MS - 350) + "ms", animationDelay: "300ms" };

  // EL AGUA NO ES UN SLOT: es el fondo de toda la secuencia, está en las dos
  // fases y no hay ninguna decisión por pantalla en ella — un registro que la
  // listara estaría describiendo el marco como si fuera contenido, la misma
  // línea que la fila de herramientas de `title`. Lo que sí son bloques son las
  // dos pantallas que la secuencia muestra encima.
  const SLOTS = {
    logo: () => (
      <img className="boot-logo" src={pacificLogo} alt={identity.studio} />
    ),
    art: () => (
      <div className="boot-lockup">
        <img className="boot-emblem" src={churchillLogo} width="224" height="224" alt="" />
        <BrandTitle className="boot-title brand-title--plain" />
      </div>
    ),
    bar: () => (
      <div className="boot-bar-wrap">
        <div className="boot-bar"><span style={barAnim}></span></div>
        {/* the muelle ferry rides the fill edge (same art as drawBoat) */}
        <div className="boot-boat" style={barAnim}>
          <Ferry />
        </div>
      </div>
    ),
    loading: () => <div className="boot-loading" role="status">{t("boot.loading")}</div>,
  };
  // El aviso de giro oculta las dos fases mientras espera una acción.
  const ctx = { showingLogo: !hold && phase === 0, showingLoad: !hold && phase === 1 };
  const slot = (region) => <Slots screen={UI_SCREEN.BOOT} region={region} ctx={ctx} slots={SLOTS} />;

  // No click-skip: the sequence always plays in full.
  return (
    <div className={"boot-screen" + (phase ? " load" : "") + (out ? " out" : "")}>
      <canvas ref={waterRef} className="boot-water" aria-hidden="true"></canvas>
      {slot("main")}
    </div>
  );
}
