import React from "react";
import { useT } from "../../i18n/index.js";
import { UI_SCREEN } from "../../domain/vocabulary.generated.js";
import Icon from "../Icon.jsx";
import Slots from "../Slots.jsx";

export default function PauseScreen({ onResume, onRestart, onSettings, onQuit }) {
  const t = useT();
  // Los bloques que esta pantalla puede mostrar; `src/ui/screens.json` decide
  // cuáles salen y en qué orden. Los cuatro botones son slots propios porque
  // el orden de una fila de botones es UNA decisión de diseño —cuál queda de
  // primero es cuál se pulsa sin mirar— y «Reiniciar» ya era condicional:
  // Recorrer no tiene nivel que reiniciar, así que no lo ofrece.
  const SLOTS = {
    title: () => <h2>{t("pause.title")}</h2>,
    body: () => <p style={{ opacity: 0.7, marginTop: 0 }}>{t("pause.body")}</p>,
    resume: () => <button className="btn gold" onClick={onResume}>{t("pause.resume")}</button>,
    restart: () => <button className="btn secondary" onClick={onRestart}>{t("pause.restart")}</button>,
    settings: () => (
      <button className="btn secondary" onClick={onSettings}>
        <Icon name="gear" size={15} /> {t("pause.settings")}
      </button>
    ),
    quit: () => <button className="btn secondary" onClick={onQuit}>{t("pause.quit")}</button>,
  };
  const ctx = { canRestart: !!onRestart };
  const slot = (region) => <Slots screen={UI_SCREEN.PAUSED} region={region} ctx={ctx} slots={SLOTS} />;

  return (
    <div className="overlay">
      <div className="panel">
        {slot("main")}
        <div className="btn-row pause-actions">{slot("actions")}</div>
      </div>
    </div>
  );
}
