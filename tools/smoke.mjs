// Boot the built game in a real browser, start a run, drive, and FAIL on any
// error the page throws.
//
// WHY THIS EXISTS. The render loop is one `try`-less call chain: a single
// ReferenceError anywhere in it kills the frame, and everything drawn after the
// throw point silently disappears — the car, the HUD, the debug overlay — while
// the world keeps its last painted frame. It looks exactly like a freeze, and
// it looks nothing like a stack trace unless somebody has a console open.
//
// That has now shipped three times: players invisible (`matches` never cleared
// on a mode start), `drawPassenger is not defined` (a regex tidy-up ate the
// function but not its call), and an import of a deleted export that Rollup
// only warns about. None of the three is catchable by `pnpm build`, by the
// world snapshot, or by reading — but all three are caught by loading the page
// once. That is the whole job of this file.
//
//   pnpm build && npx vite preview --port 8799 &
//   node tools/smoke.mjs http://localhost:8799/
//
// Playwright is NOT a dependency of the game: if it is not installed this exits
// 0 with a note, so it can never block a build that has nothing to do with it.
const url = process.argv[2] || "http://localhost:8799/";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("[smoke] playwright not installed — skipped (npm i -D playwright)");
  process.exit(0);
}

const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch(
  { executablePath: CHROME }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0, 4).join("\n   ")));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/favicon|ERR_CONNECTION|Failed to load resource/.test(t)) return;   // not ours
  errors.push("console: " + t.slice(0, 300));
});

const fail = (msg) => { console.log("[smoke] FAIL — " + msg); };
let bad = 0;

await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(3000);

if (!(await page.evaluate(() => !!window.Game))) { fail("window.Game never appeared"); bad++; }

// A run, not the attract loop: the attract camera does not read input, so a
// broken player path would go unnoticed.
await page.evaluate(() => { window.Game.setAttract(false); window.Game.startArcade(); });
await page.waitForTimeout(1500);

// Drive. The exact route does not matter — what matters is that the loop keeps
// ticking and the car answers the throttle, which a dead frame cannot fake.
const drive = await page.evaluate(async () => {
  const p = window.Game.state.p;
  p.x = 17944; p.y = 12240; p.a = 0; p.vx = 0; p.vy = 0; p.speed = 0;  // Avenida Centenario
  const from = { x: p.x, y: p.y };
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
  let top = 0;
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 300));
    top = Math.max(top, p.speed || 0);
  }
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
  return { travelled: Math.round(Math.hypot(p.x - from.x, p.y - from.y)), top: Math.round(top) };
});

if (drive.travelled < 300) { fail(`the car only moved ${drive.travelled} px in 5 s — the loop is dead or it is walled in`); bad++; }
if (errors.length) { fail(`${errors.length} page error(s)`); bad++; }
for (const e of errors.slice(0, 8)) console.log("   " + e);

await browser.close();
if (!bad) console.log(`[smoke] ok — drove ${drive.travelled} px, top speed ${drive.top}, no page errors`);
process.exit(bad ? 1 : 0);
