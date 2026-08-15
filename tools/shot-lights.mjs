// LAS LUCES, dibujadas — y la prueba de que las tres farolas no se movieron.
//
//   node tools/shot-lights.mjs <out.png> [devUrl] [new|old|all]
//
// `new` and `old` draw THE SAME THREE STREET LAMPS in the same layout: `new`
// through `c2d/lights.js` + the registry, `old` through the four-branch if/else
// reconstructed verbatim below. Diffing the two is the whole regression gate —
// the registry may not move a pixel of a lamp that already existed.
//
//   node tools/shot-lights.mjs /tmp/old.png http://localhost:8734/ old
//   node tools/shot-lights.mjs /tmp/new.png http://localhost:8734/ new
//   node tools/png-diff.mjs /tmp/old.png /tmp/new.png
//
// `all` adds the stadium fixture, which changes ON PURPOSE — a street lamp
// widened to 10×4 became a real mast with a crossbar of four floodlights — so
// it is there to LOOK at, never to diff.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "lights.png";
const url = process.argv[3] || "http://localhost:8734/";
const mode = process.argv[4] || "new";
const W = mode === "all" ? 620 : 480, H = 300;
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: W, height: H } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
const drew = await page.evaluate(async ({ mode, W, H }) => {
  const [lights, gfx] = await Promise.all([
    import("/src/render/c2d/lights.js"), import("/src/render/c2d/gfx.js")]);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  document.body.replaceChildren(cv); document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  // A mid grey: the day row must read against it and the night halo must too.
  g.fillStyle = "#5b6470"; g.fillRect(0, 0, cv.width, cv.height);

  // THE OLD PAINTER, verbatim. Kept here rather than in git history because a
  // regression gate you have to check out an old commit to run is a gate
  // nobody runs. Every literal is the one that was deleted.
  const OLD_PALETTE = (type) => {
    if (type === "led") return { core: "#dff7ff", glow: "rgba(155,225,255,.34)" };
    if (type === "stadium") return { core: "#fff", glow: "rgba(240,248,255,.42)" };
    if (type === "amber") return { core: "#ffbd5b", glow: "rgba(255,157,57,.34)" };
    return { core: "#fff0ad", glow: "rgba(255,224,125,.32)" };
  };
  const roundRect = (c, x, y, w, h, r, fill) => {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r); c.closePath();
    if (fill) c.fill();
  };
  const oldLight = (type, x, y, night) => {
    const palette = OLD_PALETTE(type);
    const intensity = 1;
    const radius = type === "stadium" ? 100 : 46;
    g.strokeStyle = "#3f4648"; g.lineWidth = type === "stadium" ? 2.2 : 1.4;
    g.beginPath(); g.moveTo(x, y + 8); g.lineTo(x, y - (type === "stadium" ? 18 : 10)); g.stroke();
    g.fillStyle = palette.core;
    roundRect(g, x - (type === "stadium" ? 5 : 3), y - (type === "stadium" ? 21 : 13),
              type === "stadium" ? 10 : 6, 4, 1, true);
    if (night && intensity > 0) {
      const glow = g.createRadialGradient(x, y - 10, 0, x, y - 10, radius);
      glow.addColorStop(0, palette.glow.replace(/[\d.]+\)$/, `${Math.min(.75, intensity * .24)})`));
      glow.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = glow;
      g.beginPath(); g.arc(x, y - 10, radius, 0, Math.PI * 2); g.fill();
    }
  };

  const kinds = mode === "all" ? ["warm", "led", "amber", "stadium"] : ["warm", "led", "amber"];
  kinds.forEach((kind, i) => {
    const x = 80 + i * 140;
    for (const [row, night] of [[100, false], [230, true]]) {
      if (mode === "old") oldLight(kind, x, row, night);
      else lights.paintLight(kind, x, row, { night });
    }
  });
  if (mode === "all") {
    g.fillStyle = "#e9eef4"; g.font = "11px monospace"; g.textAlign = "center";
    kinds.forEach((k, i) => g.fillText(k, 80 + i * 140, 285));
    g.textAlign = "left";
    g.fillText("día", 6, 100); g.fillText("noche", 6, 230);
  }

  const px = g.getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  for (let i = 0; i < px.length; i += 4)
    if (px[i] !== 0x5b || px[i + 1] !== 0x64 || px[i + 2] !== 0x70) ink++;
  return { ink, png: cv.toDataURL("image/png").split(",")[1] };
}, { mode, W, H });
writeFileSync(out, Buffer.from(drew.png, "base64"));
await b.close();
// A blank sheet diffs IDENTICAL against another blank sheet, so every harness
// here counts its own ink and fails without it.
if (!(drew.ink > 3000)) { console.error(`[FAIL] blank (${drew.ink} px)`); process.exit(1); }
if (errors.length) { console.error(`[lights] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[lights] mode=${mode}, ${drew.ink} px of ink -> ${out}`);
