import React, { useState } from "react";
import { Game } from "../../game/index.js";
import { WORLD } from "../../world/index.js";

export default function StageSelect({ onStart, onBack }) {
  const stages = WORLD.STAGES;
  const vehicles = Game.VEHICLES;
  const cleared = Game.state.progress.clearedStages;
  const [veh, setVeh] = useState(Game.state.vehicleKey || "scooter");
  const isLocked = (i) => i > 0 && !cleared.includes(stages[i - 1].id);

  return (
    <div className="title-bg">
      <div className="title-shell">
        <div className="title-card" style={{ maxWidth: 1080 }}>
          <button className="btn secondary" onClick={onBack} style={{ position: "absolute", left: 0, top: 0 }}>← Menú</button>
          <span className="title-pill"><span className="dot"></span>MODO HISTORIA · ELEGÍ ETAPA</span>
          <h1 className="title-main" style={{ fontSize: "clamp(36px, 6vw, 64px)", marginTop: 12 }}>LA RUTA</h1>

          <div className="stage-grid">
            {stages.map((s, i) => {
              const locked = isLocked(i);
              const done = cleared.includes(s.id);
              return (
                <button key={s.id} className={"stage-card" + (locked ? " locked" : "") + (done ? " done" : "")}
                  onClick={() => !locked && onStart(i, veh)} disabled={locked}>
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
            {Object.entries(vehicles).map(([k, v]) => (
              <button key={k} className={"vchip " + (veh === k ? "active" : "")} onClick={() => setVeh(k)}>
                {v.name}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16, font: "11px 'JetBrains Mono', monospace", opacity: 0.6 }}>
            <button className="btn secondary" style={{ fontSize: 11, padding: "6px 10px" }} onClick={() => { if (confirm("¿Resetear progreso?")) { Game.resetProgress(); window.location.reload(); } }}>↺ Resetear progreso</button>
          </div>
        </div>
      </div>
    </div>
  );
}
