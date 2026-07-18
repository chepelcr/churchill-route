// Core delivery loop: pick up a churchill at a kiosk, deliver it to a customer
// before it melts. Scoring, combo, timer extensions and stage-clear checks.
import { WORLD2D as W } from "../world2d/index.js";
import { state, pushFloat } from "./state.js";
import { markStageCleared, unlockDistrict, isMvpLocked } from "./progress.js";
import { sfx } from "./audio.js";
import { t } from "../i18n/index.js";
import { content } from "../content/remote.js";
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
  const pt = W.reachablePointNear(base.x, base.y);
  state.pendingOrder = { ...base, x: Math.round(pt.x), y: Math.round(pt.y) };
}

export function pickCustomer() {
  const pool = activeCustomers();
  if (!pool.length) { state.pendingOrder = null; return; }
  const base = pool[Math.floor(Math.random() * pool.length)];
  // Give this order a fresh, reachable spot near the customer's home anchor so
  // repeat deliveries don't always land in the exact same place, and nobody is
  // ever stranded on the beach / inside a cuadra. Clone so the canonical
  // customer record is never mutated.
  const pt = W.reachablePointNear(base.x, base.y);
  state.pendingOrder = { ...base, x: Math.round(pt.x), y: Math.round(pt.y) };
}

export function pickUpChurchill(kioskLm) {
  if (!state.pendingOrder) pickCustomer();
  const dist = Math.hypot(state.pendingOrder.x - kioskLm.x, state.pendingOrder.y - kioskLm.y);
  // Budget must leave headroom over the real (grid-inflated) travel time —
  // dist/110 was break-even with a flawless run, so any mistake melted.
  // dist/72 tracks the ~10% top-speed reduction (2026-07-18 playability pass).
  const base = Math.max(28, dist / 72);
  state.carrying = { kioskId: kioskLm.id, customer: state.pendingOrder, melt: 0, total: base };
  state.pendingOrder = null;
  state.storyTip = t("tip.deliverTo", { name: state.carrying.customer.name });
  pushFloat(kioskLm.x, kioskLm.y - 24, t("float.pickup"), "#fff");
  sfx.play("pickup");
  analytics.track("pickup", { kiosk_id: kioskLm.id, mode: state.mode });
}

export function deliverChurchill() {
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
  pushFloat(c.customer.x, c.customer.y - 22, c.customer.line.slice(0, 26), "#fff");
  // Per-business exposure: which named customer/district got this delivery
  // (the stat sponsored spots are sold on).
  analytics.track("delivery", {
    customer_id: c.customer.id || "",
    customer_name: c.customer.name,
    district: c.customer.district || (W.districtAt(c.customer.x, c.customer.y) || {}).id || "",
    mode: state.mode,
    perfect: meltPct < 0.25 ? 1 : 0,
  });
  state.carrying = null;
  state.storyTip = t("tip.delivered");
  if (state.mode === "arcade" || state.mode === "story") state.timeLeft += meltPct < 0.4 ? 10 : 5;
  if (state.mode === "explore") state.timeLeft += meltPct < 0.4 ? 12 : 6;
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

export function dropChurchill() {
  pushFloat(state.p.x, state.p.y - 18, t("float.melted"), "#ff3d80");
  state.carrying = null;
  state.combo = 1;
  state.storyTip = t("tip.melted");
  sfx.play("melt_fail");
}
