// Palms (coast) and almendros (medians): the two scatter sprites.
import { ctx } from "./gfx.js";

function paintPalm(pa, t) {
  const sway = Math.sin(t * 0.001 + (pa.sway || 0)) * 2, s = pa.s || 1;
  ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(pa.x + 6, pa.y + 5, 12 * s, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#7a4f2a"; ctx.lineWidth = 3 * s; ctx.beginPath(); ctx.moveTo(pa.x, pa.y + 4); ctx.lineTo(pa.x + sway, pa.y - 16 * s); ctx.stroke();
  ctx.fillStyle = "#3aa45b";
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + sway * 0.06; const fx = pa.x + sway + Math.cos(a) * 11 * s, fy = pa.y - 16 * s + Math.sin(a) * 5 * s; ctx.beginPath(); ctx.ellipse(fx, fy, 9 * s, 3.2 * s, a, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#2e7d44"; ctx.beginPath(); ctx.arc(pa.x + sway, pa.y - 16 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
}
function paintTree(tr) {
  const s = tr.s || 1;
  ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(tr.x + 5, tr.y + 4, 11 * s, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#6a4426"; ctx.lineWidth = 2.5 * s; ctx.beginPath(); ctx.moveTo(tr.x, tr.y + 3); ctx.lineTo(tr.x, tr.y - 7 * s); ctx.stroke();
  ctx.fillStyle = "#2e7d44"; ctx.beginPath(); ctx.arc(tr.x, tr.y - 11 * s, 9.5 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3aa45b"; ctx.beginPath(); ctx.arc(tr.x - 3 * s, tr.y - 13 * s, 6.5 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#57c078"; ctx.beginPath(); ctx.arc(tr.x + 3.5 * s, tr.y - 12 * s, 4.5 * s, 0, Math.PI * 2); ctx.fill();
}

export { paintPalm, paintTree };
