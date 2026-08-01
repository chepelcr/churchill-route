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
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://localhost:8799/';
const THEME = { gold: '#00ff88', coral: '#ff00aa' };
const COPY = { es: { 'title.pill': 'COPIA AUTORIZADA' }, en: { 'title.pill': 'AUTHORED COPY' } };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (event) => errors.push(String(event)));

await page.route('**/content.json', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ version: 1, meta: {}, supporters: [], npcs: [], lotes: [], ui: { theme: THEME, strings: COPY } }),
}));

await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
// Leave the boot screen so the per-screen theme effect runs at least once.
for (let i = 0; i < 4; i += 1) { await page.keyboard.press('Enter'); await page.waitForTimeout(400); }
await page.waitForTimeout(1200);

const seen = await page.evaluate(() => ({
  gold: getComputedStyle(document.documentElement).getPropertyValue('--gold').trim(),
  coral: getComputedStyle(document.documentElement).getPropertyValue('--coral').trim(),
  text: document.body.innerText.replace(/\s+/g, ' '),
}));
await browser.close();

const problems = [];
if (seen.gold !== THEME.gold) problems.push(`--gold is ${seen.gold || '(unset)'}, expected ${THEME.gold} (a screen effect probably overwrote the theme)`);
if (seen.coral !== THEME.coral) problems.push(`--coral is ${seen.coral || '(unset)'}, expected ${THEME.coral}`);
if (!/COPIA AUTORIZADA|AUTHORED COPY/.test(seen.text)) problems.push('authored copy did not reach the screen (the i18n store may not have re-rendered)');
if (errors.length) problems.push(`page errors: ${errors.join(' | ')}`);

if (problems.length) {
  for (const problem of problems) console.error(`[theme] ${problem}`);
  process.exit(1);
}
console.log('[theme] ok — tokens applied, authored copy rendered, no page errors');
