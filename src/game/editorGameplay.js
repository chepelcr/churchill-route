// Runtime bridge for semantic world-editor triggers. The editor owns geometry
// and action data; this module keeps the simulation response small and explicit.
import { WORLD2D as W } from "../world2d/index.js";
import { state, pushFloat } from "./state.js";

const active = new Set();
const fired = new Set();

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

function runAction(feature) {
  const properties = feature.properties || {};
  const action = properties.triggerAction || "checkpoint";
  const value = properties.actionValue;
  if (action === "weather" && value) {
    state.weather = value;
  } else if (action === "score") {
    const amount = Number(value) || 100;
    state.score += amount;
    pushFloat(state.p.x, state.p.y - 18, `+${amount}`, "#f4d77a");
  } else if (action === "teleport") {
    const targetId = properties.targetId || value;
    const spawn = W.EDITOR_FEATURES.find((item) => (
      item.id === targetId && ["spawn", "player"].includes(item.type)
      && item.geometry?.kind === "point"
    ));
    if (spawn) {
      state.p.x = spawn.geometry.point[0];
      state.p.y = spawn.geometry.point[1];
      state.p.vx = 0; state.p.vy = 0; state.p.speed = 0;
    }
  } else if (action === "message") {
    state.districtToast = {
      id: feature.id,
      name: String(value || feature.name || "Trigger"),
      tone: feature.style?.color || "#f4d77a",
      t: 0,
    };
  } else {
    state.checkpoint = { x: state.p.x, y: state.p.y, id: feature.id };
  }
}

export function resetEditorTriggers() {
  active.clear();
  fired.clear();
}

export function updateEditorTriggers() {
  for (const feature of W.EDITOR_FEATURES) {
    if (feature.type !== "trigger" || feature.geometry?.kind !== "polygon") continue;
    const isInside = insidePolygon(state.p.x, state.p.y, feature.geometry.points);
    const wasInside = active.has(feature.id);
    if (isInside) active.add(feature.id);
    else active.delete(feature.id);
    if (!isInside || wasInside) continue;
    if (feature.properties?.oneShot !== false && fired.has(feature.id)) continue;
    fired.add(feature.id);
    runAction(feature);
  }
}
