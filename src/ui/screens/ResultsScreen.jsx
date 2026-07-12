import React from "react";
import { Game } from "../../game/index.js";
import { WORLD2D as WORLD } from "../../world2d/index.js";

export default function ResultsScreen({ onAgain, onNext, onMenu }) {
  const s = Game.state;
  const stages = WORLD.STAGES;
  const isStage = !!s.stage;
  const won = s.won;
  const rank = s.score > 6000 ? "S — LEYENDA PORTEÑA" : s.score > 3500 ? "A — Maestro Churchillero" : s.score > 1800 ? "B — Repartidor del Paseo" : s.score > 800 ? "C — Aprendiz del kiosco" : "D — Se te derritió todo";
  const hasNext = isStage && (s.stageIdx + 1) < stages.length;
  return (
    <div className="overlay">
      <div className="panel">
        <h2 style={{ color: won ? "var(--gold)" : "var(--hot)" }}>
          {isStage ? (won ? `¡NIVEL ${s.stage.num} COMPLETADO!` : "SE ACABÓ EL TIEMPO") : "RESULTADOS"}
        </h2>
        {isStage && <div style={{ marginBottom: 10, color: "var(--paper)" }}>{s.stage.name}</div>}
        <div className="row"><span>Puntaje</span><span>{s.score.toLocaleString()}</span></div>
        <div className="row"><span>Entregas</span><span>{isStage ? `${s.stageDeliveries}/${s.stageTarget}` : s.deliveries}</span></div>
        <div className="row"><span>Perfectas</span><span>{s.perfect}</span></div>
        <div className="row"><span>Combo máximo</span><span>×{s.combo}</span></div>
        <div className="row"><span>Ranking</span><span style={{ color: "var(--gold)" }}>{rank}</span></div>
        <div className="btn-row">
          {isStage && won && hasNext && <button className="btn gold" onClick={onNext}>▸ Siguiente nivel</button>}
          <button className={"btn " + (won && hasNext ? "secondary" : "gold")} onClick={onAgain}>↻ Repetir</button>
          <button className="btn secondary" onClick={onMenu}>Menú</button>
        </div>
      </div>
    </div>
  );
}
