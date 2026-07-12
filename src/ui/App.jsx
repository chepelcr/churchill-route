import React, { useState, useEffect, useRef } from "react";
import { Game } from "../game/index.js";
import { WORLD2D as WORLD } from "../world2d/index.js";
import TitleScreen from "./screens/TitleScreen.jsx";
import StageSelect from "./screens/StageSelect.jsx";
import HUD from "./screens/HUD.jsx";
import PauseScreen from "./screens/PauseScreen.jsx";
import ResultsScreen from "./screens/ResultsScreen.jsx";
import StageBrief from "./screens/StageBrief.jsx";
import TouchControls from "./TouchControls.jsx";
import GameTweaks from "./GameTweaks.jsx";
import { enterImmersive } from "./immersive.js";
import { sfx } from "../game/audio.js";

export default function App() {
  // screens: title | stagepick | brief | playing | paused | over
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
    Game.attachCanvas(canvasRef.current);
    let raf;
    const tick = () => {
      tickRef.current += 1;
      if (tickRef.current % 3 === 0) setTick(tickRef.current);
      if (Game.state.over && screenRef.current === "playing") setScreen("over");
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

  useEffect(() => { Game.state.paused = (screen === "paused"); }, [screen]);

  // Menu screens show the live world drifting behind them (attract mode).
  useEffect(() => { Game.setAttract(screen === "title" || screen === "stagepick"); }, [screen]);

  // Engine/drift hum only while actually driving; menu blips stay available.
  useEffect(() => { screen === "playing" ? sfx.resume() : sfx.quiet(); }, [screen]);

  // Auto-pause when the tab/app goes to the background mid-run.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && screenRef.current === "playing") setScreen("paused");
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  function pickMode(mode) {
    enterImmersive();
    if (mode === "story") setScreen("stagepick");
    else if (mode === "explore") {
      Game.startExplore({ vehicleKey: Game.state.vehicleKey });
      setScreen("playing");
    } else { Game.startArcade({ vehicleKey: Game.state.vehicleKey }); setScreen("playing"); }
  }
  function pickStage(idx, vehicleKey) {
    setPendingStage({ idx, vehicleKey });
    setScreen("brief");
  }
  function beginStage() {
    if (!pendingStage) return;
    enterImmersive();
    Game.startStage(pendingStage.idx, pendingStage.vehicleKey);
    setScreen("playing");
  }
  function nextStage() {
    const next = Game.state.stageIdx + 1;
    if (next < WORLD.STAGES.length) {
      setPendingStage({ idx: next, vehicleKey: Game.state.vehicleKey });
      setScreen("brief");
    } else { setScreen("title"); }
  }
  function again() {
    enterImmersive();
    if (Game.state.stage) Game.startStage(Game.state.stageIdx, Game.state.vehicleKey);
    else Game.startArcade({ vehicleKey: Game.state.vehicleKey });
    setScreen("playing");
  }
  function quit() { Game.quit(); setScreen("title"); }

  const briefStage = pendingStage ? WORLD.STAGES[pendingStage.idx] : null;

  return (
    <>
      <canvas ref={canvasRef} id="game-canvas"></canvas>
      {(screen === "title" || screen === "stagepick" || screen === "brief" || screen === "over") && (
        <div className="screen-anim" key={screen}>
          {screen === "title" && <TitleScreen onPickMode={pickMode} />}
          {screen === "stagepick" && <StageSelect onStart={pickStage} onBack={() => setScreen("title")} />}
          {screen === "brief" && briefStage && <StageBrief stage={briefStage} onGo={beginStage} />}
          {screen === "over" && <ResultsScreen onAgain={again} onNext={nextStage} onMenu={() => setScreen("title")} />}
        </div>
      )}
      {screen === "playing" && <><HUD onPause={() => setScreen("paused")} /><TouchControls /></>}
      {screen === "paused" && <><HUD /><PauseScreen onResume={() => setScreen("playing")} onQuit={quit} /></>}
      {(screen === "playing" || screen === "paused") && <GameTweaks />}
      <div className="rotate-overlay">
        <div className="rotate-icon">📱</div>
        <p>Girá el teléfono — se juega en horizontal</p>
      </div>
    </>
  );
}
