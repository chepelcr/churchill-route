// LA PUNTA — El Faro y el Balneario, como el lugar que son.
//
// Hasta ahora la cuadra entera del Balneario era una ensenada de mar. El mundo
// trae ahora las figuras de verdad (`manifest.punta`, autoradas en
// content/world/punta.json): el terreno, el deck, la piscina en forma de coma
// con sus tres zonas y la piscina redonda.
//
// EL MALECÓN NO SE PINTA ACÁ, Y ES A PROPÓSITO: es la plazoleta del Faro de
// siempre, piedra gris y mosaico, y la sigue pintando `malecon.js` desde
// `manifest.malecon`. Lo único que este archivo le pone encima son sus
// figuras — abanicos al norte del Faro, olas al sur — en un rojo apagado, el
// de las comas de antes pasado por gris. Un solo piso, con el dibujo nuevo.
//
// El mundo dice DÓNDE; `materials.json → punta` dice de qué está hecho. Los
// verbos de acá son tres y son geometría: `sector` (el abanico), `outline`
// (la ola, desde su contorno unitario) y la escollera sembrada por hash.
// Edificios, toldos, palmas y árboles NO se pintan acá: van en los tiles como
// todos los demás, y los dibuja quien ya los dibuja.
//
// Se pinta después del malecón y ANTES de las calles, así que la banda de
// acera y el asfalto siguen tapando lo que llegue al cordón.
import { WORLD2D as W } from "../../world2d/index.js";
import { aabbInView, blendPalette, ctx, flatAABB, flatPath, hash01, textureScale, upright, weatherColors } from "./gfx.js";
import { overlayTexture } from "./materials.js";
import { sunShadow } from "./shadows.js";
import { drawWaterAll } from "./ground.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import PROPS from "../../assets/world-props.json" with { type: "json" };

const M = MATERIALS.punta;
const ROCKS = MATERIALS.coast.rocks;
// LA PISCINA SE PINTA COMO LAS DEL PARQUE MARINO: la misma paleta de la escena
// `pool` (deck, brocal, agua, hondo, bajo, brillo), sobre la forma de verdad.
// Se LEE de esa escena; acá no hay copia.
const POOL = PROPS.scenes.pool.palette;
const INK = M.figures.ink;
const RAD = Math.PI / 180;

function shape(s) {
  if (!s._path) { s._path = flatPath(s.pts, true); s._aabb = flatAABB(s.pts); }
  return s._path;
}

function fanPath(f, half) {
  if (f._path) return f._path;
  const p = new Path2D();
  p.moveTo(f.x, f.y);
  p.arc(f.x, f.y, f.r, f.ang - half, f.ang + half);
  p.closePath();
  return (f._path = p);
}

// la ola: su contorno unitario llevado al eje de cada una
function wavePath(w, outline) {
  if (w._path) return w._path;
  const dx = Math.cos(w.ang), dy = Math.sin(w.ang), L = w.len;
  const pts = outline.map(([u, v]) => [
    w.x + dx * (u - 0.5) * L + dy * v * L,
    w.y + dy * (u - 0.5) * L - dx * v * L,
  ]);
  // esquinas redondeadas sin mover las colas: cuadráticas por los puntos medios
  const p = new Path2D(), n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const tails = new Set([0, outline.findIndex(([u]) => u === 1)]);
  p.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i <= n; i++) {
    const c = pts[i % n], nx = pts[(i + 1) % n];
    if (tails.has(i % n)) { p.lineTo(c[0], c[1]); continue; }
    const m = tails.has((i + 1) % n) ? nx : mid(c, nx);
    p.quadraticCurveTo(c[0], c[1], m[0], m[1]);
  }
  p.closePath();
  return (w._path = p);
}

function paintRiprap(line, view) {
  if (!line._rocks) {
    const rocks = [], step = M.riprap.stepM * W.PX_PER_M, [r0, r1] = M.riprap.rockM;
    for (let i = 0; i + 3 < line.pts.length; i += 2) {
      const ax = line.pts[i], ay = line.pts[i + 1], bx = line.pts[i + 2], by = line.pts[i + 3];
      const len = Math.hypot(bx - ax, by - ay), nx = -(by - ay) / len, ny = (bx - ax) / len;
      for (let s = 0; s < len; s += step) {
        for (let k = 0; k < 3; k++) {
          const h = hash01(ax * 7.13 + ay * 3.71 + s * 1.37 + k * 91.7), h2 = hash01(h * 977 + k);
          const off = (h - 0.5) * line.w;
          rocks.push([ax + (bx - ax) * s / len + nx * off, ay + (by - ay) * s / len + ny * off,
            (r0 + (r1 - r0) * h2) * W.PX_PER_M / 2, ROCKS[(h2 * ROCKS.length) | 0]]);
        }
      }
    }
    line._rocks = rocks; line._path = flatPath(line.pts, false); line._aabb = flatAABB(line.pts);
  }
  ctx.strokeStyle = M.riprap.bed; ctx.lineWidth = line.w; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.stroke(line._path);
  const x0 = view.x0 - 8, x1 = view.x1 + 8, y0 = view.y0 - 8, y1 = view.y1 + 8;
  for (const [x, y, r, ink] of line._rocks) {
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;       // la línea mide kilómetros: sólo lo que se ve
    ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

// EL TOLDO Y LA PÉRGOLA: techo, no edificio. El toldo es lona con sus limatesas del
// borde al centro; la pérgola, viguetas a lo ancho sobre el piso que deja ver.
function paintRoof(rf, ppm) {
  const R = M.roofs, path = shape(rf), a = rf._aabb, cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
  ctx.save(); ctx.translate(3, 4); ctx.fillStyle = R.shadow; ctx.fill(path); ctx.restore();
  if (rf.kind === "pergola") {
    ctx.save(); ctx.clip(path);
    ctx.fillStyle = R.pergola; ctx.fill(path);
    ctx.strokeStyle = R.pergolaBeam; ctx.lineWidth = 0.35 * ppm;
    const step = R.beamEveryM * ppm;
    ctx.beginPath();
    for (let k = a.x0 + a.y0 - a.y1; k < a.x1; k += step) { ctx.moveTo(k, a.y0); ctx.lineTo(k + (a.y1 - a.y0), a.y1); }
    ctx.stroke(); ctx.restore();
    return;
  }
  ctx.fillStyle = R.canopy; ctx.fill(path);
  ctx.strokeStyle = R.canopyRidge; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < rf.pts.length; i += 2) { ctx.moveTo(rf.pts[i], rf.pts[i + 1]); ctx.lineTo(cx, cy); }
  ctx.stroke();
  ctx.strokeStyle = R.canopyEdge; ctx.lineWidth = 1.6; ctx.stroke(path);
}

// LAS PIEZAS DEL BALNEARIO, desde arriba: sombrilla, camas de sol, flotador, tobogán, barco.
function paintFun(f, ppm, t) {
  const F = M.fun;
  if (f.kind === "slide") {
    if (!f._path) f._path = flatPath(f.pts, false);
    const w = F.slideM * ppm, tw = F.slideTowerM * ppm;
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.save(); ctx.translate(3, 4); ctx.strokeStyle = F.shadow; ctx.lineWidth = w; ctx.stroke(f._path); ctx.restore();
    ctx.strokeStyle = f.color; ctx.lineWidth = w; ctx.stroke(f._path);
    ctx.strokeStyle = F.slideRail; ctx.lineWidth = w * 0.3; ctx.stroke(f._path);
    ctx.fillStyle = F.slideTower; ctx.fillRect(f.pts[0] - tw / 2, f.pts[1] - tw / 2, tw, tw);
    ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.strokeRect(f.pts[0] - tw / 2, f.pts[1] - tw / 2, tw, tw);
    return;
  }
  ctx.save(); ctx.translate(f.x, f.y);
  if (f.kind === "umbrella") {
    const r = F.umbrellaM * ppm / 2;
    ctx.fillStyle = F.shadow; ctx.beginPath(); ctx.arc(3, 4, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = F.umbrellaRib; ctx.lineWidth = 1; ctx.beginPath();
    for (let k = 0; k < F.umbrellaRibs; k++) { const a = k * Math.PI * 2 / F.umbrellaRibs; ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.stroke();
    ctx.fillStyle = F.umbrellaTip; ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2); ctx.fill();
  } else if (f.kind === "loungers") {
    const [l, w] = F.loungerM.map((m) => m * ppm);
    for (const side of [-1, 1]) {
      ctx.fillStyle = F.shadow; ctx.fillRect(side * w * 0.75 - w / 2 + 1.5, -l / 2 + 2, w, l);
      ctx.fillStyle = F.lounger; ctx.fillRect(side * w * 0.75 - w / 2, -l / 2, w, l);
      ctx.fillStyle = f.color; ctx.fillRect(side * w * 0.75 - w / 2, -l / 2, w, l * 0.3);
    }
  } else if (f.kind === "float") {
    const r = F.floatM * ppm / 2, bob = F.floatBobM * ppm, ph = f.x * 0.013 + f.y * 0.007;
    ctx.translate(Math.sin(t * F.floatSpeed + ph) * bob, Math.cos(t * F.floatSpeed * 0.8 + ph) * bob);
    ctx.strokeStyle = f.color; ctx.lineWidth = r * (1 - F.floatHole) * 1.3;
    ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2); ctx.stroke();
  } else if (f.kind === "ship") {
    const S = F.ship, L = S.lengthM * ppm, B = S.beamM * ppm;
    ctx.rotate(-0.5);
    ctx.fillStyle = F.shadow; ctx.beginPath(); ctx.ellipse(3, 4, L / 2, B / 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = S.hull; ctx.beginPath(); ctx.moveTo(L / 2, 0); ctx.quadraticCurveTo(L * 0.2, -B * 0.62, -L / 2, -B * 0.38); ctx.lineTo(-L / 2, B * 0.38); ctx.quadraticCurveTo(L * 0.2, B * 0.62, L / 2, 0); ctx.fill();
    ctx.fillStyle = S.deck; ctx.beginPath(); ctx.ellipse(-L * 0.04, 0, L * 0.36, B * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    for (const mx of [-L * 0.18, L * 0.12]) {
      ctx.fillStyle = S.sail; ctx.fillRect(mx - 1.5, -B * 0.52, 3, B * 1.04);
      ctx.fillStyle = S.mast; ctx.beginPath(); ctx.arc(mx, 0, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = S.flag; ctx.fillRect(-L * 0.46, -2.5, 7, 5);
  }
  ctx.restore();
}

// EL PARQUE DEL MUELLERO. Las piedras son puntos a lo largo de una curva; el
// esqueleto de ballena, un espinazo con costillas hacia la calle.
function stonesAlong(pts, step, r, ink) {
  ctx.fillStyle = ink;
  let run = step / 2;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k], ay = pts[k + 1], bx = pts[k + 2], by = pts[k + 3], L = Math.hypot(bx - ax, by - ay);
    for (let d = run; d < L; d += step) { ctx.beginPath(); ctx.arc(ax + (bx - ax) * d / L, ay + (by - ay) * d / L, r, 0, Math.PI * 2); ctx.fill(); }
    run = (run - L) % step; if (run < 0) run += step;
  }
}
function arcPts(x, y, r, a0, a1, n = 24) { const out = []; for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; out.push(x + Math.cos(a) * r, y + Math.sin(a) * r); } return out; }
function paintMuellero(Q, ppm) {
  const C = M.muellero, stoneR = C.stoneM * ppm / 2, stoneStep = C.stoneEveryM * ppm;
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (Q.plaza) { const p = Q.plaza; ctx.fillStyle = C.plaza; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, p.ang - Math.PI / 2, p.ang + Math.PI / 2); ctx.closePath(); ctx.fill(); }
  for (const c of Q.circles) {
    if (c.kind === "boulder") { ctx.fillStyle = C.boulder; ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill(); continue; }
    stonesAlong(arcPts(c.x, c.y, c.r, 0, Math.PI * 2, 40), stoneStep, stoneR, C.stone);
  }
  for (const a of Q.arcs) {
    const a0 = a.ang + a.a0 * RAD, a1 = a.ang + a.a1 * RAD;
    if (a.planter) { ctx.fillStyle = C.planter; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, a0, a1); ctx.closePath(); ctx.fill(); }
    stonesAlong(arcPts(a.x, a.y, a.r, a0, a1), stoneStep, stoneR, C.stone);
  }
  for (const b of Q.benches) {
    if (!b._path) b._path = flatPath(b.pts, false);
    ctx.save(); ctx.translate(2, 3); ctx.strokeStyle = C.shadow; ctx.lineWidth = b.w; ctx.stroke(b._path); ctx.restore();
    ctx.strokeStyle = b.kind === "pergola" ? C.pergola : C.bench; ctx.lineWidth = b.w; ctx.stroke(b._path);
  }
  // los esqueletos de ballena: costillas primero (con su sombra), el espinazo encima
  for (const w of Q.whales) {
    if (!w._ribs) {
      const ribs = [], [sx, sy] = w.toStreet; let run = 0;
      for (let k = 0; k + 3 < w.pts.length; k += 2) {
        const ax = w.pts[k], ay = w.pts[k + 1], bx = w.pts[k + 2], by = w.pts[k + 3], L = Math.hypot(bx - ax, by - ay) || 1;
        let nx = -(by - ay) / L, ny = (bx - ax) / L; if (nx * sx + ny * sy < 0) { nx = -nx; ny = -ny; }
        for (let d = run; d < L; d += Q.ribEveryPx) { const x = ax + (bx - ax) * d / L, y = ay + (by - ay) * d / L; ribs.push([x, y, x + nx * Q.ribPx, y + ny * Q.ribPx]); }
        run = (run - L) % Q.ribEveryPx; if (run < 0) run += Q.ribEveryPx;
      }
      w._ribs = ribs; w._path = flatPath(w.pts, false);
    }
    ctx.lineWidth = C.ribM * ppm;
    ctx.strokeStyle = C.ribShadow; ctx.beginPath(); for (const [x0, y0, x1, y1] of w._ribs) { ctx.moveTo(x0 + 1.5, y0 + 2); ctx.lineTo(x1 + 1.5, y1 + 2); } ctx.stroke();
    ctx.strokeStyle = C.rib; ctx.beginPath(); for (const [x0, y0, x1, y1] of w._ribs) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); } ctx.stroke();
    ctx.strokeStyle = C.shadow; ctx.lineWidth = C.spineM * ppm; ctx.save(); ctx.translate(1.5, 2); ctx.stroke(w._path); ctx.restore();
    ctx.strokeStyle = C.spine; ctx.stroke(w._path);
  }
  // las pancitas: una lente verde con su borde de piedras del lado de la calle; la del parqueo, un abanico rojo y sus cajones
  for (const q of Q.pancitas) {
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.ang);           // +x: hacia el mar; +y: a lo largo
    const half = q.len / 2;
    if (q.kind === "parking") {
      // la bahía de parqueo, contra la calle (asfalto y cajones en batería) …
      const x0 = -q.kerbOff, bay = q.bay, L = half * 0.82;
      ctx.fillStyle = M.yard.asphalt; ctx.fillRect(x0, -L, bay, 2 * L);
      ctx.strokeStyle = C.stall; ctx.lineWidth = 1.2;
      for (let k = 0; k <= q.stalls; k++) { const y = -L + k * (2 * L / q.stalls); ctx.beginPath(); ctx.moveTo(x0 + bay * 0.25, y); ctx.lineTo(x0 + bay, y); ctx.stroke(); }
      // … y el abanico rojo hacia el mar, en la media luna
      const R = Math.min(q.fanR, q.out * 0.75), cx = Math.max(x0 + bay + R * 0.15, q.out * 0.1);
      ctx.fillStyle = C.fan; ctx.beginPath(); ctx.arc(cx, 0, R, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = C.fanLine; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + Math.PI * k / 6; ctx.moveTo(cx, 0); ctx.lineTo(cx + Math.cos(a) * R, Math.sin(a) * R); }
      ctx.stroke(); ctx.beginPath(); ctx.arc(cx, 0, R, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    } else {
      ctx.fillStyle = C.lens; ctx.beginPath(); ctx.ellipse(q.out * 0.12, 0, q.out * 0.62, half * 0.7, 0, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = C.lensEdge; ctx.lineWidth = 1; ctx.stroke();
      stonesAlong(arcPts(q.out * 0.35, 0, 1, 0, 0, 1).length ? (() => { const o = []; for (let k = 0; k <= 16; k++) { const a = Math.PI / 2 + Math.PI * k / 16; o.push(q.out * 0.12 + Math.cos(a - Math.PI) * q.out * 0.62, Math.sin(a - Math.PI) * half * 0.7); } return o; })() : [], stoneStep, stoneR, C.stone);
    }
    ctx.restore();
  }
}

// LOS MONUMENTOS, desde arriba y girados con la calle: local +y es hacia el mar.
function paintMonument(mo, ppm) {
  const K = M.monuments, C = K[mo.kind];
  if (!C) return;
  ctx.save(); ctx.translate(mo.x, mo.y); ctx.rotate(mo.ang);
  if (mo.kind === "cannons") {
    // un cuadro con las esquinas a los puntos cardinales; un cañón sobre cada lado, apuntando al subcardinal
    const h = C.sideM * ppm / 2, b = C.barrelM * ppm;
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = K.shadow; ctx.fillRect(-h + 3, -h + 4, 2 * h, 2 * h);
    ctx.fillStyle = C.base; ctx.fillRect(-h, -h, 2 * h, 2 * h);
    ctx.strokeStyle = C.baseTrim; ctx.lineWidth = 1.2; ctx.strokeRect(-h + 2.5, -h + 2.5, 2 * h - 5, 2 * h - 5);
    for (let k = 0; k < 4; k++) {
      ctx.save(); ctx.rotate(k * Math.PI / 2);
      ctx.fillStyle = C.carriage; ctx.fillRect(h * 0.3, -h * 0.26, h * 0.5, h * 0.52);
      ctx.strokeStyle = C.barrel; ctx.lineCap = "round"; ctx.lineWidth = C.barrelWM * ppm;
      ctx.beginPath(); ctx.moveTo(h * 0.28, 0); ctx.lineTo(h * 0.28 + b, 0); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = C.block; ctx.fillRect(-h * 0.3, -h * 0.3, h * 0.6, h * 0.6);
    ctx.fillStyle = C.base; ctx.fillRect(-h * 0.2, -h * 0.2, h * 0.4, h * 0.4);
  } else if (mo.kind === "shell") {
    const R = mo.size || C.rM * ppm, step = R * 0.42 / C.tiers;   // `size`: la Concha que llena su malecón
    // las gradas, del lado de la calle; el escenario y la concha, del lado del mar
    for (let k = C.tiers; k >= 1; k--) {
      ctx.beginPath(); ctx.arc(0, 0, R * 0.58 + step * k, Math.PI, 2 * Math.PI); ctx.lineTo(0, 0); ctx.closePath();
      ctx.fillStyle = C.tier; ctx.fill(); ctx.strokeStyle = C.tierEdge; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(0, 0, R * 0.58, 0, 2 * Math.PI); ctx.fillStyle = C.floor; ctx.fill();
    ctx.save(); ctx.translate(3, 4); ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI); ctx.closePath(); ctx.fillStyle = K.shadow; ctx.fill(); ctx.restore();
    for (let k = 0; k < C.petals; k++) {
      const a0 = Math.PI * k / C.petals, a1 = Math.PI * (k + 1) / C.petals, am = (a0 + a1) / 2;
      ctx.beginPath(); ctx.moveTo(0, R * 0.12);
      ctx.quadraticCurveTo(Math.cos(a0) * R * 0.9, Math.sin(a0) * R * 0.9 + R * 0.05, Math.cos(am) * R * 1.04, Math.sin(am) * R * 1.04);
      ctx.quadraticCurveTo(Math.cos(a1) * R * 0.9, Math.sin(a1) * R * 0.9 + R * 0.05, 0, R * 0.12);
      ctx.fillStyle = k % 2 ? C.petalAlt : C.petal; ctx.fill();
      ctx.strokeStyle = C.rib; ctx.lineWidth = 1.2; ctx.stroke();
    }
  } else if (mo.kind === "letters") {
    // la plazoleta redonda de adoquín, sobre el malecón
    if (mo.oval) { ctx.beginPath(); ctx.ellipse(0, 0, mo.oval[0], mo.oval[1], 0, 0, Math.PI * 2); ctx.fillStyle = C.plaza; ctx.fill(); ctx.strokeStyle = C.plazaEdge; ctx.lineWidth = 2; ctx.stroke(); }
    else if (mo.r) { ctx.beginPath(); ctx.arc(0, 0, mo.r, 0, Math.PI * 2); ctx.fillStyle = C.plaza; ctx.fill(); ctx.strokeStyle = C.plazaEdge; ctx.lineWidth = 2; ctx.stroke(); }
    const text = mo.text || "", n = text.length, step = C.stepM * ppm, H = C.heightM * ppm, half = (n - 1) * step / 2, sag = step * 1.1;
    // la base curva: un arco bajo de concreto, y cada letra parada sobre él
    ctx.strokeStyle = C.baseEdge; ctx.lineWidth = H * 0.62; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-half - step * 0.6, -sag * 0.2); ctx.quadraticCurveTo(0, sag, half + step * 0.6, -sag * 0.2); ctx.stroke();
    ctx.strokeStyle = C.base; ctx.lineWidth = H * 0.5; ctx.stroke();
    ctx.font = `${H.toFixed(1)}px '${C.font}', sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (let k = 0; k < n; k++) {
      const u = n > 1 ? k / (n - 1) : 0.5, x = -half + k * step, y = (1 - (2 * u - 1) ** 2) * sag * 0.52 - sag * 0.12;
      ctx.fillStyle = C.shade; ctx.fillText(text[k], x + 1.5, y + 2);
      ctx.fillStyle = C.inks[k % C.inks.length]; ctx.fillText(text[k], x, y);
    }
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();
}

function drawPunta(view, t = 0) {
  const P = W.PUNTA;
  if (!P || !aabbInView(P, view, 40)) return;
  const ppm = W.PX_PER_M;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // el verde del Paseo. Se pinta ACÁ y no con los verdes del mundo porque aquéllos van
  // antes que las aguas interiores, y sobre este frente hay agua vieja que lo taparía
  for (const gr of P.greens || []) { ctx.fillStyle = MATERIALS.green[gr.type]; ctx.fill(shape(gr)); }
  // la playa entre lengua y lengua, y la del frente del Paseo: la arena del mundo
  ctx.fillStyle = weatherColors().sand;
  for (const sd of P.sands || []) ctx.fill(shape(sd));
  // el MISMO grano que la playa del mundo, para que no haya dos arenas
  { const tex = textureScale(); for (const sd of P.sands || []) overlayTexture(ctx, "sand", tex, () => ctx.fill(sd._path)); }
  for (const line of P.riprap || []) paintRiprap(line, view);
  // el patio de la terminal de ferris: asfalto redondeado y sus toldos
  if (P.yard) {
    const Y = M.yard; ctx.fillStyle = Y.asphalt; ctx.fill(shape(P.yard));
    for (const tn of P.yard.tents) {
      ctx.fillStyle = Y.tentShadow; ctx.fillRect(tn.x - tn.s / 2 + 3, tn.y - tn.s / 2 + 4, tn.s, tn.s);
      ctx.fillStyle = Y.tent; ctx.fillRect(tn.x - tn.s / 2, tn.y - tn.s / 2, tn.s, tn.s);
      ctx.strokeStyle = Y.tentRidge; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(tn.x - tn.s / 2, tn.y - tn.s / 2); ctx.lineTo(tn.x + tn.s / 2, tn.y + tn.s / 2); ctx.moveTo(tn.x + tn.s / 2, tn.y - tn.s / 2); ctx.lineTo(tn.x - tn.s / 2, tn.y + tn.s / 2); ctx.stroke();
    }
  }
  // el suelo, en el orden en que el mundo lo trae: terreno, deck, malecones…
  for (const g of P.grounds || []) {
    const ink = g.use === "deck" ? POOL.deck : (M.ground[g.use] || M.ground.park);
    ctx.fillStyle = ink; ctx.fill(shape(g));
    // `dilate`: el suelo se mete debajo de las calles que lo rodean (que lo tapan), sin cordón propio
    if (g.dilate) { ctx.strokeStyle = ink; ctx.lineWidth = g.dilate * 2; ctx.stroke(g._path); continue; }
    ctx.strokeStyle = M.kerb; ctx.lineWidth = 1.5; ctx.stroke(g._path);
  }
  // los dos pisos: recortados a SU malecón, para que nada se salga a la calle
  const half = M.fan.halfAngleDeg * RAD;
  // el círculo del Faro: relleno, del color de las figuras
  for (const dsc of P.discs || []) {
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(dsc.x, dsc.y, dsc.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = M.fan.edge; ctx.lineWidth = 1.5; ctx.stroke();
  }
  for (const f of P.fans || []) {
    ctx.fillStyle = INK; ctx.fill(fanPath(f, half));
    ctx.strokeStyle = M.fan.edge; ctx.lineWidth = 1.2; ctx.stroke(f._path);
    // DOS bancas por abanico, una a cada lado: afuera de cada canto recto,
    // a media vara, y alineada con él
    const [bl, bw] = M.fan.benchM, off = M.fan.benchOffsetM * ppm;
    for (const side of [-1, 1]) {
      const e = f.ang + side * half, ex = Math.cos(e), ey = Math.sin(e);
      const bx = f.x + ex * f.r * M.fan.benchAlong - ey * side * off;
      const by = f.y + ey * f.r * M.fan.benchAlong + ex * side * off;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(e);
      ctx.fillStyle = M.fan.benchShadow; ctx.fillRect(-bl * ppm / 2 + 1, -bw * ppm / 2 + 1.5, bl * ppm, bw * ppm);
      ctx.fillStyle = M.fan.bench; ctx.fillRect(-bl * ppm / 2, -bw * ppm / 2, bl * ppm, bw * ppm);
      ctx.restore();
    }
  }
  for (const w of P.waves || []) {
    ctx.fillStyle = INK; ctx.fill(wavePath(w, M.wave.outline));
    ctx.strokeStyle = M.wave.edge; ctx.lineWidth = 1.2; ctx.stroke(w._path);
  }
  for (const r of P.rotondas || []) {
    ctx.strokeStyle = INK; ctx.lineWidth = M.wave.rotondaWidthM * ppm;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
  }
  // el agua, con el estilo de las piscinas del Parque Marino sobre su forma
  // de verdad: brocal, lámina, la zona honda y la baja, y el brillo que se mueve
  const whole = (P.pools || []).filter((pool) => !pool.zone);
  for (const pool of whole) {
    ctx.strokeStyle = POOL.coping; ctx.lineWidth = M.pool.rimWidthM * ppm * 2; ctx.stroke(shape(pool));
    ctx.fillStyle = POOL.water; ctx.fill(pool._path);
  }
  for (const pool of P.pools || []) if (pool.zone) { ctx.fillStyle = POOL[M.pool.zones[pool.use]]; ctx.fill(shape(pool)); }
  const S = M.pool.shimmer, gap = S.gapM * ppm, amp = S.ampM * ppm;
  ctx.strokeStyle = POOL.shimmer; ctx.lineWidth = S.widthM * ppm;
  for (const pool of whole) {
    const a = pool._aabb;
    ctx.save(); ctx.clip(pool._path);
    for (let y = a.y0 + gap / 2, n = 0; y < a.y1; y += gap, n++) {
      const drift = (t * S.speed * ppm + n * 37) % (S.dashM * ppm * 2);
      ctx.setLineDash([S.dashM * ppm, S.dashM * ppm]); ctx.lineDashOffset = -drift;
      ctx.beginPath();
      for (let x = a.x0; x <= a.x1; x += 6) {
        const yy = y + Math.sin((x + n * 50) * S.freq + t * S.wobble) * amp;
        if (x === a.x0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = POOL.coping; ctx.lineWidth = M.pool.wallWidthM * ppm;
  for (const wall of P.walls || []) {
    if (!wall._path) wall._path = flatPath(wall.pts, false);
    ctx.stroke(wall._path);
  }
  // la isla y lo que flota: van DESPUÉS del agua
  for (const g of P.islands || []) {
    ctx.strokeStyle = POOL.coping; ctx.lineWidth = M.pool.rimWidthM * ppm * 2; ctx.stroke(shape(g));
    ctx.fillStyle = M.ground.planter; ctx.fill(g._path);
  }
  for (const pr of P.props || []) {
    const s = M.props.cabanaM * ppm;
    ctx.fillStyle = M.props.shadow; ctx.fillRect(pr.x - s / 2 + 2, pr.y - s / 2 + 3, s, s);
    ctx.fillStyle = M.props.cabana; ctx.fillRect(pr.x - s / 2, pr.y - s / 2, s, s);
  }
  // los techos sin paredes y los monumentos van con el suelo, bajo los árboles
  for (const f of P.fun || []) paintFun(f, ppm, t);
  for (const rf of P.roofs || []) paintRoof(rf, ppm);
  for (const mo of P.monuments || []) paintMonument(mo, ppm);
  if (P.muellero) paintMuellero(P.muellero, ppm);
  // la hora: UN velo sobre todo el suelo del lugar, en un solo relleno para
  // que donde dos figuras se montan no oscurezca dos veces
  // (el deck y el parqueo van DENTRO de otra figura: sumarlos abriría un hueco
  // donde el sentido de su contorno es el contrario)
  if (!P._all) {
    P._all = new Path2D();
    for (const g of P.grounds || []) if (g.use !== "deck" && g.use !== "parking") P._all.addPath(shape(g));
  }
  ctx.fillStyle = blendPalette(M.sky, "clear").veil;
  ctx.fill(P._all);
}

// LOS ARCOS DE ENTRADA, en alzado y por encima de calles y muelles: el carro pasa
// por DEBAJO del rótulo, que se endereza contra la cámara como todo texto. Es el
// mismo dibujo que el cartel de la feria, con su propia tinta.
function drawPuntaGates(view, t = 0) {
  const P = W.PUNTA;
  if (!P || !P.gates) return;
  // las banderas del muelle: asta en alzado y el paño ondeando
  const FL = M.flag, fp = W.PX_PER_M, pole = FL.poleM * fp, [fw, fh] = FL.sizeM.map((m) => m * fp), fsh = sunShadow(FL.poleM);
  for (const fl of P.flags || []) {
    if (fl.x < view.x0 - 60 || fl.x > view.x1 + 60 || fl.y < view.y0 - 60 || fl.y > view.y1 + 60) continue;
    ctx.lineCap = "round"; ctx.lineWidth = 1.6;
    ctx.strokeStyle = FL.shadow; ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fl.x + fsh.dx, fl.y + fsh.dy); ctx.stroke();
    ctx.strokeStyle = FL.pole; ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fl.x, fl.y - pole); ctx.stroke();
    const n = FL.stripes.length, sh2 = fh / n, lift = Math.sin(t * 2.2 + fl.y * 0.01) * FL.wave;
    for (let k = 0; k < n; k++) {
      ctx.fillStyle = FL.stripes[k];
      ctx.beginPath(); ctx.moveTo(fl.x, fl.y - pole + k * sh2); ctx.lineTo(fl.x + fw, fl.y - pole + k * sh2 + lift);
      ctx.lineTo(fl.x + fw, fl.y - pole + (k + 1) * sh2 + lift); ctx.lineTo(fl.x, fl.y - pole + (k + 1) * sh2); ctx.closePath(); ctx.fill();
    }
  }
  const G = M.gate, ppm = W.PX_PER_M, H = G.postHeightM * ppm, B = G.boardM * ppm, sh = sunShadow(G.postHeightM);
  for (const gate of P.gates) {
    if (gate.x < view.x0 - 200 || gate.x > view.x1 + 200 || gate.y < view.y0 - 200 || gate.y > view.y1 + 200) continue;
    const tx = Math.cos(gate.ang || 0), ty = Math.sin(gate.ang || 0);
    const ax = gate.x - tx * gate.w / 2, ay = gate.y - ty * gate.w / 2, bx = gate.x + tx * gate.w / 2, by = gate.y + ty * gate.w / 2;
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = G.postPx;
    ctx.strokeStyle = G.shadow;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + sh.dx, ay + sh.dy); ctx.lineTo(bx + sh.dx, by + sh.dy); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = G.post;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - H); ctx.moveTo(bx, by); ctx.lineTo(bx, by - H); ctx.stroke();
    const ox = tx * G.overhangM * ppm, oy = ty * G.overhangM * ppm;
    ctx.beginPath();
    ctx.moveTo(ax - ox, ay - oy - H); ctx.lineTo(bx + ox, by + oy - H);
    ctx.lineTo(bx + ox, by + oy - H + B); ctx.lineTo(ax - ox, ay - oy - H + B);
    ctx.closePath();
    ctx.fillStyle = G.board; ctx.fill();
    ctx.strokeStyle = G.trim; ctx.lineWidth = 1.2; ctx.stroke();
    const mx = (ax + bx) / 2, my = (ay + by) / 2 - H + B / 2, stood = upright(mx, my);
    // el rótulo cabe en su tablero: si el texto es más ancho, la letra se achica
    let fpx = G.fontM * ppm; ctx.font = `${fpx.toFixed(2)}px '${G.font}', sans-serif`;
    const room = Math.hypot(bx - ax, by - ay) + 2 * G.overhangM * ppm - 1.2 * ppm, tw = ctx.measureText(gate.text).width;
    if (tw > room) { fpx *= room / tw; ctx.font = `${fpx.toFixed(2)}px '${G.font}', sans-serif`; }
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = G.ink;
    ctx.fillText(gate.text, stood ? 0 : mx, (stood ? 0 : my) + 0.4);
    ctx.textBaseline = "alphabetic";
    if (stood) ctx.restore();
  }
}

// EL HAZ DEL FARO. Es luz: se pinta en pantalla, DESPUÉS de la oscuridad y sumando
// —igual que los láseres de la feria—, o quedaría debajo del velo de la noche.
function drawPuntaNight(view, t, toScreen, zoom, night) {
  const P = W.PUNTA;
  if (!P || !P.beams || night <= 0.001) return;
  const B = M.beam, ppm = W.PX_PER_M, reach = B.lengthM * ppm, half = B.halfAngleDeg * RAD;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const bm of P.beams) {
    if (bm.x + reach < view.x0 || bm.x - reach > view.x1 || bm.y + reach < view.y0 || bm.y - reach > view.y1) continue;
    const [sx, sy] = toScreen(bm.x, bm.y), L = reach * zoom, turn = t * B.turnsPerSec * Math.PI * 2;
    for (const flip of [0, Math.PI]) {
      const a = turn + flip, grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, L);
      grad.addColorStop(0, `rgba(${B.rgb},${(B.alpha * night).toFixed(3)})`);
      grad.addColorStop(1, `rgba(${B.rgb},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.arc(sx, sy, L, a - half, a + half); ctx.closePath(); ctx.fill();
    }
    const g = B.glowM * ppm * zoom, glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, g);
    glow.addColorStop(0, `rgba(${B.rgb},${(0.9 * night).toFixed(3)})`); glow.addColorStop(1, `rgba(${B.rgb},0)`);
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(sx, sy, g, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// EL MAR QUE TAPA LA COSTA VIEJA: el MISMO pintor del golfo, recortado. Va justo
// después del suelo base y antes del malecón, como el mar de verdad.
function drawPuntaSea(view, t) {
  const P = W.PUNTA;
  if (!P || !P.seaPatch || !P.seaPatch.length || !aabbInView(P, view, 900)) return;
  if (!P._sea) { P._sea = new Path2D(); for (const ring of P.seaPatch) P._sea.addPath(flatPath(ring, true)); }
  ctx.save(); ctx.clip(P._sea, "nonzero"); drawWaterAll(view, t); ctx.restore();
}

export { drawPunta, drawPuntaGates, drawPuntaNight, drawPuntaSea };
