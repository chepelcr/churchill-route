import React, { useEffect, useRef, useState } from "react";
import { Game } from "../game/index.js";
import { useTweaks, TweaksPanel, TweakRow, TweakSection, TweakSelect } from "./tweaks/TweaksPanel.jsx";

// The host edit-mode bridge rewrites this block on disk; keep the markers.
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "weather": "sunny",
  "vehicle": "scooter"
}/*EDITMODE-END*/;

function useFrameTime(active) {
  const [stats, setStats] = useState({ median: 0, p95: 0, fps: 0 });
  useEffect(() => {
    // The tweaks shell is mounted throughout a run but normally returns null.
    // Do not add a second rAF callback (or React work every 30 frames) to the
    // shipped game merely to feed a panel nobody has opened.
    if (!active) {
      setStats({ median: 0, p95: 0, fps: 0 });
      return undefined;
    }
    let raf = 0, last = performance.now(), ticks = 0;
    const samples = [];
    const measure = (now) => {
      const dt = now - last;
      last = now;
      // performance.now() is monotonic; the truthiness guard drops the only
      // non-positive value it can produce here (a zero-length frame).
      if (dt && dt < 1000) {
        samples.push(dt);
        if (samples.length > 120) samples.shift();
      }
      if (++ticks >= 30 && samples.length) {
        const ordered = samples.slice().sort((a, b) => a - b);
        const median = ordered[ordered.length >> 1];
        const p95 = ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * 0.95))];
        setStats({ median, p95, fps: 1000 / median });
        ticks = 0;
      }
      raf = requestAnimationFrame(measure);
    };
    raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return stats;
}

export default function GameTweaks() {
  const [t, set] = useTweaks(TWEAK_DEFAULTS);
  const [editModeActive, setEditModeActive] = useState(false);
  const frame = useFrameTime(editModeActive);
  // Apply only tweaks the user changes — NOT the defaults on mount, which
  // would stomp the stage weather and the vehicle chosen in StageSelect
  // every time the panel mounts on "playing".
  const mounted = useRef(false);
  useEffect(() => { if (mounted.current) Game.setWeather(t.weather); }, [t.weather]);
  useEffect(() => { if (mounted.current) Game.setVehicle(t.vehicle); }, [t.vehicle]);
  useEffect(() => { mounted.current = true; }, []);
  return (
    <TweaksPanel title="Tweaks" onOpenChange={setEditModeActive}>
      <TweakSection label="Rendimiento">
        <TweakRow label="Cuadro" value={frame.median
          ? `${frame.median.toFixed(1)} ms · ${frame.fps.toFixed(0)} FPS` : "…"} />
        <TweakRow label="p95" value={frame.p95 ? `${frame.p95.toFixed(1)} ms` : "…"} />
      </TweakSection>
      <TweakSection label="Mundo">
        <TweakSelect label="Clima" value={t.weather} onChange={(v) => set("weather", v)}
          options={[
            { value: "sunny", label: "Soleado" },
            { value: "sunset", label: "Atardecer" },
            { value: "storm", label: "Tormenta" },
            { value: "night", label: "Noche" },
          ]} />
      </TweakSection>
      <TweakSection label="Vehículo">
        <TweakSelect label="Tipo" value={t.vehicle} onChange={(v) => set("vehicle", v)}
          options={Object.entries(Game.VEHICLES).map(([k, v]) => ({ value: k, label: v.name }))} />
      </TweakSection>
    </TweaksPanel>
  );
}
