// Core delivery loop: pick up a churchill at a kiosk, deliver it to a customer
// before it melts. Scoring, combo, timer extensions and stage-clear checks.
import { WORLD as W } from "../world/index.js";
import { state, pushFloat } from "./state.js";
import { markStageCleared, unlockDistrict } from "./progress.js";
import { sfx } from "./audio.js";

export function activeKiosks() {
  // If stage is active, only those kiosks are valid
  if (state.stage) {
    return state.stage.kiosks.map(id => W.landmarkById(id)).filter(Boolean);
  }
  return W.LANDMARKS.filter(l => l.type === "kiosk");
}

export function activeCustomers() {
  if (state.stage) return state.stage.customers.map(id => W.customerById(id)).filter(Boolean);
  return W.CUSTOMERS;
}

export function nearestKiosk(p) {
  let best = null, bd = Infinity;
  for (const lm of activeKiosks()) {
    const d = Math.hypot(p.x - lm.x, p.y - lm.y);
    if (d < bd) { bd = d; best = lm; }
  }
  return { lm: best, d: bd };
}

export function pickCustomer() {
  const pool = activeCustomers();
  state.pendingOrder = pool[Math.floor(Math.random() * pool.length)];
}

export function pickUpChurchill(kioskLm) {
  if (!state.pendingOrder) pickCustomer();
  const dist = Math.hypot(state.pendingOrder.x - kioskLm.x, state.pendingOrder.y - kioskLm.y);
  const base = Math.max(18, dist / 110);
  state.carrying = { kioskId: kioskLm.id, customer: state.pendingOrder, melt: 0, total: base };
  state.pendingOrder = null;
  state.storyTip = `Llevale a ${state.carrying.customer.name}.`;
  pushFloat(kioskLm.x, kioskLm.y - 24, "+ CHURCHILL", "#fff");
  sfx.play("pickup");
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
  if (meltPct < 0.25) pushFloat(state.p.x, state.p.y - 44, "¡PERFECTO!", "#ff3d80");
  sfx.play(meltPct < 0.25 ? "perfect" : "delivery");
  if (comboUp && state.combo > 1) sfx.play("combo", state.combo);
  pushFloat(c.customer.x, c.customer.y - 22, c.customer.line.slice(0, 26), "#fff");
  state.carrying = null;
  state.storyTip = "¡Pura vida! Volvé al kiosco.";
  if (state.mode === "arcade" || state.mode === "story") state.timeLeft += meltPct < 0.4 ? 10 : 5;
  if (state.mode === "explore") state.timeLeft += meltPct < 0.4 ? 12 : 6;
  // stage clear check
  if (state.stage && state.stageDeliveries >= state.stageTarget) {
    state.won = true;
    state.over = true;
    // Unlock the next district + record progress
    markStageCleared(state.stage.id, state.score);
    if (state.stage.unlock) unlockDistrict(state.stage.unlock);
    // also unlock the next stage's district as a stretch
    const nextS = W.STAGES[state.stageIdx + 1];
    if (nextS && nextS.unlock) unlockDistrict(nextS.unlock);
  } else {
    pickCustomer();
  }
}

export function dropChurchill() {
  pushFloat(state.p.x, state.p.y - 18, "¡SE DERRITIÓ!", "#ff3d80");
  state.carrying = null;
  state.combo = 1;
  state.storyTip = "Volvé al kiosco por otro Churchill.";
  sfx.play("melt_fail");
}
