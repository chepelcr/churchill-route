// Run against the production preview: node tools/smoke-orientation.mjs [url]
import assert from "node:assert/strict";
import { chromium, devices } from "playwright";

const url = process.argv[2] || "http://localhost:8799/";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM;
const browser = await chromium.launch({ executablePath });
const portrait = { width: 390, height: 740 };
const landscape = { width: 740, height: 390 };

async function openMobileBrowser({ device, app = "", seenIntro = false, denyClipboard = false }) {
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
  await page.addInitScript(({ seenIntro, denyClipboard }) => {
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
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (url) => {
        if (denyClipboard) throw new Error("Clipboard denied");
        window.__copiedLink = url;
      } },
    });
    if (seenIntro) localStorage.setItem("churchill_intro_seen_v1", "1");
  }, { seenIntro, denyClipboard });
  await page.goto(url);
  await page.locator(".rotate-overlay").waitFor({ state: "visible" });
  assert.equal(await page.locator(".boot-logo").count(), 0);
  return { page, errors };
}

try {
  const facebook = await openMobileBrowser({
    device: "Pixel 7",
    app: "[FB_IAB/FB4A;FBAV/500.0.0.0.0;]",
    seenIntro: true,
  });
  assert.equal(await facebook.page.locator(".rotate-overlay > button").count(), 0);
  await facebook.page.locator(".rotate-browser-tip button").tap();
  await facebook.page.locator(".rotate-browser-tip [role='status']").waitFor({ state: "visible" });
  assert.equal(await facebook.page.evaluate(() => window.__copiedLink), facebook.page.url());
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

  const instagram = await openMobileBrowser({
    device: "iPhone 13",
    app: "Instagram 350.0.0.0.0",
    denyClipboard: true,
  });
  assert.equal(await instagram.page.locator(".rotate-overlay > button").count(), 0);
  await instagram.page.locator(".rotate-browser-tip button").tap();
  const copyInput = instagram.page.locator(".rotate-browser-tip input[readonly]");
  assert.equal(await copyInput.inputValue(), instagram.page.url());
  // A rotation notification alone cannot make a locked viewport landscape.
  await instagram.page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
  assert.equal(await instagram.page.locator(".rotate-overlay").isVisible(), true);
  assert.equal(await instagram.page.locator(".rotate-overlay button").count(), 0);
  await instagram.page.setViewportSize(landscape);
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
  await instagram.page.setViewportSize(portrait);
  await instagram.page.locator(".rotate-overlay").waitFor({ state: "visible" });
  await instagram.page.setViewportSize(landscape);
  await instagram.page.locator(".rotate-overlay").waitFor({ state: "hidden" });
  assert.deepEqual(instagram.errors, []);
  await instagram.page.close();

  const regular = await openMobileBrowser({ device: "Pixel 7", seenIntro: true });
  assert.equal(await regular.page.locator(".rotate-browser-tip").count(), 0);
  await regular.page.locator(".rotate-overlay > button").tap();
  await regular.page.locator(".rotate-overlay").waitFor({ state: "hidden" });
  await regular.page.locator(".title-page").waitFor({ state: "visible" });
  assert.deepEqual(regular.errors, []);

  const messenger = await openMobileBrowser({ device: "Pixel 7", app: "[FB_IAB/MESSENGER;FBAV/500.0.0.0.0;]" });
  assert.equal(await messenger.page.locator(".rotate-browser-tip").count(), 0);
  assert.equal(await messenger.page.locator(".rotate-overlay > button").isVisible(), true);
  assert.deepEqual(messenger.errors, []);
  console.log("[orientation] ok — external browser guidance and copy in Meta, portrait play in regular browsers");
} finally {
  await browser.close();
}
