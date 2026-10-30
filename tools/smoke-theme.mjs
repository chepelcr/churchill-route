// Authored-theme smoke test: does a runtime `ui` block actually restyle and
// re-word the running game? Serves a themed content.json to the page the way
// the CDN would, then reads the applied CSS variables and the rendered copy.
//
//   node tools/smoke-theme.mjs http://localhost:8799/
//
// Guards two regressions that both fail SILENTLY in a screenshot review:
//  - a per-screen effect resetting --gold to a hardcoded literal, which
//    un-applies the authored theme on every screen change;
//  - useSyncExternalStore keyed on the language alone, so a copy override
//    changes the strings under React without re-rendering anything.
//
// IT WAITS FOR THE SCREEN, IT DOES NOT COUNT SECONDS. This spent a while red,
// reporting "authored copy did not reach the screen" while the copy was in fact
// reaching it perfectly: the assertions ran on a 5.3 s budget (2.5 s, then four
// blind Enters) and booting the finished world takes about 6 s, so every check
// was made against the LOADING screen, where `title.pill` does not exist. A
// fixed timeout in a smoke test is a bet on how fast the world loads, and the
// world only ever gets bigger — so poll for the title screen and let a slow
// machine be slow.
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:8799/';
const THEME = { gold: '#00ff88', coral: '#ff00aa' };
const COPY = { es: { 'title.pill': 'COPIA AUTORIZADA' }, en: { 'title.pill': 'AUTHORED COPY' } };
//: how long to let the port load before calling it a failure. Generous on
//: purpose: the only thing a tight bound buys is a flaky test.
const BOOT_TIMEOUT_MS = 60000;
const BOOTING = /LOADING THE PORT|CARGANDO EL PUERTO/i;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (event) => errors.push(String(event)));

await page.route('**/content.json', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ version: 1, meta: {}, supporters: [], npcs: [], lotes: [], ui: { theme: THEME, strings: COPY } }),
}));

const screenText = () => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
const tokens = () => page.evaluate(() => ({
  gold: getComputedStyle(document.documentElement).getPropertyValue('--gold').trim(),
  coral: getComputedStyle(document.documentElement).getPropertyValue('--coral').trim(),
}));

await page.goto(url, { waitUntil: 'domcontentloaded' });

// Off the boot screen — however long that takes.
let text = '';
const deadline = Date.now() + BOOT_TIMEOUT_MS;
while (Date.now() < deadline) {
  await page.waitForTimeout(400);
  text = await screenText();
  if (text && !BOOTING.test(text)) break;
}

const problems = [];
if (!text || BOOTING.test(text)) {
  problems.push(`still on the boot screen after ${BOOT_TIMEOUT_MS / 1000}s — nothing else could be checked`);
} else {
  // The copy override, on the first screen that renders `title.pill`.
  if (!/COPIA AUTORIZADA|AUTHORED COPY/.test(text)) {
    problems.push('authored copy did not reach the screen (the i18n store may not have re-rendered)');
  }
  // …and the tokens must SURVIVE a screen change: the regression was a
  // per-screen effect resetting --gold to a literal, so check after moving.
  const before = await tokens();
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press('Enter'); await page.waitForTimeout(400); }
  const after = await tokens();
  for (const [name, want] of [['gold', THEME.gold], ['coral', THEME.coral]]) {
    if (before[name] !== want) problems.push(`--${name} is ${before[name] || '(unset)'}, expected ${want}`);
    else if (after[name] !== want) problems.push(`--${name} became ${after[name] || '(unset)'} after a screen change (a screen effect overwrote the theme)`);
  }
}
if (errors.length) problems.push(`page errors: ${errors.join(' | ')}`);
await browser.close();

if (problems.length) {
  for (const problem of problems) console.error(`[theme] ${problem}`);
  process.exit(1);
}
console.log('[theme] ok — tokens applied and survived a screen change, authored copy rendered, no page errors');
