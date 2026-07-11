import React, { useState } from "react";
import { Game } from "../../game/index.js";
import { WORLD } from "../../world/index.js";
import { useMenuNav } from "../useMenuNav.js";
import { sfx } from "../../game/audio.js";

export default function StageSelect({ onStart, onBack }) {
  const stages = WORLD.STAGES;
  const vehicles = Game.VEHICLES;
  const vehKeys = Object.keys(vehicles);
  const cleared = Game.state.progress.clearedStages;
  const [veh, setVeh] = useState(Game.state.vehicleKey || "scooter");
  const [confirming, setConfirming] = useState(false);
  const [, bump] = useState(0);
  const isLocked = (i) => i > 0 && !cleared.includes(stages[i - 1].id);

  // One flat focus list: stages, then vehicles, then reset, then back.
  const RESET_I = stages.length + vehKeys.length;
  const BACK_I = RESET_I + 1;

  const doReset = () => {
    Game.resetProgress();
    setConfirming(false);
    bump((n) => n + 1);
  };

  const [idx, setIdx] = useMenuNav({
    count: BACK_I + 1,
    cols: 3,
    onSelect: (i) => {
      if (i < stages.length) {
        if (isLocked(i)) { sfx.play("menu_denied"); return; }
        sfx.play("menu_select"); onStart(i, veh);
      } else if (i < RESET_I) { sfx.play("menu_select"); setVeh(vehKeys[i - stages.length]); }
      else if (i === RESET_I) { sfx.play("menu_select"); confirming ? doReset() : setConfirming(true); }
      else if (confirming) setConfirming(false);
      else { sfx.play("menu_select"); onBack(); }
    },
    onBack: () => (confirming ? setConfirming(false) : onBack()),
  });
  const foc = (i) => (idx === i ? " focused" : "");
  const hover = (i) => ({ onMouseEnter: () => setIdx(i) });

  return (
    <div className="title-bg">
      <div className="title-shell">
        <div className="title-card" style={{ maxWidth: 1080 }}>
          <button className={"btn secondary" + foc(BACK_I)} {...hover(BACK_I)} onClick={onBack}
            style={{ position: "absolute", left: 0, top: 0 }}>← Menú</button>
          <span className="title-pill"><span className="dot"></span>MODO HISTORIA · ELEGÍ ETAPA</span>
          <h1 className="title-main" style={{ fontSize: "clamp(36px, 6vw, 64px)", marginTop: 12 }}>LA RUTA</h1>

          <div className="stage-grid">
            {stages.map((s, i) => {
              const locked = isLocked(i);
              const done = cleared.includes(s.id);
              return (
                <button key={s.id}
                  className={"stage-card" + (locked ? " locked" : "") + (done ? " done" : "") + foc(i)}
                  {...hover(i)} onClick={() => !locked && onStart(i, veh)} disabled={locked}>
                  <div className="stage-num">
                    {String(s.num).padStart(2, "0")}
                    {done && <span style={{ marginLeft: 8, color: "#6fbf99" }}>✓ LIMPIA</span>}
                    {locked && <span style={{ marginLeft: 8, color: "#ff8b3d" }}>⛔ BLOQUEADA</span>}
                  </div>
                  <div className="stage-name">{s.name}</div>
                  <div className="stage-brief">{locked ? `Limpiá la etapa ${s.num - 1} primero.` : s.brief}</div>
                  <div className="stage-meta">
                    <span>🎯 {s.targetDeliveries}</span>
                    <span>⏱ {s.timeLimit}s</span>
                    <span>☀ {s.weather === "sunny" ? "Soleado" : s.weather === "sunset" ? "Atardecer" : s.weather === "storm" ? "Tormenta" : s.weather === "night" ? "Noche" : "—"}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ font: "11px 'JetBrains Mono', monospace", letterSpacing: "0.18em", opacity: 0.7, textTransform: "uppercase", marginTop: 18 }}>Elegí vehículo</div>
          <div className="vehicles-row">
            {vehKeys.map((k, vi) => (
              <button key={k} className={"vchip " + (veh === k ? "active" : "") + foc(stages.length + vi)}
                {...hover(stages.length + vi)} onClick={() => setVeh(k)}>
                {vehicles[k].name}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16, font: "11px 'JetBrains Mono', monospace", opacity: 0.75, display: "flex", gap: 8, justifyContent: "center", alignItems: "center" }}>
            {confirming ? (
              <>
                <span>¿Borrar todo el progreso?</span>
                <button className="btn" style={{ fontSize: 11, padding: "6px 10px" }} onClick={doReset}>Sí, borrar</button>
                <button className="btn secondary" style={{ fontSize: 11, padding: "6px 10px" }} onClick={() => setConfirming(false)}>No</button>
              </>
            ) : (
              <button className={"btn secondary" + foc(RESET_I)} {...hover(RESET_I)}
                style={{ fontSize: 11, padding: "6px 10px" }} onClick={() => setConfirming(true)}>↺ Resetear progreso</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
