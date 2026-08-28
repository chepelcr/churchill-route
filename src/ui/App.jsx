import React, { useState, useEffect, useRef } from "react";
import { Game } from "../game/index.js";
import { addTime } from "../game/timers.js";
import { EXPLORE_REALM, GAME_MODE, STAGE_KIND, UI_SCREEN, VEHICLE_MEDIUM } from "../domain/vocabulary.generated.js";
import { WORLD2D as WORLD } from "../world2d/index.js";
import TitleScreen from "./screens/TitleScreen.jsx";
import StageSelect from "./screens/StageSelect.jsx";
import HUD from "./screens/HUD.jsx";
import PauseScreen from "./screens/PauseScreen.jsx";
import ResultsScreen from "./screens/ResultsScreen.jsx";
import StageBrief from "./screens/StageBrief.jsx";
import ModeBrief from "./screens/ModeBrief.jsx";
import RealmPick from "./screens/RealmPick.jsx";
import PassageScreen from "./screens/PassageScreen.jsx";
import TutorialBrief from "./screens/TutorialBrief.jsx";
import BootScreen from "./screens/BootScreen.jsx";
import IntroScreen, { introSeen } from "./screens/IntroScreen.jsx";
import SettingsScreen from "./screens/SettingsScreen.jsx";
import SupportersScreen from "./screens/SupportersScreen.jsx";
import ShopScreen from "./screens/ShopScreen.jsx";
import VehiclePicker from "./VehiclePicker.jsx";
import TutorialOverlay from "./TutorialOverlay.jsx";
import { content } from "../content/remote.js";
import { applyUiContent, applyScreen } from "./theme.js";
import TouchControls from "./TouchControls.jsx";
import GameTweaks from "./GameTweaks.jsx";
import { enterImmersive } from "./immersive.js";
import { sfx } from "../game/audio.js";
import { isMvpLocked } from "../game/progress.js";
import { vehicleMedium } from "../game/vehicles.js";
import { useT } from "../i18n/index.js";
import Icon from "./Icon.jsx";
import { ads } from "../monetize/ads.js";
import { iap } from "../monetize/iap.js";
import { analytics } from "../monetize/analytics.js";

//: how loud the gulf is behind a menu. Under the driving level on purpose: it
//: is a room tone, not a beach.
const MENU_SEA = 0.55;

export default function App() {
  const t = useT();
  // screens: boot (every launch) | intro (first run only) | title | stagepick |
  //          brief | playing | paused | over | settings | supporters | shop | vehpick
  const [screen, setScreen] = useState(UI_SCREEN.BOOT);
  const [pendingStage, setPendingStage] = useState(null);
  const [pendingMode, setPendingMode] = useState(null); // story | arcade | explore
  const [pendingRealm, setPendingRealm] = useState(null); // ciudad | estero, Recorrer only
  const [pendingRun, setPendingRun] = useState(null);   // { vehicleKey, armedBoosts } awaiting the mode brief
  const [shopCtx, setShopCtx] = useState(null);         // { tab?, veh? } deep-link into the shop
  const canvasRef = useRef(null);
  const [, setTick] = useState(0);
  const tickRef = useRef(0);
  const screenRef = useRef(screen);
  // where Settings returns to (opened from title or from pause)
  const settingsFrom = useRef(UI_SCREEN.TITLE);
  const shopFrom = useRef(UI_SCREEN.TITLE);
  useEffect(() => { screenRef.current = screen; }, [screen]);

  // Single render-tick + canvas attach. DO NOT depend on `screen` here or
  // you'll spawn extra game loops every time the screen changes.
  useEffect(() => {
    Game.attachCanvas(canvasRef.current);
    ads.init();     // no-ops on web
    iap.init();
    analytics.init(); // no-ops without VITE_GA_ID
    content.load(); // supporters / server NPCs / lotes (cache-first, offline-safe)
    // Authored theme + copy ride the same document, so they apply on the cached
    // copy first and again when the network answers.
    applyUiContent(content.ui);
    const stopUi = content.onChange(() => {
      applyUiContent(content.ui);
      applyScreen(screenRef.current, { manifestUi: WORLD.EDITOR_UI, contentUi: content.ui });
    });
    const launch = new URLSearchParams(window.location.search);
    if (launch.get("editorPlay") === "1") {
      const x = Number(launch.get("x"));
      const y = Number(launch.get("y"));
      if (Number.isFinite(x) && Number.isFinite(y)) {
        Game.startExplore({ x, y });
        setScreen(UI_SCREEN.PLAYING);
      }
    }
    let raf;
    const tick = () => {
      tickRef.current += 1;
      if (tickRef.current % 3 === 0) setTick(tickRef.current);
      // every finished run — tutorial included — shows the results/confirmation
      // screen (ResultsScreen renders a "¡Tutorial completado!" card) instead of
      // snapping straight to the menu.
      if (Game.state.over && screenRef.current === UI_SCREEN.PLAYING)
        setScreen(UI_SCREEN.OVER);
      // LA PUERTA DEL MUELLE. El sim la levanta al ENTRAR al muelle; contestarla
      // es de aquí. Sólo desde "playing" — una oferta en pie mientras el menú de
      // pausa está abierto no puede meterle una pregunta por delante.
      if (Game.state.passageOffer !== null && screenRef.current === UI_SCREEN.PLAYING)
        setScreen(UI_SCREEN.PASSAGE);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { stopUi(); cancelAnimationFrame(raf); };
  }, []);

  // Interstitial cadence: count a finished run when the results screen shows
  // (skipped for remove-ads owners, the first-runs grace, tutorial, web).
  useEffect(() => {
    if (screen !== UI_SCREEN.OVER) return;
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
        if (screen === UI_SCREEN.PLAYING) setScreen(UI_SCREEN.PAUSED);
        else if (screen === UI_SCREEN.PAUSED) setScreen(UI_SCREEN.PLAYING);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen]);

  // THE ONE PLACE THAT OWNS `paused`. It recomputes on every screen change, so
  // anything that pauses by writing the flag directly is undone the moment the
  // screen it opened lands here.
  useEffect(() => {
    Game.state.paused = screen === UI_SCREEN.PAUSED || screen === UI_SCREEN.PASSAGE
      || (screen === UI_SCREEN.SETTINGS && settingsFrom.current === UI_SCREEN.PAUSED);
  }, [screen]);

  // World-editor screen contract: each main screen can override the shared
  // accent/backdrop, while individual screens opt into copy fields below.
  useEffect(() => {
    applyScreen(screen, { manifestUi: WORLD.EDITOR_UI, contentUi: content.ui });
    document.body.dataset.gameScreen = screen;
  }, [screen]);

  // Menu screens show the live world drifting behind them (attract mode).
  useEffect(() => { Game.setAttract([UI_SCREEN.BOOT, UI_SCREEN.INTRO, UI_SCREEN.TITLE, UI_SCREEN.STAGEPICK,
    UI_SCREEN.SUPPORTERS, UI_SCREEN.SHOP, UI_SCREEN.VEHPICK, UI_SCREEN.MODEBRIEF, UI_SCREEN.TUTBRIEF].includes(screen) || (screen === UI_SCREEN.SETTINGS && settingsFrom.current === UI_SCREEN.TITLE)); }, [screen]);

  // Engine/drift hum only while actually driving; menu blips stay available.
  // AND THE SEA UNDER THE MENUS. Puntarenas is a sandbar four blocks wide —
  // you can hear the gulf from anywhere on it, so the title, the shop and the
  // level list get the same swell the beach does, a shade below the level the
  // driving sets. `quiet()` deliberately leaves the wave voice alone; it is the
  // one continuous sound that belongs everywhere.
  useEffect(() => {
    if (screen === UI_SCREEN.PLAYING) { sfx.resume(); return; }
    sfx.quiet();
    sfx.resume();          // no-op until the first gesture unlocks the context
    sfx.waves(MENU_SEA);
  }, [screen]);

  // Auto-pause when the tab/app goes to the background mid-run.
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && screenRef.current === UI_SCREEN.PLAYING) setScreen(UI_SCREEN.PAUSED);
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
    if (mode === GAME_MODE.TUTORIAL) {
      // set speed + zoom first, then teach (tutbrief owns the start)
      setScreen(UI_SCREEN.TUTBRIEF);
    } else {
      setPendingMode(mode);
      // A RUN THAT IS NOT A STAGE HAS NO STAGE — and saying so is the fix for a
      // real bug. `pendingStage` was set by `pickStage` and never cleared, so
      // once La Travesía had been selected in a session `briefStage.kind` stayed
      // CROSSING and every later Arcade or Recorrer opened the picker on BOATS.
      setPendingStage(mode === GAME_MODE.STORY ? pendingStage : null);
      setPendingRealm(null);
      // Historia picks a level first; Recorrer picks which Puntarenas, because
      // that decides the medium; Arcade goes straight to the picker.
      setScreen(mode === GAME_MODE.STORY ? UI_SCREEN.STAGEPICK
        : mode === GAME_MODE.EXPLORE ? UI_SCREEN.REALMPICK : UI_SCREEN.VEHPICK);
    }
  }
  function pickRealm(realm) {
    setPendingRealm(realm);
    setScreen(UI_SCREEN.VEHPICK);
  }
  // vehicle picked on the vehpick page (every mode): story continues to the
  // stage brief (which owns boost-arming there); arcade / explore start now
  function beginFromPicker(vehicleKey, armedBoosts) {
    if (pendingMode === GAME_MODE.STORY) {
      setPendingStage((s) => ({ ...s, vehicleKey }));
      setScreen(UI_SCREEN.BRIEF);
      return;
    }
    // arcade / explore get their own "what is this mode" card before starting
    setPendingRun({ vehicleKey, armedBoosts });
    setScreen(UI_SCREEN.MODEBRIEF);
  }
  function beginMode(opts = {}) {
    if (!pendingRun) return;
    enterImmersive();
    Game.state.armedBoosts = pendingRun.armedBoosts;
    // Recorrer turns its own day; Arcade takes the sky the brief picked.
    if (pendingMode === GAME_MODE.EXPLORE) Game.startExplore({ vehicleKey: pendingRun.vehicleKey, realm: pendingRealm });
    else Game.startArcade({ vehicleKey: pendingRun.vehicleKey, weather: opts.weather });
    setScreen(UI_SCREEN.PLAYING);
  }
  function pickStage(idx) {
    setPendingStage({ idx });
    setScreen(UI_SCREEN.VEHPICK);
  }
  function beginStage(armedBoosts) {
    if (!pendingStage) return;
    enterImmersive();
    Game.state.armedBoosts = armedBoosts || null; // owned boosts armed on the brief
    Game.startStage(pendingStage.idx, pendingStage.vehicleKey);
    setScreen(UI_SCREEN.PLAYING);
  }
  function nextStage() {
    const next = Game.state.stageIdx + 1;
    const stg = WORLD.STAGES[next];
    // never advance into a PRÓXIMAMENTE (MVP-locked / WIP) level — those ship
    // later; clearing the last open level returns to the menu instead.
    if (stg && !isMvpLocked(stg.district)) {
      // "Next level" reuses the ride you just drove — a convenience worth
      // keeping — but ONLY while it is still a legal ride. Stage 4 is the
      // Travesía, so coming out of stage 3 in a scooter would carry a car into
      // a water stage: `resolveVehicle` would quietly swap in the free panga
      // and the player would never have been asked. When the medium changes,
      // the picker is not optional.
      const carried = Game.state.vehicleKey;
      const sameMedium = vehicleMedium(carried) === (stg.kind === STAGE_KIND.CROSSING ? VEHICLE_MEDIUM.WATER : VEHICLE_MEDIUM.LAND);
      setPendingStage({ idx: next, vehicleKey: sameMedium ? carried : undefined });
      setScreen(sameMedium ? UI_SCREEN.BRIEF : UI_SCREEN.VEHPICK);
    } else { setScreen(UI_SCREEN.TITLE); }
  }
  // Restart THIS run. It has to dispatch on the actual mode: the old fallback
  // sent anything that wasn't the tutorial or a story stage to startArcade, so
  // "restart" in Recorrer silently dropped you into a 3-minute timed Arcade run
  // instead of rebooting the open world.
  function again() {
    enterImmersive();
    const k = Game.state.vehicleKey;
    if (Game.state.mode === GAME_MODE.TUTORIAL) Game.startTutorial({ vehicleKey: k });
    // …and Recorrer restarts in the SAME Puntarenas: re-running the estuary as
    // the city would put a hull on the Paseo.
    else if (Game.state.mode === GAME_MODE.EXPLORE) Game.startExplore({ vehicleKey: k, realm: Game.state.exploreRealm });
    else if (Game.state.stage) Game.startStage(Game.state.stageIdx, k);
    else Game.startArcade({ vehicleKey: k });
    setScreen(UI_SCREEN.PLAYING);
  }
  // Recorrer has no level to restart — it is the open world, with no clock and
  // no target — so it gets no restart button at all.
  const canRestart = Game.state.mode !== GAME_MODE.TUTORIAL && Game.state.mode !== GAME_MODE.EXPLORE;
  // rewarded-ad continue: revive the lost run with extra time (once per run)
  function continueRun() {
    addTime(Game.state, 60);
    Game.state.over = false; Game.state.won = false;
    Game.state.usedAdContinue = true;
    setScreen(UI_SCREEN.PLAYING);
  }
  function quit() {
    // abandoned runs never reach the results screen — count them here
    if (Game.state.running && !Game.state.over) {
      analytics.track("run_quit", { mode: Game.state.mode, score: Game.state.score, deliveries: Game.state.deliveries });
    }
    Game.quit();
    setScreen(UI_SCREEN.TITLE);
  }
  function startTutorialRun() {
    enterImmersive();
    Game.startTutorial({ vehicleKey: Game.state.vehicleKey });
    setScreen(UI_SCREEN.PLAYING);
  }
  function openSettings(from) {
    settingsFrom.current = from;
    setScreen(UI_SCREEN.SETTINGS);
  }

  const briefStage = pendingStage ? WORLD.STAGES[pendingStage.idx] : null;
  // THE MEDIUM IS THE RUN'S, NOT A STAGE'S. It used to be read straight off
  // `briefStage.kind`, which is only the right question when the run being
  // started IS that stage — and `pendingStage` outlived the run that set it, so
  // Arcade inherited the Travesía's water. Asked per mode, a stage that does
  // not belong to this run cannot reach the answer at all.
  const runMedium = pendingMode === GAME_MODE.STORY
    ? (briefStage?.kind === STAGE_KIND.CROSSING ? VEHICLE_MEDIUM.WATER : VEHICLE_MEDIUM.LAND)
    : pendingMode === GAME_MODE.EXPLORE && pendingRealm === EXPLORE_REALM.ESTERO
      ? VEHICLE_MEDIUM.WATER : VEHICLE_MEDIUM.LAND;

  return (
    <>
      <canvas ref={canvasRef} id="game-canvas"></canvas>
      {screen === UI_SCREEN.BOOT && <BootScreen onDone={() => setScreen(introSeen() ? UI_SCREEN.TITLE : UI_SCREEN.INTRO)} />}
      {(screen === UI_SCREEN.INTRO || screen === UI_SCREEN.TITLE || screen === UI_SCREEN.STAGEPICK || screen === UI_SCREEN.BRIEF || screen === UI_SCREEN.MODEBRIEF || screen === UI_SCREEN.TUTBRIEF || screen === UI_SCREEN.OVER || screen === UI_SCREEN.SETTINGS || screen === UI_SCREEN.SUPPORTERS || screen === UI_SCREEN.SHOP || screen === UI_SCREEN.VEHPICK || screen === UI_SCREEN.REALMPICK) && (
        <div className="screen-anim" key={screen}>
          {screen === UI_SCREEN.INTRO && <IntroScreen onDone={() => setScreen(UI_SCREEN.TUTBRIEF)} />}
          {screen === UI_SCREEN.TITLE && <TitleScreen editorConfig={WORLD.EDITOR_UI?.screens?.title} onPickMode={pickMode} onSettings={() => openSettings(UI_SCREEN.TITLE)} onSupporters={() => setScreen(UI_SCREEN.SUPPORTERS)} onShop={() => { setShopCtx(null); shopFrom.current = UI_SCREEN.TITLE; setScreen(UI_SCREEN.SHOP); }} />}
          {screen === UI_SCREEN.SUPPORTERS && <SupportersScreen onBack={() => setScreen(UI_SCREEN.TITLE)} />}
          {screen === UI_SCREEN.SHOP && <ShopScreen ctx={shopCtx} onBack={() => { setShopCtx(null); const back = shopFrom.current; shopFrom.current = UI_SCREEN.TITLE; setScreen(back); }} />}
          {/* The medium the pending run needs — see `runMedium`. A crossing
              stage is sailed and so is Recorrer del Estero, so the picker must
              offer boats and only boats; everything else is driven. */}
          {screen === UI_SCREEN.VEHPICK && <VehiclePicker onGo={beginFromPicker} storyMode={pendingMode === GAME_MODE.STORY} medium={runMedium} onShop={(ctx) => { setShopCtx(ctx || null); shopFrom.current = UI_SCREEN.VEHPICK; setScreen(UI_SCREEN.SHOP); }} onBack={() => setScreen(pendingMode === GAME_MODE.STORY ? UI_SCREEN.STAGEPICK : pendingMode === GAME_MODE.EXPLORE ? UI_SCREEN.REALMPICK : UI_SCREEN.TITLE)} />}
          {screen === UI_SCREEN.REALMPICK && <RealmPick onPick={pickRealm} onBack={() => setScreen(UI_SCREEN.TITLE)} />}
          {screen === UI_SCREEN.STAGEPICK && <StageSelect onStart={pickStage} onBack={() => setScreen(UI_SCREEN.TITLE)} />}
          {screen === UI_SCREEN.BRIEF && briefStage && <StageBrief stage={briefStage} onGo={beginStage} />}
          {/* Recorrer del Estero gets its OWN card. Handing it the ciudad's
              copy would promise kiosks and deliveries to somebody about to
              spend the run on open water. */}
          {screen === UI_SCREEN.MODEBRIEF && <ModeBrief mode={pendingMode} brief={pendingMode === GAME_MODE.EXPLORE && pendingRealm === EXPLORE_REALM.ESTERO ? "estero" : pendingMode} onGo={beginMode} />}
          {screen === UI_SCREEN.TUTBRIEF && <TutorialBrief onGo={startTutorialRun} />}
          {screen === UI_SCREEN.OVER && <ResultsScreen onAgain={again} onNext={nextStage} onMenu={() => setScreen(UI_SCREEN.TITLE)} onContinue={continueRun} />}
          {screen === UI_SCREEN.SETTINGS && (
            <SettingsScreen
              onBack={() => setScreen(settingsFrom.current === UI_SCREEN.PAUSED ? UI_SCREEN.PAUSED : UI_SCREEN.TITLE)}
              onTutorial={() => setScreen(UI_SCREEN.TUTBRIEF)}
              onSupporters={settingsFrom.current === UI_SCREEN.TITLE ? () => setScreen(UI_SCREEN.SUPPORTERS) : null} />
          )}
        </div>
      )}
      {screen === UI_SCREEN.PLAYING && <><HUD onPause={() => setScreen(UI_SCREEN.PAUSED)} /><TouchControls />{Game.state.tutorial && <TutorialOverlay />}</>}
      {/* El pasaje va SOBRE el mundo, no en el grupo de menús: la cortina de
          agua tiene que tapar el canvas vivo, y la pregunta se hace de pie en
          el muelle. Metida en el grupo, `screen-anim` la habría desmontado. */}
      {screen === UI_SCREEN.PASSAGE && <><HUD /><PassageScreen
        onDone={() => setScreen(UI_SCREEN.PLAYING)}
        onCancel={() => { Game.declinePassage(); setScreen(UI_SCREEN.PLAYING); }} /></>}
      {screen === UI_SCREEN.PAUSED && <><HUD /><PauseScreen onResume={() => setScreen(UI_SCREEN.PLAYING)} onRestart={canRestart ? again : null} onSettings={() => openSettings(UI_SCREEN.PAUSED)} onQuit={quit} /></>}
      {(screen === UI_SCREEN.PLAYING || screen === UI_SCREEN.PAUSED) && <GameTweaks />}
      <div className="rotate-overlay">
        <div className="rotate-icon"><Icon name="phone" size={60} /></div>
        <p>{t("rotate.body")}</p>
      </div>
    </>
  );
}
