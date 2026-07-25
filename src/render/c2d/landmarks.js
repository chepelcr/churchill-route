// Landmark drawers: the faro scene, green spaces, the estadios, fountains,
// pools, the Parque Marino and the sponsored lotes, behind drawLandmark().
import { paintPalm, paintTree } from "./flora.js";
import { areaLabel, ctx, hash01, label, lastT, polyBBox, roundRect } from "./gfx.js";

// El Faro at La Punta — paved plaza on the rocky point: riprap armor on the
// water side, red crescent shade benches, palms and the red/white tower.
function drawFaroScene(lm) {
  const x = lm.x, y = lm.y;
  // La Punta plaza: the GRAY esplanade GROUND is drawn by the tile plaza layer
  // (an "esplanade" fill following the real sand shape — no circle, no sand
  // under it). Here we only add the on-plaza decoration: riprap rimming the
  // shape, the iconic RED comma "islands" (spread across the plaza by the
  // build), palms and the tower.
  const rim = lm.rim;   // rocks only on the real sand/water edge (build-emitted)
  if (rim) {
    for (let i = 0; i < rim.length; i++) {
      const rx = rim[i][0], ry = rim[i][1];
      const r0 = 1.8 + hash01(lm.x * 7.13 + i * 12.9) * 2.4;
      ctx.fillStyle = i % 3 ? "#4a4d52" : "#5a5e64";
      ctx.beginPath();
      ctx.ellipse(rx, ry, r0 + 1.4, r0, hash01(i * 9.4 + lm.x) * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // (the red comma "islands" are drawn in the GROUND layer — drawFaroCommas —
  // so the trees sit on top of them, not the other way around)
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

// A green space (park / stadium field): grass with mow stripes, a ring of
// trees around the edge, and optionally a central fountain (animated water)
// or a faint sports-pitch outline. Non-drivable — the surface under it is a
// wall; this just paints it green instead of bare sand.
function drawGreenSpace(lm, w, h, opts = {}) {
  const x = lm.x, y = lm.y;
  // Parks (opts.ground === false): the green GROUND is painted by the block
  // footprint (plaza-green) so it can never overlap streets and follows the
  // block orientation — here we only add the fountain, a small tight tree
  // cluster near the centre, and the label. Stadium/standalone keep the
  // legacy self-drawn grass rect + pitch outline.
  if (opts.ground === false) {
    // Trees hug the park perimeter (well clear of the central fountain), so
    // the ring reads as shade trees around the plaza, not a clump on the jet.
    const rx = Math.max(20, w / 2 - 14), ry = Math.max(18, h / 2 - 14);
    const n = Math.max(6, Math.round((w + h) / 26));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + hash01(i + lm.x) * 0.35;
      const f = 0.82 + hash01(i * 5 + lm.y) * 0.16;
      paintTree({ x: x + Math.cos(a) * rx * f, y: y + Math.sin(a) * ry * f, s: 0.8 + hash01(i + lm.x) * 0.35 });
    }
    if (opts.fountain) drawFountain(x, y);
    return;
  }
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  roundRect(ctx, x - w / 2 + 3, y - h / 2 + 4, w, h, 12, true, false); // soft shadow
  ctx.fillStyle = "#4f9d5b";
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 12, true, false);         // grass
  ctx.strokeStyle = "rgba(232,226,210,0.55)"; ctx.lineWidth = 3;       // gravel path border
  roundRect(ctx, x - w / 2 + 5, y - h / 2 + 5, w - 10, h - 10, 9, false, true);
  if (opts.pitch) {                                                    // sports pitch outline
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 2;
    ctx.strokeRect(x - w / 2 + 16, y - h / 2 + 14, w - 32, h - 28);
    ctx.beginPath(); ctx.moveTo(x, y - h / 2 + 14); ctx.lineTo(x, y + h / 2 - 14); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.stroke();
  }
  // tree ring around the perimeter (deterministic scatter)
  const n = Math.round((w + h) / 24);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rx = w / 2 - 10 - hash01(i * 3 + lm.x) * 8;
    const ry = h / 2 - 10 - hash01(i * 7 + lm.y) * 8;
    paintTree({ x: x + Math.cos(a) * rx, y: y + Math.sin(a) * ry, s: 0.8 + hash01(i + lm.x) * 0.4 });
  }
  if (opts.fountain) drawFountain(x, y);
}

// Estadio — NAME PILL ONLY. The stadium itself (grey graderías on the block's
// real sidewalk + the pitch and its markings) is painted inside the acera pass,
// paintStadiumCuadras in ./streets.js: it's a colour choice on ground that
// already exists, not a structure stacked on a later layer. Drawing it here is
// what used to bury the street name pills under the block.
function drawStadium(lm) {
  const pts = lm.footprint;
  if (!pts || pts.length < 6) {                       // no traced cuadra: legacy rect
    const w = lm.w || 156, h = lm.h || 122;
    drawGreenSpace(lm, w, h, { pitch: true });
    areaLabel(lm.x - w / 2, lm.y - h / 2, lm.x + w / 2, lm.y + h / 2, "ESTADIO", "#fff", "#2e7d44");
    return;
  }
  const b = polyBBox(pts);
  areaLabel(b.x0, b.y0, b.x1, b.y1, (lm.name || "Estadio").toUpperCase(), "#fff", "#2e7d44");
}

// Central fountain with living (animated) water: stone basin, rippling pool,
// a bobbing central jet and droplets. Animated off lastT.
function drawFountain(x, y) {
  const tt = lastT * 0.003;
  ctx.fillStyle = "#b9b3a4"; ctx.beginPath(); ctx.arc(x, y, 17, 0, Math.PI * 2); ctx.fill(); // rim
  ctx.fillStyle = "#d6d0c0"; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "#4fb4d6"; ctx.fillRect(x - 12, y - 12, 24, 24);                            // pool water
  ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 1;                              // ripples
  for (let k = 0; k < 3; k++) {
    const rr = ((tt + k / 3) % 1) * 12;
    ctx.globalAlpha = Math.max(0, 1 - rr / 12);
    ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  const jh = 9 + Math.sin(tt * 6) * 2;                                                        // central jet
  ctx.fillStyle = "rgba(206,236,246,0.9)";
  ctx.beginPath(); ctx.ellipse(x, y - jh / 2, 2, jh / 2, 0, 0, Math.PI * 2); ctx.fill();
  for (let d = 0; d < 5; d++) {                                                               // droplets
    const a = (d / 5) * Math.PI * 2 + tt * 2;
    const rr = 3 + ((tt * 22 + d * 2.5) % 9);
    ctx.beginPath(); ctx.arc(x + Math.cos(a) * rr, y - jh + Math.sin(a) * 2, 1.2, 0, Math.PI * 2); ctx.fill();
  }
}

// A landscaped pool: tiled concrete deck, animated shimmering water with
// moving highlights, a shallow end + slide. Reused for the Balneario and for
// the Parque Marino's aquarium tanks. `s` scales it; `palms` frames it.
function drawPool(x, y, rot, s = 1, palms = true) {
  const tt = lastT * 0.0022;
  ctx.save();
  ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
  ctx.fillStyle = "#e8e2d2";                                  // concrete deck
  ctx.beginPath(); ctx.ellipse(0, 0, 78, 48, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#ccc4ae"; ctx.lineWidth = 5;             // tiled coping ring
  ctx.beginPath(); ctx.ellipse(0, 0, 72, 43, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.save();                                                 // clip to water
  ctx.beginPath(); ctx.ellipse(0, 0, 66, 38, 0, 0, Math.PI * 2); ctx.clip();
  ctx.fillStyle = "#4fbdd8"; ctx.fillRect(-70, -42, 140, 84);
  ctx.fillStyle = "rgba(40,120,160,0.35)";                    // deeper centre
  ctx.beginPath(); ctx.ellipse(6, 4, 42, 24, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#aeeaf2";                                  // shallow end
  ctx.beginPath(); ctx.ellipse(-42, 8, 22, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 2;   // moving shimmer
  for (let i = 0; i < 4; i++) {
    const yy = -28 + i * 15 + Math.sin(tt * 3 + i) * 3;
    ctx.beginPath();
    for (let xx = -66; xx <= 66; xx += 8) ctx.lineTo(xx, yy + Math.sin(xx * 0.08 + tt * 4 + i) * 2.5);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = "#f3c969"; ctx.beginPath(); ctx.arc(-54, 22, 6, 0, Math.PI * 2); ctx.fill(); // slide
  ctx.restore();
  if (palms) {
    paintPalm({ x: x + 60 * s, y: y - 30 * s, s: 0.7 * Math.max(0.7, s) }, lastT);
    paintPalm({ x: x - 62 * s, y: y - 22 * s, s: 0.7 * Math.max(0.7, s) }, lastT);
  }
}

// Parque Marino del Pacífico: its green already fills the whole cuadra
// (footprint plaza-green). The build hands us interior pool points (lm.pools,
// guaranteed on the footprint so they never spill onto streets); we draw an
// aquarium tank + a leafy tree at each.
function drawMarinePark(lm) {
  const pools = lm.pools || [];
  for (let i = 0; i < pools.length; i++) {
    const px = pools[i][0], py = pools[i][1];
    if (i % 2) paintPalm({ x: px - 26, y: py + 12, s: 0.75 }, lastT);
    else paintTree({ x: px - 24, y: py + 12, s: 0.85 });
  }
  for (let i = 0; i < pools.length; i++)
    drawPool(pools[i][0], pools[i][1], i % 2 ? 0.18 : -0.14, 0.46, false);
  const mw = lm.w || 240, mh = lm.h || 120;
  areaLabel(lm.x - mw / 2, lm.y - mh / 2, lm.x + mw / 2, lm.y + mh / 2,
            "PARQUE MARINO", "#fff", "#2e7d44");
}

// AREA landmarks draw no object at their anchor — the plaza, the pool and the
// park ARE their ground. The generic drop shadow below would be a dark ellipse
// floating in the middle of the grass / the water with nothing casting it.
const NO_SHADOW = new Set(["stadium", "pool", "park"]);

function drawLandmark(lm) {
  const x = lm.x, y = lm.y;
  if (!NO_SHADOW.has(lm.type)) {
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath(); ctx.ellipse(x + 4, y + 8, 18, 5, 0, 0, Math.PI * 2); ctx.fill();
  }
  switch (lm.type) {
    case "kiosk": {
      // white + ORANGE kiosk (was red); the churchill drink stays red — it's the syrup
      ctx.fillStyle = "#fff"; ctx.fillRect(x - 16, y - 8, 32, 18);
      for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? "#fff" : "#f08a5d"; ctx.fillRect(x - 16 + i * 8, y - 14, 8, 6); }
      ctx.fillStyle = "rgba(255,255,255,0.9)"; ctx.fillRect(x - 4, y - 4, 8, 12);
      ctx.fillStyle = "#ff3d80"; ctx.fillRect(x - 4, y, 8, 6);
      ctx.fillStyle = "#fff"; ctx.fillRect(x - 4, y - 4, 8, 3);
      label(x, y - 22, "CHURCHILL", "#fff", "#f08a5d"); break;
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
      ctx.fillStyle = "#e7ddc8"; ctx.fillRect(x - 20, y - 12, 40, 24);          // pale stucco nave
      ctx.fillStyle = "#b98a5e"; ctx.fillRect(x - 20, y - 12, 40, 4);
      // bell tower with a tall spire so it reads as a church, not a house
      ctx.fillStyle = "#e7ddc8"; ctx.fillRect(x - 6, y - 30, 12, 20);
      ctx.fillStyle = "#9e6f4a"; ctx.beginPath(); ctx.moveTo(x - 8, y - 28); ctx.lineTo(x, y - 40); ctx.lineTo(x + 8, y - 28); ctx.closePath(); ctx.fill();
      // bold white cross on top
      ctx.fillStyle = "#fff"; ctx.fillRect(x - 1.5, y - 50, 3, 11); ctx.fillRect(x - 5, y - 46, 10, 3);
      ctx.fillStyle = "#7fa8c8"; ctx.fillRect(x - 3, y - 26, 6, 8);              // door
      label(x, y - 54, lm.type === "cathedral" ? "CATEDRAL" : "IGLESIA", "#fff", "#9e6f4a"); break;
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
    case "park": {
      const pw = lm.w || 116, ph = lm.h || 90;
      if (lm.marine) { drawMarinePark(lm, pw, ph); break; }
      drawGreenSpace(lm, pw, ph, { fountain: true, ground: false });
      areaLabel(x - pw / 2, y - ph / 2, x + pw / 2, y + ph / 2, "PARQUE", "#fff", "#2e7d44"); break;
    }
    case "stadium": {
      drawStadium(lm); break;
    }
    case "museum": {
      // neoclassical facade: portico columns + pediment
      ctx.fillStyle = "#eae3d2"; ctx.fillRect(x - 22, y - 12, 44, 24);
      ctx.fillStyle = "#d8cfb8"; ctx.beginPath(); ctx.moveTo(x - 24, y - 12); ctx.lineTo(x, y - 24); ctx.lineTo(x + 24, y - 12); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#c3b79a";
      for (let i = 0; i < 5; i++) ctx.fillRect(x - 20 + i * 9, y - 10, 4, 20); // columns
      label(x, y - 28, "MUSEO", "#fff", "#8a6f4a"); break;
    }
    case "civic": {
      ctx.fillStyle = "#6fbf99"; ctx.fillRect(x - 20, y - 10, 40, 22);
      ctx.fillStyle = "#fff"; ctx.fillRect(x - 6, y - 6, 12, 12);
      label(x, y - 18, "CULTURA", "#fff", "#2e7d44"); break;
    }
    case "marina": {
      ctx.fillStyle = "#5fb0d6"; ctx.fillRect(x - 18, y - 8, 36, 16);
      ctx.fillStyle = "#fff"; ctx.fillRect(x - 4, y - 18, 2, 10); ctx.beginPath(); ctx.moveTo(x - 4, y - 18); ctx.lineTo(x + 6, y - 12); ctx.lineTo(x - 4, y - 8); ctx.fill();
      label(x, y - 24, "YACHT", "#fff", "#3a6f8a"); break;
    }
    case "pool": {
      // Balneario Municipal at La Punta — a SEA-WATER inlet: the cuadra is
      // painted by the living-sea effect (its outline is in W.WATERS) with a
      // boat + swimmers inside; here we only tag it with a label.
      const bw = lm.w || 120, bh = lm.h || 60;
      areaLabel(x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2, "BALNEARIO", "#fff", "#3a6f8a"); break;
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

export { drawFaroScene, drawFountain, drawGreenSpace, drawLandmark, drawLote, drawMarinePark, drawPool, drawStadium };
