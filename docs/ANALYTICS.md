# Analytics (Google Analytics 4)

How to turn on the game's telemetry and pull the numbers used to pitch
Puntarenas businesses (reach, geography, and per-business in-game exposure).

The code is already wired (`src/monetize/analytics.js` + hooks in the game
modules). It **no-ops until you paste a Measurement ID** — nothing is sent
today. In dev (`pnpm dev`) events are never sent; they log to the browser
console as `[analytics] <event> {params}` so you can watch them fire.

## 1. One-time setup

1. Go to [analytics.google.com](https://analytics.google.com) (use the same
   Google account as AdSense/AdMob so everything lives together).
2. **Admin → Create → Account** — name it e.g. `La Ruta del Churchill`.
3. Create a **GA4 property** — name `churchill.jcampos.dev`, timezone
   `(GMT-06:00) Costa Rica`, currency CRC.
4. Add a **Web data stream** for `https://churchill.jcampos.dev`. Copy the
   **Measurement ID** — it looks like `G-XXXXXXXXXX`.
5. Paste it into `GA_ID` in `src/monetize/analytics.js`:

   ```js
   const GA_ID = ENV.VITE_GA_ID || "G-XXXXXXXXXX";
   ```

   Commit it — the production build runs in GitHub Actions, and the ID is
   public in the page source anyway. (`VITE_GA_ID` in `.env.local` is only a
   local-experiment override.)
6. Push to `main`. Data starts accumulating on deploy — the Android APK
   (Capacitor WebView) reports too, tagged with the `platform` user property.

## 2. Register the custom dimensions (do this once, day one)

GA4 ignores custom event parameters in reports until they're registered.
**Admin → Data display → Custom definitions → Create custom dimension**, all
**Event**-scoped:

| Dimension name | Event parameter |
|---|---|
| Customer | `customer_name` |
| Customer id | `customer_id` |
| District | `district` |
| Kiosk | `kiosk_id` |
| Mode | `mode` |
| Stage | `stage_id` |
| Vehicle | `vehicle` |

Also register **`platform`** as a **User**-scoped dimension.

Registration is not retroactive — events sent before this step won't have the
dimension in reports, so do it the same day the ID goes live.

## 3. What gets tracked

| Event | When | Parameters |
|---|---|---|
| `run_start` | any mode starts | `mode`, `stage_id` (story), `vehicle` |
| `pickup` | churchill picked up | `kiosk_id`, `mode` |
| `delivery` | churchill delivered | `customer_id`, `customer_name`, `district`, `mode`, `perfect` |
| `run_end` | results screen shows | `mode`, `stage_id`, `won`, `score`, `deliveries`, `perfect` |
| `run_quit` | run abandoned via pause → quit | `mode`, `score`, `deliveries` |
| `stage_clear` | story stage completed | `stage_id`, `score` |
| `district_unlock` | explore district opens | `district` |

No PII: no accounts, no names/emails/precise location. Progress stays in
localStorage. The privacy policy already discloses GA
(`public/privacy/index.html`, §2 in both languages).

## 4. Verifying it works

- **Before deploy:** `pnpm dev`, open the browser console, play — every event
  prints as `[analytics] …`.
- **After deploy:** GA4 **Reports → Realtime** while you play on the live
  site; events appear within seconds. **Admin → DebugView** shows the full
  parameter payloads if you play with the
  [GA Debugger extension](https://chromewebstore.google.com/detail/google-analytics-debugger) on.

## 5. Pulling the pitch numbers

For a meeting with a hotel/commerce owner, build these once in GA4 and
screenshot or export them:

- **Reach:** Reports → Engagement → Overview — active users, sessions,
  average engagement time. Home → trend curve for growth.
- **Geography (locals vs. tourists):** Reports → User attributes →
  Demographic details → Country / Region / City.
- **Per-business exposure** (the number a sponsor is buying): Explore →
  Free form → dimension **Customer** (and/or **District**), metric **Event
  count**, filter `Event name = delivery`. That table reads "deliveries to
  *your* business last month".
- **Platform split:** any report + the **platform** dimension (web vs. android).
- Pair with **Play Console** stats (installs/DAU/retention, once the AAB is
  live) and **AdSense/AdMob** impression reports — same deck.

The claim that closes the deal isn't analytics, it's redemption: in-game promo
codes ("show this screen at the counter for a discount") let each business
count real customers walking in. Analytics proves reach; codes prove return.

## 6. Rules the code must keep

- `public/sw.js` must **never intercept** Google ad/analytics hosts — the
  hostname-regex bypass in its fetch handler protects beacons and ad requests
  from being answered by cache. Keep it if the SW is reworked.
- `analytics.track()` is safe to call from anywhere in the game loop (no-ops
  without an ID / outside the browser). Add new events through it only —
  never load gtag from `index.html`.
- Keep events to gameplay facts. No PII, ever — the privacy policy promises it.
