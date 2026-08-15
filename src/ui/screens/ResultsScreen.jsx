import React, { useState } from "react";
import { Game } from "../../game/index.js";
import { STAGE_KIND, UI_SCREEN } from "../../domain/vocabulary.generated.js";
import { WORLD2D as WORLD } from "../../world2d/index.js";
import { useT, stageName } from "../../i18n/index.js";
import { ads } from "../../monetize/ads.js";
import { economy } from "../../game/economy.js";
import { isMvpLocked, crossingRecord } from "../../game/progress.js";
import { content } from "../../content/remote.js";
import CoinIcon from "../CoinIcon.jsx";
import Icon from "../Icon.jsx";
import Slots from "../Slots.jsx";

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
  // The Travesía reports itself: fish, gates and the clock, not deliveries.
  const isCrossing = isStage && s.stage.kind === STAGE_KIND.CROSSING;
  const cross = s.crossing || null;
  const fish = cross ? cross.fish : 0;
  const gatesTaken = cross ? cross.gateIndex : 0;
  const gatesTotal = cross ? cross.gates : 0;
  const record = isCrossing ? crossingRecord(s.stage.id) : null;
  const title = isTutorial ? t("results.tutorial")
    : isStage ? (won ? t("results.win", { n: s.stage.num }) : t("results.lose"))
    : s.mode === "arcade" && !won ? t("results.lose") : t("results.title");
  // THE BLOCKS THIS SCREEN CAN SHOW — `src/ui/screens.json` decides which of
  // them appear and in what order. Each one is the JSX it always was, lifted
  // out unchanged; what moved is the ORDER and the CONDITIONS, which are the
  // only part of a results screen a designer wants to change.
  const SLOTS = {
    title: () => <h2 style={{ color: won ? "var(--gold)" : "var(--hot)" }}>{title}</h2>,
    stageName: () => (
      <div style={{ marginBottom: 10, color: "var(--paper)" }}>{stageName(s.stage)}</div>
    ),
    score: () => (
      <div className="row"><span>{t("results.score")}</span><span>{s.score.toLocaleString()}</span></div>
    ),
    // A CROSSING HAS NO DELIVERIES AND NO COMBO. Showing "0/0 entregas" and
    // "×1" after a 7 km run down the channel describes a delivery the player
    // never attempted; what they actually earned is the fish they caught, the
    // gates they held and the time it took. The records come from the same save
    // as the stage clears.
    crossingStats: () => <>
      <div className="row"><span>{t("crossing.fish")}</span><span>{fish}</span></div>
      <div className="row"><span>{t("crossing.gate")
        .replace("{n}", String(gatesTaken)).replace("{total}", String(gatesTotal))}</span><span /></div>
      {record?.bestTime != null && (
        <div className="row"><span>{t("crossing.bestTime")}</span><span>{record.bestTime}s</span></div>
      )}
      {record?.bestFish > 0 && (
        <div className="row"><span>{t("crossing.bestFish")}</span><span>{record.bestFish}</span></div>
      )}
    </>,
    deliveryStats: () => <>
      <div className="row"><span>{t("results.deliveries")}</span><span>{isStage ? `${s.stageDeliveries}/${s.stageTarget}` : s.deliveries}</span></div>
      <div className="row"><span>{t("results.perfect")}</span><span>{s.perfect}</span></div>
      <div className="row"><span>{t("results.maxCombo")}</span><span>×{s.combo}</span></div>
    </>,
    rank: () => (
      <div className="row"><span>{t("results.rank")}</span><span style={{ color: "var(--gold)" }}>{rank}</span></div>
    ),
    // the level's coin haul, front and center before leaving the screen
    coinsBand: () => (
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
    ),
    continueAd: () => (
      <button className="btn gold" disabled={adBusy} onClick={watchAd}>
        <Icon name="ad" size={15} /> {t("results.continueAd")}
      </button>
    ),
    nextStage: () => <button className="btn gold" onClick={onNext}>{t("results.next")}</button>,
    // "Again" is the gold button only when nothing louder is competing with it.
    again: () => (
      <button className={"btn " + ((won && hasNext) || canContinue ? "secondary" : "gold")}
              onClick={onAgain}>{t("results.again")}</button>
    ),
    menu: () => <button className="btn secondary" onClick={onMenu}>{t("results.menu")}</button>,
    // a gentle post-level nudge: the game is free — supporters keep it alive
    kofi: () => (
      <a className="results-kofi" href={content.meta.kofi} target="_blank" rel="noopener noreferrer">
        <Icon name="coffee" size={14} /> {t("sup.kofi")}
      </a>
    ),
  };

  // The context a `when` is read from. NEGATIONS ARE KEYS, not expressions —
  // `Slots` deliberately cannot parse `!isCrossing`, because the moment it can,
  // screens.json is a language.
  const ctx = {
    isStage, isCrossing, notCrossing: !isCrossing,
    notTutorial: !isTutorial,
    earnedCoins: !isTutorial && (s.runCoins || 0) > 0,
    canContinue: !!canContinue, canDouble, hasNext: isStage && won && hasNext,
    hasKofi: !isTutorial && !!content.meta.kofi,
  };
  const slot = (region) => <Slots screen={UI_SCREEN.OVER} region={region} ctx={ctx} slots={SLOTS} />;

  return (
    <div className="page-card">
      <div className="page-body scrolly">
        <div className="center-stack">
          {slot("head")}
          <div className="results-stats">{slot("stats")}</div>
          {slot("coins")}
          <div className="btn-row">{slot("actions")}</div>
          {slot("footer")}
        </div>
      </div>
    </div>
  );
}
