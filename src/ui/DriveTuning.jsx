import React, { useState } from "react";
import { useT } from "../i18n/index.js";
import { tuning } from "../game/tuning.js";

// The two "how does it drive" dials — vehicle speed and camera zoom — as one
// reusable block. Shown UP FRONT at the tutorial (so a first-time player sets
// a comfortable feel before learning anything else) and again in Settings.
// `hint` prints the "you can change this later" line; the Settings copy hides
// it, since that IS the later.
export default function DriveTuning({ hint = false }) {
  const t = useT();
  const [spd, setSpd] = useState(Math.round(tuning.speed * 100));
  const [zoom, setZoom] = useState(Math.round(tuning.zoom * 100));
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
      {hint && <p className="set-desc drive-tuning-hint">{t("tuning.later")}</p>}
    </div>
  );
}
