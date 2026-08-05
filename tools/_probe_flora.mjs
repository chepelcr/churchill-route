// THROWAWAY visual probe — delete after use.
const url = process.argv[2] || "http://localhost:8804/";
const out = process.argv[3] || "/tmp/shot";
const { chromium } = await import("playwright");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE " + m.text().slice(0, 200)); });
await page.addInitScript(() => {
  try { localStorage.setItem("churchill_intro_seen_v1", "1"); } catch {}
});
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => !document.querySelector(".boot-screen"), null, { timeout: 30000 });
await page.waitForTimeout(2500);
await page.locator(".mode", { hasText: "FREE ROAM" }).first().click();
await page.waitForTimeout(1500);
await page.locator(".btn.gold").first().click();
await page.waitForTimeout(1500);
await page.locator(".btn.gold").first().click();
await page.waitForTimeout(2500);
await page.evaluate(() => {
  window.Game.state.progress.coins = 9999;
  window.Game.state.weather = "day";
});

const spots = [
  ["street", 19000, 12300],
  ["leoncortes", 20200, 12300],
  ["turistas", 18000, 12690],
  ["manglar", 17980, 8380],
];
for (const [name, x, y] of spots) {
  await page.evaluate(([x, y]) => {
    const p = window.Game.state.p;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.speed = 0;
  }, [x, y]);
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("shot " + name);
}
await browser.close();
