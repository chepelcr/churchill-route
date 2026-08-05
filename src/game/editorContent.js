// Runtime bridge for non-spatial content authored by the world editor.
//
// The editor emits data, not JavaScript. At boot we merge enabled definitions
// into the game's existing mutable catalogs, so a new vehicle/boost/upgrade/
// paint/coin pack immediately uses the same shop, ownership and vehicle-picker
// flows as shipped content.
import { WORLD2D as W } from "../world2d/index.js";
import { VEHICLES } from "./vehicles.js";
import {
  BOOSTS, COIN_PACKS, COLORS, UPGRADES, VEHICLE_PRICES,
} from "./economy.js";

export const SHOP_TABS = [
  // `medium` scopes a vehicle tab to the ground its rides live on
  // (vehicles.js `medium`): the carros and the lanchas share one card and one
  // buy flow, and differ only in which keys they list.
  { id: "vehicles", label: "Vehículos", enabled: true, medium: "land" },
  { id: "boats", label: "Lanchas", enabled: true, medium: "water" },
  { id: "upgrades", label: "Mejoras", enabled: true },
  { id: "boosts", label: "Boosts", enabled: true },
  { id: "colors", label: "Colores", enabled: true },
  { id: "packs", label: "Monedas", enabled: true },
];
export const SHOP_ITEMS = [];

let applied = false;
const number = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export function applyEditorContent() {
  if (applied) return;
  applied = true;
  const shop = W.EDITOR_CONTENT?.shop || {};
  for (const tab of shop.tabs || []) {
    if (!tab?.id) continue;
    const index = SHOP_TABS.findIndex((item) => item.id === tab.id);
    const normalized = {
      id: tab.id,
      label: tab.label || tab.name || tab.id,
      enabled: tab.enabled !== false,
    };
    if (tab.medium) normalized.medium = tab.medium;
    if (index >= 0) SHOP_TABS[index] = { ...SHOP_TABS[index], ...normalized };
    else SHOP_TABS.push(normalized);
  }
  for (const item of shop.items || []) {
    if (!item?.id || item.enabled === false) continue;
    const config = item.config || {};
    const normalized = {
      ...item,
      name: item.name || item.id,
      description: item.description || "",
      tab: item.tab || `${item.kind || "extras"}s`,
      price: Math.max(0, number(item.price, 0)),
      config,
    };
    SHOP_ITEMS.push(normalized);
    if (item.kind === "vehicle") {
      const key = config.vehicleKey || item.id;
      VEHICLES[key] = {
        name: normalized.name,
        accel: number(config.accel, 200),
        top: number(config.top, 220),
        turn: number(config.turn, 2.7),
        grip: number(config.grip, 0.82),
        melt: number(config.melt, 1),
        color: config.color || item.color || "#e85d75",
        roof: config.roofColor || "#fff",
        w: number(config.w, 27),
        h: number(config.h, 16),
        kind: config.drawKind === "bike" ? "bike" : "car",
        editorItem: item.id,
      };
      VEHICLE_PRICES[key] = normalized.price;
    } else if (item.kind === "boost") {
      BOOSTS[item.id] = {
        name: normalized.name,
        desc: normalized.description,
        icon: config.icon || "rocket",
        price: normalized.price,
        effect: config.effect || "turbo",
        duration: Math.max(0, number(config.duration, 5)),
        value: number(config.value, 1),
        editorItem: item.id,
      };
    } else if (item.kind === "upgrade") {
      const prices = Array.isArray(config.prices) ? config.prices.map(Number) : [normalized.price];
      const values = Array.isArray(config.values) ? config.values.map(Number) : [1, number(config.value, 1.1)];
      UPGRADES[item.id] = {
        name: normalized.name,
        desc: normalized.description,
        icon: config.icon || "cube",
        prices,
        levels: values,
        stat: config.stat || config.effect || "top",
        appliesTo: config.appliesTo || "all",
        editorItem: item.id,
      };
    } else if (item.kind === "color") {
      if (!COLORS.some((color) => color.id === item.id)) {
        COLORS.push({
          id: item.id, name: normalized.name,
          hex: config.hex || item.color || "#e8b53a",
          price: normalized.price,
        });
      }
    } else if (item.kind === "coin-pack") {
      if (!COIN_PACKS.some((pack) => pack.productId === (config.productId || item.id))) {
        COIN_PACKS.push({
          productId: config.productId || item.id,
          coins: Math.max(1, number(config.coins, 500)),
          usd: config.storePrice || "$0.99",
        });
      }
    }
  }
}

// Permanent authored upgrades and generic vehicle parts affect a cloned run
// vehicle; the source catalog stays immutable during that run.
export function applyOwnedShopEffects(vehicleKey, vehicle, progress) {
  const result = { ...vehicle };
  for (const item of SHOP_ITEMS) {
    const config = item.config || {};
    const target = config.appliesTo || "all";
    if (target !== "all" && target !== vehicleKey) continue;
    let amount = null;
    if (item.kind === "upgrade") {
      const level = progress?.upgrades?.[item.id] || 0;
      if (!level) continue;
      const values = Array.isArray(config.values) ? config.values : [1, config.value || 1.1];
      amount = number(values[Math.min(level, values.length - 1)], 1);
    } else if (item.kind === "vehicle-part" && progress?.ownedItems?.includes(item.id)) {
      amount = number(config.value, 1);
    } else continue;
    const stat = config.stat || config.effect;
    if (["top", "accel", "turn", "grip"].includes(stat)) result[stat] *= amount;
    else if (stat === "melt") result.melt *= amount;
  }
  return result;
}

export function consumeEditorBoosts(armed, economy, state) {
  state.editorBoosts = {};
  for (const [id, enabled] of Object.entries(armed || {})) {
    const boost = BOOSTS[id];
    if (!enabled || !boost || !economy.useBoost(id)) continue;
    state.editorBoosts[id] = {
      effect: boost.effect,
      value: number(boost.value, 1),
      remaining: Math.max(0, number(boost.duration, 0)),
    };
  }
}

export function tickEditorBoosts(dt, state) {
  for (const boost of Object.values(state.editorBoosts || {})) {
    boost.remaining = Math.max(0, boost.remaining - dt);
  }
}

export function activeEditorBoost(state, effect) {
  return Object.values(state.editorBoosts || {}).find((boost) => (
    boost.effect === effect && boost.remaining > 0
  )) || null;
}
