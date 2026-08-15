// Semantic world-editor overlays that are intentionally independent from the
// generated tile painter. Ground/surface edits are baked by the builder; these
// are layered objects whose draw order matters (furniture, lights, roofs).
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { ctx } from "./gfx.js";
import { drawLight } from "./lights.js";

const pointInView = ([x, y], view, pad = 60) => (
  x >= view.x0 - pad && x <= view.x1 + pad && y >= view.y0 - pad && y <= view.y1 + pad
);
function pathFor(feature) {
  if (feature._editorPath) return feature._editorPath;
  const path = new Path2D();
  const points = feature.geometry.points;
  path.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) path.lineTo(points[i][0], points[i][1]);
  path.closePath();
  feature._editorPath = path;
  return path;
}
function drawGrandstand(feature) {
  const path = pathFor(feature), properties = feature.properties || {};
  ctx.fillStyle = feature.style?.color || "#171b18";
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  const points = feature.geometry.points;
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const rows = Math.max(1, Math.min(12, Number(properties.rows) || 3));
  ctx.strokeStyle = "rgba(235,235,225,.58)";
  ctx.lineWidth = 1;
  for (let row = 1; row < rows; row++) {
    const y = y0 + (y1 - y0) * row / rows;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,.65)"; ctx.lineWidth = 1.5; ctx.stroke(path);
}
function drawEntrance(feature) {
  const [x, y] = feature.geometry.point;
  const angle = (Number(feature.properties?.angle) || 0) * Math.PI / 180;
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.strokeStyle = feature.style?.color || "#f3c969"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-7, -6); ctx.lineTo(-7, 6); ctx.moveTo(7, -6); ctx.lineTo(7, 6); ctx.stroke();
  ctx.restore();
}
// The luminaire moved to `c2d/lights.js` + `src/assets/lights.json`: what a
// lamp IS is a registry now, so a fifth kind is a record instead of a fifth
// branch. Where it stands is still authored here, which was always the half
// that worked.
function drawRoof(feature) {
  const path = pathFor(feature);
  const properties = feature.properties || {};
  ctx.save();
  ctx.globalAlpha = state.weather === "night" ? 0.88 : 0.82;
  ctx.fillStyle = feature.style?.color || properties.roofColor || "#2f3737";
  ctx.fill(path);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = properties.driveUnder ? "#e8c765" : "rgba(15,20,20,.75)";
  ctx.lineWidth = properties.driveUnder ? 2 : 1.5;
  ctx.stroke(path);
  ctx.restore();
}

export function drawEditorWorld(view, phase) {
  const features = W.EDITOR_FEATURES || [];
  if (phase === "elements") {
    for (const feature of features) {
      if (feature.geometry?.kind === "polygon" && feature.type === "grandstand" && !feature.properties?.roof) {
        if (feature.geometry.points.some((point) => pointInView(point, view))) drawGrandstand(feature);
      } else if (feature.geometry?.kind === "point" && feature.type === "entrance" && pointInView(feature.geometry.point, view)) {
        drawEntrance(feature);
      }
    }
    for (const light of W.LIGHTS || []) if (pointInView(light.geometry.point, view, 260)) drawLight(light);
  } else if (phase === "roofs") {
    for (const roof of W.ROOFS || []) {
      if (roof.geometry.points.some((point) => pointInView(point, view, 120))) drawRoof(roof);
    }
  } else if (phase === "districts" && state.debug) {
    for (const district of W.DISTRICTS.filter((item) => item.editorPoly)) {
      const feature = { geometry: { points: district.editorPoly } };
      ctx.strokeStyle = district.tone; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
      ctx.stroke(pathFor(feature)); ctx.setLineDash([]);
    }
  }
}
