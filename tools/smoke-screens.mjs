// LAS DIECISÉIS PANTALLAS, RECORRIDAS DE VERDAD.
//
// POR QUÉ EXISTE. `tests/test_screens.py` prueba que los ids del registro y los
// componentes de cada pantalla coinciden, que ningún `when` está sin proveer y
// que el registro no lleva maquetado. Lo que NO puede ver es si la pantalla
// sigue DIBUJANDO: un slot que devuelve `null`, una región que nadie monta o un
// `when` que resultó falso siempre pintan una pantalla que se ve deliberada, sin
// una excepción y sin una advertencia. Ése es exactamente el fallo que el
// registro existe para hacer imposible, y es invisible en revisión.
//
// Así que esto abre cada pantalla y cuenta sus bloques. No compara píxeles —eso
// sería frágil por otra razón— sino que exige que lo que el registro promete
// para esa pantalla ESTÉ EN EL DOM.
//
// Playwright NO es dependencia del juego: si no está, esto sale 0 con una nota.
const url = process.argv[2] || "http://localhost:8799/";
let chromium;
try { ({ chromium } = await import("playwright")); }
catch { console.log("[screens] playwright not installed — skipped (npm i -D playwright)"); process.exit(0); }

const CHROME = process.env.PLAYWRIGHT_CHROMIUM
  || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: CHROME }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push((e.stack || e.message).split("\n").slice(0, 3).join("\n   ")));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const t = m.text();
  if (/favicon|ERR_CONNECTION|Failed to load resource/.test(t)) return;
  errors.push("console: " + t.slice(0, 200));
});
// UNA ADVERTENCIA DE `Slots` ES UN FALLO AQUÍ. El intérprete avisa una vez por
// consola cuando un id no tiene componente y sigue — que es lo correcto en
// tiempo de ejecución y justo lo que hay que cazar en una prueba.
page.on("console", (m) => {
  if (m.text().includes("[screens]")) errors.push("Slots: " + m.text().slice(0, 200));
});
let bad = 0;
const fail = (m) => { console.log("[screens] FAIL — " + m); bad++; };

await page.goto(url, { waitUntil: "load" });

const count = (sel) => page.locator(sel).count();
const seen = async (sel, n, what) => {
  const got = await count(sel);
  if (got < n) fail(`${what}: se esperaban >= ${n} de \`${sel}\` y hay ${got}`);
  return got;
};
// SE PULSA POR ESTRUCTURA, NUNCA POR TEXTO. El juego se publica en dos idiomas
// y el idioma sale de `localStorage`, así que un `has-text("Siguiente")` es una
// prueba que falla al cambiar de idioma y, peor, al cambiar una palabra de la
// copia — dos cosas que no tienen nada que ver con si la pantalla dibuja.
const click = async (sel, i = 0) => {
  const el = page.locator(sel).nth(i);
  await el.waitFor({ state: "visible", timeout: 8000 });
  await el.click();
  await page.waitForTimeout(520);
};
const report = [];

// ---- boot -----------------------------------------------------------------
await page.waitForTimeout(600);
await seen(".boot-screen", 1, "boot");
await seen(".boot-water", 1, "boot (el agua es el marco, no un slot)");
await seen(".boot-logo", 1, "boot.logo");
await page.waitForTimeout(2600);
await seen(".boot-art", 1, "boot.art");
await seen(".boot-bar", 1, "boot.bar");
await seen(".boot-loading", 1, "boot.loading");
report.push("boot");

// ---- intro (primera corrida: el perfil de playwright siempre lo es) --------
await page.waitForTimeout(3600);
if (await count(".intro-page")) {
  await seen(".intro-text", 1, "intro.text");
  await seen(".intro-dots .dot", 3, "intro.dots");
  await click(".intro-page .btn.gold");
  await page.waitForTimeout(400);
  await click(".intro-page .btn.gold");
  await page.waitForTimeout(400);
  await seen(".intro-support", 1, "intro.support (sólo en la última)");
  report.push("intro");
}

// ---- llegar a la portada --------------------------------------------------
await page.evaluate(() => { try { localStorage.setItem("churchill_intro_seen_v1", "1"); } catch {} });
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(6200);
await seen(".title-page", 1, "title");
await seen(".modes .mode", 3, "title.modes");
await seen(".title-tools .tool-pill", 4, "title (la fila de herramientas es el marco)");
report.push("title");

// ---- settings / supporters / shop ----------------------------------------
await page.locator(".title-tools .tool-pill").last().click();      // mute
await page.locator(".title-tools .tool-pill").nth(4).click();      // gear
await page.waitForTimeout(600);
if (await count(".set-row")) {
  await seen(".set-group", 3, "settings (los tres grupos son regiones)");
  await seen(".set-row", 10, "settings: las diez filas");
  report.push("settings");
  await click(".page-head .btn.secondary");
}
await page.locator(".title-tools .tool-pill").nth(3).click();      // heart
await page.waitForTimeout(600);
if (await count(".page-card")) {
  const tiers = await count(".sup-groups"), empty = await count(".sup-empty");
  if (!tiers && !empty) fail("supporters: ni lista ni el bloque de vacío");
  report.push("supporters");
  await click(".page-head .btn.secondary");
}
await page.locator(".title-tools .coin-tool").click();
await page.waitForTimeout(700);
await seen(".shop-tabs .btn", 3, "shop.tabs");
await seen(".page-body", 1, "shop: el panel de la pestaña abierta");
report.push("shop");
await click(".page-head .btn.secondary");

// ---- tutbrief (el gorro de la fila de herramientas) ------------------------
await click(".title-tools .tool-pill", 1);
await seen(".panel h2", 1, "tutbrief.kicker");
await seen(".panel .drive-tuning, .panel input[type=range]", 1, "tutbrief.tuning");
report.push("tutbrief");
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(6200);

// ---- Historia: stagepick -> vehpick -> brief -------------------------------
await click(".modes .mode", 0);          // Historia es la primera tarjeta
await page.waitForTimeout(700);
await seen(".stage-hero", 1, "stagepick");
await seen(".hero-num", 1, "stagepick.badges");
await seen(".hero-name", 1, "stagepick.name");
await seen(".hero-brief", 1, "stagepick.brief");
await seen(".hero-meta span", 3, "stagepick.meta");
await seen(".stage-dots .dot", 5, "stagepick.dots");
report.push("stagepick");

await page.locator(".hero-play").click();
await page.waitForTimeout(800);
await seen(".picker-veh", 1, "vehpick.vehicle");
await seen(".picker-side", 1, "vehpick.color");
// EL `when` TIENE QUE HACER ALGO. Se llegó por HISTORIA, que arma sus mejoras
// en el StageBrief, así que la columna de mejoras NO debe estar — y comprobar
// que un bloque condicional está AUSENTE cuando toca es la única forma de
// distinguir «el `when` funciona» de «el bloque nunca aparece».
if (await count(".picker-boostcol")) {
  fail("vehpick: Historia muestra la columna de mejoras, que arma en el brief "
     + "— `armsBoosts` no está apagando nada");
}
const landChips = await count(".picker-veh .vchip");
report.push("vehpick");

await page.locator(".picker-veh .hero-play").click();
await page.waitForTimeout(700);
await seen(".panel h2", 1, "brief.kicker");
await seen(".panel .btn-row .btn", 1, "brief.go");
report.push("brief");

// ---- Recorrer: realmpick -> vehpick(agua) -> modebrief ---------------------
await page.goto(url, { waitUntil: "load" });
await page.waitForTimeout(6200);
await click(".modes .mode", 1);          // Recorrer es la segunda
await page.waitForTimeout(700);
const realms = await count(".modes .mode");
if (realms !== 2) fail(`realmpick: se esperaban 2 tarjetas y hay ${realms}`);
report.push("realmpick");
await page.locator(".modes .mode").nth(1).click();     // el estero
await page.waitForTimeout(800);
// …y aquí SÍ: Recorrer no es Historia, así que la tercera columna aparece.
await seen(".picker-boostcol", 1, "vehpick.boosts en Recorrer");
const waterChips = await count(".picker-veh .vchip");
if (!waterChips) fail("vehpick(estero): ni un casco");
if (waterChips === landChips) {
  fail(`vehpick: el estero ofrece los mismos ${waterChips} vehículos que Historia `
     + `— el medio no llegó al selector`);
}
await page.locator(".picker-veh .hero-play").click();
await page.waitForTimeout(700);
await seen(".panel h2", 1, "modebrief.heading");
report.push("modebrief");

// ---- playing: el HUD ------------------------------------------------------
await page.locator(".panel .btn.gold").first().click();
await page.waitForTimeout(2500);
await seen(".ui-layer", 1, "playing");
await seen(".hud-top .hud-card", 4, "playing: las cuatro tarjetas");
await seen(".hud-right .hud-btn", 3, "playing.tools");
await seen(".district-tab", 1, "playing.districtTab");
report.push("playing");

// ---- paused: el HUD SIN sus botones + el panel -----------------------------
await page.locator(".hud-right .hud-btn").last().click();
await page.waitForTimeout(600);
await seen(".pause-actions .btn", 3, "paused: los botones");
const toolsWhilePaused = await count(".hud-right");
if (toolsWhilePaused !== 0) {
  fail("paused: el HUD dibujó sus botones — `canPause` debería apagar esa región");
}
report.push("paused");

// ---- over: se termina la corrida desde el propio estado --------------------
// Es como App lo hace: el lazo de la UI ve `over` y cambia de pantalla. Jugar
// hasta perder de verdad tomaría los tres minutos del Arcade.
await click(".pause-actions .btn", 0);            // reanudar
await page.evaluate(() => { window.Game.state.over = true; });
await page.waitForTimeout(700);
await seen(".results-stats .row", 2, "over: las filas del marcador");
await seen(".page-body .btn-row .btn", 2, "over: los botones");
report.push("over");

if (errors.length) fail("errores de página:\n   " + errors.join("\n   "));
if (bad) { await browser.close(); process.exit(1); }
console.log(`[screens] ok — ${report.length} pantallas recorridas y con sus bloques en el DOM: `
  + report.join(", "));
console.log("[screens] ok — el medio llega al selector (tierra "
  + landChips + " vehículos, estero " + waterChips + "), y en pausa el HUD se dibuja sin sus botones");
await browser.close();
