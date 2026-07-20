import React, { useState, useEffect, useRef } from "react";
import { Game } from "../../game/index.js";
import { WORLD2D as WORLD } from "../../world2d/index.js";
import { sfx } from "../../game/audio.js";
import { isMvpLocked } from "../../game/progress.js";
import { useT, stageName, stageBrief } from "../../i18n/index.js";
import FitScale from "../FitScale.jsx";
import Icon from "../Icon.jsx";

export const WEATHER_ICON = { sunny: "sun", sunset: "sunset", storm: "storm", night: "moon" };

export default function StageSelect({ onStart, onBack }) {
  const t = useT();
  const stages = WORLD.STAGES;
  const cleared = Game.state.progress.clearedStages;
  // MVP: stages set in the gated eastern districts ship in a later release
  const isMvp = (i) => isMvpLocked(stages[i].district);
  const isLocked = (i) => isMvp(i) || (i > 0 && !cleared.includes(stages[i - 1].id));
  // start on the first not-yet-cleared stage so you land on "where you are"
  const firstOpen = Math.max(0, stages.findIndex((s, i) => !cleared.includes(s.id) && !isMvp(i)));

  const [cur, setCur] = useState(firstOpen < 0 ? 0 : firstOpen);

  // keep the latest values reachable from the mount-once key/pad handlers
  const st = useRef({});
  st.current = { cur };

  const moveStage = (d) => setCur((c) => {
    const n = Math.max(0, Math.min(stages.length - 1, c + d));
    if (n !== c) sfx.play("menu_move");
    return n;
  });
  const play = (i) => {
    if (isLocked(i)) { sfx.play("menu_denied"); return; }
    sfx.play("menu_select"); onStart(i);
  };

  useEffect(() => {
    const onKey = (e) => {
      switch (e.key) {
        case "ArrowLeft": e.preventDefault(); moveStage(-1); break;
        case "ArrowRight": e.preventDefault(); moveStage(1); break;
        case "Enter": case " ": e.preventDefault(); play(st.current.cur); break;
        case "Escape": case "Backspace": e.preventDefault(); onBack(); break;
        default: break;
      }
    };
    window.addEventListener("keydown", onKey);

    let raf, prev = {}, last = 0;
    const poll = () => {
      const p = Array.from(navigator.getGamepads ? navigator.getGamepads() : []).find(Boolean);
      if (p) {
        const now = performance.now();
        const pressed = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
        const ax = p.axes[0] || 0;
        const d = { l: pressed(14) || ax < -0.5, r: pressed(15) || ax > 0.5 };
        for (const k in d) {
          if (d[k] && (!prev[k] || now - last > 240)) {
            k === "l" ? moveStage(-1) : moveStage(1);
            last = now;
          }
          prev[k] = d[k];
        }
        const a = pressed(0), b = pressed(1);
        if (a && !prev.a) play(st.current.cur);
        if (b && !prev.b) onBack();
        prev.a = a; prev.b = b;
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);
    return () => { window.removeEventListener("keydown", onKey); cancelAnimationFrame(raf); };
  }, []);

  const s = stages[cur];
  const locked = isLocked(cur);
  const done = cleared.includes(s.id);

  return (
    <div className="title-bg">
      <div className="title-shell shell-col">
        <div className="shell-nav">
          <button className="btn secondary" onClick={onBack}>{t("select.back")}</button>
          <h1 className="title-main shell-title">LA RUTA</h1>
          <span className="title-pill"><span className="dot"></span>{t("select.pill")}</span>
        </div>
        <FitScale pad={110}>
        <div className="stage-select-wrap">
          <div className="stage-layout">
            <div className="stage-carousel">
              <button className="carousel-arrow" onClick={() => moveStage(-1)} disabled={cur === 0} aria-label="Anterior">‹</button>

              <div className={"stage-hero glass-card" + (locked ? " locked" : "") + (done ? " done" : "")}>
                <div className="hero-top">
                  <span className="hero-num">{String(s.num).padStart(2, "0")}</span>
                  <span className="hero-count">{t("select.of", { n: s.num, total: stages.length })}</span>
                  {done && <span className="hero-badge ok">{t("select.done")}</span>}
                  {locked && <span className="hero-badge no">{isMvp(cur) ? t("select.soon") : <><Icon name="lock" size={12} /> {t("select.locked")}</>}</span>}
                </div>
                <div className="hero-name">{stageName(s)}</div>
                <p className="hero-brief">{locked
                  ? (isMvp(cur) ? t("select.soonBrief") : t("select.lockedBrief", { n: s.num - 1 }))
                  : stageBrief(s)}</p>
                <div className="hero-meta">
                  <span><b>{s.targetDeliveries}</b> {t("select.deliveries")}</span>
                  <span><b>{s.timeLimit}s</b> {t("select.time")}</span>
                  <span><Icon name={WEATHER_ICON[s.weather] || "sun"} size={14} /> {t(`weather.${s.weather}`)}</span>
                </div>
                <button className="btn gold hero-play" onClick={() => play(cur)} disabled={locked}>
                  {locked ? (isMvp(cur) ? t("select.playSoon") : t("select.playLocked")) : t("select.play")}
                </button>
              </div>

              <button className="carousel-arrow" onClick={() => moveStage(1)} disabled={cur === stages.length - 1} aria-label="Siguiente">›</button>
            </div>
          </div>

          <div className="stage-dots">
            {stages.map((sg, i) => (
              <button key={sg.id}
                className={"dot" + (i === cur ? " on" : "") + (cleared.includes(sg.id) ? " cleared" : "") + (isLocked(i) ? " locked" : "")}
                onClick={() => { if (i !== cur) { sfx.play("menu_move"); setCur(i); } }}
                aria-label={t("select.level", { n: sg.num })}></button>
            ))}
          </div>
        </div>
        </FitScale>
      </div>
    </div>
  );
}
