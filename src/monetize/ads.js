// AdMob (via @capacitor-community/admob). Web / dev is a safe no-op; the
// plugin is imported dynamically so it never lands in the web bundle path.
//
// Ad surface (per the monetization plan):
//  - INTERSTITIAL every 3rd finished run (results screen), skipped for the
//    "remove ads" purchase.
//  - REWARDED video = "continue +60s" on a lost run (player-requested; NOT
//    gated by remove-ads, since it's a player benefit).
//
// IDs are Google's PUBLIC TEST ids — replace with real AdMob unit ids (and
// the APPLICATION_ID in AndroidManifest.xml) before the Play release.
import { iap } from "./iap.js";

const NATIVE = typeof window !== "undefined" && !!window.Capacitor;
const COUNT_KEY = "churchill_runs_since_ad_v1";
const INTERSTITIAL_EVERY = 3;

const TEST_INTERSTITIAL = "ca-app-pub-3940256099942544/1033173712";
const TEST_REWARDED = "ca-app-pub-3940256099942544/5224354917";

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
      await AdMob.initialize({ initializeForTesting: true });
      ready = true;
    } catch (e) {
      console.warn("[ads] init failed (plugin missing on this platform?)", e);
    }
  },

  // Every INTERSTITIAL_EVERY finished runs, show a full-screen ad — unless
  // the player bought "remove ads". Fire-and-forget from the results screen.
  async maybeShowInterstitial() {
    if (!ready || iap.owned) return;
    let n = 0;
    try { n = (parseInt(localStorage.getItem(COUNT_KEY), 10) || 0) + 1; } catch { n = 1; }
    try { localStorage.setItem(COUNT_KEY, String(n % INTERSTITIAL_EVERY)); } catch { /* private */ }
    if (n < INTERSTITIAL_EVERY) return;
    try {
      await AdMob.prepareInterstitial({ adId: TEST_INTERSTITIAL });
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
        await AdMob.prepareRewardVideoAd({ adId: TEST_REWARDED });
        await AdMob.showRewardVideoAd();
      } catch (e) {
        console.warn("[ads] rewarded failed", e);
        for (const s of subs) if (s && s.remove) s.remove();
        resolve(false);
      }
    });
  },
};
