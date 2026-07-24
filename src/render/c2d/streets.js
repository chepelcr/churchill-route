// Street layer: the multi-pass road painter (acera → casing → asphalt → lane
// dashes), per-tile rails/medians, street name pills and the lock barriers.
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { t } from "../../i18n/index.js";
import { dashPath, roadPath } from "./cache.js";
import { ACERA_PX, aabbInView, ctx, flatAABB, flatPath, label } from "./gfx.js";

// Estadios are NOT a structure drawn over the ground — they are a COLOUR
// CHOICE inside the acera pass. The build traces each one as two organic
// polygons from the real cuadra (outline = block + sidewalk, footprint = that
// eroded by the acera depth = the pitch), so the 20 px ring between them is
// literally the block's sidewalk: here it is simply repainted grey, in two
// tiers, instead of the usual concrete. Drawn between the acera band and the
// casing/asphalt, so (a) the asphalt pass paints over anything that reaches
// the roadway and (b) street name pills, buildings and flora still land on
// top — the stadium can never bury them the way a later layer did.
function paintStadiumCuadras(view) {
  const arr = W.STADIUMS;
  if (!arr || !arr.length) return;
  for (const S of arr) {
    if (S.x1 + 40 < view.x0 || S.x0 - 40 > view.x1 || S.y1 + 40 < view.y0 || S.y0 - 40 > view.y1) continue;
    if (!S.footprint || !S.outline) continue;
    const pitch = S._pitch || (S._pitch = flatPath(S.footprint, true));
    if (S.stands !== false) {
      // The ring ONLY: outline and pitch as two subpaths of one even-odd clip,
      // so nothing here can touch the grass (which stays the ground-layer green
      // poly — no second grass draw) or the roadway outside the block.
      let ring = S._ring;
      if (!ring) {
        ring = S._ring = new Path2D();
        ring.addPath(flatPath(S.outline, true));
        ring.addPath(pitch);
      }
      ctx.save();
      ctx.clip(ring, "evenodd");
      ctx.fillStyle = "#a8a190"; ctx.fill(ring, "evenodd");   // upper tier (outer 10 px)
      // bevel, not round: a 20 px round join arcs over the cuadra's real
      // corners and the ring reads as a smooth bowl, not the sidewalk it is
      ctx.lineJoin = "bevel"; ctx.lineCap = "butt";
      ctx.strokeStyle = "#cec7b2"; ctx.lineWidth = ACERA_PX;  // lower tier, acera grey
      ctx.stroke(pitch);                                      // its inward half is clipped away
      ctx.restore();
    }
    ctx.save();
    ctx.clip(pitch);
    const w = S.x1 - S.x0, h = S.y1 - S.y0;
    const cx = (S.x0 + S.x1) / 2, cy = (S.y0 + S.y1) / 2;
    if (S.stands === false) {                              // mow stripes on the plain pitch
      ctx.fillStyle = "rgba(30,88,50,0.16)";
      for (let sy = S.y0; sy < S.y1; sy += 14) ctx.fillRect(S.x0, sy, w, 7);
    }
    const inset = Math.max(10, Math.min(w, h) * 0.12);
    ctx.strokeStyle = "rgba(255,255,255,0.75)"; ctx.lineWidth = 2;
    ctx.strokeRect(S.x0 + inset, S.y0 + inset, w - 2 * inset, h - 2 * inset);
    ctx.beginPath();
    if (w >= h) { ctx.moveTo(cx, S.y0 + inset); ctx.lineTo(cx, S.y1 - inset); } // wide → vertical halfway line
    else { ctx.moveTo(S.x0 + inset, cy); ctx.lineTo(S.x1 - inset, cy); }        // tall → horizontal halfway line
    ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.13, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
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

export { drawBarriers, drawStreetLabels2D, paintRoads, paintTileMedians, paintTileRails, road2dPointAt };
