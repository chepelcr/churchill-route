import React, { useState, useEffect } from "react";
import { Game } from "../game/index.js";
import { VEHICLES } from "../game/vehicles.js";
import { economy, VEHICLE_PRICES, BOOSTS, COLORS } from "../game/economy.js";
import { sfx } from "../game/audio.js";
import { useT } from "../i18n/index.js";
import VehiclePreview from "./VehiclePreview.jsx";
import CoinIcon from "./CoinIcon.jsx";
import Icon from "./Icon.jsx";

// Pre-run vehicle picker for Arcade / Recorrer (Historia keeps its inline
// card in StageSelect). Locked vehicles deep-link to the Shop; owned boosts
// can be armed for this run (consumed at mode start by modes.js armRun).
export default function VehiclePicker({ onGo, onShop, onBack }) {
  const t = useT();
  const startKey = economy.ownsVehicle(Game.state.vehicleKey) ? Game.state.vehicleKey : "scooter";
  const [veh, setVeh] = useState(startKey);
  const [armed, setArmed] = useState({});
  const [, bump] = useState(0);
  useEffect(() => economy.onChange(() => bump((n) => n + 1)), []);

  const vehKeys = Object.keys(VEHICLES);
  const owned = economy.ownsVehicle(veh);
  const totalBoosts = Object.keys(BOOSTS).reduce((s, id) => s + economy.boostCount(id), 0);
  const equippedCol = economy.equippedColor(veh);
  // Equip a paint you already own right here; unowned colours deep-link to the
  // Shop (that's where they're bought).
  const pickColor = (id) => {
    if (!id || economy.ownsColor(id)) { economy.equipColor(veh, id); sfx.play("menu_move"); }
    else { sfx.play("menu_denied"); onShop(); }
  };

  const pick = (k) => {
    sfx.play(economy.ownsVehicle(k) ? "menu_move" : "menu_denied");
    setVeh(k);
  };
  const toggleBoost = (id) => {
    if (economy.boostCount(id) <= 0) { sfx.play("menu_denied"); return; }
    sfx.play("menu_move");
    setArmed((a) => ({ ...a, [id]: !a[id] }));
  };
  const go = () => {
    if (!owned) { sfx.play("menu_denied"); return; }
    sfx.play("menu_select");
    onGo(veh, armed);
  };

  return (
    <div className="overlay">
      <div className="panel picker-panel">
        <h2>{t("picker.title")}</h2>
        <VehiclePreview vehKey={veh} color={economy.equippedColor(veh)?.hex || null} />
        <div className="vehicles-row">
          {vehKeys.map((k) => {
            const has = economy.ownsVehicle(k);
            return (
              <button key={k} className={"vchip " + (veh === k ? "active" : "") + (has ? "" : " locked")}
                onClick={() => pick(k)}>
                {has ? VEHICLES[k].name : <><Icon name="lock" size={12} /> {VEHICLES[k].name}</>}
              </button>
            );
          })}
        </div>
        {!owned && (
          <button className="btn secondary" onClick={onShop}>
            <Icon name="lock" size={13} /> {t("picker.locked")} · <CoinIcon size={13} /> {VEHICLE_PRICES[veh]}
          </button>
        )}
        {owned && (
          <div className="picker-colors">
            <div className="shop-desc">{t("picker.color")}</div>
            <div className="swatches">
              <button className={"swatch stock" + (!equippedCol ? " equipped" : "")}
                title={t("shop.stock")} onClick={() => pickColor(null)}>↺</button>
              {COLORS.map((c) => {
                const has = economy.ownsColor(c.id);
                const eq = equippedCol?.id === c.id;
                return (
                  <button key={c.id} className={"swatch" + (eq ? " equipped" : "") + (has ? "" : " locked")}
                    style={{ background: c.hex }} title={`${c.name}${has ? "" : ` · ${c.price}`}`}
                    onClick={() => pickColor(c.id)}>
                    {!has && <Icon name="lock" size={11} />}
                    {eq && "✓"}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {totalBoosts > 0 && (
          <div className="picker-boosts">
            <div className="shop-desc">{t("picker.boosts", { n: totalBoosts })}</div>
            <div className="shop-tabs">
              {Object.keys(BOOSTS).map((id) => (
                <button key={id} disabled={economy.boostCount(id) <= 0}
                  className={"btn " + (armed[id] ? "gold" : "secondary")}
                  onClick={() => toggleBoost(id)}>
                  <Icon name={BOOSTS[id].icon} size={14} /> {t(`shop.${id}.name`)} ×{economy.boostCount(id)}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="btn-row">
          <button className="btn gold" onClick={go} disabled={!owned}>{t("picker.go")}</button>
          <button className="btn secondary" onClick={onBack}>{t("select.back")}</button>
        </div>
      </div>
    </div>
  );
}
