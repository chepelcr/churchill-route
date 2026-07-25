import React from "react";
import { useT } from "../../i18n/index.js";
import Icon from "../Icon.jsx";

// What-you're-about-to-play card for Recorrer and Arcade, so those modes get
// the same "here's the deal" beat Historia gets from StageBrief instead of
// dropping you straight into the puerto with no idea what the rules are.
const MODE_ICON = { explore: "pin", arcade: "clock" };

export default function ModeBrief({ mode, onGo }) {
  const t = useT();
  return (
    <div className="overlay">
      <div className="panel">
        <h2>{t(`modebrief.${mode}.kicker`)}</h2>
        <div style={{ font: "20px 'Bungee', sans-serif", color: "var(--gold)", marginBottom: 10 }}>
          {t(`modebrief.${mode}.title`)}
        </div>
        <p style={{ opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>{t(`modebrief.${mode}.body`)}</p>
        <div style={{ display: "flex", justifyContent: "space-around", margin: "14px 0", font: "12px 'JetBrains Mono', monospace", opacity: 0.85 }}>
          <span><Icon name={MODE_ICON[mode] || "target"} size={14} /> {t(`modebrief.${mode}.rule1`)}</span>
          <span><Icon name="target" size={14} /> {t(`modebrief.${mode}.rule2`)}</span>
        </div>
        <div className="btn-row">
          <button className="btn gold" onClick={onGo}>{t("brief.go")}</button>
        </div>
      </div>
    </div>
  );
}
