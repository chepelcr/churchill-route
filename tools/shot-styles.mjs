// THE RESOLVED STYLE OF EVERY ELEMENT, ON EVERY SCREEN.
//
//   node tools/shot-styles.mjs <out.json> [devUrl]
//
// The gate for the `styles.css` token sweep, and deliberately NOT a pixel diff.
// Three of these screens animate (the boot charge bar, the intro slides, the
// attract world behind the title), so a bitmap comparison measures a stopwatch —
// this repo already measured that noise floor at up to 86 %.
//
// What a token sweep can actually break is narrower and fully observable:
//
//   * a `var()` that does not resolve. The declaration is then INVALID AT
//     COMPUTED-VALUE TIME and the property falls back to its initial value —
//     `color` goes black, `background-color` transparent. No console error, no
//     build failure, and on a dark panel a black-on-black label looks like a
//     missing string rather than a broken variable.
//   * a value transcribed wrong: `rgba(255,255,255,0.12)` becoming 0.14.
//
// Both are exactly a change in the COMPUTED value, so that is what is recorded:
// every element on every screen, with the properties a theme can touch. The
// comparison is `tools/json-diff.mjs`.
//
// The screens are walked through the real UI, because a screen that is never
// mounted contributes nothing and would hide whatever broke on it — the count
// in the output is there so a screen silently dropping out is visible.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "styles.json";
const url = process.argv[3] || "http://localhost:8734/";

const PROPS = [
  "color", "background-color", "background-image", "border-top-color",
  "border-right-color", "border-bottom-color", "border-left-color",
  "border-top-width", "border-radius", "box-shadow", "text-shadow", "filter",
  "font-family", "font-size", "font-weight", "opacity", "outline-color",
  "fill", "stroke",
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 680 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.Game, null, { timeout: 25000 });
await page.evaluate(async () => { await document.fonts.ready; });

// FREEZE THE CLOCK. The boot logo, the charge bar and the intro slides are all
// mid-animation while this walks, so their computed `opacity` is whatever
// millisecond the snapshot landed on — a run-to-run difference of 0.05 that has
// nothing to do with the stylesheet. Pausing every animation and transition
// makes the comparison about the CSS and only the CSS.
await page.addStyleTag({
  // `animation-play-state: paused` is NOT enough: it freezes each element
  // wherever it happened to be, and how far the boot logo has faded depends on
  // how long the bundle took to load. `animation: none` drops the animated
  // value entirely, so every element reports its DECLARED style — deterministic
  // run to run. The cost is that this harness can no longer see a changed
  // keyframe or duration, so `tests/test_theme_tokens.py` reads those out of
  // the stylesheet text, which is a better place to check them from anyway.
  content: `*, *::before, *::after {
    animation: none !important;
    transition: none !important;
  }`,
});

async function snapshot(label) {
  return page.evaluate(([props, label]) => {
    const rows = [];
    for (const el of document.querySelectorAll("*")) {
      if (el.tagName === "CANVAS" || el.tagName === "SCRIPT") continue;
      // AdSense injects <ins> nodes asynchronously and styles them itself, so
      // whether they exist depends on network timing, not on this stylesheet.
      if (el.closest("ins.adsbygoogle")) continue;
      const cs = getComputedStyle(el);
      // A stable identity that does not depend on DOM order: the tag plus the
      // class list plus the first slice of its own text.
      const id = `${el.tagName}.${el.className || ""}|${(el.textContent || "").trim().slice(0, 24)}`;
      const rec = {};
      for (const p of props) rec[p] = cs.getPropertyValue(p);
      rows.push([`${label}::${id}`, rec]);
    }
    return rows;
  }, [PROPS, label]);
}

// Click whatever advances, by label, until a screen is reached.
async function clickText(re) {
  const btns = await page.locator("button").all();
  for (const b of btns) {
    const t = (await b.textContent()) || "";
    if (re.test(t)) { await b.click(); return true; }
  }
  return false;
}

const all = {};
const seen = [];
async function record(label) {
  await page.waitForTimeout(700);
  for (const [k, v] of await snapshot(label)) all[k] = v;
  seen.push(label);
}

await record("boot");
await clickText(/next|siguiente/i); await record("intro");
// Straight to the title: the intro's own buttons walk it there.
for (let i = 0; i < 4; i++) {
  if (await page.locator(".hud-card").count()) break;
  if (!(await clickText(/.+/))) break;
  await page.waitForTimeout(500);
}
await record("playing");

// The overlay screens, driven from the game facade the way the buttons do.
for (const [label, fn] of [
  ["paused", () => window.Game.state.paused = true],
  ["over", () => { window.Game.state.over = true; window.Game.state.won = true; }],
]) {
  await page.evaluate(fn);
  await record(label);
}

// EVERY RULE IN THE STYLESHEET, not only the ones that happened to mount.
//
// The walk above reaches five screens and ~120 elements; `styles.css` has
// several hundred rules, and the ones on Settings, Shop, Supporters and the
// tutorial coach-marks would simply not be measured. So the stylesheet is read
// back and every class it mentions is instantiated on a bare element. That is
// not a rendering test — it is exactly the question a token sweep raises: does
// this declaration still compute to the same value.
const sheetRows = await page.evaluate((props) => {
  const classes = new Set();
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }   // cross-origin
    // HARVEST FIRST, THEN RECURSE — and not the other way round. Since Chrome
    // shipped CSS nesting every CSSStyleRule carries a (usually empty)
    // `cssRules`, so an `if (r.cssRules) recurse; else harvest;` walk skips
    // every plain rule in the sheet and quietly returns nothing.
    const walk = (list) => {
      for (const r of list) {
        for (const m of (r.selectorText || "").matchAll(/\.([A-Za-z][\w-]*)/g)) classes.add(m[1]);
        if (r.cssRules && r.cssRules.length) walk(r.cssRules);
      }
    };
    walk(rules);
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const rows = [];
  for (const cls of [...classes].sort()) {
    const el = document.createElement("div");
    el.className = cls;
    el.textContent = "x";
    host.appendChild(el);
    const cs = getComputedStyle(el);
    const rec = {};
    for (const p of props) rec[p] = cs.getPropertyValue(p);
    rows.push([`rule::.${cls}`, rec]);
    host.removeChild(el);
  }
  host.remove();
  return rows;
}, PROPS);
for (const [k, v] of sheetRows) all[k] = v;
seen.push(`stylesheet(${sheetRows.length} classes)`);

writeFileSync(out, JSON.stringify({ screens: seen, elements: Object.keys(all).length, all }, null, 1));
await browser.close();
if (errors.length) { console.error(`[styles] page errors: ${errors.join(" | ")}`); process.exit(1); }
if (Object.keys(all).length < 40) {
  console.error(`[FAIL] only ${Object.keys(all).length} elements captured — the walk did not reach the screens`);
  process.exit(1);
}
console.log(`[styles] ${seen.length} screens, ${Object.keys(all).length} elements -> ${out}`);
