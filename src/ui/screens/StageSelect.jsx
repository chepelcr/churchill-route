import React, { useState, useEffect, useRef } from "react";
import { Game } from "../../game/index.js";
import { WORLD } from "../../world/index.js";
import { sfx } from "../../game/audio.js";
import VehiclePreview from "../VehiclePreview.jsx";

const WEATHER_ES = { sunny: "Soleado", sunset: "Atardecer", storm: "Tormenta", night: "Noche" };
const WEATHER_ICON = { sunny: "☀", sunset: "🌅", storm: "⛈", night: "🌙" };

export default function StageSelect({ onStart, onBack }) {
  const stages = WORLD.STAGES;
  const vehicles = Game.VEHICLES;
  const vehKeys = Object.keys(vehicles);
  const cleared = Game.state.progress.clearedStages;
  const isLocked = (i) => i > 0 && !cleared.includes(stages[i - 1].id);
  // start on the first not-yet-cleared stage so you land on "where you are"
  const firstOpen = Math.max(0, stages.findIndex((s) => !cleared.includes(s.id)));

  const [cur, setCur] = useState(firstOpen < 0 ? 0 : firstOpen);
  const [veh, setVeh] = useState(Game.state.vehicleKey || "scooter");
  const [confirming, setConfirming] = useState(false);
  const [, bump] = useState(0);

  const doReset = () => { Game.resetProgress(); setConfirming(false); bump((n) => n + 1); };

  // keep the latest values reachable from the mount-once key/pad handlers
  const st = useRef({});
  st.current = { cur, veh };

  const moveStage = (d) => setCur((c) => {
    const n = Math.max(0, Math.min(stages.length - 1, c + d));
    if (n !== c) sfx.play("menu_move");
    return n;
  });
  const moveVeh = (d) => setVeh((k) => {
    const i = (vehKeys.indexOf(k) + d + vehKeys.length) % vehKeys.length;
    sfx.play("menu_move");
    return vehKeys[i];
  });
  const play = (i) => {
    if (isLocked(i)) { sfx.play("menu_denied"); return; }
    sfx.play("menu_select"); onStart(i, st.current.veh);
  };

  useEffect(() => {
    const onKey = (e) => {
      switch (e.key) {
        case "ArrowLeft": e.preventDefault(); moveStage(-1); break;
        case "ArrowRight": e.preventDefault(); moveStage(1); break;
        case "ArrowUp": e.preventDefault(); moveVeh(-1); break;
        case "ArrowDown": e.preventDefault(); moveVeh(1); break;
        case "Enter": case " ": e.preventDefault(); play(st.current.cur); break;
        case "Escape": case "Backspace": e.preventDefault(); onBack(); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);

    let raf, prev = {}, last = 0;
    const poll = () => {
      const p = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find(Boolean);
      if (p) {
        const now = performance.now();
        const pressed = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
        const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
        const d = {
          l: pressed(14) || ax < -0.5, r: pressed(15) || ax > 0.5,
          u: pressed(12) || ay < -0.5, dn: pressed(13) || ay > 0.5,
        };
        for (const k in d) {
          if (d[k] && (!prev[k] || now - last > 240)) {
            if (k === "l") moveStage(-1); else if (k === "r") moveStage(1);
            else if (k === "u") moveVeh(-1); else moveVeh(1);
            last = now;
          }
          prev[k] = d[k];
        }
        const a = pressed(0), b = pressed(1);
        if (a && !prev.a) play(st.current.cur);
        if (b && !prev.b) onBack();
        prev.a = a; prev.b = b;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(raf); };
  }, []);

  const s = stages[cur];
  const locked = isLocked(cur);
  const done = cleared.includes(s.id);

  return (
    <div className="title-bg">
      <div className="title-shell">
        <div className="stage-select-wrap">
          <button className="btn secondary back-btn" onClick={onBack}>← Menú</button>

          <div className="stage-head">
            <span className="title-pill"><span className="dot"></span>MODO HISTORIA · ELEGÍ NIVEL</span>
            <h1 className="title-main stage-title">LA RUTA</h1>
          </div>

          <div className="stage-layout">
            <div className="stage-carousel">
              <button className="carousel-arrow" onClick={() => moveStage(-1)} disabled={cur === 0} aria-label="Anterior">‹</button>

              <div className={"stage-hero glass-card" + (locked ? " locked" : "") + (done ? " done" : "")}>
                <div className="hero-top">
                  <span className="hero-num">{String(s.num).padStart(2, "0")}</span>
                  <span className="hero-count">Nivel {s.num} / {stages.length}</span>
                  {done && <span className="hero-badge ok">✓ COMPLETADO</span>}
                  {locked && <span className="hero-badge no">⛔ BLOQUEADO</span>}
                </div>
                <div className="hero-name">{s.name}</div>
                <p className="hero-brief">{locked ? `Completá el nivel ${s.num - 1} para desbloquear este.` : s.brief}</p>
                <div className="hero-meta">
                  <span><b>{s.targetDeliveries}</b> entregas</span>
                  <span><b>{s.timeLimit}s</b> tiempo</span>
                  <span>{WEATHER_ICON[s.weather] || "☀"} {WEATHER_ES[s.weather] || "—"}</span>
                </div>
                <button className="btn gold hero-play" onClick={() => play(cur)} disabled={locked}>
                  {locked ? "Bloqueado" : "▸ Jugar"}
                </button>
              </div>

              <button className="carousel-arrow" onClick={() => moveStage(1)} disabled={cur === stages.length - 1} aria-label="Siguiente">›</button>
            </div>

            <div className="glass-card vehicle-card">
              <div className="vehicle-card-title">TU VEHÍCULO</div>
              <VehiclePreview vehKey={veh} />
              <div className="vehicles-col">
                {vehKeys.map((k) => (
                  <button key={k} className={"vchip " + (veh === k ? "active" : "")}
                    onClick={() => { sfx.play("menu_select"); setVeh(k); }}>
                    {vehicles[k].name}
                  </button>
                ))}
              </div>
              <div className="reset-row">
                {confirming ? (
                  <>
                    <span>¿Borrar progreso?</span>
                    <button className="btn" onClick={doReset}>Sí</button>
                    <button className="btn secondary" onClick={() => setConfirming(false)}>No</button>
                  </>
                ) : (
                  <button className="btn secondary" onClick={() => setConfirming(true)}>↺ Resetear progreso</button>
                )}
              </div>
            </div>
          </div>

          <div className="stage-dots">
            {stages.map((sg, i) => (
              <button key={sg.id}
                className={"dot" + (i === cur ? " on" : "") + (cleared.includes(sg.id) ? " cleared" : "") + (isLocked(i) ? " locked" : "")}
                onClick={() => { if (i !== cur) { sfx.play("menu_move"); setCur(i); } }}
                aria-label={`Nivel ${sg.num}`}></button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
