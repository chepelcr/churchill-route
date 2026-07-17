// AdMob (via @capacitor-community/admob). Web / dev is a safe no-op; the
// plugin is imported dynamically so it never lands in the web bundle path.
//
// Ad surface — deliberately GENTLE (the app is a tourism showcase first;
// ads must never get in the way of that):
//  - INTERSTITIAL only every 5th finished run, and NEVER during the player's
//    first 3 runs ever (let tourists fall in love first), never after the
//    tutorial, skipped entirely with the "remove ads" purchase.
//  - REWARDED video = "continue +60s" on a lost run — 100% player-initiated,
//    so it doesn't count as intrusive (and isn't gated by remove-ads,
//    since it's a benefit the player asks for).
//  - NO banners: they'd cover the road while driving.
//
// PRODUCTION ad-unit ids (the matching APPLICATION_ID lives in
// AndroidManifest.xml). For ad-debugging, register the device as a test
// device in the AdMob console rather than re-adding initializeForTesting.
import { iap } from "./iap.js";

const NATIVE = typeof window !== "undefined" && !!window.Capacitor;
const COUNT_KEY = "churchill_runs_since_ad_v1";
const TOTAL_KEY = "churchill_runs_total_v1";
const INTERSTITIAL_EVERY = 5;
const GRACE_RUNS = 3; // no interstitials at all for the first runs ever

const AD_INTERSTITIAL = "ca-app-pub-3090812928887940/4457249161";
const AD_REWARDED = "ca-app-pub-3090812928887940/3168218225";

let AdMob = null;          // plugin module once loaded
let RewardAdPluginEvents = null;
let ready = false;

export const ads = {
  async init() {
    if (!NATIVE || ready) return;
    try {
      const mod = await import("@capacitor-community/admob");
      AdMob = mod.AdMob;
      RewardAdPluginEvents = mod.RewardAdPluginEvents;
      await AdMob.initialize();
      ready = true;
    } catch (e) {
      console.warn("[ads] init failed (plugin missing on this platform?)", e);
    }
  },

  // Every INTERSTITIAL_EVERY finished runs, show a full-screen ad — unless
  // the player bought "remove ads", is still in the first-runs grace period,
  // or just finished the tutorial. Fire-and-forget from the results screen.
  async maybeShowInterstitial(mode) {
    if (!ready || iap.owned || mode === "tutorial") return;
    let total = 0, n = 0;
    try { total = (parseInt(localStorage.getItem(TOTAL_KEY), 10) || 0) + 1; } catch { total = 1; }
    try { localStorage.setItem(TOTAL_KEY, String(total)); } catch { /* private */ }
    if (total <= GRACE_RUNS) return;
    try { n = (parseInt(localStorage.getItem(COUNT_KEY), 10) || 0) + 1; } catch { n = 1; }
    try { localStorage.setItem(COUNT_KEY, String(n % INTERSTITIAL_EVERY)); } catch { /* private */ }
    if (n < INTERSTITIAL_EVERY) return;
    try {
      await AdMob.prepareInterstitial({ adId: AD_INTERSTITIAL });
      await AdMob.showInterstitial();
    } catch (e) { console.warn("[ads] interstitial failed", e); }
  },

  // true iff a rewarded "continue" can be offered right now
  canOfferRewarded() { return ready; },

  // Shows the rewarded video; resolves true if the player earned the reward.
  showRewarded() {
    if (!ready) return Promise.resolve(false);
    return new Promise(async (resolve) => {
      let rewarded = false;
      const subs = [];
      try {
        subs.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => { rewarded = true; }));
        subs.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
          for (const s of subs) s.remove();
          resolve(rewarded);
        }));
        await AdMob.prepareRewardVideoAd({ adId: AD_REWARDED });
        await AdMob.showRewardVideoAd();
      } catch (e) {
        console.warn("[ads] rewarded failed", e);
        for (const s of subs) if (s && s.remove) s.remove();
        resolve(false);
      }
    });
  },
};
