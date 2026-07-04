/* La Ruta del Churchill — React UI v2 (with stage select + missions) */

const { useState, useEffect, useRef, useMemo } = React;

const MODE_CARDS = [
  { id: "story",   name: "Historia",  swatch: "#ffe06b", tag: "7 etapas. De El Faro al Puente de Mata de Limón." },
  { id: "explore", name: "Recorrer",  swatch: "#6fbf99", tag: "Mundo abierto. Distritos se desbloquean al limpiar etapas." },
  { id: "arcade",  name: "Arcade",    swatch: "#ff3d80", tag: "3 minutos, peninsula libre, combo a tope." },
];

// ---- Title screen -----------------------------------------------------------
function TitleScreen({ onPickMode }) {
  return (
    <div className="title-bg">
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        <div style={{ position: "absolute", left: "-40px", bottom: "-20px", fontSize: "240px", lineHeight: 1, opacity: 0.35 }}>🌴</div>
        <div style={{ position: "absolute", right: "-30px", bottom: "-30px", fontSize: "300px", lineHeight: 1, opacity: 0.28 }}>🌴</div>
      </div>
      <div className="title-shell">
        <div className="title-card">
          <span className="title-pill"><span className="dot"></span>PUNTARENAS · COSTA RICA · ARCADE 2026</span>
          <h1 className="title-main">LA RUTA DEL CHURCHILL</h1>
          <div className="title-sub">¡PURA VIDA, MAE!</div>
          <p className="title-tag">
            Sos repartidor de Churchills en El Puerto. Recogé en el kiosco rojo y blanco del{" "}
            <em>Paseo de los Turistas</em>, llegá al cliente antes que el hielo se derrita. Drift, esquivá
            gaviotas, atravesá Carmen, el Mercado, Las Playitas hasta Mata de Limón.
          </p>

          <div className="modes" style={{ gridTemplateColumns: "repeat(3, 1fr)", maxWidth: 760, margin: "18px auto" }}>
            {MODE_CARDS.map((m) => (
              <button key={m.id} className="mode" onClick={() => onPickMode(m.id)}>
                <div className="mt"><span className="sw" style={{ background: m.swatch }}></span>{m.name}</div>
                <div className="ms">{m.tag}</div>
              </button>
            ))}
          </div>

          <div className="controls-hint">
            <span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> manejar</span>
            <span><kbd>Space</kbd> drift</span>
            <span><kbd>X</kbd> turbo</span>
            <span><kbd>P</kbd> pausa</span>
            <span>controller / touch OK</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Stage select -----------------------------------------------------------
function StageSelect({ onStart, onBack }) {
  const stages = window.WORLD.STAGES;
  const vehicles = window.Game.VEHICLES;
  const cleared = window.Game.state.progress.clearedStages;
  const [veh, setVeh] = useState(window.Game.state.vehicleKey || "scooter");
  const isLocked = (i) => i > 0 && !cleared.includes(stages[i - 1].id);

  return (
    <div className="title-bg">
      <div className="title-shell">
        <div className="title-card" style={{ maxWidth: 1080 }}>
          <button className="btn secondary" onClick={onBack} style={{ position: "absolute", left: 0, top: 0 }}>← Menú</button>
          <span className="title-pill"><span className="dot"></span>MODO HISTORIA · ELEGÍ ETAPA</span>
          <h1 className="title-main" style={{ fontSize: "clamp(36px, 6vw, 64px)", marginTop: 12 }}>LA RUTA</h1>

          <div className="stage-grid">
            {stages.map((s, i) => {
              const locked = isLocked(i);
              const done = cleared.includes(s.id);
              return (
                <button key={s.id} className={"stage-card" + (locked ? " locked" : "") + (done ? " done" : "")}
                  onClick={() => !locked && onStart(i, veh)} disabled={locked}>
                  <div className="stage-num">
                    {String(s.num).padStart(2, "0")}
                    {done && <span style={{ marginLeft: 8, color: "#6fbf99" }}>✓ LIMPIA</span>}
                    {locked && <span style={{ marginLeft: 8, color: "#ff8b3d" }}>⛔ BLOQUEADA</span>}
                  </div>
                  <div className="stage-name">{s.name}</div>
                  <div className="stage-brief">{locked ? `Limpiá la etapa ${s.num - 1} primero.` : s.brief}</div>
                  <div className="stage-meta">
                    <span>🎯 {s.targetDeliveries}</span>
                    <span>⏱ {s.timeLimit}s</span>
                    <span>☀ {s.weather === "sunny" ? "Soleado" : s.weather === "sunset" ? "Atardecer" : s.weather === "storm" ? "Tormenta" : s.weather === "night" ? "Noche" : "—"}</span>
                  </div>
                </button>
              );
            })}
          </div>

          <div style={{ font: "11px 'JetBrains Mono', monospace", letterSpacing: "0.18em", opacity: 0.7, textTransform: "uppercase", marginTop: 18 }}>Elegí vehículo</div>
          <div className="vehicles-row">
            {Object.entries(vehicles).map(([k, v]) => (
              <button key={k} className={"vchip " + (veh === k ? "active" : "")} onClick={() => setVeh(k)}>
                {v.name}
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16, font: "11px 'JetBrains Mono', monospace", opacity: 0.6 }}>
            <button className="btn secondary" style={{ fontSize: 11, padding: "6px 10px" }} onClick={() => { if (confirm("¿Resetear progreso?")) { window.Game.resetProgress(); window.location.reload(); } }}>↺ Resetear progreso</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- HUD --------------------------------------------------------------------
function HUD() {
  const s = window.Game.state;
  const W = window.WORLD;
  const district = W.districtAt(s.p.x);
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
            <div className="val">{Math.ceil(s.timeLeft).toString().padStart(2,"0")}s</div>
          </div>
        )}
        {s.stage ? (
          <div className="hud-card">
            <div className="lbl">Etapa {String(s.stage.num).padStart(2,"0")}</div>
            <div className="val">{s.stageDeliveries}/{s.stageTarget}</div>
          </div>
        ) : (
          <div className="hud-card">
            <div className="lbl">Entregas</div>
            <div className="val">{s.deliveries}</div>
          </div>
        )}
      </div>

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
          <div className="quip">{quip} <span style={{opacity: 0.5}}>· {s.carrying.customer.line}</span></div>
        </div>
      )}
    </div>
  );
}

// ---- Pause / Results --------------------------------------------------------
function PauseScreen({ onResume, onQuit }) {
  return (
    <div className="overlay">
      <div className="panel">
        <h2>PAUSA</h2>
        <p style={{ opacity: 0.7, marginTop: 0 }}>Tomate un respiro, mae.</p>
        <div className="btn-row">
          <button className="btn gold" onClick={onResume}>▸ Continuar</button>
          <button className="btn secondary" onClick={onQuit}>Salir al menú</button>
        </div>
      </div>
    </div>
  );
}

function ResultsScreen({ onAgain, onNext, onMenu }) {
  const s = window.Game.state;
  const stages = window.WORLD.STAGES;
  const isStage = !!s.stage;
  const won = s.won;
  const rank = s.score > 6000 ? "S — LEYENDA PORTEÑA" : s.score > 3500 ? "A — Maestro Churchillero" : s.score > 1800 ? "B — Repartidor del Paseo" : s.score > 800 ? "C — Aprendiz del kiosco" : "D — Se te derritió todo";
  const hasNext = isStage && (s.stageIdx + 1) < stages.length;
  return (
    <div className="overlay">
      <div className="panel">
        <h2 style={{ color: won ? "var(--gold)" : "var(--hot)" }}>
          {isStage ? (won ? `¡ETAPA ${s.stage.num} LIMPIA!` : "SE ACABÓ EL TIEMPO") : "RESULTADOS"}
        </h2>
        {isStage && <div style={{ marginBottom: 10, color: "var(--paper)" }}>{s.stage.name}</div>}
        <div className="row"><span>Puntaje</span><span>{s.score.toLocaleString()}</span></div>
        <div className="row"><span>Entregas</span><span>{isStage ? `${s.stageDeliveries}/${s.stageTarget}` : s.deliveries}</span></div>
        <div className="row"><span>Perfectas</span><span>{s.perfect}</span></div>
        <div className="row"><span>Combo máximo</span><span>×{s.combo}</span></div>
        <div className="row"><span>Ranking</span><span style={{ color: "var(--gold)" }}>{rank}</span></div>
        <div className="btn-row">
          {isStage && won && hasNext && <button className="btn gold" onClick={onNext}>▸ Siguiente etapa</button>}
          <button className={"btn " + (won && hasNext ? "secondary" : "gold")} onClick={onAgain}>↻ Repetir</button>
          <button className="btn secondary" onClick={onMenu}>Menú</button>
        </div>
      </div>
    </div>
  );
}

function StageBrief({ stage, onGo }) {
  return (
    <div className="overlay">
      <div className="panel">
        <h2>ETAPA {String(stage.num).padStart(2,"0")}</h2>
        <div style={{ font: "20px 'Bungee', sans-serif", color: "var(--gold)", marginBottom: 10 }}>{stage.name}</div>
        <p style={{ opacity: 0.85, lineHeight: 1.5, fontSize: 13 }}>{stage.brief}</p>
        <div style={{ display: "flex", justifyContent: "space-around", margin: "14px 0", font: "12px 'JetBrains Mono', monospace", opacity: 0.85 }}>
          <span>🎯 {stage.targetDeliveries} entregas</span>
          <span>⏱ {stage.timeLimit}s</span>
          <span>☀ {stage.weather}</span>
        </div>
        <div className="btn-row">
          <button className="btn gold" onClick={onGo}>▸ ¡Vamos!</button>
        </div>
      </div>
    </div>
  );
}

// ---- Touch controls ---------------------------------------------------------
function TouchControls() {
  const joyRef = useRef(null), gasRef = useRef(null), brakeRef = useRef(null);
  useEffect(() => { window.Game.attachTouch(joyRef.current, gasRef.current, brakeRef.current); }, []);
  const coarse = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  if (!coarse) return null;
  return (
    <div className="touch-controls">
      <div ref={joyRef} className="joy"></div>
      <div ref={brakeRef} className="pedal brake">✋</div>
      <div ref={gasRef} className="pedal gas">▶</div>
    </div>
  );
}

// ---- Tweaks -----------------------------------------------------------------
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "weather": "sunny",
  "vehicle": "scooter"
}/*EDITMODE-END*/;

function GameTweaks() {
  const [t, set] = window.useTweaks(TWEAK_DEFAULTS);
  useEffect(() => { window.Game.setWeather(t.weather); }, [t.weather]);
  useEffect(() => {
    if (t.vehicle !== window.Game.state.vehicleKey) window.Game.setVehicle(t.vehicle);
  }, [t.vehicle]);
  return (
    <window.TweaksPanel title="Tweaks">
      <window.TweakSection title="Mundo">
        <window.TweakSelect label="Clima" value={t.weather} onChange={(v) => set("weather", v)}
          options={[
            { value: "sunny", label: "Soleado" },
            { value: "sunset", label: "Atardecer" },
            { value: "storm", label: "Tormenta" },
            { value: "night", label: "Noche" },
          ]} />
      </window.TweakSection>
      <window.TweakSection title="Vehículo">
        <window.TweakSelect label="Tipo" value={t.vehicle} onChange={(v) => set("vehicle", v)}
          options={Object.entries(window.Game.VEHICLES).map(([k,v]) => ({ value: k, label: v.name }))} />
      </window.TweakSection>
    </window.TweaksPanel>
  );
}

// ---- Root -------------------------------------------------------------------
function App() {
  // screens: title | stagepick | brief | playing | paused | over | explore
  const [screen, setScreen] = useState("title");
  const [pendingStage, setPendingStage] = useState(null);
  const canvasRef = useRef(null);
  const [, setTick] = useState(0);
  const tickRef = useRef(0);
  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  // Single render-tick + canvas attach. DO NOT depend on `screen` here or
  // you'll spawn extra game loops every time the screen changes.
  useEffect(() => {
    window.Game.attachCanvas(canvasRef.current);
    let raf;
    const tick = () => {
      tickRef.current += 1;
      if (tickRef.current % 3 === 0) setTick(tickRef.current);
      if (window.Game.state.over && screenRef.current === "playing") setScreen("over");
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key.toLowerCase() === "p" || e.key === "Escape") {
        if (screen === "playing") setScreen("paused");
        else if (screen === "paused") setScreen("playing");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  useEffect(() => { window.Game.state.paused = (screen === "paused"); }, [screen]);

  function pickMode(mode) {
    if (mode === "story") setScreen("stagepick");
    else if (mode === "explore") {
      window.Game.startExplore({ vehicleKey: window.Game.state.vehicleKey });
      setScreen("playing");
    } else { window.Game.startArcade({ vehicleKey: window.Game.state.vehicleKey }); setScreen("playing"); }
  }
  function pickStage(idx, vehicleKey) {
    setPendingStage({ idx, vehicleKey });
    setScreen("brief");
  }
  function beginStage() {
    if (!pendingStage) return;
    window.Game.startStage(pendingStage.idx, pendingStage.vehicleKey);
    setScreen("playing");
  }
  function nextStage() {
    const next = window.Game.state.stageIdx + 1;
    if (next < window.WORLD.STAGES.length) {
      setPendingStage({ idx: next, vehicleKey: window.Game.state.vehicleKey });
      setScreen("brief");
    } else { setScreen("title"); }
  }
  function again() {
    if (window.Game.state.stage) window.Game.startStage(window.Game.state.stageIdx, window.Game.state.vehicleKey);
    else window.Game.startArcade({ vehicleKey: window.Game.state.vehicleKey });
    setScreen("playing");
  }
  function quit() { window.Game.quit(); setScreen("title"); }

  const briefStage = pendingStage ? window.WORLD.STAGES[pendingStage.idx] : null;

  return (
    <>
      <canvas ref={canvasRef} id="game-canvas"></canvas>
      {screen === "title" && <TitleScreen onPickMode={pickMode} />}
      {screen === "stagepick" && <StageSelect onStart={pickStage} onBack={() => setScreen("title")} />}
      {screen === "brief" && briefStage && <StageBrief stage={briefStage} onGo={beginStage} />}
      {screen === "playing" && <><HUD /><TouchControls /></>}
      {screen === "paused" && <><HUD /><PauseScreen onResume={() => setScreen("playing")} onQuit={quit} /></>}
      {screen === "over" && <ResultsScreen onAgain={again} onNext={nextStage} onMenu={() => setScreen("title")} />}
      {(screen === "playing" || screen === "paused") && <GameTweaks />}
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
