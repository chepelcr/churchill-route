// LA GENTE Y EL TRÁFICO, dibujados uno al lado del otro.
//
//   node tools/shot-actors.mjs <out.png> [devUrl]
//
// The biggest art family in the game: 26 drawers and 116 colour literals. This
// sheet is the gate for moving them into `src/assets/actors.json` — draw every
// actor from a FIXED mock entity, migrate, draw again, and the two must be
// pixel for pixel the same.
//
// Two things the sheet has to control or it proves nothing:
//
//   * **THE PHASE IS PER-INSTANCE, not the clock.** A ped bobs on `pe.ph`,
//     which the simulation advances. Every mock below pins `ph` to a constant,
//     so the drawing is deterministic in a way the running game never is.
//   * **`state.carrying` decides whether the target customer draws at all** —
//     it returns immediately without it, which is a silent blank on a sheet
//     that otherwise looks fine.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const out = process.argv[2] || "actors.png";
const url = process.argv[3] || "http://localhost:8734/";
const W = 980, H = 620;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => document.fonts.size > 0, null, { timeout: 20000 });
await page.evaluate(async () => { await document.fonts.ready; });
const drew = await page.evaluate(async ({ W, H }) => {
  const [ent, gfx, st] = await Promise.all([
    import("/src/render/c2d/entities.js"),
    import("/src/render/c2d/gfx.js"),
    import("/src/game/state.js"),
  ]);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  document.body.replaceChildren(cv); document.body.style.margin = "0";
  gfx.setupCanvas(cv);
  const g = cv.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0);
  const BG = [0x6b, 0x72, 0x7d];
  g.fillStyle = "#6b727d"; g.fillRect(0, 0, cv.width, cv.height);
  gfx.setLastT(0);

  const T = 1234;                       // a fixed clock for the few that read one
  const ped = (o) => ({ x: 0, y: 0, ph: 1.1, hue: 200, ...o });
  // Every case is [label, draw(x, y)]. Kept as one list so the sheet's layout
  // is a consequence of the list rather than a set of coordinates to maintain.
  const CASES = [
    ["walker", (x, y) => ent.drawPed(ped({ x, y, kind: "walker" }))],
    ["fan", (x, y) => ent.drawPed(ped({ x, y, kind: "fan" }))],
    ["paseante", (x, y) => ent.drawPed(ped({ x, y, kind: "paseante", stationary: true }))],
    ["playero", (x, y) => ent.drawPed(ped({ x, y, kind: "playero" }))],
    ["playero sol", (x, y) => ent.drawPed(ped({ x, y, kind: "playero", stationary: true, ang: 0.4 }))],
    ["jugador", (x, y) => ent.drawPed(ped({ x, y, kind: "jugador" }))],
    ["passenger", (x, y) => ent.drawPed(ped({ x, y, kind: "passenger" }))],
    ["fisher", (x, y) => ent.drawPed(ped({ x, y, kind: "fisher", ang: 0.3 }))],
    ["muellero", (x, y) => ent.drawPed(ped({ x, y, kind: "muellero", ang: -0.4 }))],
    ["swimmer", (x, y) => ent.drawPed(ped({ x, y, kind: "swimmer" }))],
    ["npc person", (x, y) => ent.drawPed(ped({ x, y, editorNpc: true, drawStyle: "person", color: "#c85a4a", scale: 1 }))],
    ["npc vendor", (x, y) => ent.drawPed(ped({ x, y, editorNpc: true, drawStyle: "vendor", color: "#4a8ac8", scale: 1 }))],
    ["npc worker", (x, y) => ent.drawPed(ped({ x, y, editorNpc: true, drawStyle: "worker", color: "#d8a13a", scale: 1 }))],
    ["npc mascot", (x, y) => ent.drawPed(ped({ x, y, editorNpc: true, drawStyle: "mascot", color: "#7ac84a", scale: 1.2 }))],
    ["ball", (x, y) => ent.drawBeachBall({ ball: { x, y, ph: 0.8 } })],
    ["car", (x, y) => ent.drawCar({ x, y, ang: 0.35, color: "#d4483c", w: 19, h: 10 })],
    // A TRAIN IS ITS CARS, not a count: `drawTrain` walks `tr.cars` and reads
    // the loco's own (x, y, ang) for the smoke. Passing a number drew nothing
    // and threw on the puff.
    ["train", (x, y) => ent.drawTrain({ cars: [
      { x: x + 18, y, ang: 0.1 }, { x: x - 16, y: y - 3, ang: 0.1 },
    ] }, T)],
    ["gull", (x, y) => ent.drawGull({ x, y, ph: 1.4, ang: 0.2 })],
    ["boat", (x, y) => ent.drawBoat({ x, y, ang: 0.5, vx: 1, vy: 0, kind: "panga", w: 26, h: 10, ph: 0.7 })],
    // A school is a boil AND its fleet — `sc.fleet` is iterated, so it is
    // required even when empty. One boat here, because the fleet is half of
    // what this actor looks like (it draws a hull, a console and a fisher).
    ["school", (x, y) => ent.drawSchool({
      x, y, r: 20, ph: 0.5,
      fleet: [{ x: x + 16, y: y + 6, a: 0.4, ph: 0.9, hue: 210 }],
    }, T)],
    ["vendor", (x, y) => ent.drawVendor({ x, y, hue: 30, ph: 0.9 }, T)],
    ["perro", (x, y) => ent.drawAnimal({ x, y, ph: 1.0, cat: false })],
    ["gato", (x, y) => ent.drawAnimal({ x, y, ph: 1.0, cat: true })],
    // The coin's phase is `c.t`, and the TYPE key is `coinType` — `type` is
    // silently ignored and every coin comes out gold.
    ["coin gold", (x, y) => ent.drawArcadeCoin({ x, y, t: 0.6, coinType: "gold" }, T)],
    ["coin silver", (x, y) => ent.drawArcadeCoin({ x, y, t: 0.6, coinType: "silver", silver: true }, T)],
    ["coin bonus", (x, y) => ent.drawArcadeCoin({ x, y, t: 0.6, coinType: "bonus" }, T)],
    ["coin frozen", (x, y) => ent.drawArcadeCoin({ x, y, t: 0.6, coinType: "frozen" }, T)],
    // THE TARGET CUSTOMER RETURNS EARLY WITHOUT `state.carrying`. Setting it is
    // the difference between drawing the actor and drawing nothing at all.
    ["target", (x, y) => {
      st.state.carrying = { customer: { x, y } };
      ent.drawTargetCustomer(T);
      st.state.carrying = null;
    }],
  ];

  const COLS = 7, CW = W / COLS, CH = 110;
  const labels = [];
  CASES.forEach(([name, draw], i) => {
    const cx = Math.round((i % COLS) * CW + CW / 2);
    const cy = Math.round(Math.floor(i / COLS) * CH + 56);
    draw(cx, cy);
    labels.push([name, cx, cy]);
  });
  g.fillStyle = "#eef2f6"; g.font = "10px monospace"; g.textAlign = "center";
  labels.forEach(([n, cx, cy]) => g.fillText(n, cx, cy + 40));

  const px = g.getImageData(0, 0, cv.width, cv.height).data;
  let ink = 0;
  for (let i = 0; i < px.length; i += 4)
    if (px[i] !== BG[0] || px[i + 1] !== BG[1] || px[i + 2] !== BG[2]) ink++;
  return { ink, n: CASES.length, png: cv.toDataURL("image/png").split(",")[1] };
}, { W, H });
writeFileSync(out, Buffer.from(drew.png, "base64"));
await browser.close();
if (!(drew.ink > 5000)) { console.error(`[FAIL] blank sheet (${drew.ink} px of ink)`); process.exit(1); }
if (errors.length) { console.error(`[actors] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[actors] ${drew.n} drawn, ${drew.ink} px of ink -> ${out}`);
