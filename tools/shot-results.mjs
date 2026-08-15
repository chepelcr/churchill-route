// LA PANTALLA DE RESULTADOS, RENDERIZADA DE VERDAD.
//
//   node tools/shot-results.mjs <out.json> [devUrl]
//
// Mounts `ResultsScreen` DIRECTLY with ReactDOM against a controlled game
// state, once per run outcome, and records the rendered tree — tag, classes and
// own text, in document order. Compared with `tools/json-diff.mjs`.
//
// TWO THINGS THIS EXISTS TO AVOID, both met while writing it:
//
//   * `shot-styles.mjs` never mounts this screen. Reaching `over` needs a run
//     in progress that then ends (App.jsx switches only when `state.over` flips
//     while the screen is already `playing`), so a diff of that harness across
//     a ResultsScreen change compares its STYLESHEET RULES and nothing else —
//     and reports IDENTICAL for a screen it never drew. That is the third time
//     this repo has nearly believed a green run for the wrong reason.
//   * Driving the app's screen machine through button clicks to get there is
//     slow, order-dependent, and hung twice. The component takes props and
//     reads a singleton; mounting it directly needs neither.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const out = process.argv[2] || "results.json";
const url = process.argv[3] || "http://localhost:8734/";

// Chosen so that between them every conditional block appears at least once:
// the coin band, the rewarded-continue button, "next stage", the crossing
// stats, and the tutorial case where most of the screen is suppressed.
const CASES = [
  ["arcade-lost", { mode: "arcade", won: false, score: 4200, deliveries: 6, runCoins: 300 }],
  ["arcade-won", { mode: "arcade", won: true, score: 9100, deliveries: 12, runCoins: 900 }],
  ["story-won", { mode: "story", won: true, stageIdx: 0, score: 5000, runCoins: 400 }],
  ["story-lost", { mode: "story", won: false, stageIdx: 2, score: 1200, runCoins: 0 }],
  ["tutorial", { mode: "tutorial", won: true, score: 0, runCoins: 0 }],
  ["crossing", { mode: "story", won: true, stageIdx: 7, score: 7000, runCoins: 200 }],
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.Game, null, { timeout: 25000 });
await page.evaluate(async () => { await document.fonts.ready; });

const all = await page.evaluate(async (cases) => {
  // `import("react")` from here is NOT rewritten by Vite — see the note in
  // tools/harness-react.js, which is a served module and therefore is.
  const [R, mod, game] = await Promise.all([
    import("/tools/harness-react.js"),
    import("/src/ui/screens/ResultsScreen.jsx"),
    import("/src/game/index.js"),
  ]);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = R.createRoot(host);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = {};

  for (const [label, s] of cases) {
    // The screen reads the live singleton, so the CASE is the state.
    const st = game.Game.state;
    if (s.mode === "story") game.Game.startStage(s.stageIdx, "scooter");
    else if (s.mode === "tutorial") game.Game.startTutorial({ vehicleKey: "scooter" });
    else game.Game.startArcade({ vehicleKey: "scooter" });
    Object.assign(st, {
      score: s.score, deliveries: s.deliveries || 0, runCoins: s.runCoins || 0,
      perfect: 2, combo: 3, stageDeliveries: 3, stageTarget: 4,
      won: s.won, over: true, usedAdContinue: false,
    });

    root.render(R.createElement(mod.default, {
      onAgain() {}, onNext() {}, onMenu() {}, onContinue() {},
    }));
    await sleep(150);

    const card = host.querySelector(".page-card");
    if (!card) { result[`results::${label}`] = { tree: "SCREEN DID NOT MOUNT" }; continue; }
    const rows = [];
    const walk = (el, depth) => {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim()).filter(Boolean).join(" ");
      rows.push(`${"  ".repeat(depth)}${el.tagName}.${el.className || ""}${own ? ` |${own}` : ""}`);
      for (const c of el.children) walk(c, depth + 1);
    };
    walk(card, 0);
    result[`results::${label}`] = { tree: rows.join("\n") };
  }
  root.unmount();
  host.remove();
  return result;
}, CASES);

writeFileSync(out, JSON.stringify({
  screens: Object.keys(all), elements: Object.keys(all).length, all,
}, null, 1));
await browser.close();
if (errors.length) { console.error(`[results] page errors: ${errors.join(" | ")}`); process.exit(1); }

// A SCREEN THAT DID NOT MOUNT IS NOT A PASS — two of them diff as IDENTICAL.
const dead = Object.entries(all).filter(([, v]) => v.tree === "SCREEN DID NOT MOUNT").map(([k]) => k);
if (dead.length) {
  console.error(`[FAIL] never mounted for: ${dead.join(", ")} — do NOT trust a diff of this.`);
  process.exit(1);
}
for (const [k, v] of Object.entries(all)) {
  console.log(`  ${k.padEnd(22)} ${v.tree.split("\n").length} nodes`);
}
console.log(`[results] ${Object.keys(all).length} outcomes -> ${out}`);
