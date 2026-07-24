// Hand-drawn set pieces: buildings, the two muelles and the Mata de Limón
// suspension bridge. The painterly tile pass doesn't cover these.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { ctx, flatPath } from "./gfx.js";

// One building: drop shadow, body, roof band + windows (clipped), outline.
function paintBuilding(b) {
  const a = b.aabb, path = (b._path || (b._path = flatPath(b.pts, true)));
  const bw = a.x1 - a.x0, bh = a.y1 - a.y0;
  ctx.save(); ctx.translate(4, 4); ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fill(path); ctx.restore();
  ctx.fillStyle = b.color || "#caa089"; ctx.fill(path);
  ctx.save(); ctx.clip(path);
  ctx.fillStyle = b.roof || "#8a6a4a"; ctx.fillRect(a.x0, a.y0, bw, Math.max(3, bh * 0.3));
  if (b.wnd) {
    ctx.fillStyle = state.weather === "night" ? "rgba(255,220,140,0.7)" : "rgba(255,255,255,0.55)";
    const wn = Math.max(1, Math.floor(bw / 16));
    for (let i = 0; i < wn; i++) ctx.fillRect(a.x0 + 4 + i * (bw / wn), a.y0 + bh * 0.55, 4, 3);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1; ctx.stroke(path);
}

// Per-tile Ferrocarril rail pieces: ballast bed + ties + two steel rails.
// Decorative (not drivable), drawn on the ground over the roads.

// Muelle Nacional — long straight concrete pier running south into the gulf
function drawPier(view) {
  if (!W.PIER) return;
  const P = W.PIER;
  const hw = P.w / 2;
  if (P.x + hw + 40 < view.x0 || P.x - hw - 40 > view.x1) return;
  if (P.y1 + 10 < view.y0 || P.y0 - 20 > view.y1) return;
  const len = P.y1 - P.y0;
  // Shadow of the deck on the water (same offset trick as buildings)
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(P.x - hw + 3, P.y0 + 4, P.w, len);
  // Concrete deck
  ctx.fillStyle = "#cfcfc8";
  ctx.fillRect(P.x - hw, P.y0, P.w, len);
  // Plank seams across the deck
  ctx.strokeStyle = "rgba(0,0,0,0.1)"; ctx.lineWidth = 1;
  for (let yy = P.y0 + 14; yy < P.y1; yy += 14) {
    if (yy < view.y0 - 14 || yy > view.y1 + 14) continue;
    ctx.beginPath(); ctx.moveTo(P.x - hw + 1, yy); ctx.lineTo(P.x + hw - 1, yy); ctx.stroke();
  }
  // Darker cap at the sea end
  ctx.fillStyle = "#b8b8b0";
  ctx.fillRect(P.x - hw, P.y1 - 3, P.w, 3);
  // Blue side railings
  ctx.fillStyle = "#2f6fb8";
  ctx.fillRect(P.x - hw, P.y0, 2, len);
  ctx.fillRect(P.x + hw - 2, P.y0, 2, len);
  // Yellow center line dashes
  ctx.strokeStyle = "#f8d76b"; ctx.lineWidth = 2; ctx.setLineDash([12, 10]);
  ctx.beginPath(); ctx.moveTo(P.x, P.y0 + 6); ctx.lineTo(P.x, P.y1 - 6); ctx.stroke();
  ctx.setLineDash([]);
  // Lamp posts — alternating sides, warm dot on a tiny grey pole
  for (let yy = P.y0 + 24; yy < P.y1 - 8; yy += 46) {
    if (yy < view.y0 - 10 || yy > view.y1 + 10) continue;
    const side = (((yy / 46) | 0) % 2) ? 1 : -1;
    const lx = P.x + side * (hw - 3);
    ctx.fillStyle = "#8a8f96"; ctx.fillRect(lx - 0.75, yy - 6, 1.5, 6);
    ctx.fillStyle = state.weather === "night" ? "#ffd98a" : "#f4e6c0";
    ctx.beginPath(); ctx.arc(lx, yy - 7, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  // Guard hut at the shore entrance, offset to the west side of the deck
  const hx = P.x - hw - 18, hy = P.y0 - 2;
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(hx + 8, hy + 13, 11, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#f4f4ef"; ctx.fillRect(hx, hy, 14, 12);      // white body
  ctx.fillStyle = "#3f7fc4";                                     // blue hip roof
  ctx.beginPath();
  ctx.moveTo(hx - 3, hy); ctx.lineTo(hx + 3, hy - 6);
  ctx.lineTo(hx + 11, hy - 6); ctx.lineTo(hx + 17, hy);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(20,40,60,0.55)"; ctx.fillRect(hx + 5, hy + 4, 4, 8); // door
}

// The faro muelle: a warm wooden boardwalk jetty jutting into the gulf (any
// direction — drawn as a rotated deck along its segment P={x0,y0,x1,y1,w}),
// with the churchill kiosk at its sea end and the player spawn on it.
function drawFaroPier(view) {
  const P = W.FAROPIER;
  if (!P || P.x0 === undefined) return;
  const hw = P.w / 2;
  if (Math.max(P.x0, P.x1) + hw + 20 < view.x0 || Math.min(P.x0, P.x1) - hw - 20 > view.x1 ||
      Math.max(P.y0, P.y1) + hw + 20 < view.y0 || Math.min(P.y0, P.y1) - hw - 20 > view.y1) return;
  const len = Math.hypot(P.x1 - P.x0, P.y1 - P.y0), ang = Math.atan2(P.y1 - P.y0, P.x1 - P.x0);
  ctx.save();
  ctx.translate(P.x0, P.y0); ctx.rotate(ang);
  ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.fillRect(2, -hw + 4, len, P.w);      // deck shadow
  ctx.fillStyle = "#b98a4e"; ctx.fillRect(0, -hw, len, P.w);                    // warm timber deck
  ctx.strokeStyle = "rgba(60,40,20,0.35)"; ctx.lineWidth = 1;                   // plank seams
  for (let s = 12; s < len; s += 12) { ctx.beginPath(); ctx.moveTo(s, -hw + 1); ctx.lineTo(s, hw - 1); ctx.stroke(); }
  ctx.fillStyle = "#8a5f33"; ctx.fillRect(0, -hw, len, 2); ctx.fillRect(0, hw - 2, len, 2);   // rails
  ctx.fillStyle = "#6a451f";                                                    // posts
  for (let s = 10; s < len; s += 34) { ctx.fillRect(s, -hw - 1, 3, 3); ctx.fillRect(s, hw - 2, 3, 3); }
  ctx.restore();
}

// Suspension bridge — towers, cables, deck, rails
function drawBridge(view) {
  if (!W.BRIDGE) return;
  const B = W.BRIDGE;
  if (B.x1 < view.x0 || B.x0 > view.x1) return;
  // approach ramps
  ctx.fillStyle = "#7a6a55";
  ctx.fillRect(B.x0 - 32, B.cy - B.deckW/2 - 4, 32, B.deckW + 8);
  ctx.fillRect(B.x1, B.cy - B.deckW/2 - 4, 32, B.deckW + 8);
  // Deck base
  ctx.fillStyle = "#cfc3a3";
  ctx.fillRect(B.x0, B.cy - B.deckW/2 - 4, B.x1 - B.x0, B.deckW + 8);
  // Asphalt
  ctx.fillStyle = "#3a3540";
  ctx.fillRect(B.x0, B.cy - B.deckW/2 + 2, B.x1 - B.x0, B.deckW - 4);
  // Lane dashes
  ctx.strokeStyle = "#f8d76b"; ctx.lineWidth = 2; ctx.setLineDash([14, 14]);
  ctx.beginPath(); ctx.moveTo(B.x0 + 4, B.cy); ctx.lineTo(B.x1 - 4, B.cy); ctx.stroke();
  ctx.setLineDash([]);
  // Rails
  ctx.fillStyle = "#b4bcc4";
  ctx.fillRect(B.x0, B.cy - B.deckW/2 - 2, B.x1 - B.x0, 2);
  ctx.fillRect(B.x0, B.cy + B.deckW/2, B.x1 - B.x0, 2);
  // Cables (catenary)
  const [tx0, tx1] = B.towers;
  const towerTop = B.cy - B.towerH;
  const sagY = B.cy - 14;
  ctx.strokeStyle = "#e2e6ea"; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx0, towerTop);
  ctx.quadraticCurveTo((tx0 + tx1) / 2, sagY, tx1, towerTop);
  ctx.stroke();
  // Side anchor cables
  ctx.beginPath();
  ctx.moveTo(B.x0 - 28, B.cy + 4); ctx.lineTo(tx0, towerTop);
  ctx.moveTo(B.x1 + 28, B.cy + 4); ctx.lineTo(tx1, towerTop);
  ctx.stroke();
  // Vertical hangers
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(228,233,238,0.9)";
  for (let xx = tx0 + 6; xx < tx1; xx += 6) {
    const t = (xx - tx0) / (tx1 - tx0);
    const ty = (1-t)*(1-t)*towerTop + 2*t*(1-t)*sagY + t*t*towerTop;
    ctx.beginPath(); ctx.moveTo(xx, ty); ctx.lineTo(xx, B.cy - 4); ctx.stroke();
  }
  // Towers — slender silver lattice legs with X cross-bracing
  for (const tx of B.towers) {
    ctx.fillStyle = "#aeb6c0";
    ctx.fillRect(tx - 4, towerTop, 3, B.towerH + 4);
    ctx.fillRect(tx + 1, towerTop, 3, B.towerH + 4);
    ctx.fillStyle = "#7d8791";
    ctx.fillRect(tx - 6, towerTop - 4, 12, 4);
    // lattice X braces between the legs, 4 panels up the height
    ctx.strokeStyle = "#7d8791"; ctx.lineWidth = 1;
    const seg = (B.towerH + 4) / 4;
    for (let i = 0; i < 4; i++) {
      const yA = towerTop + i * seg, yB = yA + seg;
      ctx.beginPath();
      ctx.moveTo(tx - 2.5, yA); ctx.lineTo(tx + 2.5, yB);
      ctx.moveTo(tx + 2.5, yA); ctx.lineTo(tx - 2.5, yB);
      ctx.stroke();
    }
  }
  // Sign
  ctx.font = "bold 9px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
  const lbl = "PUENTE MATA LIMÓN";
  const wlbl = ctx.measureText(lbl).width + 10;
  const mx = (B.x0 + B.x1) / 2;
  ctx.fillStyle = "rgba(20,16,40,0.78)"; ctx.fillRect(mx - wlbl/2, B.cy + B.deckW/2 + 14, wlbl, 12);
  ctx.fillStyle = "#fff"; ctx.fillText(lbl, mx, B.cy + B.deckW/2 + 23);
}

export { drawBridge, drawFaroPier, drawPier, paintBuilding };
