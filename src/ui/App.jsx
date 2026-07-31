import React, { useState, useEffect, useRef } from "react";
import { Game } from "../game/index.js";
import { WORLD2D as WORLD } from "../world2d/index.js";
import TitleScreen from "./screens/TitleScreen.jsx";
import StageSelect from "./screens/StageSelect.jsx";
import HUD from "./screens/HUD.jsx";
import PauseScreen from "./screens/PauseScreen.jsx";
import ResultsScreen from "./screens/ResultsScreen.jsx";
import StageBrief from "./screens/StageBrief.jsx";
import ModeBrief from "./screens/ModeBrief.jsx";
import TutorialBrief from "./screens/TutorialBrief.jsx";
import BootScreen from "./screens/BootScreen.jsx";
import IntroScreen, { introSeen } from "./screens/IntroScreen.jsx";
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
import { isMvpLocked } from "../game/progress.js";
import { useT } from "../i18n/index.js";
import Icon from "./Icon.jsx";
import { ads } from "../monetize/ads.js";
import { iap } from "../monetize/iap.js";
import { analytics } from "../monetize/analytics.js";

export default function App() {
  const t = useT();
  // screens: boot (every launch) | intro (first run only) | title | stagepick |
  //          brief | playing | paused | over | settings | supporters | shop | vehpick
  const [screen, setScreen] = useState("boot");
  const [pendingStage, setPendingStage] = useState(null);
  const [pendingMode, setPendingMode] = useState(null); // story | arcade | explore
  const [pendingRun, setPendingRun] = useState(null);   // { vehicleKey, armedBoosts } awaiting the mode brief
  const [shopCtx, setShopCtx] = useState(null);         // { tab?, veh? } deep-link into the shop
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
    const launch = new URLSearchParams(window.location.search);
    if (launch.get("editorPlay") === "1") {
      const x = Number(launch.get("x"));
      const y = Number(launch.get("y"));
      if (Number.isFinite(x) && Number.isFinite(y)) {
        Game.startExplore({ x, y });
        setScreen("playing");
      }
    }
    let raf;
    const tick = () => {
      tickRef.current += 1;
      if (tickRef.current % 3 === 0) setTick(tickRef.current);
      // every finished run — tutorial included — shows the results/confirmation
      // screen (ResultsScreen renders a "¡Tutorial completado!" card) instead of
      // snapping straight to the menu.
      if (Game.state.over && screenRef.current === "playing")
        setScreen("over");
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

  // World-editor screen contract: each main screen can override the shared
  // accent/backdrop, while individual screens opt into copy fields below.
  useEffect(() => {
    const ui = WORLD.EDITOR_UI?.screens?.[screen] || {};
    document.documentElement.style.setProperty("--editor-screen-bg", ui.background || "#17141f");
    document.documentElement.style.setProperty("--gold", ui.accent || "oklch(0.86 0.16 90)");
    document.body.dataset.gameScreen = screen;
  }, [screen]);

  // Menu screens show the live world drifting behind them (attract mode).
  useEffect(() => { Game.setAttract(["boot", "intro", "title", "stagepick", "supporters", "shop", "vehpick", "modebrief", "tutbrief"].includes(screen) || (screen === "settings" && settingsFrom.current === "title")); }, [screen]);

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

  // Mobile web: rotating to landscape should land straight in fullscreen.
  // Browsers only grant fullscreen with a user gesture, so try on the rotate
  // event itself (works in some engines/PWA) AND on the next touch after it.
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const landscape = window.matchMedia("(orientation: landscape)");
    const tryFs = () => {
      if (landscape.matches && !document.fullscreenElement) enterImmersive();
    };
    const onRotate = (e) => { if (e.matches) tryFs(); };
    landscape.addEventListener("change", onRotate);
    window.addEventListener("touchend", tryFs, { passive: true });
    return () => {
      landscape.removeEventListener("change", onRotate);
      window.removeEventListener("touchend", tryFs);
    };
  }, []);

  function pickMode(mode) {
    enterImmersive();
    if (mode === "tutorial") {
      // set speed + zoom first, then teach (tutbrief owns the start)
      setScreen("tutbrief");
    } else {
      setPendingMode(mode);
      // story picks a level first; arcade / explore go straight to the picker
      setScreen(mode === "story" ? "stagepick" : "vehpick");
    }
  }
  // vehicle picked on the vehpick page (every mode): story continues to the
  // stage brief (which owns boost-arming there); arcade / explore start now
  function beginFromPicker(vehicleKey, armedBoosts) {
    if (pendingMode === "story") {
      setPendingStage((s) => ({ ...s, vehicleKey }));
      setScreen("brief");
      return;
    }
    // arcade / explore get their own "what is this mode" card before starting
    setPendingRun({ vehicleKey, armedBoosts });
    setScreen("modebrief");
  }
  function beginMode() {
    if (!pendingRun) return;
    enterImmersive();
    Game.state.armedBoosts = pendingRun.armedBoosts;
    if (pendingMode === "explore") Game.startExplore({ vehicleKey: pendingRun.vehicleKey });
    else Game.startArcade({ vehicleKey: pendingRun.vehicleKey });
    setScreen("playing");
  }
  function pickStage(idx) {
    setPendingStage({ idx });
    setScreen("vehpick");
  }
  function beginStage(armedBoosts) {
    if (!pendingStage) return;
    enterImmersive();
    Game.state.armedBoosts = armedBoosts || null; // owned boosts armed on the brief
    Game.startStage(pendingStage.idx, pendingStage.vehicleKey);
    setScreen("playing");
  }
  function nextStage() {
    const next = Game.state.stageIdx + 1;
    const stg = WORLD.STAGES[next];
    // never advance into a PRÓXIMAMENTE (MVP-locked / WIP) level — those ship
    // later; clearing the last open level returns to the menu instead.
    if (stg && !isMvpLocked(stg.district)) {
      setPendingStage({ idx: next, vehicleKey: Game.state.vehicleKey });
      setScreen("brief");
    } else { setScreen("title"); }
  }
  // Restart THIS run. It has to dispatch on the actual mode: the old fallback
  // sent anything that wasn't the tutorial or a story stage to startArcade, so
  // "restart" in Recorrer silently dropped you into a 3-minute timed Arcade run
  // instead of rebooting the open world.
  function again() {
    enterImmersive();
    const k = Game.state.vehicleKey;
    if (Game.state.mode === "tutorial") Game.startTutorial({ vehicleKey: k });
    else if (Game.state.mode === "explore") Game.startExplore({ vehicleKey: k });
    else if (Game.state.stage) Game.startStage(Game.state.stageIdx, k);
    else Game.startArcade({ vehicleKey: k });
    setScreen("playing");
  }
  // Recorrer has no level to restart — it is the open world, with no clock and
  // no target — so it gets no restart button at all.
  const canRestart = Game.state.mode !== "tutorial" && Game.state.mode !== "explore";
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
  function startTutorialRun() {
    enterImmersive();
    Game.startTutorial({ vehicleKey: Game.state.vehicleKey });
    setScreen("playing");
  }
  function openSettings(from) {
    settingsFrom.current = from;
    setScreen("settings");
  }

  const briefStage = pendingStage ? WORLD.STAGES[pendingStage.idx] : null;

  return (
    <>
      <canvas ref={canvasRef} id="game-canvas"></canvas>
      {screen === "boot" && <BootScreen onDone={() => setScreen(introSeen() ? "title" : "intro")} />}
      {(screen === "intro" || screen === "title" || screen === "stagepick" || screen === "brief" || screen === "modebrief" || screen === "tutbrief" || screen === "over" || screen === "settings" || screen === "supporters" || screen === "shop" || screen === "vehpick") && (
        <div className="screen-anim" key={screen}>
          {screen === "intro" && <IntroScreen onDone={() => setScreen("tutbrief")} />}
          {screen === "title" && <TitleScreen editorConfig={WORLD.EDITOR_UI?.screens?.title} onPickMode={pickMode} onSettings={() => openSettings("title")} onSupporters={() => setScreen("supporters")} onShop={() => { setShopCtx(null); setScreen("shop"); }} />}
          {screen === "supporters" && <SupportersScreen onBack={() => setScreen("title")} />}
          {screen === "shop" && <ShopScreen ctx={shopCtx} onBack={() => { setShopCtx(null); setScreen("title"); }} />}
          {screen === "vehpick" && <VehiclePicker onGo={beginFromPicker} storyMode={pendingMode === "story"} onShop={(ctx) => { setShopCtx(ctx || null); setScreen("shop"); }} onBack={() => setScreen(pendingMode === "story" ? "stagepick" : "title")} />}
          {screen === "stagepick" && <StageSelect onStart={pickStage} onBack={() => setScreen("title")} />}
          {screen === "brief" && briefStage && <StageBrief stage={briefStage} onGo={beginStage} />}
          {screen === "modebrief" && <ModeBrief mode={pendingMode} onGo={beginMode} />}
          {screen === "tutbrief" && <TutorialBrief onGo={startTutorialRun} />}
          {screen === "over" && <ResultsScreen onAgain={again} onNext={nextStage} onMenu={() => setScreen("title")} onContinue={continueRun} />}
          {screen === "settings" && (
            <SettingsScreen
              onBack={() => setScreen(settingsFrom.current === "paused" ? "paused" : "title")}
              onTutorial={() => setScreen("tutbrief")}
              onSupporters={settingsFrom.current === "title" ? () => setScreen("supporters") : null} />
          )}
        </div>
      )}
      {screen === "playing" && <><HUD onPause={() => setScreen("paused")} /><TouchControls />{Game.state.tutorial && <TutorialOverlay />}</>}
      {screen === "paused" && <><HUD /><PauseScreen onResume={() => setScreen("playing")} onRestart={canRestart ? again : null} onSettings={() => openSettings("paused")} onQuit={quit} /></>}
      {(screen === "playing" || screen === "paused") && <GameTweaks />}
      <div className="rotate-overlay">
        <div className="rotate-icon"><Icon name="phone" size={60} /></div>
        <p>{t("rotate.body")}</p>
      </div>
    </>
  );
}
