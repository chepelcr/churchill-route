import React, { useState, useEffect } from "react";
import { Game } from "../../game/index.js";
import { VEHICLES } from "../../game/vehicles.js";
import { economy, VEHICLE_PRICES, UPGRADES, BOOSTS, COLORS, COIN_PACKS } from "../../game/economy.js";
import { iap } from "../../monetize/iap.js";
import { sfx } from "../../game/audio.js";
import { useT } from "../../i18n/index.js";
import VehiclePreview from "../VehiclePreview.jsx";
import CoinIcon from "../CoinIcon.jsx";
import Icon from "../Icon.jsx";

const TABS = ["vehicles", "upgrades", "boosts", "colors", "packs"];

// The Churchill-coins shop — a FULL-SCREEN page (edge to edge, no floating
// card): header (back / title / balance), tab bar, and one tab of content
// centered in the remaining space. Coin packs are their own tab so no tab
// ever needs to scroll.
// `ctx` ({ tab?, veh? }) comes from deep-links (vehicle picker): it opens the
// right tab AND selects the car being customized — colors always equip to
// THAT car, never a hardcoded default.
export default function ShopScreen({ onBack, ctx }) {
  const t = useT();
  const vehKeysAll = Object.keys(VEHICLES);
  const [tab, setTab] = useState(ctx?.tab || "vehicles");
  const [vIdx, setVIdx] = useState(() =>                // vehicle carousel index
    Math.max(0, vehKeysAll.indexOf(ctx?.veh || Game.state.vehicleKey)));
  const [colorVeh, setColorVeh] = useState(() => {      // colors tab context
    const k = ctx?.veh || Game.state.vehicleKey;
    return economy.ownsVehicle(k) ? k : "scooter";
  });
  const [pending, setPending] = useState(null);        // { label, price, fn } confirm gate
  const [, bump] = useState(0);
  useEffect(() => economy.onChange(() => bump((n) => n + 1)), []);
  useEffect(() => iap.onChange(() => bump((n) => n + 1)), []);

  const buy = (fn) => { if (fn()) sfx.play("delivery"); else sfx.play("menu_denied"); };
  // Purchases are gated behind a confirm step so nothing is bought "sin querer".
  const askBuy = (label, cost, fn) => { sfx.play("menu_move"); setPending({ label, price: cost, fn }); };
  const confirmBuy = () => { if (pending) buy(pending.fn); setPending(null); };
  const cancelBuy = () => { sfx.play("menu_move"); setPending(null); };
  const price = (n) => <span className="coin-price"><CoinIcon size={16} /> {n}</span>;

  const vehKeys = Object.keys(VEHICLES);
  const ownedVehs = vehKeys.filter((k) => economy.ownsVehicle(k));
  const equippedCol = economy.equippedColor(colorVeh);

  return (
    <div className="page-card">
      <div className="page-head">
        <button className="btn secondary" onClick={onBack}>{t("settings.back")}</button>
        <h1 className="title-main page-title">{t("shop.title")}</h1>
        <div className="coin-pill" aria-label={t("shop.have", { n: economy.coins })}>
          <CoinIcon size={20} /> <b>{economy.coins.toLocaleString()}</b>
        </div>
      </div>

      <div className="shop-tabs">
        {TABS.map((id) => (
          <button key={id} className={"btn " + (tab === id ? "gold" : "secondary")}
            onClick={() => { setTab(id); sfx.play("menu_move"); }}>
            {id === "packs" ? <><CoinIcon size={13} /> {t(`shop.tab.${id}`)}</> : t(`shop.tab.${id}`)}
          </button>
        ))}
      </div>

      <div className="page-body">
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
                      onClick={() => askBuy(VEHICLES[k].name, p, () => economy.buyVehicle(k))}>
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
                  <span className="shop-ico"><Icon name={u.icon} size={26} /></span>
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
                      onClick={() => askBuy(t(`shop.${line}.name`), next, () => economy.buyUpgrade(line))}>
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
                  <span className="shop-ico"><Icon name={b.icon} size={26} /></span>
                  <div className="shop-info">
                    <b>{t(`shop.${id}.name`)} <span className="shop-count">×{economy.boostCount(id)}</span></b>
                    <span className="shop-desc">{t(`shop.${id}.desc`)}</span>
                  </div>
                  <button className="btn gold" disabled={!economy.canAfford(b.price)}
                    onClick={() => askBuy(t(`shop.${id}.name`), b.price, () => economy.buyBoost(id))}>
                    {t("shop.buy")} · {price(b.price)}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {tab === "colors" && (
          <div className="shop-colors">
            <div className="shop-tabs" style={{ margin: 0 }}>
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
                      else askBuy(c.name, c.price, () => economy.buyColor(c.id) && economy.equipColor(colorVeh, c.id));
                    }}>
                    {!owned && <span className="swatch-price"><CoinIcon size={11} />{c.price}</span>}
                    {eq && "✓"}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {tab === "packs" && (
          <div className="shop-rows packs-rows">
            {iap.isNative ? (
              iap.available ? (
                COIN_PACKS.map((pk) => (
                  <div key={pk.productId} className="shop-row">
                    <span className="shop-ico"><CoinIcon size={30} /></span>
                    <div className="shop-info">
                      <b>{pk.coins.toLocaleString()} {t("shop.tab.packs").toLowerCase()}</b>
                    </div>
                    <button className="btn gold" onClick={() => iap.buy(pk.productId)}>
                      {iap.packPrice(pk.productId) || pk.usd}
                    </button>
                  </div>
                ))
              ) : <span className="set-desc">{t("shop.packsPlay")}</span>
            ) : <span className="set-desc">{t("shop.packsWeb")}</span>}
          </div>
        )}
      </div>

      {pending && (
        <div className="overlay" onClick={cancelBuy}>
          <div className="panel confirm-panel" onClick={(e) => e.stopPropagation()}>
            <h2>{t("shop.confirmTitle")}</h2>
            <div className="confirm-item">
              <b>{pending.label}</b>
              <span className="coin-price"><CoinIcon size={18} /> {pending.price}</span>
            </div>
            <div className="btn-row">
              <button className="btn gold" disabled={!economy.canAfford(pending.price)} onClick={confirmBuy}>
                {t("shop.confirmYes")}
              </button>
              <button className="btn secondary" onClick={cancelBuy}>{t("shop.confirmNo")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
