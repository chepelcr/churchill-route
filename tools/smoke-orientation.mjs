// Run against the production preview: node tools/smoke-orientation.mjs [url]
import assert from "node:assert/strict";
import { chromium, devices } from "playwright";

const url = process.argv[2] || "http://localhost:8799/";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM;
const browser = await chromium.launch({ executablePath });
const portrait = { width: 390, height: 740 };
const landscape = { width: 740, height: 390 };

async function openInAppBrowser({ device, app, seenIntro = false }) {
  const profile = devices[device];
  const page = await browser.newPage({
    ...profile,
    userAgent: profile.userAgent + " " + app,
    viewport: portrait,
    serviceWorkers: "block",
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript((seenIntro) => {
    const matchMedia = window.matchMedia.bind(window);
    // Emulate an embedded browser whose media query never sees the rotation.
    window.matchMedia = (query) => {
      const result = matchMedia(query);
      if (query.includes("orientation:")) {
        Object.defineProperty(result, "matches", { value: query.includes("portrait") });
      }
      return result;
    };
    Element.prototype.requestFullscreen = () => Promise.reject(new Error("Fullscreen denied"));
    if (seenIntro) localStorage.setItem("churchill_intro_seen_v1", "1");
  }, seenIntro);
  await page.goto(url);
  await page.locator(".rotate-overlay").waitFor({ state: "visible" });
  assert.equal(await page.locator(".boot-logo").count(), 0);
  return { page, errors };
}

try {
  const facebook = await openInAppBrowser({
    device: "Pixel 7",
    app: "[FB_IAB/FB4A;FBAV/500.0.0.0.0;]",
    seenIntro: true,
  });
  await facebook.page.setViewportSize(landscape);
  await facebook.page.locator(".rotate-overlay").waitFor({ state: "hidden" });
  assert.equal(await facebook.page.evaluate(() => matchMedia("(orientation: portrait)").matches), true);
  await facebook.page.locator(".title-page").waitFor({ state: "visible" });
  await facebook.page.setViewportSize(portrait);
  await facebook.page.locator(".rotate-overlay").waitFor({ state: "visible" });
  // Some WebViews update only the visual viewport.
  await facebook.page.evaluate(({ width, height }) => {
    Object.defineProperties(visualViewport, { width: { value: width }, height: { value: height } });
    visualViewport.dispatchEvent(new Event("resize"));
  }, landscape);
  await facebook.page.locator(".rotate-overlay").waitFor({ state: "hidden" });
  assert.deepEqual(facebook.errors, []);
  await facebook.page.close();

  const instagram = await openInAppBrowser({
    device: "iPhone 13",
    app: "Instagram 350.0.0.0.0",
  });
  // A rotation notification alone cannot make a locked viewport landscape.
  await instagram.page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
  await instagram.page.locator(".rotate-overlay button").tap();
  await instagram.page.locator(".rotate-overlay").waitFor({ state: "hidden" });
  const next = instagram.page.locator(".intro-page .btn.gold");
  for (let slide = 1; slide <= 3; slide++) {
    await next.tap();
    if (slide < 3) {
      await instagram.page.locator(".intro-slide.leave").waitFor({ state: "hidden" });
    }
  }
  await instagram.page.locator("body[data-game-screen='tutbrief'] .btn-row > .btn.gold").tap();
  await instagram.page.locator("body[data-game-screen='playing'] .touch-controls .pedal").waitFor({ state: "visible" });
  await instagram.page.setViewportSize(landscape);
  await instagram.page.setViewportSize(portrait);
  assert.equal(await instagram.page.locator(".rotate-overlay").count(), 0);
  assert.deepEqual(instagram.errors, []);
  console.log("[orientation] ok — stale orientation, visual viewport, and portrait tutorial");
} finally {
  await browser.close();
}
