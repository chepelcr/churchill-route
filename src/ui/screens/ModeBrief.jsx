import React, { useState } from "react";
import { useT } from "../../i18n/index.js";
import Icon from "../Icon.jsx";

// What-you're-about-to-play card for Recorrer and Arcade, so those modes get
// the same "here's the deal" beat Historia gets from StageBrief instead of
// dropping you straight into the puerto with no idea what the rules are.
const MODE_ICON = { explore: "pin", arcade: "clock" };

// ARCADE PICKS ITS SKY, Recorrer turns one. Three minutes is shorter than any
// phase of a ten-minute day, so a cycling arcade run would either never turn or
// strobe; choosing is the honest control. Recorrer says what it is doing instead
// of offering a choice, because there the turn IS the feature.
const SKIES = ["sunny", "sunset", "night", "storm"];

export default function ModeBrief({ mode, onGo }) {
  const t = useT();
  const [sky, setSky] = useState("sunny");
  return (
    <div className="overlay">
      <div className="panel">
        {/* the MODE is the title — "MODO" alone read as the heading, with the
            mode itself demoted to a subtitle under it */}
        <h2 style={{ marginBottom: 10, font: "20px 'Bungee', sans-serif" }}>
          {t(`modebrief.${mode}.kicker`)}{" "}
          <span style={{ color: "var(--gold)" }}>{t(`modebrief.${mode}.title`)}</span>
        </h2>
        <p style={{ opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>{t(`modebrief.${mode}.body`)}</p>
        {mode === "arcade" && (
          <div className="mode-sky">
            <div className="vehicle-card-title">{t("arcade.sky")}</div>
            <div className="shop-tabs" style={{ margin: "6px 0 0" }}>
              {SKIES.map((w) => (
                <button key={w} className={"btn " + (sky === w ? "gold" : "secondary")}
                  onClick={() => setSky(w)}>{t(`sky.pick.${w}`)}</button>
              ))}
            </div>
          </div>
        )}
        {mode === "explore" && (
          <p style={{ opacity: 0.7, fontSize: 12 }}>☀︎ {t("explore.cycle")}</p>
        )}
        <div style={{ display: "flex", justifyContent: "space-around", margin: "14px 0", font: "12px 'JetBrains Mono', monospace", opacity: 0.85 }}>
          <span><Icon name={MODE_ICON[mode] || "target"} size={14} /> {t(`modebrief.${mode}.rule1`)}</span>
          <span><Icon name="target" size={14} /> {t(`modebrief.${mode}.rule2`)}</span>
        </div>
        <div className="btn-row">
          <button className="btn gold" onClick={() => onGo({ weather: mode === "arcade" ? sky : undefined })}>{t("brief.go")}</button>
        </div>
      </div>
    </div>
  );
}
