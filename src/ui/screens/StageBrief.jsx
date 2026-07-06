import React from "react";

export default function StageBrief({ stage, onGo }) {
  return (
    <div className="overlay">
      <div className="panel">
        <h2>ETAPA {String(stage.num).padStart(2, "0")}</h2>
        <div style={{ font: "20px 'Bungee', sans-serif", color: "var(--gold)", marginBottom: 10 }}>{stage.name}</div>
        <p style={{ opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>{stage.brief}</p>
        <div style={{ display: "flex", justifyContent: "space-around", margin: "14px 0", font: "12px 'JetBrains Mono', monospace", opacity: 0.85 }}>
          <span>🎯 {stage.targetDeliveries} entregas</span>
          <span>⏱ {stage.timeLimit}s</span>
          <span>☀ {stage.weather}</span>
        </div>
        <div className="btn-row">
          <button className="btn gold" onClick={onGo}>▸ ¡Vamos!</button>
        </div>
      </div>
    </div>
  );
}
