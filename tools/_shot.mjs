const url = process.argv[2] || "http://localhost:8799/";
const { chromium } = await import("playwright");
const CHROME = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: CHROME }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
page.on("pageerror", e => console.log("PAGEERR", e.message));
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3000);
// dismiss the intro carousel, then any residual overlay
for (let i = 0; i < 6; i++) {
  const btn = await page.$('button:has-text("NEXT"), button:has-text("SIGUIENTE"), button:has-text("JUGAR"), button:has-text("PLAY")');
  if (!btn) break;
  await btn.click().catch(() => {});
  await page.waitForTimeout(400);
}
await page.evaluate(() => { window.Game.setAttract(false); window.Game.startExplore(); });
await page.waitForTimeout(800);
// hide the React UI layer so only the canvas shows
await page.addStyleTag({ content: '#root > *:not(canvas) { display:none !important }' }).catch(()=>{});
const shots = JSON.parse(process.argv[3] || "[]");
for (const [name, x, y] of shots) {
  await page.evaluate(async ([x, y]) => {
    const G = window.Game, W = window.WORLD2D;
    G.state.p.x = x; G.state.p.y = y; G.state.p.vx = 0; G.state.p.vy = 0; G.state.p.speed = 0;
    G.state.cam.x = x; G.state.cam.y = y;
    W.update(x, y); W.ready(x, y, 2600, 1600);
    await new Promise(r => setTimeout(r, 2600));
    G.state.cam.x = x; G.state.cam.y = y;
  }, [x, y]);
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `/private/tmp/claude-501/-Users-jcampos-Desktop-dev-churchill-route/ed92ea06-0a1b-4cad-83c9-89f937e5aa7f/scratchpad/shot_${name}.png` });
  console.log("shot", name);
}
await browser.close();
