// CÓMO SE VE EL PUEBLO PARADO. Una captura por ángulo, del mismo sitio.
//
//   node tools/shot-lean.mjs [devUrl] [outPrefix] [deg,deg,…]
//
// Congela lo mismo que `shot-3d` —la semilla, el reloj, la sacudida y el rAF—
// para que dos ángulos se diferencien SÓLO en el ángulo. Sin eso, el piso de
// ruido de una escena del mundo es de 2 % a 86 % y comparar no dice nada.
import { chromium } from "playwright";
import { dirname } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const baseUrl = process.argv[2] || "http://localhost:8734/";
const prefix = process.argv[3] || "/tmp/churchill-lean";
const angles = (process.argv[4] || "0,30").split(",").map(Number);
const place = process.argv[5] || "kios_paseo1";
const phase = Number(process.argv[6] ?? 0.25);   // 0..1 del día
mkdirSync(dirname(prefix), { recursive: true });

const browser = await chromium.launch();

async function capture(deg, dayPhase) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__resetShotRandom = (seed = 0x5eed1234) => {
      let n = seed >>> 0;
      Math.random = () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 0x100000000; };
    };
    window.__resetShotRandom();
  });

  const u = new URL(baseUrl);
  u.searchParams.set("lean", String(deg));
  await page.goto(u.href, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.Game?.state && window.WORLD2D, null, { timeout: 30000 });

  const info = await page.evaluate(async ([anchorId, dayPhase]) => {
    await document.fonts.ready;
    const G = window.Game, W = window.WORLD2D;
    window.__resetShotRandom(0x5eed1234);
    G.setAttract(false);
    const anchor = W.landmarkById(anchorId) || W.landmarkById("faro");
    G.startExplore({ x: anchor.x, y: anchor.y, weather: "sunny" });
    G.state.running = false; G.state.attract = false;

    // El reloj se fija sobre el módulo VIVO: importar la ruta lisa acuña un
    // segundo `cycle` bajo HMR y el que se mueve no es el que el pintor lee.
    const canvasUrl = new URL("/src/render/canvas2d.js", location.href);
    const canvasSource = await fetch(canvasUrl).then((r) => r.text());
    const daySpec = canvasSource.match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)?.[1];
    const day = await import(new URL(daySpec, canvasUrl).href);
    day.setDayCycle(true, dayPhase);

    const halfW = innerWidth / (G.state.cam.zoom || 1) / 2 + 160;
    const halfH = innerHeight / (G.state.cam.zoom || 1) / 2 + 160;
    await W.ensureView(anchor.x - halfW, anchor.y - halfH,
                       anchor.x + halfW, anchor.y + halfH, 1);
    G.state.cam.x = G.state.p.x = anchor.x;
    G.state.cam.y = G.state.p.y = anchor.y;
    G.state.cam.shake = 0;
    G.state.p.vx = G.state.p.vy = G.state.p.speed = 0;
    window.requestAnimationFrame = () => 0;
    await new Promise((r) => setTimeout(r, 120));

    const gameUrl = new URL("/src/game/index.js", location.href);
    const gameSource = await fetch(gameUrl).then((r) => r.text());
    const rendererSpec = gameSource.match(/from\s+["']([^"']*\/render\/Renderer\.js[^"']*)["']/)?.[1];
    const liveRenderer = await import(new URL(rendererSpec, gameUrl).href);
    liveRenderer.render(123.25);

    const leanUrl = new URL("/src/render/lean.js", location.href);
    const rendererSource = await fetch(new URL(rendererSpec, gameUrl)).then((r) => r.text());
    const leanSpec = rendererSource.match(/from\s+["']([^"']*\/lean\.js[^"']*)["']/)?.[1];
    const leanMod = await import(new URL(leanSpec || leanUrl, gameUrl).href);

    for (const child of document.querySelectorAll("#root > :not(canvas)")) child.style.display = "none";
    document.body.style.background = "#000";
    return { x: anchor.x, y: anchor.y, leanRad: leanMod.lean() };
  }, [place, dayPhase]);

  const png = await page.screenshot({ animations: "disabled" });
  await context.close();
  if (errors.length) throw new Error(`lean ${deg}: ${errors.join(" | ")}`);
  return { png, info };
}

for (const deg of angles) {
  const { png, info } = await capture(deg, phase);
  const out = `${prefix}-${String(deg).replace(".", "_")}.png`;
  writeFileSync(out, png);
  console.log(`[lean] ${String(deg).padStart(5)}° -> lean() = `
    + `${(info.leanRad * 180 / Math.PI).toFixed(2)}°  ${out}`);
}
await browser.close();
