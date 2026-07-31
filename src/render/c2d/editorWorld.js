// Semantic world-editor overlays that are intentionally independent from the
// generated tile painter. Ground/surface edits are baked by the builder; these
// are layered objects whose draw order matters (furniture, lights, roofs).
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { ctx, roundRect } from "./gfx.js";

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
function lightPalette(type) {
  if (type === "led") return { core: "#dff7ff", glow: "rgba(155,225,255,.34)" };
  if (type === "stadium") return { core: "#fff", glow: "rgba(240,248,255,.42)" };
  if (type === "amber") return { core: "#ffbd5b", glow: "rgba(255,157,57,.34)" };
  return { core: "#fff0ad", glow: "rgba(255,224,125,.32)" };
}
function drawLight(feature) {
  const [x, y] = feature.geometry.point;
  const properties = feature.properties || {};
  const type = properties.lightType || (feature.type === "light" ? "stadium" : "warm");
  const palette = lightPalette(type);
  const intensity = Math.max(0, Math.min(4, Number(properties.lightIntensity) || 1));
  const radius = Math.max(10, Math.min(240, Number(properties.lightRadius) || (type === "stadium" ? 100 : 46)));
  ctx.strokeStyle = "#3f4648"; ctx.lineWidth = type === "stadium" ? 2.2 : 1.4;
  ctx.beginPath(); ctx.moveTo(x, y + 8); ctx.lineTo(x, y - (type === "stadium" ? 18 : 10)); ctx.stroke();
  ctx.fillStyle = palette.core;
  roundRect(ctx, x - (type === "stadium" ? 5 : 3), y - (type === "stadium" ? 21 : 13), type === "stadium" ? 10 : 6, 4, 1, true, false);
  if (state.weather === "night" && intensity > 0) {
    const glow = ctx.createRadialGradient(x, y - 10, 0, x, y - 10, radius);
    glow.addColorStop(0, palette.glow.replace(/[\d.]+\)$/, `${Math.min(.75, intensity * .24)})`));
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y - 10, radius, 0, Math.PI * 2); ctx.fill();
  }
}
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
