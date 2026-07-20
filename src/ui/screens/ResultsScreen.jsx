import React, { useState } from "react";
import { Game } from "../../game/index.js";
import { WORLD2D as WORLD } from "../../world2d/index.js";
import { useT, stageName } from "../../i18n/index.js";
import { ads } from "../../monetize/ads.js";
import { economy } from "../../game/economy.js";
import { isMvpLocked } from "../../game/progress.js";
import { content } from "../../content/remote.js";
import CoinIcon from "../CoinIcon.jsx";
import Icon from "../Icon.jsx";

export default function ResultsScreen({ onAgain, onNext, onMenu, onContinue }) {
  const t = useT();
  const [adBusy, setAdBusy] = useState(false);
  const [doubled, setDoubled] = useState(false);
  const s = Game.state;
  const stages = WORLD.STAGES;
  const isStage = !!s.stage;
  const isTutorial = s.mode === "tutorial";
  const won = s.won;
  const rank = s.score > 6000 ? t("rank.s") : s.score > 3500 ? t("rank.a") : s.score > 1800 ? t("rank.b") : s.score > 800 ? t("rank.c") : t("rank.d");
  // Offer "Next" only when the following stage is actually playable — never
  // into a PRÓXIMAMENTE (MVP-locked / WIP) level that ships in a later release.
  const nextStage = isStage ? stages[s.stageIdx + 1] : null;
  const hasNext = !!nextStage && !isMvpLocked(nextStage.district);
  // rewarded "continue": a lost timed run, once per run, when an ad is ready
  const canContinue = !won && !isTutorial && (s.mode === "arcade" || s.mode === "story")
    && !s.usedAdContinue && ads.canOfferRewarded() && onContinue;
  const watchAd = async () => {
    if (adBusy) return;
    setAdBusy(true);
    const rewarded = await ads.showRewarded();
    setAdBusy(false);
    if (rewarded) onContinue();
  };
  // rewarded "double the run's coins" — once, when there's something to double
  const canDouble = !doubled && !isTutorial && (s.runCoins || 0) > 0 && ads.canOfferRewarded();
  const doubleCoins = async () => {
    if (adBusy) return;
    setAdBusy(true);
    const rewarded = await ads.showRewarded();
    setAdBusy(false);
    if (rewarded) { economy.addCoins(s.runCoins); setDoubled(true); }
  };
  const title = isTutorial ? t("results.tutorial")
    : isStage ? (won ? t("results.win", { n: s.stage.num }) : t("results.lose"))
    : s.mode === "arcade" && !won ? t("results.lose") : t("results.title");
  return (
    <div className="page-card">
      <div className="page-body scrolly">
        <div className="center-stack">
        <h2 style={{ color: won ? "var(--gold)" : "var(--hot)" }}>{title}</h2>
        {isStage && <div style={{ marginBottom: 10, color: "var(--paper)" }}>{stageName(s.stage)}</div>}
        <div className="results-stats">
        <div className="row"><span>{t("results.score")}</span><span>{s.score.toLocaleString()}</span></div>
        <div className="row"><span>{t("results.deliveries")}</span><span>{isStage ? `${s.stageDeliveries}/${s.stageTarget}` : s.deliveries}</span></div>
        <div className="row"><span>{t("results.perfect")}</span><span>{s.perfect}</span></div>
        <div className="row"><span>{t("results.maxCombo")}</span><span>×{s.combo}</span></div>
        {!isTutorial && <div className="row"><span>{t("results.rank")}</span><span style={{ color: "var(--gold)" }}>{rank}</span></div>}
        </div>
        {!isTutorial && (s.runCoins || 0) > 0 && (
          // the level's coin haul, front and center before leaving the screen
          <div className="coins-band">
            <CoinIcon size={26} />
            <span className="coins-amount">+{(doubled ? s.runCoins * 2 : s.runCoins).toLocaleString()}</span>
            <span className="coins-lbl">{t("results.coins")}</span>
            {canDouble && (
              <button className="btn secondary" disabled={adBusy} onClick={doubleCoins}>
                <Icon name="ad" size={15} /> {t("results.doubleAd")}
              </button>
            )}
          </div>
        )}
        <div className="btn-row">
          {canContinue && (
            <button className="btn gold" disabled={adBusy} onClick={watchAd}>
              <Icon name="ad" size={15} /> {t("results.continueAd")}
            </button>
          )}
          {isStage && won && hasNext && <button className="btn gold" onClick={onNext}>{t("results.next")}</button>}
          <button className={"btn " + ((won && hasNext) || canContinue ? "secondary" : "gold")} onClick={onAgain}>{t("results.again")}</button>
          <button className="btn secondary" onClick={onMenu}>{t("results.menu")}</button>
        </div>
        {!isTutorial && content.meta.kofi && (
          // gentle post-level nudge: the game is free — supporters keep it alive
          <a className="results-kofi" href={content.meta.kofi} target="_blank" rel="noopener noreferrer">
            <Icon name="coffee" size={14} /> {t("sup.kofi")}
          </a>
        )}
        </div>
      </div>
    </div>
  );
}
