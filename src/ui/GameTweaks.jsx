import React, { useEffect, useRef } from "react";
import { Game } from "../game/index.js";
import { useTweaks, TweaksPanel, TweakSection, TweakSelect } from "./tweaks/TweaksPanel.jsx";

// The host edit-mode bridge rewrites this block on disk; keep the markers.
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "weather": "sunny",
  "vehicle": "scooter"
}/*EDITMODE-END*/;

export default function GameTweaks() {
  const [t, set] = useTweaks(TWEAK_DEFAULTS);
  // Apply only tweaks the user changes — NOT the defaults on mount, which
  // would stomp the stage weather and the vehicle chosen in StageSelect
  // every time the panel mounts on "playing".
  const mounted = useRef(false);
  useEffect(() => { if (mounted.current) Game.setWeather(t.weather); }, [t.weather]);
  useEffect(() => { if (mounted.current) Game.setVehicle(t.vehicle); }, [t.vehicle]);
  useEffect(() => { mounted.current = true; }, []);
  return (
    <TweaksPanel title="Tweaks">
      <TweakSection title="Mundo">
        <TweakSelect label="Clima" value={t.weather} onChange={(v) => set("weather", v)}
          options={[
            { value: "sunny", label: "Soleado" },
            { value: "sunset", label: "Atardecer" },
            { value: "storm", label: "Tormenta" },
            { value: "night", label: "Noche" },
          ]} />
      </TweakSection>
      <TweakSection title="Vehículo">
        <TweakSelect label="Tipo" value={t.vehicle} onChange={(v) => set("vehicle", v)}
          options={Object.entries(Game.VEHICLES).map(([k, v]) => ({ value: k, label: v.name }))} />
      </TweakSection>
    </TweaksPanel>
  );
}
