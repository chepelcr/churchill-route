// Google Analytics 4 — audience + in-game exposure telemetry.
//
// Why: sponsorship pitches to Puntarenas businesses need real numbers —
// players/month, where they play from (CR vs. tourists abroad), and
// per-business exposure (deliveries to each named customer, pickups per
// kiosk). The events tracked here are the source for all of those.
//
// Setup: create a GA4 property at analytics.google.com and paste the
// measurement id (G-XXXXXXXXXX) into GA_ID below — it must be committed
// because production builds run in GitHub Actions, and it's public in the
// page source anyway (VITE_GA_ID in .env.local overrides it for local
// experiments). With no id everything no-ops; in dev events go to the
// console instead of the network. No PII: progress stays in localStorage,
// events carry only gameplay facts (mode, stage, customer/kiosk ids, scores).
const ENV = import.meta.env ?? {}; // undefined under plain Node (headless check)
const GA_ID = ENV.VITE_GA_ID || "";  // <- paste "G-XXXXXXXXXX" here
const BROWSER = typeof window !== "undefined";
const DEV = !!ENV.DEV;

let inited = false;

export const analytics = {
  init() {
    if (!BROWSER || inited || !GA_ID || DEV) return;
    inited = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", GA_ID);
    // split every report web vs. the Android (Capacitor) app
    window.gtag("set", "user_properties", { platform: window.Capacitor ? "android" : "web" });
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
    document.head.appendChild(s);
  },

  // Safe anywhere (game loop included): no-ops without an id / outside the
  // browser, logs instead of sending in dev.
  track(name, params) {
    if (!BROWSER) return;
    if (DEV) { console.debug("[analytics]", name, params || {}); return; }
    if (!GA_ID || typeof window.gtag !== "function") return;
    window.gtag("event", name, params || {});
  },
};
