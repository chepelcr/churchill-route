// Vehicle preview card content: the exact in-game sprite (paintVehicle from
// the render backend), big, on a little asphalt swatch, plus stat bars.
import React, { useRef, useEffect } from "react";
import { paintVehicle } from "../render/Renderer.js";
import { VEHICLES } from "../game/vehicles.js";
import { useT } from "../i18n/index.js";

const STAT_RANGE = (() => {
  const vs = Object.values(VEHICLES);
  const r = (f) => [Math.min(...vs.map(f)), Math.max(...vs.map(f))];
  return { top: r(v => v.top), accel: r(v => v.accel), grip: r(v => v.grip) };
})();
const norm = ([lo, hi], v) => 0.15 + 0.85 * ((v - lo) / (hi - lo || 1));

export default function VehiclePreview({ vehKey, color = null }) {
  const t = useT();
  const ref = useRef(null);
  // optional paint override (equipped shop color) — paintVehicle reads veh.color
  const veh = VEHICLES[vehKey] && color ? { ...VEHICLES[vehKey], color } : VEHICLES[vehKey];

  useEffect(() => {
    const c = ref.current;
    if (!c || !veh) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    // asphalt pad with a center dash, like the streets
    g.fillStyle = "#3c3a44";
    g.beginPath(); g.roundRect(0, h * 0.18, w, h * 0.64, 12); g.fill();
    g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 2.5;
    g.setLineDash([10, 12]);
    g.beginPath(); g.moveTo(8, h / 2); g.lineTo(w - 8, h / 2); g.stroke();
    g.setLineDash([]);
    // sprite, scaled to fill (~4-5x its in-game size), facing right
    const scale = Math.min((w * 0.6) / veh.w, (h * 0.6) / veh.h);
    g.save();
    g.translate(w / 2 + 3 * (scale / 5), h / 2 + 4 * (scale / 5));
    g.scale(scale, scale);
    g.fillStyle = "rgba(0,0,0,0.35)"; g.fillRect(-veh.w / 2, -veh.h / 2, veh.w, veh.h);
    g.restore();
    g.save();
    g.translate(w / 2, h / 2);
    g.scale(scale, scale);
    paintVehicle(g, vehKey, veh);
    g.restore();
  }, [vehKey, veh, color]);

  if (!veh) return null;
  const bars = [
    [t("veh.speed"), norm(STAT_RANGE.top, veh.top), "var(--gold)"],
    [t("veh.accel"), norm(STAT_RANGE.accel, veh.accel), "var(--coral)"],
    [t("veh.grip"), norm(STAT_RANGE.grip, veh.grip), "var(--teal)"],
  ];
  return (
    <div className="veh-preview">
      <canvas ref={ref} className="veh-canvas" aria-label={veh.name}></canvas>
      <div className="veh-name">{veh.name}</div>
      <div className="veh-stats">
        {bars.map(([label, pct, color]) => (
          <div className="veh-stat" key={label}>
            <span className="lbl">{label}</span>
            <span className="bar"><span className="fill" style={{ width: `${pct * 100}%`, background: color }}></span></span>
          </div>
        ))}
        <div className="veh-stat">
          <span className="lbl">{t("veh.ice")}</span>
          <span className="ice">{veh.melt <= 0.6 ? "❄❄❄" : veh.melt <= 0.9 ? "❄❄" : "❄"}</span>
        </div>
      </div>
    </div>
  );
}
