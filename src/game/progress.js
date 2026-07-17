// Progression / unlocks / wallet — persisted in localStorage.
import { WORLD2D as W } from "../world2d/index.js";
import { state, pushFloat } from "./state.js";
import { t } from "../i18n/index.js";
import { ensureEconomy } from "./economy.js";

const STORAGE_KEY = "churchill_progress_v1";

// ---- MVP gate (first Play Store release) ----------------------------------
// Only the Puntarenas spit up to Las Playitas is open: Faro, Carmen, the
// paseos, Centro (market) and Playitas. Everything east of the playitas|cocal
// boundary — El Cocal, Mata de Limón, Caldera and the inland barrios — is
// fenced off in EVERY mode with a "PRÓXIMAMENTE" wall until a later release.
export const MVP_LOCKED = ["cocal", "mata", "caldera", "chacarita", "elroble", "barranca", "esparza"];
export function isMvpLocked(id) { return MVP_LOCKED.includes(id); }
export function mvpWallX() {
  const cocal = W.DISTRICTS.find((d) => d.id === "cocal");
  return cocal ? cocal.x0 : Infinity;
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
  }
}

export function markStageCleared(stageId, score) {
  if (!state.progress.clearedStages.includes(stageId)) state.progress.clearedStages.push(stageId);
  state.progress.best = Math.max(state.progress.best || 0, score);
  saveProgress();
}

// Build the barrier list: the MVP wall applies in EVERY mode; the progression
// barriers (locked districts) only gate explore mode as before.
export function rebuildBarriers() {
  state.barriers = [];
  const wallX = mvpWallX();
  if (isFinite(wallX)) state.barriers.push({ x: wallX + 4, district: "cocal", mvp: true });
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
