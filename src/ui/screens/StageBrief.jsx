import React from "react";
import { useT, stageName, stageBrief } from "../../i18n/index.js";

export default function StageBrief({ stage, onGo }) {
  const t = useT();
  return (
    <div className="overlay">
      <div className="panel">
        <h2>{t("brief.level", { n: String(stage.num).padStart(2, "0") })}</h2>
        <div style={{ font: "20px 'Bungee', sans-serif", color: "var(--gold)", marginBottom: 10 }}>{stageName(stage)}</div>
        <p style={{ opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>{stageBrief(stage)}</p>
        <div style={{ display: "flex", justifyContent: "space-around", margin: "14px 0", font: "12px 'JetBrains Mono', monospace", opacity: 0.85 }}>
          <span>🎯 {stage.targetDeliveries} {t("select.deliveries")}</span>
          <span>⏱ {stage.timeLimit}s</span>
          <span>☀ {t(`weather.${stage.weather}`)}</span>
        </div>
        <div className="btn-row">
          <button className="btn gold" onClick={onGo}>{t("brief.go")}</button>
        </div>
      </div>
    </div>
  );
}
