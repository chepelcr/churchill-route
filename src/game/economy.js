// Churchill coins economy — catalog (pure data) + wallet/ownership ops.
// Everything persists inside state.progress (progress.js localStorage), so
// old saves migrate silently via ensureEconomy(). Catalog growth (future
// vehicles, more colors) = new entries here, no schema changes.
import { state } from "./state.js";
import { saveProgress } from "./progress.js";
import { VEHICLES } from "./vehicles.js";

export const FREE_VEHICLES = ["bici", "scooter", "tuktuk"];

// Earn rates (approved economy: ~10-15 coins per honest run)
export const COINS_PER_DELIVERY = 3;
export const COINS_PERFECT_BONUS = 2;

// upgrade lines: effect per level (level 0 = none)
export const UPGRADES = {
  cooler:    { name: "Cooler pro",   icon: "cube",  levels: [1, 0.9, 0.8, 0.7],     prices: [200, 500, 1000] }, // melt multiplier
  turbotank: { name: "Turbo tank",   icon: "flame", levels: [1.35, 1.42, 1.48, 1.55], prices: [200, 500, 1000] }, // boost top-speed cap
};

// consumable boosts (armed per run from the vehicle picker / shop)
export const BOOSTS = {
  icepack:   { name: "Ice pack",    icon: "snow",   price: 60, desc: "30s sin derretir" },
  headstart: { name: "Head start",  icon: "rocket", price: 40, desc: "5s de turbo gratis" },
};

// cosmetic paint colors (per-vehicle equip)
export const COLORS = [
  { id: "col_rojo",    name: "Rojo porteño",  hex: "#d63a30", price: 80 },
  { id: "col_azul",    name: "Azul gulf",     hex: "#2e8bd6", price: 80 },
  { id: "col_verde",   name: "Verde manglar", hex: "#2e7d44", price: 80 },
  { id: "col_morado",  name: "Morado feria",  hex: "#8a4fd6", price: 80 },
  { id: "col_negro",   name: "Negro noche",   hex: "#26222c", price: 80 },
  { id: "col_dorado",  name: "Dorado leyenda", hex: "#e8b53a", price: 80 },
];

export const VEHICLE_PRICES = { cart: 350, pickup: 900, turbo: 1500 };

// IAP coin packs (Play Billing CONSUMABLE product ids → coin amounts)
export const COIN_PACKS = [
  { productId: "coins_500",  coins: 500,  usd: "$0.99" },
  { productId: "coins_2000", coins: 2000, usd: "$2.99" },
  { productId: "coins_4000", coins: 4000, usd: "$4.99" },
];

// ---- persistence shape ------------------------------------------------------
// Called from loadProgress(): fills in economy fields on old saves.
export function ensureEconomy(p) {
  if (!Number.isFinite(p.coins)) p.coins = 0;
  if (!Array.isArray(p.owned) || !p.owned.length) p.owned = [...FREE_VEHICLES];
  for (const v of FREE_VEHICLES) if (!p.owned.includes(v)) p.owned.push(v);
  if (!p.upgrades || typeof p.upgrades !== "object") p.upgrades = {};
  if (!p.boosts || typeof p.boosts !== "object") p.boosts = {};
  if (!p.colors || typeof p.colors !== "object") p.colors = {};
  if (!Array.isArray(p.ownedColors)) p.ownedColors = [];
  return p;
}

const listeners = new Set();
function emit() { saveProgress(); for (const fn of listeners) fn(); }

export const economy = {
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  get coins() { return state.progress?.coins || 0; },
  addCoins(n) {
    state.progress.coins = Math.max(0, (state.progress.coins || 0) + Math.round(n));
    emit();
  },
  canAfford(n) { return this.coins >= n; },
  spend(n) {
    if (!this.canAfford(n)) return false;
    state.progress.coins -= n;
    emit();
    return true;
  },

  // --- vehicles ---
  ownsVehicle(key) { return state.progress.owned.includes(key); },
  vehiclePrice(key) { return VEHICLE_PRICES[key] ?? 0; },
  buyVehicle(key) {
    if (this.ownsVehicle(key) || !VEHICLES[key]) return false;
    if (!this.spend(this.vehiclePrice(key))) return false;
    state.progress.owned.push(key);
    emit();
    return true;
  },

  // --- upgrades (permanent, leveled) ---
  upgradeLevel(line) { return state.progress.upgrades[line] || 0; },
  upgradeEffect(line) {
    const u = UPGRADES[line];
    return u ? u.levels[Math.min(this.upgradeLevel(line), u.levels.length - 1)] : 1;
  },
  nextUpgradePrice(line) {
    const u = UPGRADES[line], lv = this.upgradeLevel(line);
    return u && lv < u.prices.length ? u.prices[lv] : null;
  },
  buyUpgrade(line) {
    const price = this.nextUpgradePrice(line);
    if (price === null || !this.spend(price)) return false;
    state.progress.upgrades[line] = this.upgradeLevel(line) + 1;
    emit();
    return true;
  },

  // --- consumable boosts ---
  boostCount(id) { return state.progress.boosts[id] || 0; },
  buyBoost(id) {
    const b = BOOSTS[id];
    if (!b || !this.spend(b.price)) return false;
    state.progress.boosts[id] = this.boostCount(id) + 1;
    emit();
    return true;
  },
  useBoost(id) {
    if (this.boostCount(id) <= 0) return false;
    state.progress.boosts[id] -= 1;
    emit();
    return true;
  },

  // --- colors (buy once, equip per vehicle) ---
  ownsColor(id) { return state.progress.ownedColors.includes(id); },
  buyColor(id) {
    const c = COLORS.find((c) => c.id === id);
    if (!c || this.ownsColor(id) || !this.spend(c.price)) return false;
    state.progress.ownedColors.push(id);
    emit();
    return true;
  },
  equippedColor(vehKey) {
    const id = state.progress.colors[vehKey];
    return COLORS.find((c) => c.id === id) || null;
  },
  equipColor(vehKey, colorId) {
    if (colorId && !this.ownsColor(colorId)) return false;
    if (colorId) state.progress.colors[vehKey] = colorId;
    else delete state.progress.colors[vehKey]; // back to stock paint
    emit();
    return true;
  },
};
