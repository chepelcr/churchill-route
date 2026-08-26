// EL HUD HABLA DE LO QUE UNO LLEVA — through React's real PLAYING screen.
//
//   node tools/smoke-product-hud.mjs [devUrl]
//
// This does not replace the requested hand-played look check. It closes the
// mechanism gap that made the old probe useless: editorPlay moves App itself to
// PLAYING, then the real physics pickup at kios_paseo2 drives the real HUD.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const base = process.argv[2] || "http://localhost:8734/";
const url = new URL(base);
url.searchParams.set("editorPlay", "1");
url.searchParams.set("x", "24330");
url.searchParams.set("y", "15886");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => localStorage.setItem("churchill_lang_v1", "es"));
await page.goto(url.href, { waitUntil: "domcontentloaded" });
await page.waitForFunction(() => window.Game?.state && window.WORLD2D
  && document.body.dataset.gameScreen === "playing", null, { timeout: 30000 });

const place = await page.evaluate(async () => {
  const G = window.Game, W = window.WORLD2D;
  const kiosk = W.LANDMARKS.find((lm) => lm.id === "kios_paseo2");
  if (!kiosk) throw new Error("kios_paseo2 is missing from the emitted world");
  if (kiosk.product !== "vigoron")
    throw new Error(`kios_paseo2 sells ${kiosk.product}, expected vigoron`);
  // A fresh Recorrer save only has Faro/Carmen unlocked, so its delivery pool
  // correctly excludes this Paseo kiosk. Keep the React screen that editorPlay
  // opened, but start a real Arcade run: Arcade exposes every kiosk and takes
  // the exact same physics -> delivery -> HUD path we are proving here.
  G.startArcade({ weather: "sunny" });
  await W.ensureView(kiosk.x - 500, kiosk.y - 500, kiosk.x + 500, kiosk.y + 500, 1);
  G.setAttract(false);
  Object.assign(G.state.p, { x: kiosk.x, y: kiosk.y, vx: 0, vy: 0, speed: 0 });
  G.state.cam.x = kiosk.x; G.state.cam.y = kiosk.y;
  return { id: kiosk.id, name: kiosk.name, product: kiosk.product, x: kiosk.x, y: kiosk.y };
});

await page.waitForFunction(() => window.Game.state.carrying?.product === "vigoron", null,
                           { timeout: 10000 });
await page.evaluate(() => {
  const c = window.Game.state.carrying;
  c.melt = c.total * 0.6; // third quip: the yuca is visibly going soggy
});
await page.waitForFunction(() => {
  const pct = document.querySelector(".melt-bar .pct")?.textContent || "";
  const quip = document.querySelector(".melt-bar .quip")?.textContent || "";
  return pct.includes("% firme") && quip.includes("Se está aguadando la yuca…");
}, null, { timeout: 5000 });

const hud = await page.evaluate(() => ({
  pct: document.querySelector(".melt-bar .pct")?.textContent?.trim() || "",
  quip: document.querySelector(".melt-bar .quip")?.textContent?.trim() || "",
  product: window.Game.state.carrying?.product || "",
  customerId: window.Game.state.carrying?.customer?.id || "",
}));

// …Y LA FRASE TIENE QUE SER DE ESTA COMIDA. Esta es la aserción que faltaba, y
// la que encontró el fallo: el HUD imprimió «¡La mía sin tanto rojo!» —el
// sirope de cola de un churchill— sobre un vigorón en hoja. La etiqueta
// `product` de la frase se autora en `customers.json` y el MUNDO EMITIDO NO LA
// LLEVA, así que `customerLine` tomaba siempre la rama «sirve para cualquiera»
// y los repuestos por producto no se usaban jamás. Comprobar sólo la barra y el
// quip no lo veía: los dos venían de i18n y estaban bien.
const authored = JSON.parse(readFileSync("content/world/customers.json", "utf8"));
const products = JSON.parse(readFileSync("content/world/products.json", "utf8"));
const tagged = new Map(authored.customers.filter((c) => c.product)
                                         .map((c) => [c.id, c.product]));
//
// Y SE BARRE ENTERO, no sólo el cliente que tocó. `pickCustomer` elige al azar,
// así que una aserción sobre el de esta corrida pasa la mayoría de las veces por
// suerte: de los 24, doce llevan etiqueta. Se le pregunta a `customerLine` por
// TODOS contra TODOS los productos, que es determinista y es la pregunta real.
const sweep = await page.evaluate(async () => {
  const mod = await import("/src/game/delivery.js");   // función pura: la
  const out = [];                                      // segunda instancia da igual
  return { ok: typeof mod.customerLine === "function",
           lines: out, fn: true };
});
if (!sweep.ok) {
  console.error("[product-hud] FAIL — `customerLine` no está exportada");
  process.exit(1);
}
//
// LOS CLIENTES SE TOMAN COMO LOS VE EL JUEGO (`W.CUSTOMERS`), no del archivo
// autorado — y ESO es exactamente el fallo. Pasarle los registros autorados a
// `customerLine` le entrega objetos que YA traen `product`, así que la prueba
// pasa aunque el juego nunca lo vea: verificado, con el arreglo revertido este
// barrido seguía verde mientras el HUD decía «Rojito bien fuerte.» sobre un
// vigorón. La expectativa viene del archivo; el SUJETO tiene que ser el mundo.
const bad = await page.evaluate(async ({ tags, prods }) => {
  const mod = await import("/src/game/delivery.js");
  const W = window.WORLD2D;
  const wrong = [];
  for (const c of W.CUSTOMERS) {
    const about = tags[c.id];
    if (!about) continue;
    for (const pid of Object.keys(prods)) {
      if (about === pid) continue;
      const said = mod.customerLine(c, pid);
      const pool = prods[pid].lines || [];
      if (!pool.includes(said)) wrong.push(`${c.id}+${pid}: "${said}"`);
    }
  }
  return wrong;
}, { tags: Object.fromEntries(tagged), prods: products.products });
if (bad.length) {
  console.error(`[product-hud] FAIL — ${bad.length} frases se dicen sobre la comida `
    + `equivocada, p.ej. ${bad.slice(0, 3).join(" | ")}`);
  process.exit(1);
}
console.log(`[product-hud] ${tagged.size} frases etiquetadas x `
  + `${Object.keys(products.products).length} productos: ninguna habla de otra comida`);
// …AND IT CAN HAND YOU THE PICTURE. The assertion above proves the strings;
// only a look proves the bar READS right next to a vigorón on the Paseo, and
// the shot is what makes that look reviewable instead of remembered.
//   node tools/smoke-product-hud.mjs http://localhost:8734/ hud.png
const shot = process.argv[3];
if (shot) {
  await page.screenshot({ path: shot });
  console.log(`[product-hud] wrote ${shot}`);
}
await browser.close();

if (errors.length) {
  console.error(`[product-hud] page errors: ${errors.join(" | ")}`);
  process.exit(1);
}
if (hud.pct.includes("hielo") || hud.quip.toLowerCase().includes("derrit")) {
  console.error(`[product-hud] FAIL — el vigorón todavía habla de hielo: ${hud.pct} | ${hud.quip}`);
  process.exit(1);
}
console.log(`[product-hud] ${place.id} (${place.product}) → ${hud.pct} | ${hud.quip}`);
