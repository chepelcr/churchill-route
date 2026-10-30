import React from "react";
import { Game } from "../game/index.js";
import { useT } from "../i18n/index.js";
import Icon from "./Icon.jsx";

// Tutorial coach-marks: a pulsing SPOTLIGHT ring on the control the step
// needs (brake, compass, melt bar) plus a bouncing arrow — or, on desktop,
// big keycaps, since PC plays with the keyboard. No veil: the game stays
// bright and fully playable underneath (pointer-events: none).
const COARSE = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

// drawCompass pins itself at (vw/2, 92) with r=24 (+ the distance label)
const compassRect = (vw) => ({ left: vw / 2 - 36, top: 56, width: 72, height: 84 });

function elRect(sel, pad = 12) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { left: r.left - pad, top: r.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
}

// What each step points at, per platform.
function stepSpec(step, vw, t) {
  if (COARSE) {
    switch (step) {
      case 0: return { finger: "steer" }; // hand orbits the car: it follows you
      case 1: return { finger: "speed" };
      case 2: return { finger: "turbo" };
      case 3: return { rect: elRect(".pedal.brake", 14), round: true };
      case 4: return { rect: compassRect(vw) };
      case 5: return { rect: elRect(".melt-bar", 10) || compassRect(vw) };
      default: return {};
    }
  }
  switch (step) {
    case 0: return { keys: ["W", "A", "S", "D"] };
    case 1: return { keys: ["W"] };
    case 2: return { keys: ["X"] };
    case 3: return { keys: [t("key.space")] };
    case 4: return { rect: compassRect(vw) };
    case 5: return { rect: elRect(".melt-bar", 10) || compassRect(vw) };
    default: return {};
  }
}

export default function TutorialOverlay() {
  const t = useT();
  const s = Game.state;
  const T = s.tutorial;
  if (!T || s.over || s.paused) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const spec = stepSpec(T.step, vw, t);
  const key = Game.tutorialStepKey();
  const done = T.step >= T.total - 1;
  // arrow above or below the spotlight, whichever half it sits in
  const arrowBelow = spec.rect && spec.rect.top < vh / 2;

  return (
    <div className="tut-overlay" aria-hidden="true">
      {spec.rect && (
        <div className={"tut-spot" + (spec.round ? " round" : "")}
          style={{ left: spec.rect.left, top: spec.rect.top, width: spec.rect.width, height: spec.rect.height }}>
          <div className={"tut-arrow " + (arrowBelow ? "below" : "above")}>{arrowBelow ? "▲" : "▼"}</div>
        </div>
      )}

      {spec.finger && (
        // the throttle-finger demo: a hand slides away from the car (screen
        // center) along a dashed track — further = faster, furthest = turbo
        <div className={"tut-finger " + spec.finger}>
          <div className="tut-finger-track" />
          <div className="tut-finger-hand"><Icon name="hand" size={30} /></div>
          <div className="tut-finger-car"><Icon name="car" size={26} /></div>
          {spec.finger === "turbo" && <div className="tut-finger-flame"><Icon name="bolt" size={24} /></div>}
        </div>
      )}

      {spec.keys && (
        <div className="tut-keys">
          {spec.keys.map((k) => <kbd key={k} className="tut-key">{k}</kbd>)}
        </div>
      )}

      <div className={"tut-panel" + (done ? " done" : "")}>
        <div className="tut-step">{t("tut.title")} · {t("tut.step", { n: Math.min(T.step + 1, T.total), total: T.total })}</div>
        <div className="tut-text">{t(key)}</div>
      </div>
    </div>
  );
}
