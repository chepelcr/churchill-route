// Progression / unlocks / wallet — persisted in localStorage.
import { WORLD2D as W } from "../world2d/index.js";
import { state, pushFloat } from "./state.js";
import { t } from "../i18n/index.js";
import { ensureEconomy } from "./economy.js";
import { analytics } from "../monetize/analytics.js";

const STORAGE_KEY = "churchill_progress_v1";

// ---- MVP gate (first Play Store release) ----------------------------------
// The wall used to stand at the playitas|cocal boundary, closing everything
// east of Las Playitas. It has MOVED EAST to the inland barrios: the coast road
// out through El Cocal, Mata de Limón and Caldera is open, which is what the
// beach accesses and the lancha to the north shore are for. Chacarita, El
// Roble, Barranca and Esparza stay closed — they are inland grids with no
// kiosks, customers or stages, so opening them would be empty driving.
export const MVP_LOCKED = ["chacarita", "elroble", "barranca", "esparza"];
export function isMvpLocked(id) { return MVP_LOCKED.includes(id); }
export function mvpWallX() {
  // The wall stands at the westernmost locked district — read from the world,
  // never hardcoded, so moving a district boundary moves the wall with it.
  const locked = W.DISTRICTS.filter((d) => isMvpLocked(d.id));
  return locked.length ? Math.min(...locked.map((d) => d.x0)) : Infinity;
}

export function loadProgress() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return ensureEconomy({ unlocked: ["faro", "carmen"], clearedStages: [], best: 0 });
    const o = JSON.parse(s);
    if (!o.unlocked || !o.unlocked.length) o.unlocked = ["faro", "carmen"];
    return ensureEconomy(o); // silently adds coins/owned/upgrades/… to old saves
  } catch (e) { return ensureEconomy({ unlocked: ["faro", "carmen"], clearedStages: [], best: 0 }); }
}

export function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress)); } catch (e) {}
}

export function unlockDistrict(id) {
  if (isMvpLocked(id)) return; // gated until a future release
  if (!state.progress.unlocked.includes(id)) {
    state.progress.unlocked.push(id);
    saveProgress();
    pushFloat(state.p.x, state.p.y - 50, t("float.unlocked", { district: id.toUpperCase() }), "#ffe06b");
    analytics.track("district_unlock", { district: id });
  }
}

export function markStageCleared(stageId, score) {
  if (!state.progress.clearedStages.includes(stageId)) state.progress.clearedStages.push(stageId);
  state.progress.best = Math.max(state.progress.best || 0, score);
  saveProgress();
}

/** Best time and best catch for a crossing stage, or null if never finished.
 *  Kept beside the stage records in the same save; `crossings` is added to old
 *  saves lazily by the writer, so a missing key here is "never sailed it". */
export function crossingRecord(stageId) {
  return (state.progress && state.progress.crossings && state.progress.crossings[stageId]) || null;
}

// Build the barrier list: the MVP wall applies in EVERY mode; the progression
// barriers (locked districts) only gate explore mode as before.
export function rebuildBarriers() {
  state.barriers = [];
  const wallX = mvpWallX();
  if (isFinite(wallX)) state.barriers.push({ x: wallX + 4, district: "chacarita", mvp: true });
  if (state.mode !== "explore") return;
  for (let i = 0; i < W.DISTRICTS.length; i++) {
    const d = W.DISTRICTS[i];
    if (isMvpLocked(d.id)) continue; // already behind the MVP wall
    if (state.progress.unlocked.includes(d.id)) continue;
    // place a barrier at the district's western edge
    // required stage = the story stage whose clear unlocks this district
    const unlockStage = W.STAGES.findIndex(s => s.unlock === d.id);
    state.barriers.push({
      x: d.x0 + 4,
      district: d.id,
      requiredStage: unlockStage >= 0 ? unlockStage + 1 : i,
    });
  }
}
