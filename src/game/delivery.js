// Core delivery loop: pick up an ORDER at a kiosk, deliver it to a customer
// before it goes off. Scoring, combo, timer extensions and stage-clear checks.
//
// EL PRODUCTO VIAJA CON LA CARGA, y hasta ahora no viajaba. `content/world/
// kiosks.json` reparte cinco comidas entre los 17 puestos y el mundo emite el
// `product` de cada kiosco — pero se quedaba en el ARTE: `propFor` dibujaba el
// puesto correcto y desde ahí abajo todo el juego seguía siendo un churchill.
// `state.carrying` no lo llevaba, así que el reloj, el presupuesto, la barra
// del HUD, lo que dice el cliente y lo que sale flotando en la entrega hablaban
// los cinco de hielo raspado. Un vigorón en hoja no se derrite.
//
// El registro se lee EN EL CLIENTE. `product` ya viaja en el manifest, así que
// esto no necesita reconstruir el mundo: es el mismo movimiento que
// `building-styles.json`, y lo que hace que cambiar un presupuesto cueste una
// recarga y no 33 minutos. El validador sigue siendo `tests/test_content.py`,
// que es donde el catálogo ya se comprobaba.
import PRODUCTS_JSON from "../../content/world/products.json" with { type: "json" };
import CUSTOMERS_JSON from "../../content/world/customers.json" with { type: "json" };
import { sunVector, stormLevel } from "./daynight.js";
import { WORLD2D as W } from "../world2d/index.js";
import { state, pushFloat } from "./state.js";
import { markStageCleared, unlockDistrict, isMvpLocked, mvpWallX } from "./progress.js";
import { sfx } from "./audio.js";
import { t } from "../i18n/index.js";
import { content } from "../content/remote.js";
import { tuning } from "./tuning.js";
import { addTime } from "./timers.js";
import { economy, COINS_PER_DELIVERY, COINS_PERFECT_BONUS } from "./economy.js";
import { analytics } from "../monetize/analytics.js";

// The world is gated by walls (the MVP wall in every mode + the explore
// progression barriers), so only offer kiosks/customers on the open side —
// otherwise you could be sent to pick up or deliver behind a locked wall.
function reachable(o) {
  const dId = o.district || (W.districtAt(o.x, o.y) || {}).id;
  if (dId && isMvpLocked(dId)) return false;
  if (state.mode !== "explore" || !state.progress) return true;
  return !dId || state.progress.unlocked.includes(dId);
}

const PRODUCTS = PRODUCTS_JSON.products;
const DEFAULT_PRODUCT = "churchill";

// DE QUÉ HABLA CADA FRASE, LEÍDO DEL LADO DEL CLIENTE.
//
// El `product` de una frase se autora en `content/world/customers.json` y **el
// mundo emitido no lo lleva**: el builder emite del cliente id/nombre/posición/
// distrito/línea, y un campo que no está en ese modelo se cae sin decir nada. Se
// vio en el propio smoke del HUD — «¡La mía sin tanto rojo!», que es el sirope
// de cola de un churchill, dicha sobre un vigorón en hoja.
//
// Se resuelve aquí y no en el emit por dos razones: la etiqueta es una propiedad
// de la COPIA, no del lugar donde para el cliente, y afinarla no puede costar
// una reconstrucción de 48 minutos. Es el mismo movimiento que el registro de
// productos de arriba. Un NPC remoto puede traer la suya propia y esa manda.
const LINE_PRODUCT = Object.fromEntries(
  CUSTOMERS_JSON.customers.filter((c) => c.product).map((c) => [c.id, c.product]));

/** Which product a customer's own line is about, or undefined if it fits any. */
export function lineProduct(customer) {
  return customer.product || LINE_PRODUCT[customer.id];
}

/** The registry row for a product id. An unknown id falls back to the churchill
 *  rather than throwing: a kiosk is a delivery target first and a menu second,
 *  and `tests/test_content.py` is what makes an unknown id impossible anyway. */
export function productOf(id) {
  return PRODUCTS[id] || PRODUCTS[DEFAULT_PRODUCT];
}

/** What the order on the vehicle IS. Anything that used to assume a churchill
 *  asks this instead, so there is one answer and it survives an empty hand. */
export function carriedProduct() {
  return productOf(state.carrying?.product);
}

// CÓMO SE ECHA A PERDER CADA COSA — cuatro modelos, y el producto ELIGE.
//
// Es el contrato que `products.json` ya prometía («`spoil` es el modelo que la
// física implementa y el producto SELECCIONA») y que no implementaba nadie: los
// cinco productos corrían el reloj del churchill. Cada modelo sale de la nota
// del producto, no de un número inventado:
//
//   melt  el churchill se derrite MIENTRAS UNO MANEJA. El reloj es el odómetro
//         y el calor del día — el modelo de siempre, intacto.
//   cool  se enfría solo, casi al mismo paso pase lo que pase. Perdona más,
//         pero un rodeo no lo salva: no depende de cómo se maneje.
//   sog   en hoja. Lo que lo aguada es el AGUA y el traqueteo del camino de
//         tierra, no el calor — bajo aguacero es el peor reparto del juego.
//   sun   «su reloj corre con el cielo, no con el odómetro». A mediodía se va;
//         de noche casi no corre, y la misma entrega es otra cosa a las seis.
//
// El nombre del modelo es vocabulario cerrado: `tests/test_content.py` lee esta
// lista para que un producto no pueda pedir uno que no existe.
const SPOIL = {
  melt: (f) => f.base * (f.onRoad ? 1.0 : 1.25) * f.heat,
  cool: (f) => f.base * 0.78 * (0.55 + 0.45 * f.heat),
  sog: (f) => f.base * 0.62 * (f.onRoad ? 1.0 : 1.5) * (1 + 1.4 * f.rain),
  sun: (f) => f.base * (0.25 + 1.15 * f.sunAlt),
};

export const SPOIL_MODELS = Object.keys(SPOIL);

/** The spoil clock for what is on the vehicle, per second.
 *
 *  `base` is the vehicle's own rate times the cooler upgrade — everything a
 *  player bought stays multiplicative and applies to all five foods. The sky
 *  terms are read HERE rather than passed as weather NAMES: the day is a
 *  continuum (see `daynight.js`), and `sun` in particular is meaningless
 *  against four discrete labels. */
export function spoilRate(base, onRoad, heat) {
  const model = SPOIL[carriedProduct().spoil] || SPOIL.melt;
  return model({ base, onRoad, heat, rain: stormLevel(), sunAlt: sunVector().alt });
}

// LO QUE DICE EL CLIENTE, Y DE QUÉ ESTÁ HABLANDO.
//
// Nueve de las 24 frases nombran el churchill — «Bendito churchill.», «Con
// hielo bien menudito.», «¡La mía sin tanto rojo!» — y se decían igual sobre un
// vigorón. Pero la frase es el PERSONAJE (c2 es un turista alemán), así que
// borrarlas para uniformar habría costado el puerto entero.
//
// Así que una frase puede DECLARAR de qué producto habla (`product` en
// `customers.json`); sin declararlo sirve para cualquiera. Si no encaja con lo
// que se entregó, habla el producto — `lines` en `products.json` — y quién de
// esas frases le toca es estable por cliente, para que la misma persona diga
// siempre lo mismo y el puerto no cambie de voz cada entrega.
export function customerLine(customer, productId) {
  const own = customer.line || "";
  const about = lineProduct(customer);
  if (!about || about === productId) return own;
  const pool = productOf(productId).lines || [];
  if (!pool.length) return own;
  const key = String(customer.id || customer.name || "");
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

export function activeKiosks() {
  // If stage is active, only those kiosks are valid
  if (state.stage) {
    return state.stage.kiosks.map(id => W.landmarkById(id)).filter(Boolean);
  }
  return W.LANDMARKS.filter(l => l.type === "kiosk" && reachable(l));
}

// The customer pool: when the remote content provides NPCs they REPLACE the
// bundled list (long-term: all NPCs are server-managed — supporters' NPCs
// arrive without an app release). Story stages keep their scripted customers.
function customerPool() {
  return content.npcs.length ? content.npcs : W.CUSTOMERS;
}

export function activeCustomers() {
  if (state.stage) return state.stage.customers.map(id => W.customerById(id)).filter(Boolean);
  return customerPool().filter(c => reachable(c));
}

// Easternmost x the player can actually reach: the nearest wall to the east
// (the MVP "PRÓXIMAMENTE" wall in every mode + explore progression barriers).
// Delivery targets must stay west of it so NPCs never spawn past the gate.
function openLimitX() {
  // A BARRIER IS EITHER A LINE OR A BOX. The progression ones are a line at a
  // district's west edge (`x`); the MVP gate is boxes around the closed
  // districts (`x0..x1`, `y0..y1`). Reading `.x` off a box gave `undefined`,
  // `Math.min` turned that into NaN, `isFinite(NaN)` was false, and the clamp
  // switched itself OFF — so orders could be placed inside a closed district
  // with no wall complaining. A box's western edge is its wall for this
  // purpose: the easternmost x an order may still sit at.
  const walls = [];
  for (const b of state.barriers || []) {
    const x = b.x0 !== undefined ? b.x0 : b.x;
    if (Number.isFinite(x)) walls.push(x);
  }
  const mvp = mvpWallX();
  if (Number.isFinite(mvp)) walls.push(mvp);
  return walls.length ? Math.min(...walls) : Infinity;
}

// A fresh, reachable delivery spot near an anchor that is guaranteed to sit in
// the open (unlocked) area — used by every order so repeat drops vary and no
// customer ever lands on the beach, inside a cuadra, or behind a locked wall.
function openReachablePoint(x, y) {
  const limit = openLimitX() - 30;
  return W.reachablePointNear(x, y, 480, isFinite(limit) ? (px) => px < limit : null);
}

export function nearestKiosk(p) {
  let best = null, bd = Infinity;
  for (const lm of activeKiosks()) {
    const d = Math.hypot(p.x - lm.x, p.y - lm.y);
    if (d < bd) { bd = d; best = lm; }
  }
  return { lm: best, d: bd };
}

// Tutorial wants a short, predictable first trip: the nearest active customer
// to (x,y) instead of a random one.
export function pickCustomerNear(x, y) {
  const pool = activeCustomers();
  if (!pool.length) { state.pendingOrder = null; return; }
  const base = pool.reduce((a, b) =>
    Math.hypot(a.x - x, a.y - y) <= Math.hypot(b.x - x, b.y - y) ? a : b);
  const pt = openReachablePoint(base.x, base.y);
  state.lastCustomerId = base.id || base.name;
  state.pendingOrder = { ...base, x: Math.round(pt.x), y: Math.round(pt.y) };
}

export function pickCustomer() {
  const pool = activeCustomers();
  if (!pool.length) { state.pendingOrder = null; return; }
  // Keep orders inside the zone the active kiosks cover: prefer customers within
  // a generous radius of a kiosk (so you deliver near where you pick up), and
  // don't hand out the same NPC twice in a row — cuts down on repeats.
  const kiosks = activeKiosks();
  let choices = pool;
  if (kiosks.length) {
    const near = pool.filter(c => kiosks.some(k => Math.hypot(k.x - c.x, k.y - c.y) < 2600));
    if (near.length) choices = near;
  }
  if (choices.length > 1 && state.lastCustomerId) {
    const varied = choices.filter(c => (c.id || c.name) !== state.lastCustomerId);
    if (varied.length) choices = varied;
  }
  const base = choices[Math.floor(Math.random() * choices.length)];
  // Give this order a fresh, reachable spot near the customer's home anchor so
  // repeat deliveries don't always land in the exact same place, nobody is ever
  // stranded on the beach / inside a cuadra, and it stays in the open area.
  // Clone so the canonical customer record is never mutated.
  const pt = openReachablePoint(base.x, base.y);
  state.lastCustomerId = base.id || base.name;
  state.pendingOrder = { ...base, x: Math.round(pt.x), y: Math.round(pt.y) };
}

export function pickUpOrder(kioskLm) {
  if (!state.pendingOrder) pickCustomer();
  const dist = Math.hypot(state.pendingOrder.x - kioskLm.x, state.pendingOrder.y - kioskLm.y);
  // Budget must leave headroom over the real (grid-inflated) travel time —
  // dist/110 was break-even with a flawless run, so any mistake melted.
  // dist/72 tracks the ~10% top-speed reduction (2026-07-18 playability
  // pass), and the user's speed slider compensates here so changing speed
  // changes feel, not difficulty.
  //
  // …AND THE FOOD GETS A SAY. `budgetMul` was authored per product and read by
  // nobody, so a vigorón — the long, patient run its own note describes — was
  // given the churchill's clock. The distance still sets the shape of the
  // budget; the product scales it.
  const product = kioskLm.product || DEFAULT_PRODUCT;
  const base = Math.max(28, dist / (72 * tuning.speed)) * (productOf(product).budgetMul || 1);
  state.carrying = {
    kioskId: kioskLm.id, product, customer: state.pendingOrder, melt: 0, total: base,
  };
  state.pendingOrder = null;
  state.storyTip = t("tip.deliverTo", { name: state.carrying.customer.name });
  pushFloat(kioskLm.x, kioskLm.y - 24,
            t("float.pickup", { product: productOf(product).short }), "#fff");
  sfx.play("pickup");
  analytics.track("pickup", { kiosk_id: kioskLm.id, product, mode: state.mode });
}

export function deliverOrder() {
  const c = state.carrying;
  const meltPct = c.melt / c.total;
  const base = 250;
  const speedBonus = Math.round(state.p.speed * 0.4);
  const meltBonus = Math.round((1 - meltPct) * 500);
  const total = Math.round((base + speedBonus + meltBonus) * state.combo);
  state.score += total;
  state.deliveries += 1;
  state.stageDeliveries += 1;
  if (meltPct < 0.25) state.perfect += 1;
  const comboUp = meltPct < 0.4;
  state.combo = Math.min(8, state.combo + (comboUp ? 1 : 0));
  state.comboTimer = 7;
  pushFloat(state.p.x, state.p.y - 24, `+${total}`, meltPct < 0.25 ? "#ffe06b" : "#fff");
  if (meltPct < 0.25) pushFloat(state.p.x, state.p.y - 44, t("float.perfect"), "#ff3d80");
  // Churchill coins: the run's spending money (tutorial runs don't pay)
  if (state.mode !== "tutorial") {
    const earned = COINS_PER_DELIVERY + (meltPct < 0.25 ? COINS_PERFECT_BONUS : 0);
    economy.addCoins(earned);
    state.runCoins = (state.runCoins || 0) + earned;
    // ₡ (colón) instead of the old ⛁ glyph — U+26C1 has no glyph on many
    // Android/WebView fonts, while the colón sign ships everywhere we run
    pushFloat(state.p.x + 20, state.p.y - 34, `+₡${earned}`, "#f3c969");
  }
  sfx.play(meltPct < 0.25 ? "perfect" : "delivery");
  if (comboUp && state.combo > 1) sfx.play("combo", state.combo);
  pushFloat(c.customer.x, c.customer.y - 22,
            customerLine(c.customer, c.product).slice(0, 26), "#fff");
  // Per-business exposure: which named customer/district got this delivery
  // (the stat sponsored spots are sold on).
  analytics.track("delivery", {
    customer_id: c.customer.id || "",
    customer_name: c.customer.name,
    product: c.product || DEFAULT_PRODUCT,
    district: c.customer.district || (W.districtAt(c.customer.x, c.customer.y) || {}).id || "",
    mode: state.mode,
    perfect: meltPct < 0.25 ? 1 : 0,
  });
  state.carrying = null;
  state.storyTip = t("tip.delivered");
  // A delivery buys time back. `addTime` is a no-op on an untimed run, which
  // is why Recorrer no longer needs a line of its own here — it was paying 12 s
  // into a clock nobody was shown.
  addTime(state, meltPct < 0.4 ? 10 : 5);
  // stage clear check
  if (state.stage && state.stageDeliveries >= state.stageTarget) {
    state.won = true;
    state.over = true;
    // Unlock the next district + record progress
    markStageCleared(state.stage.id, state.score);
    analytics.track("stage_clear", { stage_id: state.stage.id, score: state.score });
    if (state.stage.unlock) unlockDistrict(state.stage.unlock);
    // also unlock the next stage's district as a stretch
    const nextS = W.STAGES[state.stageIdx + 1];
    if (nextS && nextS.unlock) unlockDistrict(nextS.unlock);
  } else {
    pickCustomer();
  }
}

export function dropOrder() {
  // LO QUE SE PERDIÓ NO SIEMPRE SE DERRITIÓ. `¡SE DERRITIÓ!` sobre una
  // mariscada es la misma mentira que la barra de hielo: la copia va por el
  // MODELO de deterioro, que es lo que el jugador acaba de vivir.
  const spoil = carriedProduct().spoil || "melt";
  pushFloat(state.p.x, state.p.y - 18, t(`float.spoiled.${spoil}`), "#ff3d80");
  state.carrying = null;
  state.combo = 1;
  state.storyTip = t(`tip.spoiled.${spoil}`);
  sfx.play("melt_fail");
}
