import React, { useState, useEffect, useRef } from "react";
import { useMenuNav } from "../useMenuNav.js";
import { sfx } from "../../game/audio.js";
import { tutorialDone } from "../../game/tutorial.js";
import { economy } from "../../game/economy.js";
import { needsIosFullscreenHint, dismissIosFullscreenHint } from "../immersive.js";
import { useT } from "../../i18n/index.js";
import CoinIcon from "../CoinIcon.jsx";
import FitScale from "../FitScale.jsx";
import Icon from "../Icon.jsx";

// Hide the APK download in the native app (only offer it on the web).
const IS_NATIVE = typeof window !== "undefined" && !!window.Capacitor;

const MODE_IDS = [
  { id: "story",    swatch: "#ffe06b" },
  { id: "explore",  swatch: "#6fbf99" },
  { id: "arcade",   swatch: "#ff3d80" },
];

export default function TitleScreen({ onPickMode, onSettings, onSupporters, onShop }) {
  const t = useT();
  const [muted, setMuted] = useState(sfx.muted);
  const [info, setInfo] = useState(false);
  const [iosHint, setIosHint] = useState(needsIosFullscreenHint());
  const infoRef = useRef(null);
  const firstRun = !tutorialDone();
  const pick = (id) => { sfx.play("menu_select"); onPickMode(id); };
  const [idx, setIdx] = useMenuNav({
    count: MODE_IDS.length,
    cols: MODE_IDS.length,
    onSelect: (i) => pick(MODE_IDS[i].id),
  });

  // close the info bubble on any click/tap outside it
  useEffect(() => {
    if (!info) return;
    const onDown = (e) => { if (infoRef.current && !infoRef.current.contains(e.target)) setInfo(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [info]);

  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

  return (
    <div className="title-bg">
      <div className="title-shell">
        <FitScale>
        <div className="title-card">
          <div className="title-head-row">
            <span className="title-pill"><span className="dot"></span>{t("title.pill")}</span>
            <div className="title-tools">
              <div className="info-wrap" ref={infoRef}>
                <button className="tool-pill" onClick={() => { sfx.play("menu_move"); setInfo((v) => !v); }}
                  aria-label={t("title.how.title")} aria-expanded={info}>{info ? "✕" : "ⓘ"}</button>
                {info && (
                  <div className="info-bubble" role="dialog" aria-label={t("title.how.title")}>
                    <div className="info-bubble-title">{t("title.how.title")}</div>
                    <p>{t("title.how.body")}</p>
                  </div>
                )}
              </div>
              <button className={"tool-pill" + (firstRun ? " pulse" : "")}
                onClick={() => pick("tutorial")} aria-label={t("mode.tutorial")}><Icon name="cap" /></button>
              <button className="tool-pill coin-tool" onClick={() => { sfx.play("menu_move"); onShop(); }}
                aria-label={t("shop.title")}><Icon name="cart" /> <CoinIcon size={14} /> {economy.coins.toLocaleString()}</button>
              <button className="tool-pill" onClick={() => { sfx.play("menu_move"); onSupporters(); }}
                aria-label={t("sup.title")}><Icon name="heart" /></button>
              <button className="tool-pill" onClick={() => { sfx.play("menu_move"); onSettings(); }}
                aria-label={t("settings.title")}><Icon name="gear" /></button>
              <button className="tool-pill" onClick={() => setMuted(sfx.toggleMuted())}
                aria-label={t("settings.muted")}><Icon name={muted ? "mute" : "sound"} /></button>
            </div>
          </div>
          <h1 className="title-main">LA RUTA DEL CHURCHILL</h1>
          <div className="title-sub">{t("title.sub")}</div>

          {iosHint && (
            <div className="ios-hint">
              <span><Icon name="phone" size={14} /> {t("ios.hint")}</span>
              <button className="tool-pill" aria-label="✕"
                onClick={() => { dismissIosFullscreenHint(); setIosHint(false); }}>✕</button>
            </div>
          )}

          <div className="modes" style={{ gridTemplateColumns: `repeat(${MODE_IDS.length}, 1fr)`, maxWidth: 760, margin: "16px auto" }}>
            {MODE_IDS.map((m, i) => (
              <button key={m.id}
                className={"mode" + (idx === i ? " focused" : "")}
                onMouseEnter={() => setIdx(i)} onClick={() => pick(m.id)}>
                <div className="mt"><span className="sw" style={{ background: m.swatch }}></span>{t(`mode.${m.id}`)}</div>
                <div className="ms">{t(`mode.${m.id}.tag`)}</div>
              </button>
            ))}
          </div>

          {!IS_NATIVE && (
            <a className="apk-btn" href="/churchill.apk" download>
              <span aria-hidden="true">↓</span> {t("title.apk")}
            </a>
          )}

          <div className="controls-hint">
            {coarse ? (
              <span>{t("title.hint.touch")}</span>
            ) : (
              <>
                <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> {t("title.hint.drive")}</span>
                <span><kbd>Space</kbd> {t("title.hint.drift")}</span>
                <span><kbd>X</kbd> {t("title.hint.turbo")}</span>
                <span><kbd>P</kbd> {t("title.hint.pause")}</span>
                <span>{t("title.hint.pad")}</span>
              </>
            )}
          </div>
        </div>
        </FitScale>
      </div>
    </div>
  );
}
