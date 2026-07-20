import React, { useState, useEffect } from "react";
import { Game } from "../game/index.js";
import { VEHICLES } from "../game/vehicles.js";
import { economy, VEHICLE_PRICES, BOOSTS, COLORS } from "../game/economy.js";
import { sfx } from "../game/audio.js";
import { useT } from "../i18n/index.js";
import VehiclePreview from "./VehiclePreview.jsx";
import FitScale from "./FitScale.jsx";
import CoinIcon from "./CoinIcon.jsx";
import Icon from "./Icon.jsx";

// Pre-run picker for every mode: Arcade / Recorrer arm boosts here too, while
// Historia (storyMode) hides them — the StageBrief owns boost-arming there.
// Two scale-to-fit cards side by side: the vehicle carousel and an options
// card (paint colours you own + boosts to arm for this run). Locked vehicles
// deep-link to the Shop; boosts are consumed at mode start by armRun.
export default function VehiclePicker({ onGo, onShop, onBack, storyMode = false }) {
  const t = useT();
  const startKey = economy.ownsVehicle(Game.state.vehicleKey) ? Game.state.vehicleKey : "scooter";
  const [veh, setVeh] = useState(startKey);
  const [armed, setArmed] = useState({});
  const [, bump] = useState(0);
  useEffect(() => economy.onChange(() => bump((n) => n + 1)), []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); onBack(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const vehKeys = Object.keys(VEHICLES);
  const owned = economy.ownsVehicle(veh);
  const totalBoosts = Object.keys(BOOSTS).reduce((s, id) => s + economy.boostCount(id), 0);
  const equippedCol = economy.equippedColor(veh);

  const pick = (k) => { sfx.play(economy.ownsVehicle(k) ? "menu_move" : "menu_denied"); setVeh(k); };
  const toggleBoost = (id) => {
    if (economy.boostCount(id) <= 0) { sfx.play("menu_denied"); return; }
    sfx.play("menu_move");
    setArmed((a) => ({ ...a, [id]: !a[id] }));
  };
  // Equip an owned paint inline; unowned colours deep-link to the Shop.
  const pickColor = (id) => {
    if (!id || economy.ownsColor(id)) { economy.equipColor(veh, id); sfx.play("menu_move"); }
    else { sfx.play("menu_denied"); onShop(); }
  };
  const go = () => {
    if (!owned) { sfx.play("menu_denied"); return; }
    sfx.play("menu_select");
    onGo(veh, armed);
  };

  return (
    <div className="title-bg">
      <div className="title-shell shell-col">
        <div className="shell-nav">
          <button className="btn secondary" onClick={onBack}>{t("select.back")}</button>
          <h2 className="title-main shell-title">{t("picker.title")}</h2>
          <button className="btn secondary" onClick={onShop}>
            <Icon name="cart" size={14} /> <CoinIcon size={13} /> {economy.coins.toLocaleString()}
          </button>
        </div>
        <FitScale pad={110}>
          <div className="picker-wrap">
            <div className="picker-layout">
              {/* vehicle card */}
              <div className="glass-card picker-veh">
                <VehiclePreview vehKey={veh} color={equippedCol?.hex || null} />
                <div className="vehicles-col">
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
                  <button className="btn secondary picker-getbtn" onClick={onShop}>
                    <Icon name="lock" size={13} /> {t("picker.locked")} · <CoinIcon size={13} /> {VEHICLE_PRICES[veh]}
                  </button>
                )}
                <button className="btn gold hero-play" onClick={go} disabled={!owned}>{t("picker.go")}</button>
              </div>

              {/* options card: paint colours + boosts */}
              <div className="glass-card picker-side">
                <div className="vehicle-card-title">{t("picker.color")}</div>
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
                        {!has && <Icon name="lock" size={11} />}{eq && "✓"}
                      </button>
                    );
                  })}
                </div>
                {!storyMode && totalBoosts > 0 && (
                  <div className="picker-boosts">
                    <div className="vehicle-card-title">{t("picker.boosts", { n: totalBoosts })}</div>
                    <div className="shop-tabs" style={{ margin: "6px 0 0" }}>
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
              </div>
            </div>
          </div>
        </FitScale>
      </div>
    </div>
  );
}
