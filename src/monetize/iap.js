// In-app purchases (Google Play billing via cordova-plugin-purchase).
// Products: "remove_ads" (NON_CONSUMABLE) + the Churchill-coin packs
// (CONSUMABLE, credited via economy.addCoins). Web / dev builds are a safe
// no-op (nothing to buy in the browser). The remove-ads entitlement is
// persisted locally and re-validated by the store's restore flow — fine for
// a single unlock per the monetization plan (no backend needed).
import { economy, COIN_PACKS } from "../game/economy.js";

const NATIVE = typeof window !== "undefined" && !!window.Capacitor;
const OWNED_KEY = "churchill_noads_v1";
export const PRODUCT_ID = "remove_ads";

const listeners = new Set();
let price = null;      // localized remove-ads price once the store loads
const packPrices = {}; // productId -> localized price
let available = false; // store plugin ready + product loaded

function loadOwned() {
  try { return localStorage.getItem(OWNED_KEY) === "1"; } catch { return false; }
}
function saveOwned() {
  try { localStorage.setItem(OWNED_KEY, "1"); } catch { /* private mode */ }
}
let owned = typeof window !== "undefined" ? loadOwned() : false;

function emit() { for (const fn of listeners) fn(); }

export const iap = {
  get owned() { return owned; },
  get price() { return price; },
  get available() { return available; },
  isNative: NATIVE,
  packPrice(productId) { return packPrices[productId] || null; },
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // Call once at app start (App.jsx). cordova-plugin-purchase exposes the
  // CdvPurchase global after `npx cap sync` on the native build.
  init() {
    if (!NATIVE) return;
    const boot = () => {
      const CdvPurchase = window.CdvPurchase;
      if (!CdvPurchase) return; // plugin not in this build
      const { store, ProductType, Platform } = CdvPurchase;
      store.register([
        { id: PRODUCT_ID, type: ProductType.NON_CONSUMABLE, platform: Platform.GOOGLE_PLAY },
        ...COIN_PACKS.map((pk) => ({ id: pk.productId, type: ProductType.CONSUMABLE, platform: Platform.GOOGLE_PLAY })),
      ]);
      store.when()
        .productUpdated((p) => {
          if (p.id === PRODUCT_ID) {
            price = p.pricing?.price || null;
            available = true;
            if (p.owned && !owned) { owned = true; saveOwned(); }
          } else if (COIN_PACKS.some((pk) => pk.productId === p.id)) {
            packPrices[p.id] = p.pricing?.price || null;
            available = true;
          } else return;
          emit();
        })
        .approved((tx) => tx.verify())
        .verified((receipt) => {
          for (const tx of receipt.transactions || [receipt]) {
            for (const prod of tx.products || []) {
              if (prod.id === PRODUCT_ID) { owned = true; saveOwned(); }
              const pack = COIN_PACKS.find((pk) => pk.productId === prod.id);
              if (pack) economy.addCoins(pack.coins); // consumable: credit coins
            }
          }
          emit();
          receipt.finish();
        });
      store.initialize([Platform.GOOGLE_PLAY]);
    };
    if (window.CdvPurchase) boot();
    else document.addEventListener("deviceready", boot, { once: true });
  },

  async buy(productId = PRODUCT_ID) {
    if (!NATIVE || !window.CdvPurchase) return false;
    const { store } = window.CdvPurchase;
    const offer = store.get(productId)?.getOffer();
    if (!offer) return false;
    try { await offer.order(); return true; } catch { return false; }
  },

  async restore() {
    if (!NATIVE || !window.CdvPurchase) return;
    try { await window.CdvPurchase.store.restorePurchases(); } catch { /* user cancelled */ }
  },
};
