import React, { useState, useEffect } from "react";
import { VEHICLES } from "../../game/vehicles.js";
import { economy, VEHICLE_PRICES, UPGRADES, BOOSTS, COLORS, COIN_PACKS } from "../../game/economy.js";
import { iap } from "../../monetize/iap.js";
import { sfx } from "../../game/audio.js";
import { useT } from "../../i18n/index.js";
import VehiclePreview from "../VehiclePreview.jsx";
import CoinIcon from "../CoinIcon.jsx";
import FitScale from "../FitScale.jsx";

const TABS = ["vehicles", "upgrades", "boosts", "colors"];

// The Churchill-coins shop: vehicles, permanent upgrades, per-run boosts and
// paint colors, plus the coin packs (IAP). Everything reads/writes economy.js.
export default function ShopScreen({ onBack }) {
  const t = useT();
  const [tab, setTab] = useState("vehicles");
  const [vIdx, setVIdx] = useState(0);                 // vehicle carousel index
  const [colorVeh, setColorVeh] = useState("scooter"); // colors tab context
  const [, bump] = useState(0);
  useEffect(() => economy.onChange(() => bump((n) => n + 1)), []);
  useEffect(() => iap.onChange(() => bump((n) => n + 1)), []);

  const buy = (fn) => { if (fn()) sfx.play("delivery"); else sfx.play("menu_denied"); };
  const price = (n) => <span className="coin-price"><CoinIcon size={15} /> {n}</span>;

  const vehKeys = Object.keys(VEHICLES);
  const ownedVehs = vehKeys.filter((k) => economy.ownsVehicle(k));
  const equippedCol = economy.equippedColor(colorVeh);

  return (
    <div className="title-bg">
      <div className="title-shell">
        <FitScale>
        <div className="title-card settings-card shop-card">
          <button className="btn secondary back-btn" onClick={onBack}>{t("settings.back")}</button>
          <div className="shop-head">
            <h1 className="title-main" style={{ fontSize: 32 }}>{t("shop.title")}</h1>
            <div className="coin-pill" aria-label={t("shop.have", { n: economy.coins })}>
              <CoinIcon size={20} /> <b>{economy.coins.toLocaleString()}</b>
            </div>
          </div>

          <div className="shop-tabs">
            {TABS.map((id) => (
              <button key={id} className={"btn " + (tab === id ? "gold" : "secondary")}
                onClick={() => { setTab(id); sfx.play("menu_move"); }}>
                {t(`shop.tab.${id}`)}
              </button>
            ))}
          </div>

          <div className="shop-body">
          {tab === "vehicles" && (() => {
            const k = vehKeys[vIdx];
            const owned = economy.ownsVehicle(k);
            const p = VEHICLE_PRICES[k];
            const move = (d) => { setVIdx((i) => (i + d + vehKeys.length) % vehKeys.length); sfx.play("menu_move"); };
            return (
              <>
                <div className="shop-carousel">
                  <button className="carousel-arrow" onClick={() => move(-1)} aria-label="‹">‹</button>
                  <div className={"shop-item shop-item-hero" + (owned ? " owned" : "")}>
                    <VehiclePreview vehKey={k} color={economy.equippedColor(k)?.hex || null} />
                    {owned ? (
                      <span className="shop-state ok">{p ? t("shop.owned") : t("shop.free")}</span>
                    ) : (
                      <button className="btn gold" disabled={!economy.canAfford(p)}
                        onClick={() => buy(() => economy.buyVehicle(k))}>
                        {t("shop.buy")} · {price(p)}
                      </button>
                    )}
                    {!owned && !economy.canAfford(p) && (
                      <span className="shop-hint">{t("shop.needCoins", { n: p - economy.coins })} <CoinIcon size={12} /></span>
                    )}
                  </div>
                  <button className="carousel-arrow" onClick={() => move(1)} aria-label="›">›</button>
                </div>
                <div className="stage-dots">
                  {vehKeys.map((vk, i) => (
                    <button key={vk} className={"dot" + (i === vIdx ? " on" : "") + (economy.ownsVehicle(vk) ? " cleared" : "")}
                      onClick={() => { setVIdx(i); sfx.play("menu_move"); }} aria-label={vk}></button>
                  ))}
                </div>
              </>
            );
          })()}

          {tab === "upgrades" && (
            <div className="shop-rows">
              {Object.keys(UPGRADES).map((line) => {
                const u = UPGRADES[line];
                const lv = economy.upgradeLevel(line);
                const next = economy.nextUpgradePrice(line);
                return (
                  <div key={line} className="shop-row">
                    <span className="shop-ico">{u.icon}</span>
                    <div className="shop-info">
                      <b>{t(`shop.${line}.name`)}</b>
                      <span className="shop-desc">{t(`shop.${line}.desc`)}</span>
                      <span className="shop-lv">
                        {[1, 2, 3].map((i) => <i key={i} className={"lv-dot" + (lv >= i ? " on" : "")}></i>)}
                        {" "}{t("shop.level", { n: lv, max: 3 })}
                      </span>
                    </div>
                    {next !== null ? (
                      <button className="btn gold" disabled={!economy.canAfford(next)}
                        onClick={() => buy(() => economy.buyUpgrade(line))}>
                        {t("shop.buy")} · {price(next)}
                      </button>
                    ) : <span className="shop-state ok">{t("shop.max")}</span>}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "boosts" && (
            <div className="shop-rows">
              {Object.keys(BOOSTS).map((id) => {
                const b = BOOSTS[id];
                return (
                  <div key={id} className="shop-row">
                    <span className="shop-ico">{b.icon}</span>
                    <div className="shop-info">
                      <b>{t(`shop.${id}.name`)} <span className="shop-count">×{economy.boostCount(id)}</span></b>
                      <span className="shop-desc">{t(`shop.${id}.desc`)}</span>
                    </div>
                    <button className="btn gold" disabled={!economy.canAfford(b.price)}
                      onClick={() => buy(() => economy.buyBoost(id))}>
                      {t("shop.buy")} · {price(b.price)}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {tab === "colors" && (
            <div className="shop-colors">
              <div className="shop-tabs" style={{ marginBottom: 8 }}>
                {ownedVehs.map((k) => (
                  <button key={k} className={"vchip " + (colorVeh === k ? "active" : "")}
                    onClick={() => { setColorVeh(k); sfx.play("menu_move"); }}>
                    {VEHICLES[k].name}
                  </button>
                ))}
              </div>
              <VehiclePreview vehKey={colorVeh} color={equippedCol?.hex || null} />
              <div className="swatches">
                <button className={"swatch stock" + (!equippedCol ? " equipped" : "")}
                  title={t("shop.stock")}
                  onClick={() => { economy.equipColor(colorVeh, null); sfx.play("menu_move"); }}>↺</button>
                {COLORS.map((c) => {
                  const owned = economy.ownsColor(c.id);
                  const eq = equippedCol?.id === c.id;
                  return (
                    <button key={c.id} className={"swatch" + (eq ? " equipped" : "") + (owned ? "" : " locked")}
                      style={{ background: c.hex }} title={`${c.name}${owned ? "" : ` · ${c.price}`}`}
                      onClick={() => {
                        if (owned) { economy.equipColor(colorVeh, c.id); sfx.play("menu_move"); }
                        else buy(() => economy.buyColor(c.id) && economy.equipColor(colorVeh, c.id));
                      }}>
                      {!owned && <span className="swatch-price"><CoinIcon size={11} />{c.price}</span>}
                      {eq && "✓"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          </div>{/* /shop-body */}

          <div className="shop-packs">
            <div className="shop-packs-title">{t("shop.packs")}</div>
            {iap.isNative ? (
              iap.available ? (
                <div className="shop-tabs">
                  {COIN_PACKS.map((pk) => (
                    <button key={pk.productId} className="btn gold" onClick={() => iap.buy(pk.productId)}>
                      <CoinIcon size={15} /> {pk.coins.toLocaleString()} · {iap.packPrice(pk.productId) || pk.usd}
                    </button>
                  ))}
                </div>
              ) : <span className="set-desc">{t("shop.packsPlay")}</span>
            ) : <span className="set-desc">{t("shop.packsWeb")}</span>}
          </div>
        </div>
        </FitScale>
      </div>
    </div>
  );
}
