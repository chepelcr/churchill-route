import React, { useState } from "react";
import { useT } from "../i18n/index.js";
import { tuning } from "../game/tuning.js";
import { sfx } from "../game/audio.js";

// Speed, camera zoom and music are set up front, before the tutorial starts.
// `hint` points to Settings, where the same choices remain available.
export default function DriveTuning({ hint = false }) {
  const t = useT();
  const [spd, setSpd] = useState(Math.round(tuning.speed * 100));
  const [zoom, setZoom] = useState(Math.round(tuning.zoom * 100));
  const [station, setStation] = useState(sfx.station);
  return (
    <div className="settings-rows drive-tuning">
      <div className="set-row">
        <span className="set-lbl">{t("settings.speed")}</span>
        <div className="vol-wrap">
          <input type="range" min="70" max="120" step="5" value={spd}
            onChange={(e) => { const v = +e.target.value; setSpd(v); tuning.setSpeed(v / 100); }}
            aria-label={t("settings.speed")} />
          <span className="vol-pct">{spd}%</span>
        </div>
      </div>
      <div className="set-row">
        <span className="set-lbl">{t("settings.zoom")}</span>
        <div className="vol-wrap">
          <input type="range" min="60" max="140" step="10" value={zoom}
            onChange={(e) => { const v = +e.target.value; setZoom(v); tuning.setZoom(v / 100); }}
            aria-label={t("settings.zoom")} />
          <span className="vol-pct">{zoom}%</span>
        </div>
      </div>
      <div className="set-row">
        <span className="set-lbl">{t("settings.station")}</span>
        <div className="lang-toggle station-pick">
          {sfx.stations.map((id) => (
            <button key={id} className={"btn " + (station === id ? "gold" : "secondary")}
              onClick={() => { setStation(sfx.setStation(id)); sfx.play("menu_select"); }}>
              {t(`radio.${id}`)}
            </button>
          ))}
        </div>
      </div>
      {hint && <p className="set-desc drive-tuning-hint">{t("tuning.later")}</p>}
    </div>
  );
}
