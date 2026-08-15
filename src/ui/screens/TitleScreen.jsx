import React, { useState, useEffect, useRef } from "react";
import { useMenuNav } from "../useMenuNav.js";
import { sfx } from "../../game/audio.js";
import { tutorialDone } from "../../game/tutorial.js";
import { economy } from "../../game/economy.js";
import { needsIosFullscreenHint, dismissIosFullscreenHint } from "../immersive.js";
import { useT } from "../../i18n/index.js";
import CoinIcon from "../CoinIcon.jsx";
import Icon from "../Icon.jsx";
import Slots from "../Slots.jsx";
import { UI_SCREEN } from "../../domain/vocabulary.generated.js";

// Hide the APK download in the native app (only offer it on the web).
const IS_NATIVE = typeof window !== "undefined" && !!window.Capacitor;

// The swatch is the mode's accent, and each of these three was an exact
// duplicate of a theme token (`--amber`, `--mint`, `--rose`) written out again
// — the styles.css sweep took the stylesheet and never looked at the inline
// styles in the JSX. An icon's internal fills stay in the icon, because those
// are one drawing's own recipe; a mode's accent is the theme's.
const MODE_IDS = [
  { id: "story",    swatch: "var(--amber)" },
  { id: "explore",  swatch: "var(--mint)" },
  { id: "arcade",   swatch: "var(--rose)" },
];

export default function TitleScreen({ editorConfig, onPickMode, onSettings, onSupporters, onShop }) {
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

  // The blocks this screen can show — `src/ui/screens.json` decides which of
  // them appear and in what order. The tools row stays in the shell below
  // because it is the card's chrome, not a block of the page.
  const SLOTS = {
    wordmark: () => <>
      <h1 className="title-main">{editorConfig?.title || t("title.main")}</h1>
      <div className="title-sub">{editorConfig?.subtitle || t("title.sub")}</div>
    </>,
    iosHint: () => (
      <div className="ios-hint">
        <span><Icon name="phone" size={14} /> {t("ios.hint")}</span>
        <button className="tool-pill" aria-label="✕"
          onClick={() => { dismissIosFullscreenHint(); setIosHint(false); }}>✕</button>
      </div>
    ),
    modes: () => (
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
    ),
    apk: () => (
      <a className="apk-btn" href="/churchill.apk" download>
        <span aria-hidden="true">↓</span> {t("title.apk")}
      </a>
    ),
    controlsHint: () => (
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
    ),
  };
  // Negations and compounds are KEYS, never expressions — `Slots` cannot parse
  // one, deliberately.
  const ctx = {
    showIosHint: !!iosHint,
    canDownloadApk: !IS_NATIVE,
    hasKeyboard: true,
  };
  const slot = (region) => <Slots screen={UI_SCREEN.TITLE} region={region} ctx={ctx} slots={SLOTS} />;

  return (
    <div className="page-card title-page">
      <div className="page-head">
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
      <div className="page-body">
          {slot("main")}
          {slot("footer")}
      </div>
    </div>
  );
}
