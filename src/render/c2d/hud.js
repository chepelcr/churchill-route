// Screen-space overlays: the objective compass, minimap, rain, night vignette
// and the debug coordinate grid + real-world POI names.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { nearestKiosk } from "../../game/delivery.js";
import { roadPath } from "./cache.js";
import { CUAD, aabbInView, ctx, label } from "./gfx.js";

// Every named real place OSM knows about (1160 of them), drawn ONLY under the
// debug toggle: at play zoom they'd be a wall of text, but flying over the map
// with them on is how you check a business is where it really is in Puntarenas.
// Colour by category so the kind of place reads at a glance.
const POI_TONE = {
  amenity: "#e8a33d", shop: "#5fb0d6", tourism: "#e85d75", leisure: "#4f9d5b",
  office: "#9b8cd6", healthcare: "#4fc7b8", craft: "#c9a227", historic: "#b0895f",
};
function drawPoiNames(view, zoom) {
  const pois = W.POIS;
  if (!pois || !pois.length) return;
  ctx.font = `${Math.round(80 / zoom) / 10}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  const pad = 40;
  for (const p of pois) {
    if (p.x < view.x0 - pad || p.x > view.x1 + pad || p.y < view.y0 - pad || p.y > view.y1 + pad) continue;
    const tone = POI_TONE[p.cat.split("=")[0]] || "#fff";
    ctx.fillStyle = tone;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3 / zoom, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(10,8,20,0.72)";
    const w = ctx.measureText(p.name).width + 6 / zoom;
    ctx.fillRect(p.x - w / 2, p.y - 15 / zoom, w, 11 / zoom);
    ctx.fillStyle = tone;
    ctx.fillText(p.name, p.x, p.y - 7 / zoom);
  }
}

// Debug coordinate grid (world space). Minor lines every cuadrícula, bold
// labelled lines every 10 — so you can read off world (x,y) anywhere.
function drawDebugGrid(view, zoom) {
  const minor = CUAD, major = CUAD * 10;
  const x0 = Math.floor(view.x0 / minor) * minor, x1 = Math.ceil(view.x1 / minor) * minor;
  const y0 = Math.floor(view.y0 / minor) * minor, y1 = Math.ceil(view.y1 / minor) * minor;
  ctx.lineWidth = 1 / zoom;
  // minor grid
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.beginPath();
  for (let x = x0; x <= x1; x += minor) { ctx.moveTo(x, view.y0); ctx.lineTo(x, view.y1); }
  for (let y = y0; y <= y1; y += minor) { ctx.moveTo(view.x0, y); ctx.lineTo(view.x1, y); }
  ctx.stroke();
  // major grid
  ctx.strokeStyle = "rgba(120,220,255,0.28)";
  ctx.beginPath();
  for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) { ctx.moveTo(x, view.y0); ctx.lineTo(x, view.y1); }
  for (let y = Math.ceil(y0 / major) * major; y <= y1; y += major) { ctx.moveTo(view.x0, y); ctx.lineTo(view.x1, y); }
  ctx.stroke();
  // labels at major intersections
  ctx.fillStyle = "rgba(150,230,255,0.9)";
  ctx.font = `${Math.round(9 / zoom * 10) / 10}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "left";
  for (let x = Math.ceil(x0 / major) * major; x <= x1; x += major) {
    for (let y = Math.ceil(y0 / major) * major; y <= y1; y += major) {
      ctx.fillText(`${x},${y}`, x + 2 / zoom, y - 2 / zoom);
    }
  }
}

// Objective compass: pinned at the top-center of the SCREEN (never lost
// off-view), rotating to point at the target. Screen angle = world angle
// (the camera transform is uniform scale + translate).
function drawCompass(vw, vh) {
  const p = state.p;
  const target = state.carrying ? state.carrying.customer : nearestKiosk(p).lm;
  if (!target) return;
  const dx = target.x - p.x, dy = target.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d < 40) return;
  const a = Math.atan2(dy, dx);
  const cx = vw / 2, cy = 92;
  ctx.save();
  ctx.fillStyle = "rgba(20,16,40,0.78)";
  ctx.beginPath(); ctx.arc(cx, cy, 24, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1; ctx.stroke();
  ctx.translate(cx, cy); ctx.rotate(a);
  ctx.fillStyle = state.carrying ? "#ff3d80" : "#ffe06b";
  ctx.beginPath();
  ctx.moveTo(17, 0); ctx.lineTo(-9, -11); ctx.lineTo(-4, 0); ctx.lineTo(-9, 11);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
  const meters = Math.round(d / ((W.META && W.META.pxPerMeter) || 1.3));
  ctx.font = "bold 11px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(20,16,40,0.78)";
  const label = `${meters} m`;
  const lw = ctx.measureText(label).width + 10;
  ctx.fillRect(cx - lw / 2, cy + 28, lw, 15);
  ctx.fillStyle = state.carrying ? "#ff3d80" : "#ffe06b";
  ctx.fillText(label, cx, cy + 39);
}

function drawRain(vw, vh, t) {
  ctx.strokeStyle = "rgba(180,210,240,0.5)"; ctx.lineWidth = 1;
  for (let i = 0; i < 240; i++) {
    const x = (i * 73 + t * 0.4) % vw, y = (i * 137 + t * 0.9) % vh;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 10); ctx.stroke();
  }
}
function drawNightVignette(vw, vh) {
  const g = ctx.createRadialGradient(vw/2, vh/2, vh*0.15, vw/2, vh/2, vh*0.8);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,10,0.6)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh);
}

// NFS-style minimap: a circular NORTH-UP dial of the streets around the
// car (resident tile road polylines), the player as a heading arrow in the
// center, and the delivery target as a red blip (clamped to the rim when
// it's beyond the dial's range).
function drawMinimap(vw, vh, t) {
  const R = 76;                          // dial radius on screen (px)
  const cx = vw - R - 18, cy = R + 18;
  const RANGE = 460;                     // world px from car to dial edge
  const s = R / RANGE;
  const p = state.p;

  // dial background + clip
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(12,14,26,0.82)";
  ctx.fill();
  ctx.clip();

  // world → dial transform (north up, car at center)
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-p.x, -p.y);

  const M = RANGE * 1.05;
  const mv = { x0: p.x - M, x1: p.x + M, y0: p.y - M, y1: p.y + M };
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  const vts = W.visibleTiles(mv.x0, mv.y0, mv.x1, mv.y1);
  for (const tile of vts) {
    for (const r of tile.roads) {
      if (!aabbInView(r.aabb, mv, r.w)) continue;
      ctx.strokeStyle = r.cls === "paseo" ? "#c9a95e"
        : (r.cls === "trunk" || r.cls === "primary" || r.cls === "secondary") ? "#aeb3c8"
        : "#7e8298";
      ctx.lineWidth = Math.max(r.w, 30);  // readable street ribbons at map scale
      ctx.stroke(roadPath(r));
    }
  }
  ctx.restore();

  // target blip in screen space (north-up: plain scaled offset)
  const tgt = state.carrying ? state.carrying.customer : nearestKiosk(p).lm;
  if (tgt) {
    let mx = (tgt.x - p.x) * s;
    let my = (tgt.y - p.y) * s;
    const d = Math.hypot(mx, my), lim = R - 9;
    if (d > lim) { mx *= lim / d; my *= lim / d; }   // pin to the rim when far
    const pulse = 3.4 + Math.sin(t * 0.006) * 1.1;
    ctx.fillStyle = state.carrying ? "#ff2d2d" : "#ff5050"; // NPC / target = red
    ctx.beginPath(); ctx.arc(cx + mx, cy + my, pulse, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(cx + mx, cy + my, pulse, 0, Math.PI * 2); ctx.stroke();
  }

  // the car: gold arrow in the center, rotated to the travel heading
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.a + Math.PI / 2); // arrow art points up = -y
  ctx.fillStyle = "#ffe06b";
  ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();

  // rim
  ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
}

export { drawCompass, drawDebugGrid, drawMinimap, drawNightVignette, drawPoiNames, drawRain };
