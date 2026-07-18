import React, { useState, useEffect, useRef } from "react";
import { Game } from "../game/index.js";
import { WORLD2D as WORLD } from "../world2d/index.js";
import TitleScreen from "./screens/TitleScreen.jsx";
import StageSelect from "./screens/StageSelect.jsx";
import HUD from "./screens/HUD.jsx";
import PauseScreen from "./screens/PauseScreen.jsx";
import ResultsScreen from "./screens/ResultsScreen.jsx";
import StageBrief from "./screens/StageBrief.jsx";
import SettingsScreen from "./screens/SettingsScreen.jsx";
import SupportersScreen from "./screens/SupportersScreen.jsx";
import ShopScreen from "./screens/ShopScreen.jsx";
import VehiclePicker from "./VehiclePicker.jsx";
import TutorialOverlay from "./TutorialOverlay.jsx";
import { content } from "../content/remote.js";
import TouchControls from "./TouchControls.jsx";
import GameTweaks from "./GameTweaks.jsx";
import { enterImmersive } from "./immersive.js";
import { sfx } from "../game/audio.js";
import { useT } from "../i18n/index.js";
import Icon from "./Icon.jsx";
import { ads } from "../monetize/ads.js";
import { iap } from "../monetize/iap.js";
import { analytics } from "../monetize/analytics.js";

export default function App() {
  const t = useT();
  // screens: title | stagepick | brief | playing | paused | over | settings |
  //          supporters | shop | vehpick (pre-run picker for arcade/explore)
  const [screen, setScreen] = useState("title");
  const [pendingStage, setPendingStage] = useState(null);
  const [pendingMode, setPendingMode] = useState(null); // arcade | explore
  const canvasRef = useRef(null);
  const [, setTick] = useState(0);
  const tickRef = useRef(0);
  const screenRef = useRef(screen);
  // where Settings returns to (opened from title or from pause)
  const settingsFrom = useRef("title");
  useEffect(() => { screenRef.current = screen; }, [screen]);

  // Single render-tick + canvas attach. DO NOT depend on `screen` here or
  // you'll spawn extra game loops every time the screen changes.
  useEffect(() => {
    Game.attachCanvas(canvasRef.current);
    ads.init();     // no-ops on web
    iap.init();
    analytics.init(); // no-ops without VITE_GA_ID
    content.load(); // supporters / server NPCs / lotes (cache-first, offline-safe)
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

  // Interstitial cadence: count a finished run when the results screen shows
  // (skipped for remove-ads owners, the first-runs grace, tutorial, web).
  useEffect(() => {
    if (screen !== "over") return;
    ads.maybeShowInterstitial(Game.state.mode);
    const s = Game.state;
    analytics.track("run_end", {
      mode: s.mode, stage_id: s.stage?.id || "", won: s.won ? 1 : 0,
      score: s.score, deliveries: s.deliveries, perfect: s.perfect,
    });
  }, [screen]);

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

  useEffect(() => { Game.state.paused = (screen === "paused" || (screen === "settings" && settingsFrom.current === "paused")); }, [screen]);

  // Menu screens show the live world drifting behind them (attract mode).
  useEffect(() => { Game.setAttract(["title", "stagepick", "supporters", "shop", "vehpick"].includes(screen) || (screen === "settings" && settingsFrom.current === "title")); }, [screen]);

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
    else if (mode === "tutorial") {
      Game.startTutorial({ vehicleKey: Game.state.vehicleKey });
      setScreen("playing");
    } else {
      // arcade / explore go through the pre-run vehicle picker
      setPendingMode(mode);
      setScreen("vehpick");
    }
  }
  function beginFreeRun(vehicleKey, armedBoosts) {
    Game.state.armedBoosts = armedBoosts;
    if (pendingMode === "explore") Game.startExplore({ vehicleKey });
    else Game.startArcade({ vehicleKey });
    setScreen("playing");
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
    if (Game.state.mode === "tutorial") Game.startTutorial({ vehicleKey: Game.state.vehicleKey });
    else if (Game.state.stage) Game.startStage(Game.state.stageIdx, Game.state.vehicleKey);
    else Game.startArcade({ vehicleKey: Game.state.vehicleKey });
    setScreen("playing");
  }
  // rewarded-ad continue: revive the lost run with extra time (once per run)
  function continueRun() {
    Game.state.timeLeft += 60;
    Game.state.over = false; Game.state.won = false;
    Game.state.usedAdContinue = true;
    setScreen("playing");
  }
  function quit() {
    // abandoned runs never reach the results screen — count them here
    if (Game.state.running && !Game.state.over) {
      analytics.track("run_quit", { mode: Game.state.mode, score: Game.state.score, deliveries: Game.state.deliveries });
    }
    Game.quit();
    setScreen("title");
  }
  function openSettings(from) {
    settingsFrom.current = from;
    setScreen("settings");
  }

  const briefStage = pendingStage ? WORLD.STAGES[pendingStage.idx] : null;

  return (
    <>
      <canvas ref={canvasRef} id="game-canvas"></canvas>
      {(screen === "title" || screen === "stagepick" || screen === "brief" || screen === "over" || screen === "settings" || screen === "supporters" || screen === "shop" || screen === "vehpick") && (
        <div className="screen-anim" key={screen}>
          {screen === "title" && <TitleScreen onPickMode={pickMode} onSettings={() => openSettings("title")} onSupporters={() => setScreen("supporters")} onShop={() => setScreen("shop")} />}
          {screen === "supporters" && <SupportersScreen onBack={() => setScreen("title")} />}
          {screen === "shop" && <ShopScreen onBack={() => setScreen("title")} />}
          {screen === "vehpick" && <VehiclePicker onGo={beginFreeRun} onShop={() => setScreen("shop")} onBack={() => setScreen("title")} />}
          {screen === "stagepick" && <StageSelect onStart={pickStage} onBack={() => setScreen("title")} />}
          {screen === "brief" && briefStage && <StageBrief stage={briefStage} onGo={beginStage} />}
          {screen === "over" && <ResultsScreen onAgain={again} onNext={nextStage} onMenu={() => setScreen("title")} onContinue={continueRun} />}
          {screen === "settings" && (
            <SettingsScreen
              onBack={() => setScreen(settingsFrom.current === "paused" ? "paused" : "title")}
              onTutorial={() => { Game.startTutorial({ vehicleKey: Game.state.vehicleKey }); setScreen("playing"); }}
              onSupporters={settingsFrom.current === "title" ? () => setScreen("supporters") : null} />
          )}
        </div>
      )}
      {screen === "playing" && <><HUD onPause={() => setScreen("paused")} /><TouchControls />{Game.state.tutorial && <TutorialOverlay />}</>}
      {screen === "paused" && <><HUD /><PauseScreen onResume={() => setScreen("playing")} onSettings={() => openSettings("paused")} onQuit={quit} /></>}
      {(screen === "playing" || screen === "paused") && <GameTweaks />}
      <div className="rotate-overlay">
        <div className="rotate-icon"><Icon name="phone" size={60} /></div>
        <p>{t("rotate.body")}</p>
      </div>
    </>
  );
}
