// Ads, both platforms — the SAME gentle surface everywhere (the app is a
// tourism showcase first; ads must never get in the way of that):
//  - INTERSTITIAL only every 5th finished run, and NEVER during the player's
//    first 3 runs ever (let tourists fall in love first), never after the
//    tutorial, skipped entirely with the "remove ads" purchase (native).
//  - REWARDED video = "continue +60s" / "double coins" — 100% player-
//    initiated, so it doesn't count as intrusive.
//  - NO banners: they'd cover the road while driving.
//
// Backends:
//  - NATIVE (Android APK): AdMob via @capacitor-community/admob (dynamic
//    import, never in the web bundle). PRODUCTION ad-unit ids; the matching
//    APPLICATION_ID lives in AndroidManifest.xml. For ad-debugging, register
//    the device as a test device in the AdMob console.
//  - WEB: Google H5 Games Ads (AdSense Ad Placement API, `adBreak`) under
//    the same publisher (ca-pub-…). It serves once the site is approved in
//    AdSense with H5 Games Ads enabled; until then adBreak calls are silent
//    no-ops and the game just continues (see docs/MONETIZATION.md).
import { iap } from "./iap.js";

const NATIVE = typeof window !== "undefined" && !!window.Capacitor;
const BROWSER = typeof window !== "undefined" && !NATIVE;
const COUNT_KEY = "churchill_runs_since_ad_v1";
const TOTAL_KEY = "churchill_runs_total_v1";
const INTERSTITIAL_EVERY = 5;
const GRACE_RUNS = 3; // no interstitials at all for the first runs ever

const AD_INTERSTITIAL = "ca-app-pub-3090812928887940/4457249161";
const AD_REWARDED = "ca-app-pub-3090812928887940/3168218225";
const WEB_CLIENT = "ca-pub-3090812928887940"; // AdSense web property (same publisher)

let AdMob = null;          // native plugin module once loaded
let RewardAdPluginEvents = null;
let ready = false;         // native SDK initialized
let webReady = false;      // adsbygoogle tag injected

// Shared frequency gate: true when THIS finished run should show an
// interstitial (counts the run either way; respects grace + cadence).
function interstitialDue() {
  let total = 0, n = 0;
  try { total = (parseInt(localStorage.getItem(TOTAL_KEY), 10) || 0) + 1; } catch { total = 1; }
  try { localStorage.setItem(TOTAL_KEY, String(total)); } catch { /* private */ }
  if (total <= GRACE_RUNS) return false;
  try { n = (parseInt(localStorage.getItem(COUNT_KEY), 10) || 0) + 1; } catch { n = 1; }
  try { localStorage.setItem(COUNT_KEY, String(n % INTERSTITIAL_EVERY)); } catch { /* private */ }
  return n >= INTERSTITIAL_EVERY;
}

function initWebAds() {
  if (!BROWSER || webReady || typeof document === "undefined") return;
  webReady = true;
  window.adsbygoogle = window.adsbygoogle || [];
  // adBreak/adConfig forward into the adsbygoogle queue (official pattern)
  window.adBreak = window.adConfig = function (o) { window.adsbygoogle.push(o); };
  const s = document.createElement("script");
  s.async = true;
  s.crossOrigin = "anonymous";
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${WEB_CLIENT}`;
  s.setAttribute("data-ad-frequency-hint", "120s"); // extra pacing safety net
  document.head.appendChild(s);
  window.adConfig({ preloadAdBreaks: "on", sound: "on" });
}

export const ads = {
  async init() {
    if (BROWSER) { initWebAds(); return; }
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
    if (mode === "tutorial" || iap.owned) return;
    if (ready) {
      if (!interstitialDue()) return;
      try {
        await AdMob.prepareInterstitial({ adId: AD_INTERSTITIAL });
        await AdMob.showInterstitial();
      } catch (e) { console.warn("[ads] interstitial failed", e); }
    } else if (webReady && window.adBreak) {
      if (!interstitialDue()) return;
      window.adBreak({ type: "next", name: "run_finished" });
    }
  },

  // true iff a rewarded ad can be offered right now
  canOfferRewarded() { return ready || (webReady && !!window.adBreak); },

  // Shows the rewarded video; resolves true if the player earned the reward.
  showRewarded() {
    if (ready) {
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
    }
    if (webReady && window.adBreak) {
      return new Promise((resolve) => {
        let granted = false, done = false;
        const finish = () => { if (!done) { done = true; resolve(granted); } };
        window.adBreak({
          type: "reward",
          name: "reward_bonus",
          beforeReward(showAdFn) { showAdFn(); }, // a reward ad is available: show it
          adViewed() { granted = true; },
          adDismissed() { /* skipped: no reward */ },
          adBreakDone() { finish(); },            // always fires (even no-fill)
        });
        setTimeout(finish, 20000);                // belt-and-braces timeout
      });
    }
    return Promise.resolve(false);
  },
};
