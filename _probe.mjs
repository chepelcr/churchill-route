// Throwaway visual probe: boot the built game, reach gameplay, teleport, shoot.
import { chromium } from "playwright";
const url = process.argv[2] || "http://localhost:8804/";
const outdir = process.argv[3] || "/tmp";
const shots = JSON.parse(process.argv[4] || "[]");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0, 4).join("\n   ")));
await page.addInitScript(() => { localStorage.setItem("churchill_intro_seen_v1", "1"); });
await page.goto(url, { waitUntil: "load" });
await page.waitForFunction(() => !document.querySelector(".boot-screen"), null, { timeout: 30000 });
await page.waitForTimeout(1500);
await page.getByText(/FREE ROAM/i).first().click();
await page.waitForTimeout(1200);
await page.getByRole("button", { name: /LET'S GO/i }).first().click();
await page.waitForTimeout(1800);
await page.waitForFunction(() => window.Game && !window.Game.state.attract, null, { timeout: 20000 });
for (const s of shots) {
  await page.evaluate(([x, y, w]) => {
    const g = window.Game, p = g.state.p;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.speed = 0; p.a = 0;
    g.state.cam.x = x; g.state.cam.y = y;
    g.state.weather = w || "sunny";
    if (g.state.tide !== undefined) g.state.tide = 0.35;
  }, [s.x, s.y, s.weather]);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${outdir}/${s.name}.png` });
}
console.log(errors.length ? "PAGE ERRORS:\n" + errors.join("\n") : "no page errors");
await browser.close();
