// EL ÁRBOL VISTO DESDE ARRIBA — vista cenital, como todo lo demás del mundo.
//
// Un árbol se dibujaba en ALZADO (tronco subiendo en la pantalla, copa encima)
// y después en un 2.5D con el tronco a la vista. Desde una cámara a plomo el
// tronco no se ve: lo tapa la copa. Lo que se ve es la COPA desde arriba —un
// racimo de lóbulos de hojas, más claro del lado de la luz— y su SOMBRA en el
// suelo, que es la silueta de esa misma copa corrida por el sol.
//
// Tres cosas que sostienen esto:
//
// * LA SOMBRA ES LA SILUETA DE LA COPA, NO UNA ELIPSE. Se pinta el mismo
//   contorno de lóbulos en una sola tinta y se corre con `sunShadow(alto)`, el
//   mismo vector que corre la sombra de un edificio: una palmera tira la
//   estrella de sus hojas y un almendro su racimo.
// * CADA COPA ES UN SPRITE. Un almendro son ~40 círculos y el monte pide ~60
//   árboles por cuadro: se pinta UNA vez por especie, variante y escala de
//   pantalla en un lienzo propio, y después es un `drawImage`. Igual que el
//   charco de luz de `nightlights.js` y el disco del sembrado de `materials.js`.
// * LA FORMA ES DATA, EL TRAZO ES CÓDIGO. `effects.json → flora25.topdown`
//   dice cuántos lóbulos, de qué tamaño, dónde la luz; acá sólo hay geometría.
//   Los colores son los de la especie (`flora.json → species.*.canopy`): ni una
//   tinta escrita en este archivo.
import { hash01 } from "./primitives.js";

const TAU = Math.PI * 2;
const cache = new Map();     // especie → Map(clave → {crown, shadow, half})

function rng(seed) {
  let k = 0;
  return () => hash01(seed * 13.37 + (k += 1) * 7.91);
}
const between = (rnd, [a, b]) => a + (b - a) * rnd();
const tone = (pal, i) => pal[Math.max(0, Math.min(pal.length - 1, i))];

// ── los trazos: cada uno dibuja con el `fill` que se le dé, así sirve para la copa y para su sombra ──
function lobes(g, list) {
  g.beginPath();
  for (const [x, y, r] of list) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
  g.fill();
}

// una copa de hojas: un anillo de lóbulos, el borde mellado y capas más claras hacia la luz
function broadleaf(R, rnd, P) {
  const n = Math.round(between(rnd, P.lobes)), rim = [], base = [[0, 0, R * P.coreR]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (rnd() - 0.5) * P.jitter, d = R * between(rnd, P.lobeDist);
    base.push([Math.cos(a) * d, Math.sin(a) * d, R * between(rnd, P.lobeR)]);
  }
  const m = Math.round(P.rimLeaves);
  for (let i = 0; i < m; i++) {
    const a = (i / m) * TAU + rnd() * 0.4, d = R * between(rnd, P.rimDist);
    rim.push([Math.cos(a) * d, Math.sin(a) * d, R * between(rnd, P.rimR)]);
  }
  return { silhouette: [...base, ...rim], base, rim };
}

function paintBroadleaf(g, R, sp, P, rnd) {
  const L = P.light, lx = L[0] * R, ly = L[1] * R, C = broadleaf(R, rnd, P), pal = sp.canopy;
  g.fillStyle = tone(pal, 0); lobes(g, C.silhouette);
  // las ramas, apenas asomando entre las hojas (sólo las especies que las muestran)
  if (P.branches) {
    g.strokeStyle = sp.trunk; g.lineCap = "round";
    const k = Math.round(between(rnd, P.branches.count));
    for (let i = 0; i < k; i++) {
      const a = (i / k) * TAU + rnd() * 0.6, len = R * between(rnd, P.branches.len);
      g.lineWidth = R * P.branches.widthR;
      g.beginPath(); g.moveTo(0, 0);
      const mx = Math.cos(a + 0.25) * len * 0.5, my = Math.sin(a + 0.25) * len * 0.5;
      g.quadraticCurveTo(mx, my, Math.cos(a) * len, Math.sin(a) * len); g.stroke();
      g.lineWidth = R * P.branches.widthR * 0.6;
      g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(a - 0.7) * len * 0.35, my + Math.sin(a - 0.7) * len * 0.35); g.stroke();
    }
  }
  // la capa media, corrida hacia la luz
  g.fillStyle = tone(pal, 1);
  lobes(g, C.base.map(([x, y, r]) => [x * P.midScale + lx * P.midShift, y * P.midScale + ly * P.midShift, r * P.midScale]));
  lobes(g, C.rim.filter(() => rnd() < P.midRimKeep).map(([x, y, r]) => [x * 0.92 + lx * 0.3, y * 0.92 + ly * 0.3, r * 0.85]));
  // la capa alta: un racimo más chico del lado de la luz
  g.fillStyle = tone(pal, 2);
  const top = [], t = Math.round(between(rnd, P.topLobes));
  for (let i = 0; i < t; i++) {
    const a = (i / t) * TAU + rnd() * 0.8, d = R * between(rnd, P.topDist);
    top.push([lx * P.topShift + Math.cos(a) * d, ly * P.topShift + Math.sin(a) * d, R * between(rnd, P.topR)]);
  }
  lobes(g, top);
  // los brillos: unas hojas sueltas del tono más claro, donde pega el sol
  g.fillStyle = tone(pal, 3);
  const hi = [], h = Math.round(P.highlights);
  for (let i = 0; i < h; i++) {
    const a = rnd() * TAU, d = R * rnd() * P.highlightDist;
    hi.push([lx * P.highlightShift + Math.cos(a) * d, ly * P.highlightShift + Math.sin(a) * d, R * between(rnd, P.highlightR)]);
  }
  lobes(g, hi);
  return C.silhouette;
}

// una hoja de palma vista desde arriba: dos mitades a cada lado de su nervio, la de la luz más clara
function frondPath(g, a, len, w, side) {
  const ca = Math.cos(a), sa = Math.sin(a), nx = -sa * side, ny = ca * side;
  g.moveTo(0, 0);
  g.quadraticCurveTo(ca * len * 0.45 + nx * w, sa * len * 0.45 + ny * w, ca * len, sa * len);
  g.lineTo(ca * len * 0.12, sa * len * 0.12);
  g.closePath();
}
function palmFronds(R, rnd, P) {
  const n = Math.round(between(rnd, P.fronds)), out = [];
  for (let i = 0; i < n; i++) out.push({ a: (i / n) * TAU + (rnd() - 0.5) * P.jitter, len: R * between(rnd, P.len), w: R * between(rnd, P.widthR) });
  return out;
}
function paintPalmTop(g, R, sp, P, rnd) {
  const pal = sp.canopy, F = palmFronds(R, rnd, P), L = Math.atan2(P.light[1], P.light[0]);
  for (const f of F) {
    for (const side of [-1, 1]) {
      // la mitad que mira a la luz va un tono más clara
      const lit = Math.cos(f.a + side * Math.PI / 2 - L) > 0;
      g.fillStyle = tone(pal, lit ? 2 : 1);
      g.beginPath(); frondPath(g, f.a, f.len, f.w, side); g.fill();
    }
    // las pinnas: rayitas oscuras a lo largo de la hoja
    g.strokeStyle = tone(pal, 0); g.lineWidth = Math.max(0.5, R * P.pinnaW); g.lineCap = "round";
    const ca = Math.cos(f.a), sa = Math.sin(f.a);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(ca * f.len * 0.96, sa * f.len * 0.96);
    for (let k = 1; k <= P.pinnae; k++) {
      const u = k / (P.pinnae + 1), bx = ca * f.len * u, by = sa * f.len * u, wv = f.w * (1 - u) * 0.9;
      for (const s of [-1, 1]) { g.moveTo(bx, by); g.lineTo(bx + (-sa * s) * wv + ca * wv * 0.5, by + (ca * s) * wv + sa * wv * 0.5); }
    }
    g.stroke();
  }
  g.fillStyle = tone(pal, 0); g.beginPath(); g.arc(0, 0, R * P.heartR, 0, TAU); g.fill();
  g.fillStyle = tone(pal, 3); g.beginPath(); g.arc(-R * P.heartR * 0.3, -R * P.heartR * 0.3, R * P.heartR * 0.45, 0, TAU); g.fill();
  return (s) => { s.beginPath(); for (const f of F) { frondPath(s, f.a, f.len, f.w, -1); frondPath(s, f.a, f.len, f.w, 1); } s.arc(0, 0, R * P.heartR, 0, TAU); s.fill(); };
}

// la palma de abanico: cada hoja es un abanico plisado en la punta de su peciolo
function paintFanTop(g, R, sp, P, rnd) {
  const pal = sp.canopy, n = Math.round(between(rnd, P.leaves)), leaves = [], L = Math.atan2(P.light[1], P.light[0]);
  for (let i = 0; i < n; i++) leaves.push({ a: (i / n) * TAU + (rnd() - 0.5) * P.jitter, d: R * between(rnd, P.dist), r: R * between(rnd, P.leafR) });
  const fan = (s, f) => { const cx = Math.cos(f.a) * f.d, cy = Math.sin(f.a) * f.d; s.moveTo(cx, cy); s.arc(cx, cy, f.r, f.a - P.spread / 2, f.a + P.spread / 2); s.closePath(); };
  g.strokeStyle = sp.trunk; g.lineWidth = Math.max(0.6, R * P.petioleW); g.lineCap = "round";
  g.beginPath(); for (const f of leaves) { g.moveTo(0, 0); g.lineTo(Math.cos(f.a) * f.d, Math.sin(f.a) * f.d); } g.stroke();
  for (const f of leaves) {
    g.fillStyle = tone(pal, Math.cos(f.a - L) > 0 ? 2 : 1); g.beginPath(); fan(g, f); g.fill();
    g.strokeStyle = tone(pal, 0); g.lineWidth = Math.max(0.4, R * P.pleatW); g.beginPath();
    const cx = Math.cos(f.a) * f.d, cy = Math.sin(f.a) * f.d;
    for (let k = 0; k <= P.pleats; k++) { const b = f.a - P.spread / 2 + P.spread * k / P.pleats; g.moveTo(cx, cy); g.lineTo(cx + Math.cos(b) * f.r, cy + Math.sin(b) * f.r); }
    g.stroke();
  }
  g.fillStyle = tone(pal, 0); g.beginPath(); g.arc(0, 0, R * P.heartR, 0, TAU); g.fill();
  return (s) => { s.beginPath(); for (const f of leaves) fan(s, f); s.arc(0, 0, R * P.heartR, 0, TAU); s.fill(); };
}

// la conífera: estrellas de agujas encimadas, de la más oscura y ancha a la más clara
function paintConiferTop(g, R, sp, P, rnd) {
  const pal = sp.canopy, rings = P.rings, star = (s, r, k, rot) => {
    s.beginPath();
    for (let i = 0; i <= k * 2; i++) { const a = rot + (i / (k * 2)) * TAU, rr = i % 2 ? r * P.innerR : r; s[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr); }
    s.closePath(); s.fill();
  };
  const rot0 = rnd() * TAU;
  for (let i = 0; i < rings; i++) {
    const u = i / rings, L = P.light;
    g.save(); g.translate(L[0] * R * u * 0.25, L[1] * R * u * 0.25);
    g.fillStyle = tone(pal, Math.min(3, i)); star(g, R * (1 - u * P.shrink), P.points, rot0 + i * 0.4);
    g.restore();
  }
  return (s) => star(s, R, P.points, rot0);
}

// el árbol de la estación seca, desde arriba: sus RAMAS abiertas desde el centro, con cuerpo —un canto
// oscuro, la corteza y una luz del lado del sol— y unos racimos de hoja seca que le quedan en las puntas.
// La especie trae sólo corteza (`paletteRoles: ["trunk"]`): las tintas de la hoja seca y del canto son
// de la receta (`kinds.bare`), no de este archivo.
function paintBareTop(g, R, sp, P, rnd) {
  const segs = [], tips = [];
  const grow = (x, y, a, len, w, depth) => {
    const bend = (rnd() - 0.5) * P.bend, mx = x + Math.cos(a + bend) * len * 0.5, my = y + Math.sin(a + bend) * len * 0.5;
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    segs.push([x, y, mx, my, ex, ey, w]);
    if (depth <= 0) { tips.push([ex, ey, a]); return; }
    const k = rnd() < P.triFork ? 3 : 2;
    for (let i = 0; i < k; i++) {
      const off = k === 2 ? (i ? 1 : -1) * between(rnd, P.fork) : (i - 1) * between(rnd, P.fork);
      grow(ex, ey, a + off, len * between(rnd, P.shrink), w * P.taper, depth - 1);
    }
  };
  const n = Math.round(between(rnd, P.limbs));
  for (let i = 0; i < n; i++) grow(0, 0, (i / n) * TAU + (rnd() - 0.5) * P.jitter, R * between(rnd, P.limbLen), R * P.widthR, P.depth);
  const L = Math.atan2(P.light[1], P.light[0]);
  const limb = (s2, widen, dx, dy) => {
    s2.lineCap = "round"; s2.lineJoin = "round";
    for (const [x0, y0, mx, my, x1, y1, w] of segs) {
      s2.lineWidth = Math.max(0.6, w + widen); s2.beginPath(); s2.moveTo(x0 + dx, y0 + dy); s2.quadraticCurveTo(mx + dx, my + dy, x1 + dx, y1 + dy); s2.stroke();
    }
  };
  // los racimos de hoja seca, primero: las ramas pasan por encima
  const leaves = [];
  for (const [x, y, a] of tips) {
    if (rnd() > P.leafKeep) continue;
    const c = Math.round(between(rnd, P.leafPer));
    for (let i = 0; i < c; i++) { const aa = a + (rnd() - 0.5) * 1.6, d = R * rnd() * P.leafSpread; leaves.push([x + Math.cos(aa) * d, y + Math.sin(aa) * d, R * between(rnd, P.leafR), Math.floor(rnd() * P.leaves.length)]); }
  }
  for (const [x, y, r, i] of leaves) { g.fillStyle = P.leaves[i]; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
  g.strokeStyle = P.edge; limb(g, R * P.edgeR, 0, 0);
  g.strokeStyle = sp.trunk; limb(g, 0, 0, 0);
  g.strokeStyle = P.shine; g.globalAlpha = P.shineAlpha;
  const sx = Math.cos(L) * R * P.shineShift, sy = Math.sin(L) * R * P.shineShift;
  limb(g, -R * P.widthR * 0.55, sx, sy); g.globalAlpha = 1;
  g.fillStyle = P.edge; g.beginPath(); g.arc(0, 0, R * P.widthR * 1.25, 0, TAU); g.fill();
  g.fillStyle = sp.trunk; g.beginPath(); g.arc(0, 0, R * P.widthR * 0.95, 0, TAU); g.fill();
  return (s2) => {
    s2.strokeStyle = s2.fillStyle; limb(s2, R * P.edgeR, 0, 0);
    s2.beginPath(); for (const [x, y, r] of leaves) { s2.moveTo(x + r, y); s2.arc(x, y, r, 0, TAU); } s2.fill();
  };
}

const PAINTERS = { bare: paintBareTop, broadleaf: paintBroadleaf, palm: paintPalmTop, fan: paintFanTop, conifer: paintConiferTop };
export const TOPDOWN_KINDS = Object.freeze(Object.keys(PAINTERS));

/** ¿Tiene esta forma su versión cenital? */
export function topdownKind(T, form) { return T.byGenerator[form.generator] || null; }

// el sprite de una copa y el de su sombra, a la escala de pantalla `q`
function sprite(T, sp, form, kind, R, variant, q) {
  let bySp = cache.get(sp);
  if (!bySp) cache.set(sp, (bySp = new Map()));
  const key = `${kind}|${variant}|${Math.round(R * 4)}|${q}`;
  let hit = bySp.get(key);
  if (hit) return hit;
  const P = { ...T.kinds[kind], ...(T.byForm?.[sp.form] || {}) }, pad = Math.ceil(R * 1.6) + 2, size = Math.ceil(pad * 2 * q);
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d"); g.setTransform(q, 0, 0, q, size / 2, size / 2); return { c, g }; };
  const crown = mk(), shadow = mk();
  const seed = variant * 31.7 + R;
  const out = PAINTERS[kind](crown.g, R, sp, P, rng(seed));
  shadow.g.fillStyle = T.shadowInk;
  if (typeof out === "function") out(shadow.g); else lobes(shadow.g, out);
  hit = { crown: crown.c, shadow: shadow.c, half: size / 2 / q };
  if (bySp.size > T.cacheMax) bySp.delete(bySp.keys().next().value);
  bySp.set(key, hit);
  return hit;
}

/**
 * Pinta UNA planta vista desde arriba.
 *   g        el lienzo (en coordenadas de mundo)
 *   T        `effects.json → flora25.topdown`
 *   sp/form  la especie y su forma (`flora.json`)
 *   at       {x, y}: dónde está su pie
 *   crown    {dx, dy}: cuánto se corre la copa respecto del pie (el pinhole)
 *   shadow   {dx, dy, alpha}: la sombra del sol, desde el pie
 *   s, seed, q, spin   escala, semilla, escala de pantalla y giro extra (el vaivén de una palma)
 *   only     "shadow" | "crown": sólo una de las dos (el lote de `flora.js` las separa)
 */
export function paintTopdown(g, T, sp, form, kind, { x, y, s = 1, seed = 0, crown, shadow, q = 1, spin = 0, only = null }) {
  const R = sp.r * s * (T.radiusMul[kind] ?? 1), variant = Math.floor(hash01(seed * 3.1) * T.variants);
  const sq = Math.max(1, Math.min(T.maxQ, Math.round(q * 2) / 2));
  const S = sprite(T, sp, form, kind, Math.round(R * 2) / 2, variant, sq), h = S.half;
  // las palmas y las coníferas son simétricas: se giran por instancia, y así ninguna se repite.
  // Las copas de hojas no: su luz va de un lado y girarlas la movería.
  const rot = T.spin[kind] ? hash01(seed * 7.3) * TAU + spin : 0;
  const blit = (img, cx, cy) => {
    if (!rot) { g.drawImage(img, cx - h, cy - h, h * 2, h * 2); return; }
    g.save(); g.translate(cx, cy); g.rotate(rot); g.drawImage(img, -h, -h, h * 2, h * 2); g.restore();
  };
  if (only !== "crown" && shadow && shadow.alpha > 0) {
    const prev = g.globalAlpha;
    g.globalAlpha = prev * shadow.alpha * T.shadowAlpha;
    blit(S.shadow, x + shadow.dx, y + shadow.dy);
    g.globalAlpha = prev;
  }
  if (only !== "shadow") blit(S.crown, x + (crown?.dx || 0), y + (crown?.dy || 0));
}
