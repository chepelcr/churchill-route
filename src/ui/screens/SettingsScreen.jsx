import React, { useState, useEffect } from "react";
import { Game } from "../../game/index.js";
import { sfx } from "../../game/audio.js";
import { useT, getLang, setLang } from "../../i18n/index.js";
import { iap } from "../../monetize/iap.js";

// App config: language, volume/mute, remove-ads purchase, tutorial replay,
// progress reset. Reachable from the title (⚙) and the pause menu.
export default function SettingsScreen({ onBack, onTutorial, onSupporters }) {
  const t = useT();
  const [muted, setMuted] = useState(sfx.muted);
  const [vol, setVol] = useState(Math.round(sfx.volume * 100));
  const [confirming, setConfirming] = useState(false);
  const [, bump] = useState(0);
  useEffect(() => iap.onChange(() => bump((n) => n + 1)), []);

  const changeVol = (v) => {
    setVol(v);
    sfx.setVolume(v / 100);
    if (sfx.muted) setMuted(sfx.toggleMuted()); // sliding un-mutes
  };
  const version = (typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__) || "dev";

  return (
    <div className="title-bg">
      <div className="title-shell">
        <div className="title-card settings-card">
          <button className="btn secondary back-btn" onClick={onBack}>{t("settings.back")}</button>
          <h1 className="title-main" style={{ fontSize: 34 }}>{t("settings.title")}</h1>

          <div className="settings-rows">
            <div className="set-row">
              <span className="set-lbl">{t("settings.language")}</span>
              <div className="lang-toggle">
                {["es", "en"].map((l) => (
                  <button key={l} className={"btn " + (getLang() === l ? "gold" : "secondary")}
                    onClick={() => { setLang(l); sfx.play("menu_select"); }}>
                    {l === "es" ? "Español" : "English"}
                  </button>
                ))}
              </div>
            </div>

            <div className="set-row">
              <span className="set-lbl">{t("settings.volume")}</span>
              <div className="vol-wrap">
                <button className="tool-pill" onClick={() => setMuted(sfx.toggleMuted())}
                  aria-label={t("settings.muted")}>{muted ? "🔇" : "🔊"}</button>
                <input type="range" min="0" max="100" value={muted ? 0 : vol}
                  onChange={(e) => changeVol(+e.target.value)}
                  aria-label={t("settings.volume")} />
                <span className="vol-pct">{muted ? t("settings.muted") : `${vol}%`}</span>
              </div>
            </div>

            <div className="set-row">
              <span className="set-lbl">{t("settings.removeAds")}</span>
              <div className="iap-wrap">
                {iap.owned ? (
                  <span className="iap-owned">{t("settings.removeAds.owned")}</span>
                ) : iap.isNative ? (
                  iap.available ? (
                    <>
                      <span className="set-desc">{t("settings.removeAds.desc")}</span>
                      <button className="btn gold" onClick={() => iap.buy()}>
                        {t("settings.buy")}{iap.price ? ` · ${iap.price}` : ""}
                      </button>
                      <button className="btn secondary" onClick={() => iap.restore()}>
                        {t("settings.restore")}
                      </button>
                    </>
                  ) : (
                    // sideloaded APK / product not live yet: Play Billing only
                    // works for installs that came through Google Play
                    <span className="set-desc">{t("settings.removeAds.play")}</span>
                  )
                ) : (
                  <span className="set-desc">{t("settings.removeAds.web")}</span>
                )}
              </div>
            </div>

            <div className="set-row">
              <span className="set-lbl">{t("mode.tutorial")}</span>
              <button className="btn secondary" onClick={onTutorial}>{t("settings.tutorial")}</button>
            </div>

            {onSupporters && (
              <div className="set-row">
                <span className="set-lbl">{t("settings.supporters")}</span>
                <button className="btn secondary" onClick={onSupporters}>❤ {t("sup.title")}</button>
              </div>
            )}

            <div className="set-row">
              <span className="set-lbl">{t("settings.reset")}</span>
              {confirming ? (
                <div className="lang-toggle">
                  <span className="set-desc">{t("settings.resetQ")}</span>
                  <button className="btn" onClick={() => { Game.resetProgress(); setConfirming(false); }}>{t("select.yes")}</button>
                  <button className="btn secondary" onClick={() => setConfirming(false)}>{t("select.no")}</button>
                </div>
              ) : (
                <button className="btn secondary" onClick={() => setConfirming(true)}>↺</button>
              )}
            </div>
          </div>

          <div className="settings-credits">{t("settings.credits", { version })}</div>
        </div>
      </div>
    </div>
  );
}
