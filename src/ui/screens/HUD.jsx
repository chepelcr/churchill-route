import React, { useMemo, useState } from "react";
import { Game } from "../../game/index.js";
import { WORLD2D as WORLD } from "../../world2d/index.js";
import { sfx } from "../../game/audio.js";

const SURF = ["agua", "cuadra", "playa", "calle", "paseo", "puente", "acera"];

export default function HUD({ onPause }) {
  const [muted, setMuted] = useState(sfx.muted);
  const [debug, setDebug] = useState(Game.state.debug);
  const s = Game.state;
  const district = s.p ? WORLD.districtAt(s.p.x, s.p.y) : null;
  const toggleDebug = () => {
    const v = !Game.state.debug;
    Game.state.debug = v; setDebug(v);
    try { localStorage.setItem("churchill_debug", v ? "1" : "0"); } catch (e) {}
  };
  const toast = s.districtToast;
  // fade in over 0.3s, hold, fade out over the last 0.5s of the 2.6s life
  const toastOpacity = toast ? Math.max(0, Math.min(1, toast.t / 0.3, (2.6 - toast.t) / 0.5)) : 0;
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
          <button className={"hud-btn" + (debug ? " on" : "")} onClick={toggleDebug}
            aria-label="Coordenadas de depuración">📍</button>
          <button className="hud-btn" onClick={() => setMuted(sfx.toggleMuted())}
            aria-label={muted ? "Activar sonido" : "Silenciar"}>{muted ? "🔇" : "🔊"}</button>
          <button className="hud-btn" onClick={onPause} aria-label="Pausa">⏸</button>
        </div>
      )}

      {debug && (
        <div className="debug-coords">
          x {Math.round(s.p.x)} · y {Math.round(s.p.y)}
          <span className="sep"> | </span>{SURF[WORLD.surfaceAt(s.p.x, s.p.y)] || "?"}
          <span className="sep"> | </span>{district.id}
        </div>
      )}

      <div className="district-tab">
        <span className="sw" style={{ background: district.tone }}></span>
        <span className="nm">{district.name}</span>
      </div>

      {toast && toastOpacity > 0 && (
        <div className="district-toast" style={{ opacity: toastOpacity, borderColor: toast.tone }}>
          <div className="dt-kicker" style={{ color: toast.tone }}>ENTRÁS A</div>
          <div className="dt-name">{toast.name}</div>
          <div className="dt-rule" style={{ background: toast.tone }}></div>
        </div>
      )}

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
