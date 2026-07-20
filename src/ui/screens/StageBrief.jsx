import React, { useState } from "react";
import { useT, stageName, stageBrief } from "../../i18n/index.js";
import { economy, BOOSTS } from "../../game/economy.js";
import { sfx } from "../../game/audio.js";
import Icon from "../Icon.jsx";
import { WEATHER_ICON } from "./StageSelect.jsx";

export default function StageBrief({ stage, onGo }) {
  const t = useT();
  const [armed, setArmed] = useState({});
  // owned consumable boosts can be armed for this story run (consumed at start
  // by modes.js armRun — same as the Arcade/Recorrer vehicle picker)
  const totalBoosts = Object.keys(BOOSTS).reduce((s, id) => s + economy.boostCount(id), 0);
  const toggleBoost = (id) => {
    if (economy.boostCount(id) <= 0) { sfx.play("menu_denied"); return; }
    sfx.play("menu_move");
    setArmed((a) => ({ ...a, [id]: !a[id] }));
  };
  return (
    <div className="overlay">
      <div className="panel">
        <h2>{t("brief.level", { n: String(stage.num).padStart(2, "0") })}</h2>
        <div style={{ font: "20px 'Bungee', sans-serif", color: "var(--gold)", marginBottom: 10 }}>{stageName(stage)}</div>
        <p style={{ opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>{stageBrief(stage)}</p>
        <div style={{ display: "flex", justifyContent: "space-around", margin: "14px 0", font: "12px 'JetBrains Mono', monospace", opacity: 0.85 }}>
          <span><Icon name="target" size={14} /> {stage.targetDeliveries} {t("select.deliveries")}</span>
          <span><Icon name="clock" size={14} /> {stage.timeLimit}s</span>
          <span><Icon name={WEATHER_ICON[stage.weather] || "sun"} size={14} /> {t(`weather.${stage.weather}`)}</span>
        </div>
        {totalBoosts > 0 && (
          <div className="picker-boosts">
            <div className="shop-desc">{t("picker.boosts", { n: totalBoosts })}</div>
            <div className="shop-tabs">
              {Object.keys(BOOSTS).map((id) => (
                <button key={id} disabled={economy.boostCount(id) <= 0}
                  className={"btn " + (armed[id] ? "gold" : "secondary")}
                  onClick={() => toggleBoost(id)}>
                  <Icon name={BOOSTS[id].icon} size={14} /> {t(`shop.${id}.name`)} ×{economy.boostCount(id)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="btn-row">
          <button className="btn gold" onClick={() => onGo(armed)}>{t("brief.go")}</button>
        </div>
      </div>
    </div>
  );
}
