import React, { useMemo, useState } from "react";
import { Game } from "../../game/index.js";
import { WORLD } from "../../world/index.js";
import { sfx } from "../../game/audio.js";

export default function HUD({ onPause }) {
  const [muted, setMuted] = useState(sfx.muted);
  const s = Game.state;
  const district = WORLD.districtAt(s.p.x);
  const meltPct = s.carrying ? Math.min(1, s.carrying.melt / s.carrying.total) : 0;
  const quip = useMemo(() => {
    if (!s.carrying) return "";
    if (meltPct < 0.2) return "Helado todavía — pura vida.";
    if (meltPct < 0.5) return "Empieza a sudar la copa…";
    if (meltPct < 0.8) return "¡La leche se está aguando!";
    return "¡Acelerá! ¡Se derrite!";
  }, [meltPct, s.carrying]);

  return (
    <div className="ui-layer">
      <div className="hud-top">
        <div className="hud-card score">
          <div className="lbl">Puntos</div>
          <div className="val">{s.score.toLocaleString()}</div>
        </div>
        <div className="hud-card combo">
          <div className="lbl">Combo</div>
          <div className="val">×{s.combo}</div>
        </div>
        {s.mode === "explore" ? (
          <div className="hud-card">
            <div className="lbl">Modo</div>
            <div className="val" style={{ fontSize: 14 }}>RECORRER</div>
          </div>
        ) : (
          <div className={"hud-card timer" + (s.timeLeft < 20 ? " urgent" : "")}>
            <div className="lbl">Tiempo</div>
            <div className="val">{Math.ceil(s.timeLeft).toString().padStart(2, "0")}s</div>
          </div>
        )}
        {s.stage ? (
          <div className="hud-card">
            <div className="lbl">Nivel {String(s.stage.num).padStart(2, "0")}</div>
            <div className="val">{s.stageDeliveries}/{s.stageTarget}</div>
          </div>
        ) : (
          <div className="hud-card">
            <div className="lbl">Entregas</div>
            <div className="val">{s.deliveries}</div>
          </div>
        )}
      </div>

      {onPause && (
        <div className="hud-right">
          <button className="hud-btn" onClick={() => setMuted(sfx.toggleMuted())}
            aria-label={muted ? "Activar sonido" : "Silenciar"}>{muted ? "🔇" : "🔊"}</button>
          <button className="hud-btn" onClick={onPause} aria-label="Pausa">⏸</button>
        </div>
      )}

      <div className="district-tab">
        <span className="sw" style={{ background: district.tone }}></span>
        <span className="nm">{district.name}</span>
      </div>

      {s.storyTip && <div className="story-tip">↳ {s.storyTip}</div>}

      {s.carrying && (
        <div className="melt-bar">
          <div className="row">
            <span className="name">→ {s.carrying.customer.name}</span>
            <span className="pct">{Math.round((1 - meltPct) * 100)}% hielo</span>
          </div>
          <div className="bar"><div className="fill" style={{ width: `${meltPct * 100}%` }}></div></div>
          <div className="quip">{quip} <span style={{ opacity: 0.5 }}>· {s.carrying.customer.line}</span></div>
        </div>
      )}
    </div>
  );
}
