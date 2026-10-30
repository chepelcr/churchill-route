// EL TREN AL PUERTO — cuatro pantallas y un `iframe` menos.
//
// El MVP vivía en un `iframe` del mismo origen y se hablaba con el juego por
// `postMessage`: era lo correcto para preservar el prototipo mientras se decidía
// el motor, y es lo que ya no hace falta. Hoy la partida corre EN el juego —
// mismo bundle, mismo intérprete de arte, mismo registro de pantallas— y lo que
// eso compra se ve en dos sitios: el arte del tren es el mismo en el selector,
// en el garaje y en la vía, y la validación del resultado dejó de ser un
// contrato entre ventanas para ser una llamada a una función.
//
// Las cuatro pantallas son el bucle de Hill Climb: TRAMO → GARAJE → VIAJE →
// RESULTADO, y del resultado se vuelve al garaje con las fichas que el viaje
// pagó. Las fichas ferroviarias NO son la economía de las entregas de churchill
// y viven en su propia llave (`churchill.railway.v2`).
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { UI_SCREEN } from "../../domain/vocabulary.generated.js";
import { useT } from "../../i18n/index.js";
import { sfx } from "../../game/audio.js";
import Slots from "../Slots.jsx";
import FitScale from "../FitScale.jsx";
import {
  RAILWAY_ART, RAILWAY_CATALOG, createRailwayRun, railwayLevel, railwayTrain,
} from "../../game/railway/index.js";
import { buildConsist, ladderView, trainStats } from "../../game/railway/stats.js";
import {
  applyResult, buyTrain, buyUpgrade, loadProgress, saveProgress,
} from "../../game/railway/save.js";
import ScenePreview from "./railway/ScenePreview.jsx";
import TrainFigure from "./railway/TrainFigure.jsx";
import RailwayStage from "./railway/RailwayStage.jsx";
import "./railway.css";

const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const stars = (n) => "★★★".slice(0, n) + "☆☆☆".slice(0, 3 - n);

export default function RailwayMode({ onBack }) {
  const t = useT();
  const [progress, setProgress] = useState(() => loadProgress(RAILWAY_CATALOG));
  const [phase, setPhase] = useState("levels");
  const [levelId, setLevelId] = useState(RAILWAY_CATALOG.campaign[0]);
  const [trainId, setTrainId] = useState(progress.train);
  const [game, setGame] = useState(null);
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState(null);
  const [sceneId, setSceneId] = useState(null);
  const [error, setError] = useState(null);
  const economy = RAILWAY_CATALOG.economy;
  const persist = useRef(progress);

  const commit = useCallback((next) => {
    persist.current = next;
    saveProgress(next);
    setProgress(next);
  }, []);

  const level = railwayLevel(levelId);
  const train = railwayTrain(trainId);
  const upgrades = progress.upgrades[trainId] || {};
  const owned = progress.owned.includes(trainId);
  const stats = useMemo(() => trainStats(train, upgrades, RAILWAY_CATALOG), [train, upgrades]);
  const consist = useMemo(() => buildConsist(train, RAILWAY_ART), [train]);
  const ladders = RAILWAY_CATALOG.upgrades.ladders
    .map((l) => ladderView(l, upgrades, train, RAILWAY_CATALOG));
  const record = progress.levels[levelId] || { bestS: null, stars: 0, cleared: false };

  const depart = useCallback(() => {
    sfx.play("menu_select");
    try {
      setGame(createRailwayRun(levelId, trainId, persist.current.upgrades[trainId] || {}));
      setPaused(false);
      setError(null);
      setPhase("playing");
    } catch (e) {
      setError(String(e.message || e));
      setPhase("levels");
    }
  }, [levelId, trainId]);

  const finish = useCallback((runResult) => {
    const next = applyResult(persist.current, levelId, runResult, economy);
    commit({ ...next, _firstClear: undefined });
    setResult({ ...runResult, firstClear: next._firstClear });
    setPhase("results");
  }, [commit, economy, levelId]);

  const back = useCallback(() => {
    if (phase === "levels") { onBack(); return; }
    if (phase === "playing") { setPaused(true); return; }
    setPhase("levels");
  }, [onBack, phase]);

  useEffect(() => {
    const key = (e) => {
      if (e.key !== "Escape" || phase === "playing") return;
      e.preventDefault();
      back();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [back, phase]);

  const page = (title, pill, children) => (
    <div className="title-bg railway-page">
      <div className="title-shell shell-col">
        <div className="shell-nav">
          <button className="btn secondary" onClick={back}>
            {t(phase === "levels" ? "select.back" : "railway.backLevels")}
          </button>
          <h1 className="title-main shell-title">{title}</h1>
          <span className="title-pill">{pill}</span>
        </div>
        <FitScale pad={110}>{children}</FitScale>
      </div>
    </div>
  );

  const coinPill = <span className="railway-coins">◈ {progress.coins}</span>;

  const SLOTS = {
    levels: () => page(t("mode.pacific-railway"), t("railway.pill"), (
      <div className="railway-select">
        <div className="railway-level glass-card">
          <ScenePreview consist={consist} onScene={setSceneId} />
          <div className="railway-level-body">
            <div className="railway-level-head">
              <span className="railway-num">{String(level.number).padStart(2, "0")}</span>
              <div>
                <strong>{t(level.nameKey)}</strong>
                <small>{t("railway.corridor", {
                  from: level.corridor.fromKm.toFixed(0),
                  to: level.corridor.toKm.toFixed(2),
                })}</small>
              </div>
              {coinPill}
            </div>
            <p className="railway-brief">{t(level.briefKey)}</p>
            <ul className="railway-facts">
              <li><b>{stars(record.stars)}</b><span>{t("railway.stars")}</span></li>
              <li><b>{record.bestS ? clock(record.bestS) : "—"}</b><span>{t("railway.best")}</span></li>
              <li><b>↻ {level.loops.length}</b><span>{t("railway.loops")}</span></li>
              <li><b>{level.structures.length}</b><span>{t("railway.bridges")}</span></li>
            </ul>
            {sceneId && (
              <p className="railway-scene-tag">
                {t("railway.sceneNow")} <b>{t(RAILWAY_ART.scenes[sceneId].nameKey)}</b>
              </p>
            )}
            {error && <p className="railway-error" role="alert">{error}</p>}
            <button className="btn gold hero-play" onClick={() => { sfx.play("menu_select"); setPhase("garage"); }}>
              {t("railway.toGarage")}
            </button>
            <p className="railway-note">{t("railway.levelNote")}</p>
          </div>
        </div>
      </div>
    )),

    garage: () => page(t("railway.garage"), t("railway.garagePill"), (
      <div className="railway-select railway-garage">
        <div className="glass-card railway-garage-main">
          <div className="railway-garage-head">
            <div>
              <p className="railway-kicker">{t("railway.pickTrain")}</p>
              <strong>{t(train.nameKey)}</strong>
              <small>{t(train.taglineKey)}</small>
            </div>
            {coinPill}
          </div>
          <TrainFigure consist={consist} />
          <div className="railway-train-row">
            {RAILWAY_CATALOG.trains.map((option) => {
              const has = progress.owned.includes(option.id);
              return (
                <button
                  key={option.id}
                  className={`railway-train-chip${option.id === trainId ? " on" : ""}${has ? "" : " locked"}`}
                  aria-pressed={option.id === trainId}
                  onClick={() => { sfx.play("menu_move"); setTrainId(option.id); }}
                >
                  <b>{t(option.nameKey)}</b>
                  <small>{has ? t(option.fiche.yearKey) : `◈ ${option.price}`}</small>
                </button>
              );
            })}
          </div>
          <p className="railway-fiche">{t(train.fiche.yearKey)}</p>
        </div>

        <div className="glass-card railway-upgrades">
          <p className="railway-kicker">{t("railway.upgrades")}</p>
          {ladders.map((ladder) => (
            <div key={ladder.id} className="railway-ladder">
              <div className="railway-ladder-head">
                <b>{t(ladder.nameKey)}</b>
                <span>{ladder.level}/{ladder.max}</span>
              </div>
              <div className="railway-pips">
                {Array.from({ length: ladder.max }, (_, i) => (
                  <span key={i} className={i < ladder.level ? "on" : ""} />
                ))}
              </div>
              <small>{t(ladder.descKey)}</small>
              <button
                className="btn secondary railway-buy"
                disabled={!owned || ladder.cost === null || progress.coins < ladder.cost}
                onClick={() => {
                  sfx.play("menu_select");
                  commit(buyUpgrade(persist.current, trainId,
                    RAILWAY_CATALOG.upgrades.ladders.find((l) => l.id === ladder.id), RAILWAY_CATALOG));
                }}
              >
                {ladder.cost === null ? t("railway.maxed") : `◈ ${ladder.cost}`}
              </button>
            </div>
          ))}
          <dl className="railway-stats">
            <div><dt>{t("railway.stat.pull")}</dt><dd>{stats.pullMax.toFixed(2)} m/s²</dd></div>
            <div><dt>{t("railway.stat.top")}</dt><dd>{Math.round(stats.topSpeed * 3.6)} km/h</dd></div>
            <div><dt>{t("railway.stat.brake")}</dt><dd>{stats.brake.toFixed(1)} m/s²</dd></div>
            <div><dt>{t("railway.stat.tank")}</dt><dd>{Math.round(stats.tankL)} L</dd></div>
          </dl>
          {owned ? (
            <button className="btn gold hero-play" onClick={depart}>{t("railway.depart")}</button>
          ) : (
            <button
              className="btn gold hero-play"
              disabled={progress.coins < train.price}
              onClick={() => { sfx.play("menu_select"); commit(buyTrain(persist.current, train)); }}
            >
              {progress.coins < train.price
                ? t("railway.needCoins", { n: train.price - progress.coins })
                : t("railway.unlock", { n: train.price })}
            </button>
          )}
          <p className="railway-note">{t("railway.fuelNote", { kind: t(`railway.fuel.${train.fuelKind}`) })}</p>
        </div>
      </div>
    )),

    playing: () => (
      <div className="railway-play">
        {game && (
          <RailwayStage
            key={game.run.map.id + game.train.id + game.run.coinPickups.length + String(result?.elapsed ?? "")}
            game={game}
            paused={paused}
            onPause={() => setPaused((p) => !p)}
            onFinish={finish}
          />
        )}
        {paused && (
          <div className="railway-overlay">
            <div className="glass-card railway-pause-card">
              <p className="railway-kicker">{t("railway.paused")}</p>
              <strong>{t(level.nameKey)}</strong>
              <div className="railway-result-actions">
                <button className="btn gold" onClick={() => setPaused(false)}>{t("railway.resume")}</button>
                <button className="btn secondary" onClick={depart}>{t("railway.again")}</button>
                <button className="btn secondary" onClick={() => { setPaused(false); setPhase("garage"); }}>
                  {t("railway.garage")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    ),

    results: () => page(
      result?.arrived ? t("railway.finished") : t("railway.stopped"),
      t("railway.pill"),
      (
        <div className="railway-select">
          <div className="railway-level glass-card">
            <ScenePreview consist={consist} />
            <div className="railway-level-body">
              <div className="railway-level-head">
                <span className="railway-num">{stars(result?.stars || 0)}</span>
                <div>
                  <strong>{t(level.nameKey)}</strong>
                  <small>{t(result?.arrived ? "railway.arrived" : `railway.reason.${result?.reason || "dry"}`)}</small>
                </div>
                {coinPill}
              </div>
              <ul className="railway-facts">
                <li><b>{clock(result?.elapsed || 0)}</b><span>{t("railway.time")}</span></li>
                <li><b>{(result?.distanceM / 1000 || 0).toFixed(2)} km</b><span>{t("railway.ridden")}</span></li>
                <li><b>{result?.coinsPicked ?? 0}/{result?.coinsTotal ?? 0}</b><span>{t("railway.coins")}</span></li>
                <li><b>↻ {result?.loopsDone ?? 0}</b><span>{t("railway.loops")}</span></li>
                <li><b>{Math.round(result?.usedL || 0)} L</b><span>{t("railway.spent")}</span></li>
                <li><b>{Math.round((result?.topSpeed || 0) * 3.6)} km/h</b><span>{t("railway.topSpeed")}</span></li>
              </ul>
              <p className="railway-reward">
                ◈ +{result?.reward ?? 0} {result?.firstClear ? t("railway.firstClear", { n: economy.firstClearBonus }) : ""}
              </p>
              <div className="railway-result-actions">
                <button className="btn gold" onClick={depart}>{t("railway.again")}</button>
                <button className="btn secondary" onClick={() => setPhase("garage")}>{t("railway.garage")}</button>
                <button className="btn secondary" onClick={() => setPhase("levels")}>{t("railway.levels")}</button>
                <button className="btn secondary" onClick={onBack}>{t("railway.menu")}</button>
              </div>
            </div>
          </div>
        </div>
      ),
    ),
  };

  const ctx = {
    levels: phase === "levels",
    garage: phase === "garage",
    playing: phase === "playing",
    results: phase === "results",
  };

  return (
    <section className="railway-mode" aria-label={t("mode.pacific-railway")}>
      <Slots screen={UI_SCREEN.RAILWAY} region="main" ctx={ctx} slots={SLOTS} />
    </section>
  );
}
