import React, { useEffect } from "react";
import { Game } from "../game/index.js";
import { useTweaks, TweaksPanel, TweakSection, TweakSelect } from "./tweaks/TweaksPanel.jsx";

// The host edit-mode bridge rewrites this block on disk; keep the markers.
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "weather": "sunny",
  "vehicle": "scooter"
}/*EDITMODE-END*/;

export default function GameTweaks() {
  const [t, set] = useTweaks(TWEAK_DEFAULTS);
  useEffect(() => { Game.setWeather(t.weather); }, [t.weather]);
  useEffect(() => {
    if (t.vehicle !== Game.state.vehicleKey) Game.setVehicle(t.vehicle);
  }, [t.vehicle]);
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
