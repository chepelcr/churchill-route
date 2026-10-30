import React from "react";
import { useT } from "../../i18n/index.js";
import { UI_SCREEN } from "../../domain/vocabulary.generated.js";
import DriveTuning from "../DriveTuning.jsx";
import Slots from "../Slots.jsx";

// Shown once before the tutorial: set how the car feels (speed) and how much
// city you see (zoom) BEFORE learning the controls, rather than discovering
// halfway through that the default doesn't suit you. Both stay in Settings,
// and the hint line says so.
export default function TutorialBrief({ onGo }) {
  const t = useT();
  const SLOTS = {
    kicker: () => <h2>{t("tutbrief.kicker")}</h2>,
    title: () => (
      <div style={{ font: "20px 'Bungee', sans-serif", color: "var(--gold)", marginBottom: 10 }}>
        {t("tutbrief.title")}
      </div>
    ),
    body: () => <p style={{ opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>{t("tutbrief.body")}</p>,
    // EL AJUSTE ES UN BLOQUE, y por eso vale que esté aquí: si algún día se
    // decide que el tutorial no debe abrir con dos deslizadores encima, se
    // quita del registro en vez de comentarse en el JSX.
    tuning: () => <DriveTuning hint />,
    go: () => <button className="btn gold" onClick={onGo}>{t("brief.go")}</button>,
  };
  const ctx = { always: true };
  const slot = (region) => <Slots screen={UI_SCREEN.TUTBRIEF} region={region} ctx={ctx} slots={SLOTS} />;

  return (
    <div className="overlay">
      <div className="panel">
        {slot("main")}
        <div className="btn-row">{slot("actions")}</div>
      </div>
    </div>
  );
}
