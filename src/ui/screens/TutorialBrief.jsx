import React from "react";
import { useT } from "../../i18n/index.js";
import DriveTuning from "../DriveTuning.jsx";

// Shown once before the tutorial: set how the car feels (speed) and how much
// city you see (zoom) BEFORE learning the controls, rather than discovering
// halfway through that the default doesn't suit you. Both stay in Settings,
// and the hint line says so.
export default function TutorialBrief({ onGo }) {
  const t = useT();
  return (
    <div className="overlay">
      <div className="panel">
        <h2>{t("tutbrief.kicker")}</h2>
        <div style={{ font: "20px 'Bungee', sans-serif", color: "var(--gold)", marginBottom: 10 }}>
          {t("tutbrief.title")}
        </div>
        <p style={{ opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>{t("tutbrief.body")}</p>
        <DriveTuning hint />
        <div className="btn-row">
          <button className="btn gold" onClick={onGo}>{t("brief.go")}</button>
        </div>
      </div>
    </div>
  );
}
