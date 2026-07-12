// Progression / unlocks — persisted in localStorage.
import { WORLD2D as W } from "../world2d/index.js";
import { state, pushFloat } from "./state.js";

const STORAGE_KEY = "churchill_progress_v1";

export function loadProgress() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return { unlocked: ["faro", "carmen"], clearedStages: [], best: 0 };
    const o = JSON.parse(s);
    if (!o.unlocked || !o.unlocked.length) o.unlocked = ["faro", "carmen"];
    return o;
  } catch (e) { return { unlocked: ["faro", "carmen"], clearedStages: [], best: 0 }; }
}

export function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress)); } catch (e) {}
}

export function unlockDistrict(id) {
  if (!state.progress.unlocked.includes(id)) {
    state.progress.unlocked.push(id);
    saveProgress();
    pushFloat(state.p.x, state.p.y - 50, `¡${id.toUpperCase()} DESBLOQUEADO!`, "#ffe06b");
  }
}

export function markStageCleared(stageId, score) {
  if (!state.progress.clearedStages.includes(stageId)) state.progress.clearedStages.push(stageId);
  state.progress.best = Math.max(state.progress.best || 0, score);
  saveProgress();
}

// build barrier list for explore mode based on locked districts
export function rebuildBarriers() {
  state.barriers = [];
  if (state.mode !== "explore") return;
  for (let i = 0; i < W.DISTRICTS.length; i++) {
    const d = W.DISTRICTS[i];
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
