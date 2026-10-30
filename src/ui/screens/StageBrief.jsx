import React, { useState } from "react";
import { useT, stageName, stageBrief } from "../../i18n/index.js";
import { STAGE_KIND, UI_SCREEN } from "../../domain/vocabulary.generated.js";
import { economy, BOOSTS } from "../../game/economy.js";
import { gateCount, crossingCondition } from "../../game/crossing.js";
import { crossingRuns } from "../../game/progress.js";
import { sfx } from "../../game/audio.js";
import Icon from "../Icon.jsx";
import Slots from "../Slots.jsx";
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
  // A crossing stage (s8, la Travesía) has no deliveries — its objective is the
  // gated run down the channel, so briefing it as "0 entregas" was both wrong
  // and the least appealing possible description of the level. The gate count
  // is DERIVED from the lancha's route, exactly like the buoys that mark it, so
  // the number here cannot disagree with the number in the water.
  const isCrossing = stage.kind === STAGE_KIND.CROSSING;
  const gates = gateCount(stage);
  // THE BRIEF PROMISES THE CONDITIONS THE RUN WILL ACTUALLY HAVE. The crossing
  // rotates through four of them by attempt, so `stage.weather` — a single word
  // baked into the world — would be a lie three times out of four. Read the
  // same rotation `startStage` is about to read, at the same index.
  const cond = isCrossing ? crossingCondition(crossingRuns(stage.id)) : null;
  const weather = cond ? cond.weather : stage.weather;

  const SLOTS = {
    kicker: () => <h2>{t("brief.level", { n: String(stage.num).padStart(2, "0") })}</h2>,
    name: () => (
      <div style={{ font: "20px 'Bungee', sans-serif", color: "var(--gold)", marginBottom: 10 }}>{stageName(stage)}</div>
    ),
    body: () => <p style={{ opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>{stageBrief(stage)}</p>,
    objective: () => (
      <div style={{ display: "flex", justifyContent: "space-around", margin: "14px 0", font: "12px 'JetBrains Mono', monospace", opacity: 0.85 }}>
        {isCrossing
          ? <span><Icon name="pin" size={14} /> {t("brief.gates", { n: gates })}</span>
          : <span><Icon name="target" size={14} /> {stage.targetDeliveries} {t("select.deliveries")}</span>}
        <span><Icon name="clock" size={14} /> {stage.timeLimit}s</span>
        <span><Icon name={WEATHER_ICON[weather] || "sun"} size={14} /> {t(`weather.${weather}`)}</span>
      </div>
    ),
    // Named, because "Bajamar despejada" and "Aguacero con marea alta" are two
    // different levels and the player should know which one they are about to
    // sail before they pick a hull for it.
    condition: () => (
      <div style={{ marginTop: -6, marginBottom: 10, font: "12px 'JetBrains Mono', monospace", color: "var(--teal)" }}>
        {t(`cond.${cond.id}`)}
      </div>
    ),
    boosts: () => (
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
    ),
    go: () => <button className="btn gold" onClick={() => onGo(armed)}>{t("brief.go")}</button>,
  };
  const ctx = { hasCondition: !!cond, hasBoosts: totalBoosts > 0 };
  const slot = (region) => <Slots screen={UI_SCREEN.BRIEF} region={region} ctx={ctx} slots={SLOTS} />;

  return (
    <div className="overlay">
      <div className="panel">
        {slot("main")}
        <div className="btn-row">{slot("actions")}</div>
      </div>
    </div>
  );
}
