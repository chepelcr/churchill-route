import React, { useState } from "react";
import { Game } from "../../game/index.js";
import { WORLD } from "../../world/index.js";
import { useMenuNav } from "../useMenuNav.js";
import { sfx } from "../../game/audio.js";
import VehiclePreview from "../VehiclePreview.jsx";

const WEATHER_ES = { sunny: "Soleado", sunset: "Atardecer", storm: "Tormenta", night: "Noche" };

export default function StageSelect({ onStart, onBack }) {
  const stages = WORLD.STAGES;
  const vehicles = Game.VEHICLES;
  const vehKeys = Object.keys(vehicles);
  const cleared = Game.state.progress.clearedStages;
  const [veh, setVeh] = useState(Game.state.vehicleKey || "scooter");
  const [confirming, setConfirming] = useState(false);
  const [, bump] = useState(0);
  const isLocked = (i) => i > 0 && !cleared.includes(stages[i - 1].id);

  // One flat focus list: stages (4 per row), then vehicles, then reset, back.
  const RESET_I = stages.length + vehKeys.length;
  const BACK_I = RESET_I + 1;

  const doReset = () => {
    Game.resetProgress();
    setConfirming(false);
    bump((n) => n + 1);
  };

  const [idx, setIdx] = useMenuNav({
    count: BACK_I + 1,
    cols: 4,
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
        <div className="title-card stage-select-card">
          <button className={"btn secondary" + foc(BACK_I)} {...hover(BACK_I)} onClick={onBack}
            style={{ position: "absolute", left: 14, top: 14 }}>← Menú</button>
          <span className="title-pill"><span className="dot"></span>MODO HISTORIA · ELEGÍ ETAPA</span>

          <div className="stage-layout">
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
                      {done && <span className="tag ok">✓</span>}
                      {locked && <span className="tag no">⛔</span>}
                    </div>
                    <div className="stage-name">{s.name}</div>
                    <div className="stage-brief">{locked ? `Limpiá la etapa ${s.num - 1} primero.` : s.brief}</div>
                    <div className="stage-meta">
                      <span>🎯 {s.targetDeliveries}</span>
                      <span>⏱ {s.timeLimit}s</span>
                      <span>☀ {WEATHER_ES[s.weather] || "—"}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="vehicle-card">
              <div className="vehicle-card-title">TU VEHÍCULO</div>
              <VehiclePreview vehKey={veh} />
              <div className="vehicles-col">
                {vehKeys.map((k, vi) => (
                  <button key={k} className={"vchip " + (veh === k ? "active" : "") + foc(stages.length + vi)}
                    {...hover(stages.length + vi)} onClick={() => { sfx.play("menu_select"); setVeh(k); }}>
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
                  <button className={"btn secondary" + foc(RESET_I)} {...hover(RESET_I)}
                    onClick={() => setConfirming(true)}>↺ Resetear progreso</button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
