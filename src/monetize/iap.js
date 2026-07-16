// In-app purchases (Google Play billing via cordova-plugin-purchase).
// One non-consumable product: "remove_ads". Web / dev builds are a safe no-op
// (nothing to buy in the browser). The entitlement is persisted locally and
// re-validated by the store's own restore flow — fine for a single
// "remove ads" unlock per the monetization plan (no backend needed).
const NATIVE = typeof window !== "undefined" && !!window.Capacitor;
const OWNED_KEY = "churchill_noads_v1";
export const PRODUCT_ID = "remove_ads";

const listeners = new Set();
let price = null;      // localized price string once the store loads
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
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // Call once at app start (App.jsx). cordova-plugin-purchase exposes the
  // CdvPurchase global after `npx cap sync` on the native build.
  init() {
    if (!NATIVE) return;
    const boot = () => {
      const CdvPurchase = window.CdvPurchase;
      if (!CdvPurchase) return; // plugin not in this build
      const { store, ProductType, Platform } = CdvPurchase;
      store.register([{ id: PRODUCT_ID, type: ProductType.NON_CONSUMABLE, platform: Platform.GOOGLE_PLAY }]);
      store.when()
        .productUpdated((p) => {
          if (p.id === PRODUCT_ID) {
            price = p.pricing?.price || null;
            available = true;
            if (p.owned && !owned) { owned = true; saveOwned(); }
            emit();
          }
        })
        .approved((tx) => tx.verify())
        .verified((receipt) => {
          owned = true; saveOwned(); emit();
          receipt.finish();
        });
      store.initialize([Platform.GOOGLE_PLAY]);
    };
    if (window.CdvPurchase) boot();
    else document.addEventListener("deviceready", boot, { once: true });
  },

  async buy() {
    if (!NATIVE || !window.CdvPurchase) return false;
    const { store } = window.CdvPurchase;
    const offer = store.get(PRODUCT_ID)?.getOffer();
    if (!offer) return false;
    try { await offer.order(); return true; } catch { return false; }
  },

  async restore() {
    if (!NATIVE || !window.CdvPurchase) return;
    try { await window.CdvPurchase.store.restorePurchases(); } catch { /* user cancelled */ }
  },
};
