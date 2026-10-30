// UNA FOTO DEL MUNDO DE VERDAD, para mirarla — nunca para diffear.
//   node tools/shot-world.mjs <out.png> <x> <y> [devUrl] [zoom]
// El piso de ruido de una escena de mundo es de 2 % a 86 % (CLAUDE.md), así que
// esto existe para JUZGAR, no para comparar.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
const [out, X, Y, url = "http://localhost:8734/", zoom = "1"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state, null, { timeout: 30000 });
// ESPERAR A QUE EL MUNDO ESTÉ, no a que el objeto exista. La pantalla de carga
// se queda encima hasta que el accesor termina, y una foto tomada antes es una
// foto del cartel.
await page.waitForFunction(() => {
  const W = window.Game?.world || window.WORLD2D;
  return document.querySelector("canvas") && !document.body.innerText.includes("LOADING");
}, null, { timeout: 60000 }).catch(() => {});
await page.evaluate(async ([x, y, z]) => {
  const G = window.Game;
  G.setAttract(false);
  G.startExplore();
  G.setWeather("sunny");
  const p = G.state.p;
  p.x = x; p.y = y; p.vx = p.vy = 0; p.speed = 0;
  G.state.cam.x = x; G.state.cam.y = y;
  if (G.state.cam.z) G.state.cam.z *= z;
}, [Number(X), Number(Y), Number(zoom)]);
// MEDIODÍA, y por la instancia VIVA del reloj. `setWeather` dura un cuadro —
// `updateDayCycle` lo reescribe desde la hora— y un `import` de la ruta lisa
// acuña una SEGUNDA instancia con su propio `cycle`, así que se resuelve la URL
// que el pintor de verdad usa, igual que hace `shot-parcels` con `gfx.js`.
await page.evaluate(async () => {
  const shadowsUrl = new URL("/src/render/c2d/shadows.js", location.href);
  const shadowsSrc = await fetch(shadowsUrl).then((r) => r.text());
  const solarSpec = shadowsSrc.match(/from\s+["']([^"']*\/render\/sun\.js[^"']*)["']/)?.[1];
  if (!solarSpec) throw new Error("shot-world could not resolve the live solar module");
  const solarUrl = new URL(solarSpec, shadowsUrl);
  const solarSrc = await fetch(solarUrl).then((r) => r.text());
  const daySpec = solarSrc.match(/from\s+["']([^"']*\/game\/daynight\.js[^"']*)["']/)?.[1];
  if (!daySpec) throw new Error("shot-world could not resolve the live daynight module");
  (await import(new URL(daySpec, solarUrl).href)).setDayCycle(true, 0.25);
});
await page.waitForTimeout(6000);          // let the tiles stream in
// ESCONDER LA INTERFAZ. El canvas es del juego y React pinta encima; sin esto
// la foto es del cartel de etapa, no del suelo que se vino a mirar.
await page.evaluate(() => {
  for (const el of document.querySelectorAll("body > *:not(canvas), #root > *:not(canvas)")) {
    if (!el.querySelector("canvas")) el.style.visibility = "hidden";
  }
  for (const el of document.querySelectorAll("canvas")) el.style.visibility = "visible";
});
await page.waitForTimeout(900);
await page.evaluate(() => {
  for (const el of document.querySelectorAll("body > *:not(canvas), #root > *:not(canvas)")) {
    if (!el.querySelector("canvas")) el.style.display = "none";
  }
});
await page.waitForTimeout(400);
const shot = await page.screenshot();
writeFileSync(out, shot);
await browser.close();
if (errors.length) { console.error(`[world] page errors: ${errors.join(" | ")}`); process.exit(1); }
console.log(`[world] (${X},${Y}) -> ${out}`);
