import React, { useState, useEffect, useRef } from "react";
import { Game } from "../../game/index.js";
import { WORLD2D as WORLD } from "../../world2d/index.js";
import { sfx } from "../../game/audio.js";
import { isMvpLocked } from "../../game/progress.js";
import { economy, COLORS } from "../../game/economy.js";
import { useT, stageName, stageBrief } from "../../i18n/index.js";
import VehiclePreview from "../VehiclePreview.jsx";
import FitScale from "../FitScale.jsx";
import Icon from "../Icon.jsx";

export const WEATHER_ICON = { sunny: "sun", sunset: "sunset", storm: "storm", night: "moon" };

export default function StageSelect({ onStart, onBack }) {
  const t = useT();
  const stages = WORLD.STAGES;
  const vehicles = Game.VEHICLES;
  const vehKeys = Object.keys(vehicles);
  const cleared = Game.state.progress.clearedStages;
  // MVP: stages set in the gated eastern districts ship in a later release
  const isMvp = (i) => isMvpLocked(stages[i].district);
  const isLocked = (i) => isMvp(i) || (i > 0 && !cleared.includes(stages[i - 1].id));
  // start on the first not-yet-cleared stage so you land on "where you are"
  const firstOpen = Math.max(0, stages.findIndex((s, i) => !cleared.includes(s.id) && !isMvp(i)));

  const [cur, setCur] = useState(firstOpen < 0 ? 0 : firstOpen);
  const [veh, setVeh] = useState(Game.state.vehicleKey || "scooter");
  const [confirming, setConfirming] = useState(false);
  const [, bump] = useState(0);

  const doReset = () => { Game.resetProgress(); setConfirming(false); bump((n) => n + 1); };
  // Equip a paint you own for the selected ride (unowned colours live in the Shop).
  const pickColor = (id) => {
    if (id && !economy.ownsColor(id)) { sfx.play("menu_denied"); return; }
    economy.equipColor(veh, id); sfx.play("menu_move"); bump((n) => n + 1);
  };

  // keep the latest values reachable from the mount-once key/pad handlers
  const st = useRef({});
  st.current = { cur, veh };

  const moveStage = (d) => setCur((c) => {
    const n = Math.max(0, Math.min(stages.length - 1, c + d));
    if (n !== c) sfx.play("menu_move");
    return n;
  });
  const moveVeh = (d) => setVeh((k) => {
    // skip vehicles you don't own yet (they're bought in the Shop)
    let i = vehKeys.indexOf(k);
    for (let step = 0; step < vehKeys.length; step++) {
      i = (i + d + vehKeys.length) % vehKeys.length;
      if (economy.ownsVehicle(vehKeys[i])) break;
    }
    sfx.play("menu_move");
    return vehKeys[i];
  });
  const play = (i) => {
    if (isLocked(i)) { sfx.play("menu_denied"); return; }
    sfx.play("menu_select"); onStart(i, st.current.veh);
  };

  useEffect(() => {
    const onKey = (e) => {
      switch (e.key) {
        case "ArrowLeft": e.preventDefault(); moveStage(-1); break;
        case "ArrowRight": e.preventDefault(); moveStage(1); break;
        case "ArrowUp": e.preventDefault(); moveVeh(-1); break;
        case "ArrowDown": e.preventDefault(); moveVeh(1); break;
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
        const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
        const d = {
          l: pressed(14) || ax < -0.5, r: pressed(15) || ax > 0.5,
          u: pressed(12) || ay < -0.5, dn: pressed(13) || ay > 0.5,
        };
        for (const k in d) {
          if (d[k] && (!prev[k] || now - last > 240)) {
            if (k === "l") moveStage(-1); else if (k === "r") moveStage(1);
            else if (k === "u") moveVeh(-1); else moveVeh(1);
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
      <div className="title-shell">
        <FitScale>
        <div className="stage-select-wrap">
          <button className="btn secondary back-btn" onClick={onBack}>{t("select.back")}</button>

          <div className="stage-head">
            <span className="title-pill"><span className="dot"></span>{t("select.pill")}</span>
            <h1 className="title-main stage-title">LA RUTA</h1>
          </div>

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

            <div className="glass-card vehicle-card">
              <div className="vehicle-card-title">{t("select.vehicle")}</div>
              <VehiclePreview vehKey={veh} color={economy.equippedColor(veh)?.hex || null} />
              <div className="vehicles-col">
                {vehKeys.map((k) => {
                  const has = economy.ownsVehicle(k);
                  return (
                    <button key={k} className={"vchip " + (veh === k ? "active" : "") + (has ? "" : " locked")}
                      onClick={() => { if (has) { sfx.play("menu_select"); setVeh(k); } else sfx.play("menu_denied"); }}>
                      {has ? vehicles[k].name : <><Icon name="lock" size={12} /> {vehicles[k].name}</>}
                    </button>
                  );
                })}
              </div>
              <div className="veh-colors">
                <button className={"swatch stock" + (!economy.equippedColor(veh) ? " equipped" : "")}
                  title={t("shop.stock")} onClick={() => pickColor(null)}>↺</button>
                {COLORS.map((c) => {
                  const has = economy.ownsColor(c.id);
                  const eq = economy.equippedColor(veh)?.id === c.id;
                  return (
                    <button key={c.id} className={"swatch" + (eq ? " equipped" : "") + (has ? "" : " locked")}
                      style={{ background: c.hex }} title={`${c.name}${has ? "" : ` · ${c.price}`}`}
                      onClick={() => pickColor(c.id)}>
                      {!has && <Icon name="lock" size={10} />}{eq && "✓"}
                    </button>
                  );
                })}
              </div>
              <div className="reset-row">
                {confirming ? (
                  <>
                    <span>{t("select.resetQ")}</span>
                    <button className="btn" onClick={doReset}>{t("select.yes")}</button>
                    <button className="btn secondary" onClick={() => setConfirming(false)}>{t("select.no")}</button>
                  </>
                ) : (
                  <button className="btn secondary" onClick={() => setConfirming(true)}>{t("select.reset")}</button>
                )}
              </div>
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
