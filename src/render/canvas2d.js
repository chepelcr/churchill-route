// La Ruta del Churchill — Canvas2D render backend (extracted from engine.js).
// Renders the streamed 2-D world (WORLD2D): a low-res backdrop (land/water/beach
// silhouette) under per-tile surface blits + per-tile buildings, then the shared
// entity/overlay drawers (player, traffic, peds, gulls, weather, minimap). The
// Pixi backend (src/render/pixi) is the WebGL alternative behind Renderer.js.
// The game loop (src/game/index.js) calls setupCanvas(canvas) then render(t).
import { WORLD2D as W } from "../world2d/index.js";
import {
  state, traffic, pedestrians, gulls, boats, parked, vendors, animals, trains,
} from "../game/state.js";
import { nearestKiosk } from "../game/delivery.js";
import { t } from "../i18n/index.js";
import { content } from "../content/remote.js";
import { traceVehicleSilhouette } from "./vehicleShapes.js";

  // ----- Render -------------------------------------------------------------
  let canvas, ctx, dpr = 1;
  // Cuadrícula-based responsive zoom: frame at most CUADS_PER_VIEW cuadrículas
  // so every device shows the same amount of city. Only a floor is clamped —
  // narrow screens show FEWER cuadrículas (more detail), never more than 12.
  const CUAD = (W.META && W.META.cuad) || 20;
  // Camera framing is a RENDERER concern (tuned by feel, not a world rebuild):
  // frame ~20 cuadrículas across so the road ahead is visible while driving.
  // meta.cuadsPerView is advisory only.
  const CUADS_PER_VIEW = 20;
  const ACERA_PX = (W.META && W.META.aceraPx) || 8; // sidewalk depth per side
  function computeZoom(wCss, hCss) {
    const z = wCss / (CUADS_PER_VIEW * CUAD);
    return Math.max(2.2, z);
  }
  function setupCanvas(c) {
    canvas = c; ctx = c.getContext("2d");
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth, h = c.clientHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      ZOOM = computeZoom(w, h);
      // publish the view transform for input (point-to-drive) + camera clamp
      state.cam.zoom = ZOOM; state.cam.vw = w; state.cam.vh = h;
    };
    resize(); window.addEventListener("resize", resize);
    // some mobile browsers report stale sizes at orientationchange time
    window.addEventListener("orientationchange", () => setTimeout(resize, 120));
    if (window.visualViewport) window.visualViewport.addEventListener("resize", resize);
    // entering/leaving fullscreen doesn't fire resize on all mobile browsers
    document.addEventListener("fullscreenchange", () => setTimeout(resize, 60));
    document.addEventListener("webkitfullscreenchange", () => setTimeout(resize, 60));
  }

  function weatherColors() {
    const w = state.weather;
    if (w === "storm")  return { sky1: "#3a4a5e", sky2: "#5a6a7e", waterTop: "#3b6f7a", waterBot: "#244b56", sand: "#a89870", land: "#8a9c70", tint: "rgba(40,55,80,0.35)" };
    if (w === "sunset") return { sky1: "#ff8b5a", sky2: "#ff3d80", waterTop: "#d28a6a", waterBot: "#7a4060", sand: "#f4c98b", land: "#cda06a", tint: "rgba(255,80,80,0.12)" };
    if (w === "night")  return { sky1: "#0e1530", sky2: "#222244", waterTop: "#1a2a44", waterBot: "#0a1428", sand: "#6a5a48", land: "#4a5040", tint: "rgba(10,10,30,0.45)" };
    return                   { sky1: "#9fd9ec", sky2: "#ffe6b3", waterTop: "#62c2c9", waterBot: "#2e8090", sand: "#f1d29a", land: "#cfb27a", tint: "rgba(255,235,200,0.04)" };
  }

  // ---- Drawing helpers ----
  function roundRect(c, x, y, w, h, r, fill, stroke) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r); c.closePath();
    if (fill) c.fill(); if (stroke) c.stroke();
  }

  function drawWaterAll(view, t) {
    // Full background = water
    const C = weatherColors();
    const g = ctx.createLinearGradient(0, view.y0, 0, view.y1);
    g.addColorStop(0, C.waterTop); g.addColorStop(1, C.waterBot);
    ctx.fillStyle = g;
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    // Shimmer lines
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    const tt = t * 0.0006;
    for (let yy = view.y0; yy < view.y1; yy += 26) {
      ctx.beginPath();
      for (let xx = view.x0; xx < view.x1; xx += 20) {
        const yo = Math.sin(tt + xx * 0.04 + yy * 0.03) * 2.2;
        if (xx === view.x0) ctx.moveTo(xx, yy + yo);
        else ctx.lineTo(xx, yy + yo);
      }
      ctx.stroke();
    }
  }

  // ---- Static geometry cache (Path2D per feature, built once) ----
  // Mandatory for 60fps: ~2k roads and ~1.4k buildings get AABB-culled
  // against the camera view and stroked/filled from prebuilt paths.
  let RC = null;
  function flatAABB(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      if (pts[i] < x0) x0 = pts[i];
      if (pts[i] > x1) x1 = pts[i];
      if (pts[i + 1] < y0) y0 = pts[i + 1];
      if (pts[i + 1] > y1) y1 = pts[i + 1];
    }
    return { x0, y0, x1, y1 };
  }
  function flatPath(pts, close) {
    const path = new Path2D();
    path.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
    if (close) path.closePath();
    return path;
  }
  // minor classes first so major roads paint on top
  const ROAD_ORDER = {
    service: 0, pedestrian: 1, residential: 2, unclassified: 3,
    tertiary: 4, tertiary_link: 4, secondary: 5, primary_link: 6,
    primary: 7, trunk_link: 8, trunk: 9, paseo: 10, bridge: 11,
  };
  // Backdrop silhouette cache: land / inner water / beach polygons are global on
  // WORLD2D (few, low-res). Drawn under the streamed surface tiles so unloaded /
  // far areas still read as the real Puntarenas shape.
  function ensureRenderCache() {
    if (RC) return RC;
    RC = { land: [], beach: [], water: [] };
    for (const poly of W.LAND_POLYS || []) if (poly.length >= 6) RC.land.push({ path: flatPath(poly, true), aabb: flatAABB(poly) });
    for (const poly of W.BEACHES || []) if (poly.length >= 6) RC.beach.push({ path: flatPath(poly, true), aabb: flatAABB(poly) });
    for (const poly of W.WATERS || []) if (poly.length >= 6) RC.water.push({ path: flatPath(poly, true), aabb: flatAABB(poly) });
    return RC;
  }
  function aabbInView(a, view, pad) {
    return !(a.x1 + pad < view.x0 || a.x0 - pad > view.x1 || a.y1 + pad < view.y0 || a.y0 - pad > view.y1);
  }

  // ---- Painterly render of the streamed 2-D world (WORLD2D) -----------------
  // Instead of a flat per-cell blit, we draw the corridor's painterly style from
  // the per-tile VECTOR features (land silhouette, road strokes with lane
  // markings, buildings with roofs/windows, palms/trees). Only resident tiles in
  // view contribute; a low-res land/water/beach backdrop covers unloaded gaps.
  function roadPath(r) { return r._path || (r._path = flatPath(r.pts, false)); }

  // One inland water body (estuary / river): gradient fill, animated shimmer
  // clipped to its shape, and a soft foam bank where it meets the land.
  function paintWaterBody(w, view, t) {
    const C = weatherColors(), a = w.aabb;
    const g = ctx.createLinearGradient(0, a.y0, 0, a.y1);
    g.addColorStop(0, C.waterTop); g.addColorStop(1, C.waterBot);
    ctx.fillStyle = g; ctx.fill(w.path);
    // shimmer, clipped to the water
    ctx.save(); ctx.clip(w.path);
    ctx.strokeStyle = "rgba(255,255,255,0.14)"; ctx.lineWidth = 1;
    const tt = t * 0.0006;
    const y0 = Math.max(view.y0, a.y0), y1 = Math.min(view.y1, a.y1);
    const x0 = Math.max(view.x0, a.x0), x1 = Math.min(view.x1, a.x1);
    for (let yy = y0; yy < y1; yy += 22) {
      ctx.beginPath();
      for (let xx = x0; xx < x1; xx += 18) {
        const yo = Math.sin(tt + xx * 0.05 + yy * 0.04) * 1.8;
        xx === x0 ? ctx.moveTo(xx, yy + yo) : ctx.lineTo(xx, yy + yo);
      }
      ctx.stroke();
    }
    ctx.restore();
    // foam bank: soft pale rim along the shoreline
    ctx.strokeStyle = "rgba(226,240,238,0.35)"; ctx.lineWidth = 2.5; ctx.stroke(w.path);
  }

  // Base land + inland waters (with river love) + beach, under the streets.
  function drawLandBase(view, t) {
    const rc = ensureRenderCache(), C = weatherColors();
    ctx.fillStyle = C.land; for (const l of rc.land) if (aabbInView(l.aabb, view, 4)) ctx.fill(l.path);
    ctx.lineJoin = "round";
    for (const w of rc.water) if (aabbInView(w.aabb, view, 4)) paintWaterBody(w, view, t);
    // beach: sandy fill + a faint wet line along its seaward edge
    ctx.fillStyle = C.sand; for (const b of rc.beach) if (aabbInView(b.aabb, view, 4)) ctx.fill(b.path);
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1.5;
    for (const b of rc.beach) if (aabbInView(b.aabb, view, 4)) ctx.stroke(b.path);
  }

  // ---- junction-aware lane dashes -----------------------------------------
  // Per tile (once): intersect every road pair's segments to find the exact
  // crossing arclengths. The dash path then skips a clearance around every
  // crossing AND is trimmed at both ends — center lines never enter an
  // intersection, with no cover-up discs needed.
  function ensureTileCuts(tile) {
    if (tile._cutsDone) return;
    tile._cutsDone = true;
    const roads = tile.roads;
    for (const r of roads) if (!r._cutList) r._cutList = [];
    for (let i = 0; i < roads.length; i++) {
      const A = roads[i];
      for (let j = i + 1; j < roads.length; j++) {
        const B = roads[j];
        const pad = (A.w + B.w) / 2;
        if (A.aabb.x0 > B.aabb.x1 + pad || B.aabb.x0 > A.aabb.x1 + pad ||
            A.aabb.y0 > B.aabb.y1 + pad || B.aabb.y0 > A.aabb.y1 + pad) continue;
        const pa = A.pts, pb = B.pts;
        for (let ia = 0; ia + 3 < pa.length; ia += 2) {
          const ax = pa[ia], ay = pa[ia + 1], adx = pa[ia + 2] - ax, ady = pa[ia + 3] - ay;
          for (let ib = 0; ib + 3 < pb.length; ib += 2) {
            const bx = pb[ib], by = pb[ib + 1], bdx = pb[ib + 2] - bx, bdy = pb[ib + 3] - by;
            const den = adx * bdy - ady * bdx;
            if (Math.abs(den) < 1e-6) continue;                 // parallel
            const t = ((bx - ax) * bdy - (by - ay) * bdx) / den;
            const u = ((bx - ax) * ady - (by - ay) * adx) / den;
            if (t < -0.02 || t > 1.02 || u < -0.02 || u > 1.02) continue;
            A._cutList.push({ s: A.cum[ia / 2] + t * (A.cum[ia / 2 + 1] - A.cum[ia / 2]), c: B.w / 2 + 12 });
            B._cutList.push({ s: B.cum[ib / 2] + u * (B.cum[ib / 2 + 1] - B.cum[ib / 2]), c: A.w / 2 + 12 });
          }
        }
      }
    }
  }

  // Dash path = the road minus end trims minus a clearance around every
  // crossing (from ensureTileCuts). Cached per road.
  function dashPath(r) {
    if (r._dash !== undefined) return r._dash;
    const TRIM = Math.max(26, r.w * 0.8);
    if (!r.cum || r.len <= TRIM * 2 + 8) return (r._dash = null);
    const p = r.pts, cum = r.cum;
    const at = (s) => {
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return [p[(i - 1) * 2] + (p[i * 2] - p[(i - 1) * 2]) * t,
              p[(i - 1) * 2 + 1] + (p[i * 2 + 1] - p[(i - 1) * 2 + 1]) * t];
    };
    // subtract the cut windows from [TRIM, len-TRIM]
    let spans = [[TRIM, r.len - TRIM]];
    for (const cut of r._cutList || []) {
      const c0 = cut.s - cut.c, c1 = cut.s + cut.c;
      const next = [];
      for (const [s0, s1] of spans) {
        if (c1 <= s0 || c0 >= s1) { next.push([s0, s1]); continue; }
        if (c0 > s0) next.push([s0, c0]);
        if (c1 < s1) next.push([c1, s1]);
      }
      spans = next;
    }
    let path = null;
    for (const [s0, s1] of spans) {
      if (s1 - s0 < 14) continue;                               // too short to read
      path = path || new Path2D();
      const [ax, ay] = at(s0);
      path.moveTo(ax, ay);
      for (let i = 0; i < cum.length; i++) {
        if (cum[i] > s0 && cum[i] < s1) path.lineTo(p[i * 2], p[i * 2 + 1]);
      }
      const [bx, by] = at(s1);
      path.lineTo(bx, by);
    }
    return (r._dash = path);
  }

  // Multi-pass road styling (acera band → casing → asphalt → lane dashes),
  // ported from the corridor renderer but fed per-tile road segments.
  function paintRoads(roads) {
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    // elevated (barro/Ferrocarril) drop-shadow
    ctx.strokeStyle = "rgba(0,0,0,0.30)";
    for (const r of roads) { if (!r.elev) continue; ctx.save(); ctx.translate(0, 3.5); ctx.lineWidth = r.w + 2 * ACERA_PX + 3; ctx.stroke(roadPath(r)); ctx.restore(); }
    // acera concrete band
    ctx.strokeStyle = "#cec7b2";
    for (const r of roads) { if (r.bridge || r.cls === "bridge") continue; ctx.lineWidth = r.w + 2 * ACERA_PX; ctx.stroke(roadPath(r)); }
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

  // Orchestrate the painterly world from resident, in-view tiles.
  function drawWorld2D(view, t) {
    drawLandBase(view, t);
    const vts = W.visibleTiles(view.x0, view.y0, view.x1, view.y1);
    // roads: gather in-view segments across tiles, minor → major so arterials paint on top
    const roads = [];
    for (const tile of vts) {
      ensureTileCuts(tile); // one-time crossing detection for the dash gaps
      for (const r of tile.roads) if (aabbInView(r.aabb, view, r.w + 6)) roads.push(r);
    }
    roads.sort((a, b) => (ROAD_ORDER[a.cls] || 0) - (ROAD_ORDER[b.cls] || 0));
    paintRoads(roads);
    // rails (old Ferrocarril line) + paseo separator ground strips, on top of
    // the asphalt but under buildings/flora
    for (const tile of vts) if (tile.rails.length) paintTileRails(tile.rails, view);
    for (const tile of vts) if (tile.medians.length) paintTileMedians(tile.medians, view);
    // buildings
    for (const tile of vts) for (const b of tile.buildings) if (aabbInView(b.aabb, view, 8)) paintBuilding(b);
    // flora
    for (const tile of vts) {
      for (const tr of tile.trees) { if (tr.x > view.x0 - 30 && tr.x < view.x1 + 30 && tr.y > view.y0 - 30 && tr.y < view.y1 + 30) paintTree(tr); }
      for (const pa of tile.palms) { if (pa.x > view.x0 - 30 && pa.x < view.x1 + 30 && pa.y > view.y0 - 30 && pa.y < view.y1 + 30) paintPalm(pa, t); }
    }
  }

  function drawLand(view) {
    ensureRenderCache();
    const C = weatherColors();
    // Sand fringe: fat sand stroke of the coast under the land fill
    ctx.strokeStyle = C.sand; ctx.lineWidth = 24; ctx.lineJoin = "round";
    for (const e of RC.land) {
      if (!aabbInView(e.aabb, view, 30)) continue;
      ctx.stroke(e.path);
    }
    // Land fill
    ctx.fillStyle = C.land;
    for (const e of RC.land) {
      if (!aabbInView(e.aabb, view, 30)) continue;
      ctx.fill(e.path);
    }
    // Beach polygons (real playa areas)
    ctx.fillStyle = C.sand;
    for (const e of RC.beach) {
      if (!aabbInView(e.aabb, view, 10)) continue;
      ctx.fill(e.path);
    }
    // Paved plazas: land slivers too small for a cuadra, poured as concrete
    ctx.fillStyle = "#cec7b2";
    ctx.fill(RC.plazas);
    // Subtle district tone (clipped to land)
    ctx.save();
    ctx.clip(RC.landAll);
    ctx.globalAlpha = 0.12;
    for (const d of W.DISTRICTS) {
      if (d.x1 < view.x0 || d.x0 > view.x1) continue;
      const x0 = Math.max(d.x0, view.x0), x1 = Math.min(d.x1, view.x1);
      ctx.fillStyle = d.tone;
      ctx.fillRect(x0, view.y0, x1 - x0, view.y1 - view.y0);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // Coastline stroke
    ctx.strokeStyle = "rgba(40,30,20,0.35)"; ctx.lineWidth = 1.5;
    for (const e of RC.land) {
      if (!aabbInView(e.aabb, view, 10)) continue;
      ctx.stroke(e.path);
    }
  }

  function drawStreets(view) {
    ensureRenderCache();
    // Collect visible roads once (already sorted minor → major)
    const visible = [];
    for (const e of RC.roads) {
      if (!aabbInView(e.r.aabb, view, e.r.w + 6)) continue;
      visible.push(e);
    }
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    // The elevated (Ferrocarril) avenue rides ~1 m up — a soft drop-shadow
    // beneath the bank sells the lift (drawn first, under everything). Only the
    // avenue itself (`elev`), not its ground-level barro cross streets.
    ctx.strokeStyle = "rgba(0,0,0,0.30)";
    for (const e of visible) {
      if (!e.r.elev) continue;
      ctx.save(); ctx.translate(0, 3.5);
      ctx.lineWidth = e.r.w + 2 * ACERA_PX + 3;
      ctx.stroke(e.path); ctx.restore();
    }
    // Aceras: concrete sidewalk band under everything (matches the grid's
    // 1-cuadrícula acera fringe on both sides)
    ctx.strokeStyle = "#cec7b2";
    for (const e of visible) {
      if (e.r.bridge || e.r.cls === "bridge") continue;
      ctx.lineWidth = e.r.w + 2 * ACERA_PX;
      ctx.stroke(e.path);
    }
    // Barro shoulder: dirt banks instead of concrete curbs
    ctx.strokeStyle = "#7d6242";
    for (const e of visible) {
      if (!e.r.barro) continue;
      ctx.lineWidth = e.r.w + 2 * ACERA_PX;
      ctx.stroke(e.path);
    }
    // Bridge decks (bridge=yes segments, e.g. Río Barranca at El Roble):
    // pale concrete deck wider than the casing so it reads over water
    ctx.strokeStyle = "#cfc3a3";
    for (const e of visible) {
      if (!e.r.bridge) continue;
      ctx.lineWidth = e.r.w + 10;
      ctx.stroke(e.path);
    }
    // Casing pass
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    for (const e of visible) {
      ctx.lineWidth = e.r.w + 4;
      ctx.stroke(e.path);
    }
    // Asphalt pass (barro streets get a packed-earth surface, not asphalt)
    for (const e of visible) {
      ctx.strokeStyle = e.r.barro ? "#9c7a4f" : e.r.cls === "paseo" ? "#f4dca3" : "#3a3540";
      ctx.lineWidth = e.r.w;
      ctx.stroke(e.path);
    }
    // Curb highlight: a thin sunlit edge along the raised avenue's top side
    ctx.strokeStyle = "rgba(226,206,166,0.55)";
    for (const e of visible) {
      if (!e.r.elev) continue;
      ctx.save(); ctx.translate(0, -1.5);
      ctx.lineWidth = 1.5;
      ctx.stroke(e.path); ctx.restore();
    }
    // Center lines: yellow dashes on main routes, faint white on locals
    for (const e of visible) {
      if (e.r.barro) continue;   // dirt roads have no lane markings
      const cls = e.r.cls;
      if (cls === "trunk" || cls === "trunk_link" || cls === "primary" || cls === "primary_link") {
        ctx.strokeStyle = "#f8d76b"; ctx.lineWidth = 2; ctx.setLineDash([18, 18]);
      } else if (cls === "secondary" || cls === "tertiary" || cls === "tertiary_link" || cls === "residential" || cls === "unclassified") {
        ctx.strokeStyle = "rgba(255,255,255,0.45)"; ctx.lineWidth = 1; ctx.setLineDash([6, 10]);
      } else continue;
      ctx.stroke(e.path);
      ctx.setLineDash([]);
    }
    ctx.lineCap = "butt";
    // Paseo: coral stripe decals along the tangent
    ctx.fillStyle = "rgba(232,93,117,0.22)";
    for (const e of visible) {
      if (e.r.cls !== "paseo") continue;
      for (let s = 20; s < e.r.len; s += 50) {
        const pt = W.roadPointAt(e.i, s);
        if (pt.x < view.x0 - 40 || pt.x > view.x1 + 40 || pt.y < view.y0 - 40 || pt.y > view.y1 + 40) continue;
        ctx.save();
        ctx.translate(pt.x, pt.y); ctx.rotate(pt.ang);
        ctx.fillRect(-13, -10, 26, 4);
        ctx.fillRect(-3, 6, 26, 4);
        ctx.restore();
      }
    }
  }

  // Hand-placed junction islands: `median` = a raised curb triangle (channelizes
  // the split), `cuadra` = a solid block closing empty junction space. Drawn
  // over the asphalt so they read (a grid-only island would be an invisible wall).
  function drawIslands(view) {
    if (!W.ISLANDS || !W.ISLANDS.length) return;
    for (const isl of W.ISLANDS) {
      if (!aabbInView(isl.aabb, view, 8)) continue;
      const p = isl.pts;
      const path = () => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]); ctx.closePath(); };
      // raised drop-shadow
      ctx.save(); ctx.translate(0, 2.5); ctx.fillStyle = "rgba(0,0,0,0.28)"; path(); ctx.fill(); ctx.restore();
      if (isl.kind === "cuadra") {
        path(); ctx.fillStyle = "#e8d5a0"; ctx.fill();            // sandy block
        ctx.strokeStyle = "#cec7b2"; ctx.lineWidth = 2; ctx.stroke();
      } else {
        path(); ctx.fillStyle = "#cec7b2"; ctx.fill();            // concrete island
        ctx.strokeStyle = "#8a8266"; ctx.lineWidth = 2; ctx.stroke();
        let cx = 0, cy = 0, n = p.length / 2;                     // planted centre
        for (let i = 0; i < p.length; i += 2) { cx += p[i]; cy += p[i + 1]; }
        ctx.fillStyle = "#6fa06a"; ctx.beginPath(); ctx.arc(cx / n, cy / n, 3.5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // The old Ferrocarril al Pacífico rail line: gravel ballast + wooden ties +
  // two steel rails. Decorative (not drivable), drawn on the ground.
  function drawRails(view) {
    if (!W.RAILS || !W.RAILS.length) return;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    for (const rl of W.RAILS) {
      if (!aabbInView(rl.aabb, view, 12)) continue;
      const p = rl.pts;
      // ballast bed
      ctx.strokeStyle = "rgba(120,104,84,0.5)"; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
      ctx.stroke();
      // ties
      ctx.strokeStyle = "#5a4a38"; ctx.lineWidth = 1.6;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x0 = p[i], y0 = p[i + 1], dx = p[i + 2] - x0, dy = p[i + 3] - y0;
        const len = Math.hypot(dx, dy); if (len < 0.001) continue;
        const nx = -dy / len, ny = dx / len;
        for (let s = 0; s < len; s += 7) {
          const t = s / len, cx = x0 + dx * t, cy = y0 + dy * t;
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
  }

  // Paseo divided-avenue median: a planted green strip down the centerline
  // (the palms sit on top of it), with a darker soil/curb edge.
  function drawMedians(view) {
    ensureRenderCache();
    if (!RC.medians.length) return;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.strokeStyle = "#4f6f34"; // soil / curb edge
    for (const m of RC.medians) {
      if (!aabbInView(m.aabb, view, m.w + 6)) continue;
      ctx.lineWidth = m.w + 5; ctx.stroke(m.path);
    }
    ctx.strokeStyle = "#79b45c"; // planted grass
    for (const m of RC.medians) {
      if (!aabbInView(m.aabb, view, m.w + 6)) continue;
      ctx.lineWidth = m.w; ctx.stroke(m.path);
    }
    ctx.lineCap = "butt";
  }

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

  function drawStreetLabels(view) {
    ensureRenderCache();
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    // Named / ref'd roads get a pill every ~900px of arclength
    for (const e of RC.roads) {
      const lbl = e.r.name || e.r.ref;
      if (!lbl) continue;
      if (!aabbInView(e.r.aabb, view, 80)) continue;
      for (let s = 450; s < e.r.len; s += 900) {
        const pt = W.roadPointAt(e.i, s);
        if (pt.x < view.x0 - 60 || pt.x > view.x1 + 60 || pt.y < view.y0 - 20 || pt.y > view.y1 + 20) continue;
        label(pt.x, pt.y + 2, lbl, "#fff", "rgba(20,16,40,0.78)");
      }
    }
  }

  function drawBuildings(view) {
    ensureRenderCache();
    for (const e of RC.buildings) {
      const a = e.b.aabb;
      if (!aabbInView(a, view, 8)) continue;
      const bw = a.x1 - a.x0, bh = a.y1 - a.y0;
      // drop shadow
      ctx.save();
      ctx.translate(4, 4);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fill(e.path);
      ctx.restore();
      // body
      ctx.fillStyle = e.b.color;
      ctx.fill(e.path);
      // roof band + windows, clipped to the footprint
      ctx.save();
      ctx.clip(e.path);
      ctx.fillStyle = e.b.roof;
      ctx.fillRect(a.x0, a.y0, bw, Math.max(3, bh * 0.3));
      if (e.b.wnd) {
        ctx.fillStyle = state.weather === "night" ? "rgba(255,220,140,0.7)" : "rgba(255,255,255,0.55)";
        const wn = Math.max(1, Math.floor(bw / 16));
        for (let i = 0; i < wn; i++) ctx.fillRect(a.x0 + 4 + i * (bw / wn), a.y0 + bh * 0.55, 4, 3);
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(0,0,0,0.25)"; ctx.lineWidth = 1;
      ctx.stroke(e.path);
    }
  }

  function drawPalms(view, t) {
    for (const pa of W.PALMS) {
      if (pa.x < view.x0 - 30 || pa.x > view.x1 + 30) continue;
      const sway = Math.sin(t * 0.001 + pa.sway) * 2;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(pa.x + 6, pa.y + 5, 12 * pa.s, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#7a4f2a"; ctx.lineWidth = 3 * pa.s;
      ctx.beginPath(); ctx.moveTo(pa.x, pa.y + 4); ctx.lineTo(pa.x + sway, pa.y - 16 * pa.s); ctx.stroke();
      ctx.fillStyle = "#3aa45b";
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + sway * 0.06;
        const fx = pa.x + sway + Math.cos(a) * 11 * pa.s;
        const fy = pa.y - 16 * pa.s + Math.sin(a) * 5 * pa.s;
        ctx.beginPath(); ctx.ellipse(fx, fy, 9 * pa.s, 3.2 * pa.s, a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#2e7d44";
      ctx.beginPath(); ctx.arc(pa.x + sway, pa.y - 16 * pa.s, 2.5 * pa.s, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Leafy median trees (almendros) on the paseo separator — round canopies,
  // distinct from the coconut palms on the shores.
  function drawTrees(view) {
    for (const tr of W.TREES) {
      if (tr.x < view.x0 - 30 || tr.x > view.x1 + 30) continue;
      if (tr.y < view.y0 - 30 || tr.y > view.y1 + 30) continue;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(tr.x + 5, tr.y + 4, 11 * tr.s, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#6a4426"; ctx.lineWidth = 2.5 * tr.s;
      ctx.beginPath(); ctx.moveTo(tr.x, tr.y + 3); ctx.lineTo(tr.x, tr.y - 7 * tr.s); ctx.stroke();
      ctx.fillStyle = "#2e7d44";
      ctx.beginPath(); ctx.arc(tr.x, tr.y - 11 * tr.s, 9.5 * tr.s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#3aa45b";
      ctx.beginPath(); ctx.arc(tr.x - 3 * tr.s, tr.y - 13 * tr.s, 6.5 * tr.s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#57c078";
      ctx.beginPath(); ctx.arc(tr.x + 3.5 * tr.s, tr.y - 12 * tr.s, 4.5 * tr.s, 0, Math.PI * 2); ctx.fill();
    }
  }

  function label(x, y, text, fg, bg) {
    ctx.font = "bold 9px 'JetBrains Mono', monospace";
    ctx.textAlign = "center";
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = bg; ctx.fillRect(x - w/2, y - 8, w, 12);
    ctx.fillStyle = fg; ctx.fillText(text, x, y + 1);
  }

  // Deterministic 0..1 hash for scene scatter (no Math.random in draw paths)
  function hash01(n) {
    const v = Math.sin(n) * 43758.5453;
    return v - Math.floor(v);
  }

  // El Faro at La Punta — paved plaza on the rocky point: riprap armor on the
  // water side, red crescent shade benches, palms and the red/white tower.
  function drawFaroScene(lm) {
    const x = lm.x, y = lm.y;
    // Paved plaza
    ctx.fillStyle = "#d9d4c8";
    ctx.beginPath(); ctx.ellipse(x, y, 28, 18, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.15)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, y, 28, 18, 0, 0, Math.PI * 2); ctx.stroke();
    // Riprap rock armor rimming the water (west) side of the point
    for (let i = 0; i < 16; i++) {
      const a = Math.PI * 0.5 + (i / 15) * Math.PI; // south → west → north arc
      const rx = x + Math.cos(a) * (30 + hash01(lm.x + i * 3.7) * 6);
      const ry = y + Math.sin(a) * (19 + hash01(lm.x * 1.7 + i * 5.1) * 5);
      const r0 = 1.6 + hash01(lm.x * 7.13 + i * 12.9) * 2.2;
      ctx.fillStyle = i % 3 ? "#4a4d52" : "#5a5e64";
      ctx.beginPath();
      ctx.ellipse(rx, ry, r0 + 1.4, r0, hash01(i * 9.4 + lm.x) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Red crescent shade benches spaced along the walkway
    ctx.strokeStyle = "#c8453a"; ctx.lineWidth = 3; ctx.lineCap = "round";
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI * 0.7 + i * (Math.PI * 1.4 / 4);
      const bx = x + Math.cos(a) * 22, by = y + Math.sin(a) * 13;
      ctx.beginPath(); ctx.arc(bx, by, 4, a - 0.5, a + 2.3); ctx.stroke();
    }
    ctx.lineCap = "butt";
    // A few palms by the plaza (static, same look as drawPalms)
    const pxy = [[x + 22, y - 12], [x + 27, y + 11], [x - 4, y + 19]];
    for (let i = 0; i < pxy.length; i++) {
      const px = pxy[i][0], py = pxy[i][1], s = 0.8;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath(); ctx.ellipse(px + 5, py + 4, 10 * s, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#7a4f2a"; ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.moveTo(px, py + 4); ctx.lineTo(px, py - 16 * s); ctx.stroke();
      ctx.fillStyle = "#3aa45b";
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        const fx = px + Math.cos(a) * 11 * s;
        const fy = py - 16 * s + Math.sin(a) * 5 * s;
        ctx.beginPath(); ctx.ellipse(fx, fy, 9 * s, 3.2 * s, a, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#2e7d44";
      ctx.beginPath(); ctx.arc(px, py - 16 * s, 2.5 * s, 0, Math.PI * 2); ctx.fill();
    }
    // Tower — white with red bands, slight taper, gallery ring, yellow lantern
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(x + 5, y + 4, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
    const tw = new Path2D();
    tw.moveTo(x - 6, y + 2); tw.lineTo(x - 4, y - 34);
    tw.lineTo(x + 4, y - 34); tw.lineTo(x + 6, y + 2);
    tw.closePath();
    ctx.fillStyle = "#fff"; ctx.fill(tw);
    ctx.save();
    ctx.clip(tw);
    ctx.fillStyle = "#d63a30";
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 7, y - 29 + i * 11, 14, 5);
    ctx.restore();
    ctx.strokeStyle = "rgba(0,0,0,0.2)"; ctx.lineWidth = 1; ctx.stroke(tw);
    // Gallery ring + lantern
    ctx.fillStyle = "#3a3540"; ctx.fillRect(x - 6, y - 36, 12, 2.5);
    ctx.fillStyle = "#ffe06b"; ctx.beginPath(); ctx.arc(x, y - 40, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3a3540"; ctx.fillRect(x - 3, y - 45.5, 6, 2);
    label(x, y - 52, "FARO", "#fff", "#3a3540");
  }

  function drawLandmark(lm) {
    const x = lm.x, y = lm.y;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(x + 4, y + 8, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
    switch (lm.type) {
      case "kiosk": {
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 16, y - 8, 32, 18);
        for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? "#fff" : "#e85d75"; ctx.fillRect(x - 16 + i * 8, y - 14, 8, 6); }
        ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(x - 4, y - 4, 8, 12);
        ctx.fillStyle = "#ff3d80"; ctx.fillRect(x - 4, y, 8, 6);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 4, y - 4, 8, 3);
        label(x, y - 22, "CHURCHILL", "#fff", "#e85d75"); break;
      }
      case "ferry":
      case "cruise": {
        ctx.fillStyle = lm.type === "cruise" ? "#fff" : "#3a6f8a";
        ctx.fillRect(x - 28, y - 10, 56, 22);
        ctx.fillStyle = "#f4d77a"; ctx.fillRect(x - 28, y - 14, 56, 4);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y - 22, 12, 8);
        label(x, y - 28, lm.type === "cruise" ? "MUELLE" : "FERRY", "#fff", "#3a6f8a"); break;
      }
      case "lighthouse": {
        drawFaroScene(lm); break;
      }
      case "church":
      case "cathedral": {
        ctx.fillStyle = "#caa089"; ctx.fillRect(x - 20, y - 12, 40, 24);
        ctx.fillStyle = "#9e6f4a"; ctx.beginPath(); ctx.moveTo(x - 6, y - 12); ctx.lineTo(x, y - 26); ctx.lineTo(x + 6, y - 12); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 0.5, y - 22, 1.5, 6); ctx.fillRect(x - 3, y - 19, 7, 1.5);
        label(x, y - 30, lm.type === "cathedral" ? "CATEDRAL" : "IGLESIA", "#fff", "#9e6f4a"); break;
      }
      case "market": {
        ctx.fillStyle = "#f3c969"; ctx.fillRect(x - 24, y - 12, 48, 24);
        for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? "#fff" : "#6fbf99"; ctx.fillRect(x - 24 + i * 8, y - 16, 8, 4); }
        label(x, y - 22, "MERCADO", "#fff", "#3a3540"); break;
      }
      case "super": {
        ctx.fillStyle = "#ffec70"; ctx.fillRect(x - 18, y - 12, 36, 22);
        ctx.fillStyle = "#e85d75"; ctx.fillRect(x - 18, y - 16, 36, 4);
        label(x, y - 22, "SÚPER", "#fff", "#e85d75"); break;
      }
      case "hotel": {
        ctx.fillStyle = "#5fb0d6"; ctx.fillRect(x - 16, y - 22, 32, 32);
        for (let r = 0; r < 4; r++) for (let cc = 0; cc < 3; cc++) {
          ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.fillRect(x - 14 + cc * 10, y - 20 + r * 8, 5, 4);
        }
        label(x, y - 30, lm.name.split(" ")[1] ? lm.name.split(" ")[1].toUpperCase() : "HOTEL", "#fff", "#3a6f8a"); break;
      }
      case "park":
      case "civic":
      case "museum": {
        ctx.fillStyle = "#6fbf99"; ctx.fillRect(x - 20, y - 10, 40, 22);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y - 6, 12, 12);
        const tag = lm.type === "park" ? "PARQUE" : lm.type === "civic" ? "CULTURA" : "MUSEO";
        label(x, y - 18, tag, "#fff", "#2e7d44"); break;
      }
      case "stadium": {
        ctx.fillStyle = "#3a3540"; ctx.fillRect(x - 24, y - 14, 48, 26);
        ctx.fillStyle = "#6fbf99"; ctx.fillRect(x - 22, y - 12, 44, 22);
        ctx.strokeStyle = "#fff"; ctx.strokeRect(x - 18, y - 8, 36, 14);
        label(x, y - 22, "ESTADIO", "#fff", "#3a3540"); break;
      }
      case "marina": {
        ctx.fillStyle = "#5fb0d6"; ctx.fillRect(x - 18, y - 8, 36, 16);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 4, y - 18, 2, 10); ctx.beginPath(); ctx.moveTo(x - 4, y - 18); ctx.lineTo(x + 6, y - 12); ctx.lineTo(x - 4, y - 8); ctx.fill();
        label(x, y - 24, "YACHT", "#fff", "#3a6f8a"); break;
      }
      case "pool": {
        // Balneario Municipal at La Punta — the lagoon-shaped public pool
        // inside the road loop (see how-look-puntarenas/faro.jpg)
        ctx.fillStyle = "#e8e2d2";                       // concrete deck
        ctx.beginPath(); ctx.ellipse(x, y, 78, 48, -0.25, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "rgba(58,53,64,0.25)"; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = "#5fd3e0";                       // lagoon water
        ctx.beginPath(); ctx.ellipse(x - 18, y + 4, 40, 26, -0.35, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.ellipse(x + 28, y - 8, 26, 20, -0.15, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#aeeaf2";                       // shallow end
        ctx.beginPath(); ctx.ellipse(x - 26, y + 2, 16, 9, -0.35, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#f3c969";                       // kids slide
        ctx.beginPath(); ctx.arc(x - 34, y + 12, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#6fbf99";                       // palm islet
        ctx.beginPath(); ctx.arc(x + 30, y - 8, 7, 0, Math.PI * 2); ctx.fill();
        label(x, y - 58, "BALNEARIO", "#fff", "#3a6f8a"); break;
      }
      case "house": {
        ctx.fillStyle = "#c084d6"; ctx.fillRect(x - 14, y - 10, 28, 20);
        ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(x - 16, y - 10); ctx.lineTo(x, y - 22); ctx.lineTo(x + 16, y - 10); ctx.fill();
        label(x, y - 26, "CASA FAIT", "#fff", "#c084d6"); break;
      }
      case "estuary": {
        ctx.fillStyle = "#3a6f8a"; ctx.fillRect(x - 16, y - 6, 32, 12);
        ctx.fillStyle = "#6fbf99"; ctx.fillRect(x - 16, y - 12, 8, 8); ctx.fillRect(x + 8, y - 12, 8, 8);
        label(x, y - 20, "MATA LIMÓN", "#fff", "#2e7d44"); break;
      }
      case "restaurant": {
        ctx.fillStyle = "#e85d75"; ctx.fillRect(x - 14, y - 10, 28, 20);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y - 4, 12, 6);
        label(x, y - 18, "MARISQ.", "#fff", "#e85d75"); break;
      }
      case "beachsign": {
        ctx.strokeStyle = "#3a3540"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 14); ctx.stroke();
        ctx.fillStyle = "#6fbf99"; ctx.fillRect(x - 22, y - 18, 44, 8);
        label(x, y - 24, "PLAYA", "#fff", "#2e7d44"); break;
      }
      case "trainstation": {
        ctx.fillStyle = "#caa089"; ctx.fillRect(x - 20, y - 14, 40, 24);
        ctx.fillStyle = "#3a3540"; ctx.fillRect(x - 22, y + 10, 44, 4);
        ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y - 8, 12, 6);
        label(x, y - 22, "TREN", "#fff", "#9e6f4a"); break;
      }
      case "port": {
        ctx.fillStyle = "#5fb0d6"; ctx.fillRect(x - 28, y - 8, 56, 18);
        // crane
        ctx.strokeStyle = "#f4d77a"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x - 18, y - 22); ctx.lineTo(x - 18, y - 8);
        ctx.moveTo(x - 18, y - 22); ctx.lineTo(x + 6, y - 22);
        ctx.lineTo(x + 6, y - 16);
        ctx.stroke();
        // containers
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = ["#e85d75","#f3c969","#6fbf99","#5fb0d6"][i];
          ctx.fillRect(x - 24 + i * 12, y - 3, 10, 8);
        }
        label(x, y - 30, "PUERTO", "#fff", "#3a6f8a"); break;
      }
      case "sign": {
        ctx.strokeStyle = "#3a3540"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - 18); ctx.stroke();
        ctx.fillStyle = "#3a6f8a"; ctx.fillRect(x - 30, y - 24, 60, 12);
        ctx.fillStyle = "#fff"; ctx.font = "bold 8px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
        ctx.fillText("BULEVAR", x, y - 15); break;
      }
      case "village": {
        // cluster of three small houses
        for (let i = 0; i < 3; i++) {
          const px = x + (i - 1) * 14;
          ctx.fillStyle = ["#e85d75","#f3c969","#6fbf99"][i];
          ctx.fillRect(px - 6, y - 6, 12, 10);
          ctx.fillStyle = "#9e6f4a";
          ctx.beginPath(); ctx.moveTo(px - 7, y - 6); ctx.lineTo(px, y - 12); ctx.lineTo(px + 7, y - 6); ctx.fill();
        }
        label(x, y - 18, "VILLA", "#fff", "#9e6f4a"); break;
      }
      case "highway": {
        ctx.fillStyle = "#3a6f8a"; ctx.fillRect(x - 18, y - 12, 36, 22);
        ctx.fillStyle = "#fff"; ctx.font = "bold 12px 'Bungee', sans-serif"; ctx.textAlign = "center";
        ctx.fillText("27", x, y + 2);
        label(x, y - 18, "RUTA 27", "#fff", "#3a3540"); break;
      }
      case "anchor": {
        // nautical anchor monument on a low round plinth
        ctx.fillStyle = "#b8b0a0";
        ctx.beginPath(); ctx.ellipse(x, y + 6, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#4a5560"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
        // shank
        ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x, y + 4); ctx.stroke();
        // ring at the top
        ctx.beginPath(); ctx.arc(x, y - 25, 3.5, 0, Math.PI * 2); ctx.stroke();
        // stock (crossbar)
        ctx.beginPath(); ctx.moveTo(x - 9, y - 16); ctx.lineTo(x + 9, y - 16); ctx.stroke();
        // arms + curved flukes
        ctx.beginPath();
        ctx.moveTo(x - 11, y - 2); ctx.quadraticCurveTo(x - 12, y + 5, x - 4, y + 4);
        ctx.moveTo(x + 11, y - 2); ctx.quadraticCurveTo(x + 12, y + 5, x + 4, y + 4);
        ctx.moveTo(x, y + 4); ctx.lineTo(x - 11, y - 2);
        ctx.moveTo(x, y + 4); ctx.lineTo(x + 11, y - 2);
        ctx.stroke();
        ctx.lineCap = "butt";
        label(x, y - 32, "EL ANCLA", "#fff", "#4a5560"); break;
      }
      case "bridge": {
        /* drawn separately by drawBridge */ break;
      }
    }
  }

  // Sponsored lotes (remote content): real Puntarenas businesses claim a spot
  // and appear as a branded billboard or storefront — pure data, no release.
  function drawLote(lo) {
    const x = lo.x, y = lo.y;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(x + 3, y + 6, 16, 5, 0, 0, Math.PI * 2); ctx.fill();
    if (lo.kind === "store") {
      // small branded storefront: body, awning in the sponsor tone, label
      ctx.fillStyle = "#f4f0e4"; ctx.fillRect(x - 16, y - 10, 32, 18);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? "#fff" : lo.tone; ctx.fillRect(x - 16 + i * 8, y - 15, 8, 5); }
      ctx.fillStyle = "rgba(20,40,60,0.55)"; ctx.fillRect(x - 4, y - 2, 8, 10);   // door
      ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillRect(x - 13, y - 6, 7, 5); // window
      label(x, y - 22, lo.label, "#fff", lo.tone);
    } else {
      // billboard: two posts + panel in the sponsor tone with the label
      ctx.strokeStyle = "#6a5a48"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x - 10, y + 4); ctx.lineTo(x - 10, y - 12);
      ctx.moveTo(x + 10, y + 4); ctx.lineTo(x + 10, y - 12); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.fillRect(x - 17, y - 26, 34, 15);
      ctx.fillStyle = lo.tone; ctx.fillRect(x - 15, y - 24, 30, 11);
      label(x, y - 30, lo.label, "#fff", "rgba(20,16,40,0.85)");
    }
  }

  function drawPed(pe) {
    const bob = Math.sin(pe.ph) * 1.4;
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(pe.x + 1, pe.y + 5, 4, 1.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `hsl(${pe.hue} 70% 60%)`; ctx.fillRect(pe.x - 2, pe.y - 3 + bob, 4, 6);
    ctx.fillStyle = "#f1c8a4"; ctx.beginPath(); ctx.arc(pe.x, pe.y - 5 + bob, 2.2, 0, Math.PI * 2); ctx.fill();
  }
  function drawCar(c) {
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(c.ang || 0);
    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(-c.w/2 + 3, -c.h/2 + 3, c.w, c.h);
    if (c.kind === "truck") {
      // cab + boxy trailer
      ctx.fillStyle = c.color; ctx.fillRect(c.w/2 - 9, -c.h/2, 9, c.h);
      ctx.fillStyle = "#e8e4da"; ctx.fillRect(-c.w/2, -c.h/2, c.w - 10, c.h);
      ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(c.w/2 - 10, -c.h/2, 1.5, c.h);
    } else if (c.kind === "bus") {
      ctx.fillStyle = c.color; ctx.fillRect(-c.w/2, -c.h/2, c.w, c.h);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let wx = -c.w/2 + 4; wx < c.w/2 - 5; wx += 6) ctx.fillRect(wx, -c.h/2 + 2, 4, 3);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (let wx = -c.w/2 + 4; wx < c.w/2 - 5; wx += 6) ctx.fillRect(wx, c.h/2 - 5, 4, 3);
    } else {
      ctx.fillStyle = c.color; ctx.fillRect(-c.w/2, -c.h/2, c.w, c.h);
      ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.fillRect(-c.w/2 + 4, -c.h/2 + 2, c.w - 8, c.h - 4);
    }
    ctx.fillStyle = "#222"; ctx.fillRect(-c.w/2, -c.h/2 - 1, 3, c.h + 2); ctx.fillRect(c.w/2 - 3, -c.h/2 - 1, 3, c.h + 2);
    ctx.restore();
  }
  // The Ferrocarril heritage train: red loco + two cream wagons, each posed
  // on the rail by spawns.js (tr.cars[0] = loco).
  function drawTrain(tr, t) {
    for (let k = tr.cars.length - 1; k >= 0; k--) {
      const c = tr.cars[k];
      ctx.save();
      ctx.translate(c.x, c.y); ctx.rotate(c.ang);
      ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.fillRect(-17, -6, 34, 13);
      if (k === 0) {
        ctx.fillStyle = "#a83232"; ctx.fillRect(-18, -7, 36, 14);   // loco body
        ctx.fillStyle = "#7d2424"; ctx.fillRect(-18, -7, 10, 14);   // cab
        ctx.fillStyle = "#26222c"; ctx.fillRect(12, -4, 5, 8);      // smokebox
        ctx.fillStyle = "#ffe06b"; ctx.fillRect(16, -2, 2, 4);      // lamp
      } else {
        ctx.fillStyle = "#e8dcc0"; ctx.fillRect(-16, -6, 32, 12);   // wagon
        ctx.fillStyle = "#a83232"; ctx.fillRect(-16, -6, 32, 3);    // stripe
        ctx.fillStyle = "rgba(20,40,60,0.5)";
        for (let wx = -11; wx <= 9; wx += 7) ctx.fillRect(wx, -2, 4, 4); // windows
      }
      ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 1;
      ctx.strokeRect(k === 0 ? -18 : -16, k === 0 ? -7 : -6, k === 0 ? 36 : 32, k === 0 ? 14 : 12);
      ctx.restore();
    }
    // chimney smoke puffs drifting off the loco
    const l = tr.cars[0];
    ctx.fillStyle = "rgba(230,230,230,0.35)";
    for (let i = 0; i < 3; i++) {
      const ph = (t * 0.0012 + i * 0.33) % 1;
      ctx.beginPath();
      ctx.arc(l.x + Math.cos(l.ang) * 14 - ph * 16, l.y + Math.sin(l.ang) * 14 - 8 - ph * 14, 2 + ph * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawGull(g) {
    ctx.fillStyle = "rgba(0,0,0,0.15)"; ctx.beginPath(); ctx.ellipse(g.x, g.y + 14, 6, 1.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
    const f = Math.sin(g.ph) * 4;
    ctx.beginPath();
    ctx.moveTo(g.x - 7, g.y + f); ctx.quadraticCurveTo(g.x - 3, g.y - 3 + f, g.x, g.y + f);
    ctx.quadraticCurveTo(g.x + 3, g.y - 3 + f, g.x + 7, g.y + f); ctx.stroke();
  }
  function drawBoat(b) {
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(b.x - 40 - Math.sign(b.vx) * 12, b.y + 4, 32, 2);
    if (b.kind === "ferry") {
      ctx.fillStyle = "#fff"; ctx.fillRect(b.x - 28, b.y - 6, 56, 10);
      ctx.fillStyle = "#3a3540"; ctx.fillRect(b.x - 28, b.y + 2, 56, 4);
      ctx.fillStyle = "#e85d75"; ctx.fillRect(b.x - 4, b.y - 14, 6, 10);
    } else {
      ctx.fillStyle = "#caa089"; ctx.beginPath();
      ctx.moveTo(b.x - 14, b.y); ctx.lineTo(b.x + 14, b.y);
      ctx.lineTo(b.x + 10, b.y + 4); ctx.lineTo(b.x - 10, b.y + 4); ctx.closePath(); ctx.fill();
    }
  }

  // Hills behind Mata de Limón / Caldera (drawn in water area before land)
  function drawHills(view) {
    if (!W.HILLS) return;
    for (const h of W.HILLS) {
      if (h.x1 < view.x0 || h.x0 > view.x1) continue;
      const C = weatherColors();
      const tint = state.weather === "night" ? "#1f2c1f" : state.weather === "storm" ? "#3e5a4a" : h.color;
      ctx.fillStyle = tint;
      ctx.beginPath();
      ctx.moveTo(h.x0, h.baseY + 80);
      for (let x = h.x0; x <= h.x1; x += 18) {
        const y = h.baseY + Math.sin((x - h.x0) * 0.012) * 22 + Math.cos((x - h.x0) * 0.006) * 18;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(h.x1, h.baseY + 80);
      ctx.closePath();
      ctx.fill();
      // tree texture
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      for (let x = h.x0 + 12; x < h.x1; x += 16) {
        const y = h.baseY + Math.sin((x - h.x0) * 0.012) * 22 + Math.cos((x - h.x0) * 0.006) * 18;
        ctx.beginPath(); ctx.arc(x, y + 4, 4, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Inland water bodies (Estero Mata de Limón and friends) over the land
  function drawEstuary(view) {
    ensureRenderCache();
    if (!RC.water.length && !W.ESTUARY) return;
    const C = weatherColors();
    const g = ctx.createLinearGradient(0, view.y0, 0, view.y1);
    g.addColorStop(0, C.waterTop); g.addColorStop(1, C.waterBot);
    ctx.fillStyle = g;
    for (const e of RC.water) {
      if (!aabbInView(e.aabb, view, 10)) continue;
      ctx.fill(e.path);
    }
    // ripples on the estuary's fitted ellipse
    const E = W.ESTUARY;
    if (E && E.rx > 0 && !(E.cx + E.rx < view.x0 || E.cx - E.rx > view.x1)) {
      ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1;
      for (let r = 24; r < E.rx; r += 24) {
        ctx.beginPath(); ctx.ellipse(E.cx, E.cy, r, r * E.ry / E.rx, 0, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }

  // Mangrove dots around the estuary
  function drawMangroves(view) {
    if (!W.MANGROVES) return;
    for (const m of W.MANGROVES) {
      if (m.x < view.x0 - 20 || m.x > view.x1 + 20) continue;
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.beginPath(); ctx.arc(m.x + 1, m.y + 2, m.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2e5d3a";
      ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4a7a4a";
      ctx.beginPath(); ctx.arc(m.x - m.r * 0.3, m.y - m.r * 0.3, m.r * 0.5, 0, Math.PI * 2); ctx.fill();
    }
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

  // Street vendor cart: box cart with a striped parasol
  function drawVendor(vn, t) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.ellipse(vn.x + 2, vn.y + 5, 8, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillRect(vn.x - 7, vn.y - 4, 14, 9);
    ctx.fillStyle = `hsl(${vn.hue} 70% 55%)`; ctx.fillRect(vn.x - 7, vn.y - 4, 14, 3);
    ctx.fillStyle = "#26222c";
    ctx.beginPath(); ctx.arc(vn.x - 5, vn.y + 6, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(vn.x + 5, vn.y + 6, 1.6, 0, Math.PI * 2); ctx.fill();
    // parasol with a gentle sway
    const sway = Math.sin(t * 0.001 + vn.ph) * 1.2;
    ctx.strokeStyle = "#8a7355"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(vn.x + 4, vn.y - 2); ctx.lineTo(vn.x + 4 + sway, vn.y - 14); ctx.stroke();
    ctx.fillStyle = `hsl(${vn.hue} 75% 60%)`;
    ctx.beginPath(); ctx.arc(vn.x + 4 + sway, vn.y - 14, 9, Math.PI, 0); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath(); ctx.arc(vn.x + 4 + sway, vn.y - 14, 9, Math.PI + 0.5, Math.PI + 1.1); ctx.lineTo(vn.x + 4 + sway, vn.y - 14); ctx.fill();
  }

  // Stray dog / cat ambling around the streets
  function drawAnimal(an) {
    const bob = Math.sin(an.ph) * 0.8;
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(an.x + 1, an.y + 3, 4, 1.4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = an.cat ? "#4a4046" : "#a5763f";
    ctx.fillRect(an.x - 4, an.y - 2 + bob, 8, 4);                     // body
    ctx.fillRect(an.x + 3, an.y - 4 + bob, 3.4, 3.4);                 // head
    ctx.fillRect(an.x - 6, an.y - 3 + bob, 2, 2);                     // tail
    if (an.cat) { ctx.fillRect(an.x + 3.4, an.y - 5.4 + bob, 1.2, 1.6); ctx.fillRect(an.x + 5.2, an.y - 5.4 + bob, 1.2, 1.6); } // ears
  }

  // The active delivery target: a waiting customer on a concrete pad, waving.
  function drawTargetCustomer(t) {
    if (!state.carrying) return;
    const c = state.carrying.customer;
    ctx.fillStyle = "#cec7b2";                                 // pad
    ctx.beginPath(); ctx.ellipse(c.x, c.y + 4, 16, 9, 0, 0, Math.PI * 2); ctx.fill();
    const pulse = 10 + Math.sin(t * 0.005) * 3;                // pulse ring
    ctx.strokeStyle = "rgba(255,61,128,0.8)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c.x, c.y, pulse + 8, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(0,0,0,0.25)";                        // shadow
    ctx.beginPath(); ctx.ellipse(c.x + 2, c.y + 6, 6, 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3a6f8a";                                 // body
    roundRect(ctx, c.x - 3, c.y - 6, 6, 11, 2, true, false);
    ctx.fillStyle = "#e8b98a";                                 // head
    ctx.beginPath(); ctx.arc(c.x, c.y - 9, 3.4, 0, Math.PI * 2); ctx.fill();
    const wave = Math.sin(t * 0.012) * 3;                      // waving arm
    ctx.strokeStyle = "#e8b98a"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(c.x + 3, c.y - 4); ctx.lineTo(c.x + 7, c.y - 10 - wave); ctx.stroke();
  }

  // Vehicle sprite painter, reused by the in-game player draw and the UI
  // vehicle preview (StageSelect). Draws centered at (0,0) facing +x.
  function paintVehicle(g, key, veh) {
    const ctx = g;
    if (veh.kind === "bike") {
      // two-wheeler: wheels, frame, rider with helmet
      ctx.fillStyle = "#26222c";
      ctx.beginPath(); ctx.ellipse(-veh.w/2 + 3, 0, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(veh.w/2 - 3, 0, 3.4, 2.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = veh.color;
      if (key === "scooter") {
        roundRect(ctx, -veh.w/2 + 3, -3, veh.w - 6, 6, 2.5, true, false);   // deck + leg shield
        ctx.fillRect(veh.w/2 - 7, -4, 3, 8);
      } else {
        roundRect(ctx, -veh.w/2 + 4, -1.5, veh.w - 8, 3, 1.5, true, false); // thin bici frame
        ctx.fillStyle = "#e8e4da"; ctx.fillRect(-veh.w/2 + 2, -4, 5, 8);    // cooler box on the back
      }
      ctx.fillStyle = "rgba(20,40,60,0.6)";                  // handlebar
      ctx.fillRect(veh.w/2 - 6, -veh.h/2 + 2, 2, veh.h - 4);
      ctx.fillStyle = veh.roof;                               // rider helmet
      ctx.beginPath(); ctx.arc(-1, 0, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fffbe8";                              // headlight
      ctx.fillRect(veh.w/2 - 2, -1.5, 2, 3);
    } else if (key === "tuktuk") {
      // three-wheeler: single front wheel, cabin with canopy
      ctx.fillStyle = "#26222c";
      ctx.beginPath(); ctx.ellipse(veh.w/2 - 2, 0, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-veh.w/2 + 4, -veh.h/2 + 1, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(-veh.w/2 + 4, veh.h/2 - 1, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = veh.color;
      ctx.beginPath();                                        // teardrop body
      ctx.moveTo(veh.w/2, 0);
      ctx.quadraticCurveTo(veh.w/2 - 4, -veh.h/2, -veh.w/2 + 2, -veh.h/2 + 1);
      ctx.lineTo(-veh.w/2 + 2, veh.h/2 - 1);
      ctx.quadraticCurveTo(veh.w/2 - 4, veh.h/2, veh.w/2, 0);
      ctx.fill();
      ctx.fillStyle = veh.roof;                               // canopy
      roundRect(ctx, -veh.w/2 + 3, -veh.h/2 + 2.5, veh.w * 0.6, veh.h - 5, 2, true, false);
      ctx.fillStyle = "#fffbe8"; ctx.fillRect(veh.w/2 - 2, -1.5, 2, 3);
    } else if (key === "cart") {
      // ice-cream cart: white box, striped canopy, small wheels
      ctx.fillStyle = "#26222c";
      ctx.fillRect(-veh.w/2 + 3, -veh.h/2 - 1, 4, 2); ctx.fillRect(-veh.w/2 + 3, veh.h/2 - 1, 4, 2);
      ctx.fillRect(veh.w/2 - 7, -veh.h/2 - 1, 4, 2); ctx.fillRect(veh.w/2 - 7, veh.h/2 - 1, 4, 2);
      ctx.fillStyle = veh.color;
      roundRect(ctx, -veh.w/2, -veh.h/2, veh.w, veh.h, 3, true, false);
      for (let i = 0; i < 4; i++) {                           // striped canopy
        ctx.fillStyle = i % 2 ? "#fff" : veh.roof;
        ctx.fillRect(-veh.w/2 + 2 + i * (veh.w - 4) / 4, -veh.h/2 + 1, (veh.w - 4) / 4, veh.h * 0.45);
      }
      ctx.fillStyle = "#5fb0d6"; ctx.fillRect(-veh.w/2 + 4, veh.h/2 - 6, veh.w - 8, 3); // freezer lid
    } else if (key === "pickup") {
      // pickup: cab up front, open cargo bed behind
      ctx.fillStyle = veh.color;
      roundRect(ctx, -veh.w/2, -veh.h/2, veh.w, veh.h, 3, true, false);
      ctx.fillStyle = veh.roof;                               // cab roof
      ctx.fillRect(veh.w/2 - 14, -veh.h/2 + 2, 9, veh.h - 4);
      ctx.fillStyle = "rgba(30,25,20,0.55)";                  // bed
      ctx.fillRect(-veh.w/2 + 2, -veh.h/2 + 2, veh.w/2 + 2, veh.h - 4);
      ctx.fillStyle = "#e8e4da";                              // cooler in the bed
      ctx.fillRect(-veh.w/2 + 5, -3, 7, 6);
      ctx.fillStyle = "#fffbe8";
      ctx.fillRect(veh.w/2 - 2, -veh.h/2 + 1, 2, 3); ctx.fillRect(veh.w/2 - 2, veh.h/2 - 4, 2, 3);
    } else if (key === "turbo") {
      // kart: low body, exposed wheels, rear spoiler
      ctx.fillStyle = "#26222c";
      ctx.fillRect(-veh.w/2 + 1, -veh.h/2 - 2, 5, 3); ctx.fillRect(-veh.w/2 + 1, veh.h/2 - 1, 5, 3);
      ctx.fillRect(veh.w/2 - 6, -veh.h/2 - 2, 5, 3); ctx.fillRect(veh.w/2 - 6, veh.h/2 - 1, 5, 3);
      ctx.fillStyle = veh.color;                              // narrow hull
      roundRect(ctx, -veh.w/2, -veh.h/2 + 3, veh.w, veh.h - 6, 3, true, false);
      ctx.fillStyle = veh.roof;                               // driver
      ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = veh.color;                              // spoiler
      ctx.fillRect(-veh.w/2 - 2, -veh.h/2 + 1, 3, veh.h - 2);
      ctx.fillStyle = "#fffbe8"; ctx.fillRect(veh.w/2 - 2, -1.5, 2, 3);
    } else {
      ctx.fillStyle = veh.color;
      roundRect(ctx, -veh.w/2, -veh.h/2, veh.w, veh.h, 3, true, false);
      ctx.fillStyle = veh.roof;
      ctx.fillRect(-veh.w/2 + 2, -veh.h/2 + 2, veh.w - 4, veh.h * 0.5);
      ctx.fillStyle = "rgba(20,40,60,0.6)";
      ctx.fillRect(veh.w/2 - 7, -veh.h/2 + 2, 4, veh.h - 4);
      ctx.fillStyle = "#fffbe8";
      ctx.fillRect(veh.w/2 - 2, -veh.h/2 + 1, 2, 3); ctx.fillRect(veh.w/2 - 2, veh.h/2 - 4, 2, 3);
    }
  }

  function drawPlayer(p, veh) {
    const lift = (state.elev || 0) * 7;   // the barro avenue rides ~1 m up
    ctx.save();
    // ground shadow — the body's own silhouette, dropped further behind and
    // faded as the car climbs the ramp
    ctx.save(); ctx.translate(p.x + 4 + lift * 0.6, p.y + 6 + lift); ctx.rotate(p.a);
    ctx.fillStyle = `rgba(0,0,0,${(0.35 - lift * 0.02).toFixed(3)})`;
    traceVehicleSilhouette(ctx, state.vehicleKey, veh); ctx.fill(); ctx.restore();
    ctx.translate(p.x, p.y - lift); ctx.rotate(p.a);
    paintVehicle(ctx, state.vehicleKey, veh);
    if (state.carrying) {
      const m = state.carrying.melt / state.carrying.total;
      ctx.fillStyle = "#fff"; ctx.fillRect(-3, -veh.h/2 - 6, 6, 8);
      const hRed = 6 * (1 - m * 0.5);
      ctx.fillStyle = `oklch(0.62 0.22 ${25 + m * 20})`;
      ctx.fillRect(-3, -veh.h/2 - 6 + (6 - hRed), 6, hRed);
      ctx.fillStyle = "#fff"; ctx.fillRect(-3, -veh.h/2 - 7, 6, 2);
    }
    ctx.restore();
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

  // ---- Main render --------------------------------------------------------
  // Camera zoom: >1 pulls the camera closer so streets/buildings read at
  // city-exploration scale. World-space span shrinks accordingly.
  let ZOOM = 5.5; // recomputed responsively per viewport in setupCanvas()

  function render(t) {
    if (!ctx) return;
    const cw = canvas.width, ch = canvas.height;
    const vw = cw / dpr, vh = ch / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);

    // Camera
    const shake = state.cam.shake;
    const sx = (Math.random() - 0.5) * shake, sy = (Math.random() - 0.5) * shake;
    const cam = { x: state.cam.x + sx, y: state.cam.y + sy };
    const wvw = vw / ZOOM, wvh = vh / ZOOM;
    const view = { x0: cam.x - wvw/2 - 40, x1: cam.x + wvw/2 + 40, y0: cam.y - wvh/2 - 40, y1: cam.y + wvh/2 + 40 };

    // World transform (zoomed)
    ctx.translate(vw/2, vh/2);
    ctx.scale(ZOOM, ZOOM);
    ctx.translate(-cam.x, -cam.y);

    // Sky/water everywhere (drawn in world coords across viewport)
    drawWaterAll(view, t);
    // Boats (behind land)
    for (const b of boats) {
      if (b.x < view.x0 - 80 || b.x > view.x1 + 80) continue;
      drawBoat(b);
    }
    // Painterly 2-D world from resident tiles: land silhouette + road strokes +
    // buildings + palms/trees (replaces the corridor's global-array drawers).
    drawWorld2D(view, t);
    // Hand-drawn set pieces the painterly pass doesn't cover: the Muelle de
    // Cruceros deck (its BRIDGE surface cells are drivable but not painted by
    // the vector road pass) and the Mata de Limón suspension bridge.
    drawPier(view);
    drawBridge(view);
    drawBarriers(view);
    // Landmarks (the bridge has its own drawer)
    for (const lm of W.LANDMARKS) {
      if (lm.x < view.x0 - 60 || lm.x > view.x1 + 60) continue;
      if (lm.type === "bridge") continue;
      drawLandmark(lm);
    }
    // Sponsored lotes from the remote content (billboards / storefronts)
    for (const lo of content.lotes) {
      if (lo.x < view.x0 - 60 || lo.x > view.x1 + 60 || lo.y < view.y0 - 60 || lo.y > view.y1 + 60) continue;
      drawLote(lo);
    }
    // Pedestrians, traffic
    for (const pe of pedestrians) {
      if (pe.x < view.x0 - 20 || pe.x > view.x1 + 20) continue;
      drawPed(pe);
    }
    for (const pk of parked) {
      if (pk.x < view.x0 - 20 || pk.x > view.x1 + 20 || pk.y < view.y0 - 20 || pk.y > view.y1 + 20) continue;
      drawCar(pk);
    }
    for (const vn of vendors) {
      if (vn.x < view.x0 - 20 || vn.x > view.x1 + 20 || vn.y < view.y0 - 20 || vn.y > view.y1 + 20) continue;
      drawVendor(vn, t);
    }
    for (const an of animals) {
      if (an.x < view.x0 - 20 || an.x > view.x1 + 20 || an.y < view.y0 - 20 || an.y > view.y1 + 20) continue;
      drawAnimal(an);
    }
    for (const car of traffic) {
      if (car.x < view.x0 - 20 || car.x > view.x1 + 20) continue;
      drawCar(car);
    }
    for (const tr of trains) {
      if (tr.x < view.x0 - 140 || tr.x > view.x1 + 140 || tr.y < view.y0 - 140 || tr.y > view.y1 + 140) continue;
      drawTrain(tr, t);
    }
    // Particles
    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.c;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Active delivery target, then player (neither exists in attract mode)
    if (!state.attract) {
      drawTargetCustomer(t);
      drawPlayer(state.p, state.veh);
    }
    // Gulls above
    for (const g of gulls) {
      if (g.x < view.x0 - 30 || g.x > view.x1 + 30) continue;
      drawGull(g);
    }
    // Floats
    for (const f of state.floats) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / f.ttl);
      ctx.fillStyle = f.color;
      ctx.font = "bold 12px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    // Debug coordinate grid (topmost world-space layer)
    if (state.debug) drawDebugGrid(view, ZOOM);

    // Overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = weatherColors();
    ctx.fillStyle = C.tint; ctx.fillRect(0, 0, vw, vh);
    if (state.weather === "storm") drawRain(vw, vh, t);
    if (state.weather === "night") drawNightVignette(vw, vh);

    if (!state.attract) {
      drawMinimap(vw, vh, t);
      drawCompass(vw, vh);
    }

    if (!state.attract && state.p.speed > 240) {
      ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const y = Math.random() * vh, len = 40 + Math.random() * 60;
        ctx.beginPath(); ctx.moveTo(vw - 20 - len, y); ctx.lineTo(vw - 20, y); ctx.stroke();
      }
    }
  }

export { setupCanvas, render, paintVehicle };
