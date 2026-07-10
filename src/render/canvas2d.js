// La Ruta del Churchill — Canvas2D render backend (extracted from engine.js).
// Milestone C swaps this for a PixiJS backend behind render/Renderer.js.
// The game loop (src/game/index.js) calls setupCanvas(canvas) then render(t).
import { WORLD as W } from "../world/index.js";
import {
  state, traffic, pedestrians, gulls, boats, parked, vendors, animals,
} from "../game/state.js";
import { nearestKiosk } from "../game/delivery.js";

  // ----- Render -------------------------------------------------------------
  let canvas, ctx, dpr = 1;
  // Cuadrícula-based responsive zoom: frame ~CUADS_PER_VIEW cuadrículas so every
  // device shows the same amount of city. Clamped so small screens don't zoom
  // out too far (they show fewer cuadrículas, more detail).
  const CUAD = (W.META && W.META.cuad) || 20;
  const CUADS_PER_VIEW = (W.META && W.META.cuadsPerView) || 12;
  const ACERA_PX = (W.META && W.META.aceraPx) || 8; // sidewalk depth per side
  function computeZoom(wCss, hCss) {
    const z = wCss / (CUADS_PER_VIEW * CUAD);
    return Math.max(4.5, Math.min(9, z));
  }
  function setupCanvas(c) {
    canvas = c; ctx = c.getContext("2d");
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth, h = c.clientHeight;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      ZOOM = computeZoom(w, h);
    };
    resize(); window.addEventListener("resize", resize);
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
  function ensureRenderCache() {
    if (RC) return RC;
    RC = { land: [], beach: [], water: [], roads: [], buildings: [], medians: [], landAll: new Path2D() };
    for (const m of W.MEDIANS) RC.medians.push({ path: flatPath(m.pts, false), w: m.w, aabb: flatAABB(m.pts) });
    for (const poly of W.LAND_POLYS) {
      const path = flatPath(poly, true);
      RC.land.push({ path, aabb: flatAABB(poly) });
      RC.landAll.addPath(path);
    }
    for (const poly of W.BEACHES) RC.beach.push({ path: flatPath(poly, true), aabb: flatAABB(poly) });
    for (const poly of W.WATERS) RC.water.push({ path: flatPath(poly, true), aabb: flatAABB(poly) });
    for (let i = 0; i < W.ROADS.length; i++) {
      const r = W.ROADS[i];
      RC.roads.push({ i, r, path: flatPath(r.pts, false) });
    }
    RC.roads.sort((a, b) => (ROAD_ORDER[a.r.cls] || 0) - (ROAD_ORDER[b.r.cls] || 0));
    for (const b of W.BUILDINGS) RC.buildings.push({ b, path: flatPath(b.pts, true) });
    return RC;
  }
  function aabbInView(a, view, pad) {
    return !(a.x1 + pad < view.x0 || a.x0 - pad > view.x1 || a.y1 + pad < view.y0 || a.y0 - pad > view.y1);
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
    // Aceras: concrete sidewalk band under everything (matches the grid's
    // 1-cuadrícula acera fringe on both sides)
    ctx.strokeStyle = "#cec7b2";
    for (const e of visible) {
      if (e.r.bridge || e.r.cls === "bridge") continue;
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
    // Asphalt pass
    for (const e of visible) {
      ctx.strokeStyle = e.r.cls === "paseo" ? "#f4dca3" : "#3a3540";
      ctx.lineWidth = e.r.w;
      ctx.stroke(e.path);
    }
    // Center lines: yellow dashes on main routes, faint white on locals
    for (const e of visible) {
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
      case "bridge": {
        /* drawn separately by drawBridge */ break;
      }
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

  // District lock barriers (free-roam mode)
  function drawBarriers(view) {
    if (state.mode !== "explore" || !state.barriers) return;
    for (const br of state.barriers) {
      if (br.x < view.x0 - 30 || br.x > view.x1 + 30) continue;
      const yTop = W.topY(br.x), yBot = W.botY(br.x);
      // striped barrier sign + cones
      const segH = 12;
      for (let y = yTop + 6; y < yBot - 6; y += segH) {
        ctx.fillStyle = ((y / segH) | 0) % 2 ? "#f3c969" : "#3a3540";
        ctx.fillRect(br.x - 4, y, 8, segH);
      }
      // sign
      ctx.fillStyle = "rgba(20,16,40,0.85)";
      const sw = 120;
      const sy = (yTop + yBot) / 2;
      ctx.fillRect(br.x - sw/2, sy - 14, sw, 28);
      ctx.fillStyle = "#ff3d80"; ctx.font = "bold 9px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
      ctx.fillText("⛔ BLOQUEADO", br.x, sy - 3);
      ctx.fillStyle = "#fff";
      ctx.fillText("ETAPA " + (br.requiredStage || "—"), br.x, sy + 9);
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

  function drawPlayer(p, veh) {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.save(); ctx.translate(p.x + 4, p.y + 6); ctx.rotate(p.a); ctx.fillRect(-veh.w/2, -veh.h/2, veh.w, veh.h); ctx.restore();
    ctx.translate(p.x, p.y); ctx.rotate(p.a);
    const key = state.vehicleKey;
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

  function drawObjectiveArrow() {
    const p = state.p;
    let target = state.carrying ? state.carrying.customer : nearestKiosk(p).lm;
    if (!target) return;
    const dx = target.x - p.x, dy = target.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 40) return;
    const a = Math.atan2(dy, dx);
    const ax = p.x + Math.cos(a) * 40, ay = p.y + Math.sin(a) * 40;
    ctx.save();
    ctx.translate(ax, ay); ctx.rotate(a);
    ctx.fillStyle = state.carrying ? "#ff3d80" : "#ffe06b";
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-4, -6); ctx.lineTo(-4, 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
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

  function drawMinimap(vw, vh) {
    const mw = 320, mh = 64;
    const mx = vw - mw - 18, my = 18;
    ctx.fillStyle = "rgba(20,16,40,0.78)";
    roundRect(ctx, mx, my, mw, mh, 10, true, false);
    // Water bg
    ctx.fillStyle = "#3a8a99"; ctx.fillRect(mx + 4, my + 4, mw - 8, mh - 8);
    // Peninsula silhouette — sampled land extents (same y mapping as the target dot)
    ctx.fillStyle = "#caa56a";
    ctx.beginPath();
    const innerW = mw - 12; const innerX = mx + 6;
    const innerY = my + mh / 2;
    const yScale = (mh / 2 - 6) / 320;
    const clampMapY = (sy) => Math.max(my + 4, Math.min(my + mh - 4, sy));
    for (let i = 0; i <= 60; i++) {
      const t = i / 60;
      const wx = t * W.W;
      const sx = innerX + t * innerW;
      const sy = clampMapY(innerY + (W.topY(wx) - 700) * yScale);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    for (let i = 60; i >= 0; i--) {
      const t = i / 60;
      const wx = t * W.W;
      const sx = innerX + t * innerW;
      const sy = clampMapY(innerY + (W.botY(wx) - 700) * yScale);
      ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fill();
    // district markers
    ctx.font = "8px 'JetBrains Mono', monospace"; ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.textAlign = "center";
    for (const d of W.DISTRICTS) {
      const xa = innerX + ((d.x0 + d.x1) / 2 / W.W) * innerW;
      ctx.fillText(d.short.toUpperCase(), xa, my + mh - 6);
    }
    // player dot
    const px = innerX + (state.p.x / W.W) * innerW;
    ctx.fillStyle = "#ffe06b"; ctx.beginPath(); ctx.arc(px, innerY, 4, 0, Math.PI * 2); ctx.fill();
    // target
    const tgt = state.carrying ? state.carrying.customer : nearestKiosk(state.p).lm;
    if (tgt) {
      const tx = innerX + (tgt.x / W.W) * innerW;
      const ty = innerY + ((tgt.y - 700) / 320) * (mh / 2 - 6);
      ctx.fillStyle = state.carrying ? "#ff3d80" : "#fff";
      ctx.beginPath(); ctx.arc(tx, ty, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 1; roundRect(ctx, mx, my, mw, mh, 10, false, true);
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
    // Hills behind Mata de Limón mainland (over the water, before land)
    drawHills(view);
    // Boats (behind land)
    for (const b of boats) {
      if (b.x < view.x0 - 80 || b.x > view.x1 + 80) continue;
      drawBoat(b);
    }
    drawLand(view);
    // Estuary (water hole inside the mainland) + mangroves
    drawEstuary(view);
    drawMangroves(view);
    drawStreets(view);
    drawMedians(view);
    drawPier(view);
    drawBridge(view);
    drawStreetLabels(view);
    drawPalms(view, t);
    drawBuildings(view);
    drawBarriers(view);
    // Landmarks (the bridge has its own drawer)
    for (const lm of W.LANDMARKS) {
      if (lm.x < view.x0 - 60 || lm.x > view.x1 + 60) continue;
      if (lm.type === "bridge") continue;
      drawLandmark(lm);
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
    // Particles
    for (const pt of state.particles) {
      ctx.globalAlpha = Math.max(0, pt.life);
      ctx.fillStyle = pt.c;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Active delivery target, then player
    drawTargetCustomer(t);
    drawPlayer(state.p, state.veh);
    // Gulls above
    for (const g of gulls) {
      if (g.x < view.x0 - 30 || g.x > view.x1 + 30) continue;
      drawGull(g);
    }
    drawObjectiveArrow();
    // Floats
    for (const f of state.floats) {
      ctx.globalAlpha = Math.max(0, 1 - f.t / f.ttl);
      ctx.fillStyle = f.color;
      ctx.font = "bold 12px 'Space Grotesk', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y);
      ctx.globalAlpha = 1;
    }

    // Overlays
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const C = weatherColors();
    ctx.fillStyle = C.tint; ctx.fillRect(0, 0, vw, vh);
    if (state.weather === "storm") drawRain(vw, vh, t);
    if (state.weather === "night") drawNightVignette(vw, vh);

    drawMinimap(vw, vh);

    if (state.p.speed > 240) {
      ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const y = Math.random() * vh, len = 40 + Math.random() * 60;
        ctx.beginPath(); ctx.moveTo(vw - 20 - len, y); ctx.lineTo(vw - 20, y); ctx.stroke();
      }
    }
  }

export { setupCanvas, render };
