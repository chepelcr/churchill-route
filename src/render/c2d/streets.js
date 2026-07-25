// Street layer: the multi-pass road painter (acera → casing → asphalt → lane
// dashes), per-tile rails/medians, street name pills and the lock barriers.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { t } from "../../i18n/index.js";
import { dashPath, roadPath } from "./cache.js";
import { ACERA_PX, aabbInView, ctx, flatAABB, flatPath, label } from "./gfx.js";

// Estadios are NOT a structure drawn over the ground — they are a COLOUR
// CHOICE inside the acera pass. The build traces each one from the real cuadra
// (S.footprint, organic, following the manzana's true grid angles), and here
// that polygon is simply painted as grass with its pitch markings instead of
// the usual concrete. Drawn between the acera band and the casing/asphalt, so
// (a) it covers the sidewalk band the road pass just laid over the block —
// which is what lets Las Playitas read as ONE green field edge to edge — while
// the asphalt pass repaints anything that reached the roadway, and (b) street
// name pills, buildings and flora still land on top, instead of being buried
// the way they were when the stadium was a later layer.
// Centre, tilt and half-extents of a pitch, from the principal axis of its own
// polygon — so the markings follow the manzana's angle instead of the screen's.
function pitchFrame(S) {
  if (S._frame) return S._frame;
  const f = S.footprint;
  let mx = 0, my = 0, n = 0;
  for (let i = 0; i < f.length; i += 2) { mx += f[i]; my += f[i + 1]; n++; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < f.length; i += 2) {
    const dx = f[i] - mx, dy = f[i + 1] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  let ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let hw = 0, hh = 0;
  for (let i = 0; i < f.length; i += 2) {
    const dx = f[i] - mx, dy = f[i + 1] - my;
    hw = Math.max(hw, Math.abs(dx * ca + dy * sa));
    hh = Math.max(hh, Math.abs(-dx * sa + dy * ca));
  }
  if (hh > hw) { ang += Math.PI / 2; const t = hw; hw = hh; hh = t; }  // long axis = the pitch's length
  return (S._frame = { cx: mx, cy: my, ang, hw, hh });
}

function paintStadiumCuadras(view) {
  const arr = W.STADIUMS;
  if (!arr || !arr.length) return;
  for (const S of arr) {
    if (S.x1 + 40 < view.x0 || S.x0 - 40 > view.x1 || S.y1 + 40 < view.y0 || S.y0 - 40 > view.y1) continue;
    if (!S.footprint) continue;
    const pitch = S._pitch || (S._pitch = flatPath(S.footprint, true));
    const P = pitchFrame(S);                               // centre + tilt + extents
    // 4 px of grass dilation first: the traced pitch steps in 4 px raster
    // increments, so its edge and the acera band don't meet exactly and a hair
    // of bare ground shows through at the seam.
    ctx.strokeStyle = "#4f9d5b"; ctx.lineWidth = 8; ctx.lineJoin = "round"; ctx.stroke(pitch);
    ctx.save();
    ctx.clip(pitch);
    ctx.fillStyle = "#4f9d5b"; ctx.fill(pitch);            // grass
    // Everything below is drawn in the PITCH's OWN frame, not screen axes: Las
    // Playitas sits on the diagonal street grid, and axis-aligned mow stripes
    // with a square white box on a tilted field read as a mistake.
    ctx.translate(P.cx, P.cy); ctx.rotate(P.ang);
    const hw = P.hw, hh = P.hh;
    ctx.fillStyle = "rgba(30,88,50,0.16)";                 // mow stripes, along the pitch
    for (let sy = -hh; sy < hh; sy += 14) ctx.fillRect(-hw, sy, hw * 2, 7);
    // Fútbol markings, at a level of detail the pitch can carry. A real
    // penalty area shares the goal line with the touchline, so on a SMALL
    // pitch its stroke lands right on top of the touchline (and the goal box
    // on top of that) and the whole end reads as doubled lines. Lito Pérez is
    // 116 px across — below the threshold it gets the clean set it had before:
    // touchline, halfway line, centre circle. La Plaza is nearly twice that
    // and has the room for the full markings.
    const m = Math.max(6, Math.min(hw, hh) * 0.10);        // touchline inset
    ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 2;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.strokeRect(-hw + m, -hh + m, (hw - m) * 2, (hh - m) * 2);
    ctx.beginPath(); ctx.moveTo(0, -hh + m); ctx.lineTo(0, hh - m); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, Math.min(hw, hh) * 0.26, 0, Math.PI * 2); ctx.stroke();
    if (hw >= 80 && hh >= 55) {
      ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, Math.PI * 2); ctx.fill();        // centre spot
      const bw = Math.min(hw * 0.28, hh * 0.9);            // penalty area depth
      const bh = Math.max(12, Math.min(hh - m - 4, hh * 0.60));
      for (const sd of [-1, 1]) {
        const x0 = sd < 0 ? -hw + m : hw - m - bw;
        ctx.strokeRect(x0, -bh, bw, bh * 2);                                   // penalty area
        const gx = sd < 0 ? -hw + m : hw - m - bw * 0.38;
        ctx.strokeRect(gx, -bh * 0.45, bw * 0.38, bh * 0.9);                   // goal box
        ctx.beginPath(); ctx.arc(sd * (hw - m - bw * 0.72), 0, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(232,226,210,0.68)"; ctx.lineWidth = 2; ctx.stroke(pitch); // curb
  }
}

// Parcel ground. Same reasoning as the estadios: a parcel is a colour choice
// on ground that already exists, painted between the acera band and the
// asphalt — so the asphalt repaints anything that reached the roadway, and
// street pills, buildings and flora still land on top.
const PARCEL_FILL = { plaza: "#4f9d5b", stadium: "#4f9d5b", garden: "#5ba362",
                      church: "#cfc7b4", lot: "#b9b2a0" };
function paintParcels(view) {
  const arr = W.PARCELS;
  if (!arr || !arr.length) return;
  for (const P of arr) {
    if (P.x1 + 40 < view.x0 || P.x0 - 40 > view.x1 || P.y1 + 40 < view.y0 || P.y0 - 40 > view.y1) continue;
    // `whole` = a full cuadra already painted by paintStadiumCuadras; `built` =
    // the footprint IS a building. Either way the ground is not ours to paint,
    // only the sponsor slot on top of it.
    if (P.whole || P.built) continue;
    const path = P._path || (P._path = flatPath(P.poly, true));
    ctx.fillStyle = PARCEL_FILL[P.use] || "#b9b2a0";
    ctx.lineWidth = 8; ctx.lineJoin = "round";
    ctx.strokeStyle = ctx.fillStyle; ctx.stroke(path);   // hide the 4px raster steps
    ctx.fill(path);
    if (P.use === "plaza" || P.use === "stadium") {
      ctx.save(); ctx.clip(path);
      ctx.fillStyle = "rgba(30,88,50,0.16)";
      for (let sy = P.y0; sy < P.y1; sy += 14) ctx.fillRect(P.x0, sy, P.x1 - P.x0, 7);
      ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
      const m = Math.max(5, Math.min(P.x1 - P.x0, P.y1 - P.y0) * 0.12);
      ctx.strokeRect(P.x0 + m, P.y0 + m, P.x1 - P.x0 - 2 * m, P.y1 - P.y0 - 2 * m);
      ctx.beginPath();
      ctx.arc((P.x0 + P.x1) / 2, (P.y0 + P.y1) / 2, Math.min(P.x1 - P.x0, P.y1 - P.y0) * 0.18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(232,226,210,0.68)"; ctx.lineWidth = 2; ctx.stroke(path); // curb
  }
}

// Multi-pass road styling (acera band → casing → asphalt → lane dashes),
// ported from the corridor renderer but fed per-tile road segments.
function paintRoads(roads, view) {
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // elevated (barro/Ferrocarril) drop-shadow
  ctx.strokeStyle = "rgba(0,0,0,0.30)";
  for (const r of roads) { if (!r.elev) continue; ctx.save(); ctx.translate(0, 3.5); ctx.lineWidth = r.w + 2 * ACERA_PX + 3; ctx.stroke(roadPath(r)); ctx.restore(); }
  // acera concrete band
  ctx.strokeStyle = "#cec7b2";
  for (const r of roads) { if (r.bridge || r.cls === "bridge") continue; ctx.lineWidth = r.w + 2 * ACERA_PX; ctx.stroke(roadPath(r)); }
  // acera corner fillets: acera-coloured joint discs at each piece endpoint,
  // so perpendicular sidewalks meet ROUNDED at junctions instead of a hard
  // angle (casing + asphalt paint over the disc centres below, leaving only
  // the outer acera fillet visible).
  ctx.fillStyle = "#cec7b2";
  for (const r of roads) {
    if (r.bridge || r.cls === "bridge") continue;
    const p = r.pts, n = p.length, rad = r.w / 2 + ACERA_PX;
    ctx.beginPath();
    ctx.moveTo(p[0] + rad, p[1]); ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
    ctx.moveTo(p[n - 2] + rad, p[n - 1]); ctx.arc(p[n - 2], p[n - 1], rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // estadios: the same sidewalk, repainted grey (after the fillets so the
  // junction discs can't overwrite it, before the asphalt so the asphalt wins)
  paintStadiumCuadras(view);
  paintParcels(view);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // barro shoulder
  ctx.strokeStyle = "#7d6242";
  for (const r of roads) { if (!r.barro) continue; ctx.lineWidth = r.w + 2 * ACERA_PX; ctx.stroke(roadPath(r)); }
  // bridge deck
  ctx.strokeStyle = "#cfc3a3";
  for (const r of roads) { if (!r.bridge) continue; ctx.lineWidth = r.w + 10; ctx.stroke(roadPath(r)); }
  // Casing + asphalt use BUTT caps: round caps bulge a half-circle past
  // each piece's endpoint, smearing dark arcs onto the sidewalks at every
  // junction ("little curves in the aceras"). Joins stay round for curves.
  ctx.lineCap = "butt";
  // casing
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  for (const r of roads) { ctx.lineWidth = r.w + 4; ctx.stroke(roadPath(r)); }
  // asphalt / barro / paseo surface + SAME-COLOR joint discs at both piece
  // ends: they invisibly weld chained pieces (keeps the León Cortés →
  // Turistas curve smooth) and unify junction mouths, without the visible
  // "mini circles" a contrasting eraser disc would leave.
  for (const r of roads) {
    const col = r.barro ? "#9c7a4f" : r.cls === "paseo" ? "#f4dca3" : "#3a3540";
    ctx.strokeStyle = col; ctx.lineWidth = r.w; ctx.stroke(roadPath(r));
    const p = r.pts, n = p.length, rad = r.w / 2 - 0.4;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(p[0] + rad, p[1]); ctx.arc(p[0], p[1], rad, 0, Math.PI * 2);
    ctx.moveTo(p[n - 2] + rad, p[n - 1]); ctx.arc(p[n - 2], p[n - 1], rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // lane markings: yellow dashes on arterials, faint white on locals —
  // drawn on the TRIMMED path so they stop short of the junctions
  for (const r of roads) {
    if (r.barro) continue;
    const cls = r.cls;
    if (cls === "trunk" || cls === "trunk_link" || cls === "primary" || cls === "primary_link") { ctx.strokeStyle = "#f8d76b"; ctx.lineWidth = 2; ctx.setLineDash([18, 18]); }
    else if (cls === "secondary" || cls === "tertiary" || cls === "tertiary_link" || cls === "residential" || cls === "unclassified") { ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([6, 10]); }
    else continue;
    const dp = dashPath(r);
    if (dp) ctx.stroke(dp);
    ctx.setLineDash([]);
  }
  ctx.lineCap = "butt";
}

// Per-tile Ferrocarril rail pieces: ballast bed + ties + two steel rails.
// Decorative (not drivable), drawn on the ground over the roads.
function paintTileRails(rails, view) {
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  for (const rl of rails) {
    if (!rl.aabb) rl.aabb = flatAABB(rl.pts);
    if (!aabbInView(rl.aabb, view, 12)) continue;
    const p = rl.pts;
    // ballast bed
    ctx.strokeStyle = "rgba(120,104,84,0.5)"; ctx.lineWidth = 9;
    ctx.stroke(rl._path || (rl._path = flatPath(p, false)));
    // ties
    ctx.strokeStyle = "#5a4a38"; ctx.lineWidth = 1.6;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const x0 = p[i], y0 = p[i + 1], dx = p[i + 2] - x0, dy = p[i + 3] - y0;
      const len = Math.hypot(dx, dy); if (len < 0.001) continue;
      const nx = -dy / len, ny = dx / len;
      for (let s = 0; s < len; s += 7) {
        const t = s / len, cx = x0 + dx * t, cy = y0 + dy * t;
        if (cx < view.x0 - 8 || cx > view.x1 + 8 || cy < view.y0 - 8 || cy > view.y1 + 8) continue;
        ctx.beginPath();
        ctx.moveTo(cx - nx * 5, cy - ny * 5); ctx.lineTo(cx + nx * 5, cy + ny * 5); ctx.stroke();
      }
    }
    // two steel rails, offset either side of the centerline
    ctx.strokeStyle = "#9aa0a6"; ctx.lineWidth = 1.4;
    for (const sgn of [-3.2, 3.2]) {
      ctx.beginPath();
      for (let i = 0; i < p.length; i += 2) {
        const ii = i + 2 < p.length ? i : (i >= 2 ? i - 2 : i);
        const dx = (p[ii + 2] ?? p[ii]) - p[ii], dy = (p[ii + 3] ?? p[ii + 1]) - p[ii + 1];
        const len = Math.hypot(dx, dy) || 1, nx = -dy / len * sgn, ny = dx / len * sgn;
        if (i === 0) ctx.moveTo(p[i] + nx, p[i + 1] + ny); else ctx.lineTo(p[i] + nx, p[i + 1] + ny);
      }
      ctx.stroke();
    }
  }
  ctx.lineCap = "butt";
}

// Per-tile paseo/León Cortés separator strips: the planted green ground the
// palms/almendros stand on, with a darker soil/curb edge.
function paintTileMedians(medians, view) {
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.strokeStyle = "#4f6f34"; // soil / curb edge
  for (const m of medians) {
    if (!m.aabb) m.aabb = flatAABB(m.pts);
    if (!aabbInView(m.aabb, view, m.w + 6)) continue;
    ctx.lineWidth = m.w + 3;
    ctx.stroke(m._path || (m._path = flatPath(m.pts, false)));
  }
  ctx.strokeStyle = "#79b45c"; // planted grass
  for (const m of medians) {
    if (!aabbInView(m.aabb, view, m.w + 6)) continue;
    ctx.lineWidth = m.w; ctx.stroke(m._path);
  }
  ctx.lineCap = "butt";
}

// Interpolated point + tangent at arclength s along a prepped world-2d road.
function road2dPointAt(r, s) {
  const pts = r.pts, cum = r.cum;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const s0 = cum[i - 1], seg = (cum[i] - s0) || 1;
  const tt = Math.max(0, Math.min(1, (s - s0) / seg));
  const x0 = pts[(i - 1) * 2], y0 = pts[(i - 1) * 2 + 1];
  const x1 = pts[i * 2], y1 = pts[i * 2 + 1];
  return { x: x0 + (x1 - x0) * tt, y: y0 + (y1 - y0) * tt, ang: Math.atan2(y1 - y0, x1 - x0) };
}
// Street names: a small pill every ~900px of arclength on named roads (the
// main-branch feature). Deduped by name+coarse-cell so tile-duplicated road
// copies don't stack labels.
function drawStreetLabels2D(roads, view) {
  ctx.font = "bold 9px 'JetBrains Mono', monospace";
  ctx.textAlign = "center";
  const seen = new Set();
  for (const r of roads) {
    const lbl = r.name || r.ref;
    if (!lbl || r.len < 200 || r.cls === "pedestrian") continue;
    for (let s = 220; s < r.len; s += 900) {
      const pt = road2dPointAt(r, s);
      if (pt.x < view.x0 - 40 || pt.x > view.x1 + 40 || pt.y < view.y0 - 20 || pt.y > view.y1 + 20) continue;
      const key = lbl + "|" + ((pt.x / 120) | 0) + "|" + ((pt.y / 120) | 0);
      if (seen.has(key)) continue;
      seen.add(key);
      label(pt.x, pt.y + 2, lbl, "#fff", "rgba(20,16,40,0.78)");
    }
  }
}

// Lock barriers: the MVP wall (every mode) + explore progression barriers
function drawBarriers(view) {
  if (!state.barriers || !state.barriers.length) return;
  for (const br of state.barriers) {
    if (br.x < view.x0 - 30 || br.x > view.x1 + 30) continue;
    // vertical wall spanning the visible height (the 2-D world has no corridor
    // topY/botY; the peninsula runs west->east so an x-wall gates progression)
    const yTop = view.y0, yBot = view.y1;
    // striped barrier sign + cones
    const segH = 12;
    for (let y = yTop + 6; y < yBot - 6; y += segH) {
      ctx.fillStyle = ((y / segH) | 0) % 2 ? "#f3c969" : "#3a3540";
      ctx.fillRect(br.x - 4, y, 8, segH);
    }
    // sign — names the zone it gates + the level that opens it
    const dstr = W.DISTRICTS.find(d => d.id === br.district);
    const dname = dstr ? dstr.name : br.district.toUpperCase();
    ctx.fillStyle = "rgba(20,16,40,0.88)";
    const sw = 138, sh = 40;
    const sy = (yTop + yBot) / 2;
    ctx.fillRect(br.x - sw/2, sy - sh/2, sw, sh);
    // tone accent bar keyed to the district color
    ctx.fillStyle = dstr ? dstr.tone : "#f3c969";
    ctx.fillRect(br.x - sw/2, sy - sh/2, sw, 4);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff3d80"; ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.fillText(t("sign.blocked"), br.x, sy - 6);
    ctx.fillStyle = "#fff"; ctx.font = "bold 8px 'JetBrains Mono', monospace";
    ctx.fillText(dname.slice(0, 20), br.x, sy + 5);
    ctx.fillStyle = dstr ? dstr.tone : "#f3c969"; ctx.font = "bold 8px 'JetBrains Mono', monospace";
    ctx.fillText(br.mvp ? t("sign.soon") : t("sign.level", { n: br.requiredStage || "—" }), br.x, sy + 15);
    // cones
    for (let cy = yTop + 14; cy < yBot - 14; cy += 26) {
      ctx.fillStyle = "#ff8b3d"; ctx.beginPath();
      ctx.moveTo(br.x - 16, cy + 6); ctx.lineTo(br.x - 13, cy - 6); ctx.lineTo(br.x - 10, cy + 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillRect(br.x - 15, cy - 2, 4, 1.5);
      ctx.fillStyle = "#ff8b3d"; ctx.beginPath();
      ctx.moveTo(br.x + 10, cy + 6); ctx.lineTo(br.x + 13, cy - 6); ctx.lineTo(br.x + 16, cy + 6); ctx.closePath(); ctx.fill();
    }
  }
}

export { drawBarriers, paintParcels, drawStreetLabels2D, paintRoads, paintTileMedians, paintTileRails, road2dPointAt };
