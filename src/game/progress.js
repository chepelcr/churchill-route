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
// EL COCAL Y LO QUE SIGUE VUELVEN A CERRARSE. Those three districts hold
// stages 6, 7 and 8, and those levels are not designed yet — so they ship as
// PRÓXIMAMENTE rather than as something half-built you can walk into. The line
// lands where the pavement ends and the barro streets of El Cocal begin (the
// westernmost barro road is x≈20957, at the Playitas/Cocal seam), which is the
// same place the map stops being the town you can actually play.
//
// This is a SCOPE decision, not a geometry one: reopening them is adding the
// district back to this list, and the wall, the stage cards and the delivery
// clamp all follow from it.
export const MVP_LOCKED = [
  "cocal", "mata", "caldera",
  "chacarita", "elroble", "barranca", "esparza",
];
export function isMvpLocked(id) { return MVP_LOCKED.includes(id); }
/**
 * The MVP gate, as the BARRIOS THEMSELVES rather than a line.
 *
 * This used to be one `x` — the westernmost locked district's `x0` — and in a
 * 2-D world that is simply the wrong shape. The four closed barrios are INLAND
 * and their x-ranges OVERLAP the coastal districts: Chacarita starts at 28642,
 * which is a third of the way into El Cocal (21625..42785). So the "wall" stood
 * across the coast road and fenced off El Cocal, Mata de Limón and Caldera —
 * the exact three districts the comment above says are open, and the three that
 * stages 6, 7 and 8 are set in. Driving east past Las Playitas met
 * "PRÓXIMAMENTE" for a place that ships today.
 *
 * The districts carry `y0/y1` too, and the barrios are narrow bands inland
 * (y 4467..15079) while the coastal ones span the whole map height. Fencing the
 * boxes closes what is meant to be closed and leaves the costanera open.
 */
export function mvpBarrierBoxes() {
  return W.DISTRICTS.filter((d) => isMvpLocked(d.id)).map((d) => ({
    district: d.id, mvp: true, x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1,
  }));
}

/** The old single-line gate. Kept ONLY for `delivery.js`'s "keep orders west of
 *  the gate" clamp, which wants one conservative number rather than a shape —
 *  and Infinity is the honest answer now that the barrios are fenced as boxes:
 *  there is no x beyond which the map is closed. */
export function mvpWallX() {
  return Infinity;
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

/** How many times this crossing has been STARTED. Drives the condition
 *  rotation, so it counts attempts rather than clears — meeting the storm
 *  should not require beating the night first. */
export function crossingRuns(stageId) {
  return crossingRecord(stageId)?.runs || 0;
}

export function bumpCrossingRuns(stageId) {
  const p = state.progress;
  if (!p) return 0;
  if (!p.crossings || typeof p.crossings !== "object") p.crossings = {};
  const rec = p.crossings[stageId] || (p.crossings[stageId] = {});
  rec.runs = (rec.runs || 0) + 1;
  saveProgress();
  return rec.runs - 1;      // the index this run is sailed at
}

// Build the barrier list: the MVP wall applies in EVERY mode; the progression
// barriers (locked districts) only gate explore mode as before.
export function rebuildBarriers() {
  state.barriers = [];
  // The MVP gate applies in EVERY mode, as boxes around the closed barrios.
  for (const box of mvpBarrierBoxes()) state.barriers.push(box);
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
