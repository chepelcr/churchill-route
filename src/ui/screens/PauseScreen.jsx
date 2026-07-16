import React from "react";
import { useT } from "../../i18n/index.js";

export default function PauseScreen({ onResume, onSettings, onQuit }) {
  const t = useT();
  return (
    <div className="overlay">
      <div className="panel">
        <h2>{t("pause.title")}</h2>
        <p style={{ opacity: 0.7, marginTop: 0 }}>{t("pause.body")}</p>
        <div className="btn-row">
          <button className="btn gold" onClick={onResume}>{t("pause.resume")}</button>
          <button className="btn secondary" onClick={onSettings}>⚙ {t("pause.settings")}</button>
          <button className="btn secondary" onClick={onQuit}>{t("pause.quit")}</button>
        </div>
      </div>
    </div>
  );
}
