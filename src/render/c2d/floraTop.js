// EL ÁRBOL EN 3D, VISTO DESDE ARRIBA — piezas en METROS sobre el pinhole de los edificios.
//
// Un árbol se dibujaba en ALZADO, después como una copa plana con su sombra al lado: un sprite que
// apenas se corría (0,35 del pinhole) mientras los postes, los carros y los edificios se levantaban
// enteros, y una sombra que era la copa corrida por el sol, sin nada que la atara al pie. Desde la
// esquina de la pantalla se veía una calcomanía verde flotando junto a una mancha oscura.
//
// Ahora un árbol es lo que es todo lo demás que se levanta en este mundo: PIEZAS A UNA ALTURA.
//
// * EL TRONCO va del pie (0 m) al arranque de la copa, con el mismo pinhole que la pared de un
//   edificio: bajo la cámara lo tapa la copa, hacia el borde de la pantalla asoma del lado del
//   centro. Mitad al sol y mitad a la sombra, como una pared.
// * LA COPA SON CAPAS, cada una a SU altura: el racimo oscuro de abajo, la capa media, el racimo
//   alto y los brillos encima. El pinhole corre más la de arriba que la de abajo, así que una copa
//   lejos del centro deja ver su costado — un domo, no una calcomanía. Y la LUZ va hacia el sol de
//   verdad: cada capa se corre hacia él en el momento de pintarla, así que a la tarde el lado
//   claro de la copa es el del poniente.
// * LA SOMBRA SALE DEL PIE: el tronco tira una franja desde el pie y la copa su silueta a la altura
//   de su centro, estirada a lo largo del sol por lo alto que es. Es la misma proyección
//   (`sunShadow`) que la de un edificio, así que un árbol y la casa de al lado la tiran juntos y
//   del largo que les toca; y como el sol se apaga de noche (`sun.js → sunlight`), la sombra también.
//
// Tres cosas que no cambiaron, y por qué:
//
// * CADA CAPA ES UN SPRITE. Un almendro son ~40 círculos y el monte pide ~60 árboles por cuadro:
//   se pinta UNA vez por especie, variante y tamaño en su lienzo, y después es un `drawImage`. Lo
//   que se movió es dónde se blitea cada uno, no cuánto cuesta pintarlo.
// * LA FORMA ES DATA, EL TRAZO ES CÓDIGO. `effects.json → flora25.topdown` dice cuántos lóbulos, a
//   qué altura va cada capa, qué tan grueso es el tronco; acá sólo hay geometría. Los colores son
//   los de la especie (`flora.json → species.*`): ni una tinta escrita en este archivo.
// * ESTE ARCHIVO NO IMPORTA EL JUEGO. Quien llama le da el pinhole y el sol ya resueltos, en
//   píxeles por metro (`lift`, `sun`): un backend que no sea Canvas, o el editor, le pasan los suyos.
import { hash01 } from "./primitives.js";

const TAU = Math.PI * 2;
const cache = new Map();     // especie → Map(clave → {layers, shadow, R} — cada lienzo recortado (`crop`))

function rng(seed) {
  let k = 0;
  return () => hash01(seed * 13.37 + (k += 1) * 7.91);
}
const between = (rnd, [a, b]) => a + (b - a) * rnd();
const tone = (pal, i) => pal[Math.max(0, Math.min(pal.length - 1, i))];
const H = (P, i, dflt) => (P.layerH && P.layerH[i] != null ? P.layerH[i] : dflt);

// ── los trazos: cada uno dibuja con el `fill` que se le dé, así sirve para la copa y para su sombra ──
function lobes(g, list) {
  g.beginPath();
  for (const [x, y, r] of list) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
  g.fill();
}

// Cada pintor devuelve { layers: [{ f, shift, paint(g) }], sil(g) }:
//   f      a qué altura de la copa va la capa: 0 su arranque, 1 la cima;
//   shift  cuánto se corre hacia el sol, en radios de copa por unidad de `light`;
//   sil    la silueta entera en el `fillStyle` que traiga el lienzo — la sombra.

// una copa de hojas: un racimo oscuro, una capa media, un racimo alto y unos brillos
function broadleaf(R, sp, P, rnd) {
  const pal = sp.canopy, n = Math.round(between(rnd, P.lobes)), rim = [], base = [[0, 0, R * P.coreR]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (rnd() - 0.5) * P.jitter, d = R * between(rnd, P.lobeDist);
    base.push([Math.cos(a) * d, Math.sin(a) * d, R * between(rnd, P.lobeR)]);
  }
  const m = Math.round(P.rimLeaves);
  for (let i = 0; i < m; i++) {
    const a = (i / m) * TAU + rnd() * 0.4, d = R * between(rnd, P.rimDist);
    rim.push([Math.cos(a) * d, Math.sin(a) * d, R * between(rnd, P.rimR)]);
  }
  const silhouette = [...base, ...rim];
  // las ramas, apenas asomando entre las hojas (sólo las especies que las muestran)
  const branches = [];
  if (P.branches) {
    const k = Math.round(between(rnd, P.branches.count));
    for (let i = 0; i < k; i++) branches.push([(i / k) * TAU + rnd() * 0.6, R * between(rnd, P.branches.len)]);
  }
  const mid = [
    ...base.map(([x, y, r]) => [x * P.midScale, y * P.midScale, r * P.midScale]),
    ...rim.filter(() => rnd() < P.midRimKeep).map(([x, y, r]) => [x * 0.92, y * 0.92, r * 0.85]),
  ];
  const top = [], t = Math.round(between(rnd, P.topLobes));
  for (let i = 0; i < t; i++) {
    const a = (i / t) * TAU + rnd() * 0.8, d = R * between(rnd, P.topDist);
    top.push([Math.cos(a) * d, Math.sin(a) * d, R * between(rnd, P.topR)]);
  }
  const hi = [], h = Math.round(P.highlights);
  for (let i = 0; i < h; i++) {
    const a = rnd() * TAU, d = R * rnd() * P.highlightDist;
    hi.push([Math.cos(a) * d, Math.sin(a) * d, R * between(rnd, P.highlightR)]);
  }
  return {
    layers: [
      { f: H(P, 0, 0.15), shift: 0, paint: (g) => {
        g.fillStyle = tone(pal, 0); lobes(g, silhouette);
        if (!branches.length) return;
        g.strokeStyle = sp.trunk; g.lineCap = "round";
        for (const [a, len] of branches) {
          g.lineWidth = R * P.branches.widthR;
          g.beginPath(); g.moveTo(0, 0);
          const mx = Math.cos(a + 0.25) * len * 0.5, my = Math.sin(a + 0.25) * len * 0.5;
          g.quadraticCurveTo(mx, my, Math.cos(a) * len, Math.sin(a) * len); g.stroke();
          g.lineWidth = R * P.branches.widthR * 0.6;
          g.beginPath(); g.moveTo(mx, my); g.lineTo(mx + Math.cos(a - 0.7) * len * 0.35, my + Math.sin(a - 0.7) * len * 0.35); g.stroke();
        }
      } },
      { f: H(P, 1, 0.55), shift: P.midShift, paint: (g) => { g.fillStyle = tone(pal, 1); lobes(g, mid); } },
      // el racimo alto y sus brillos van en UNA capa: un blit menos por árbol, y a esa altura el pinhole
      // ya no los separa lo suficiente para que se note
      { f: H(P, 2, 0.9), shift: P.topShift, paint: (g) => {
        g.fillStyle = tone(pal, 2); lobes(g, top);
        const d = P.highlightShift - P.topShift, L = R * d;   // los brillos, un poco más hacia la luz que el racimo
        g.fillStyle = tone(pal, 3); lobes(g, hi.map(([x, y, r]) => [x, y - L * 0.5, r]));
      } },
    ],
    sil: (s) => lobes(s, silhouette),
  };
}

// una hoja de palma vista desde arriba: dos mitades a cada lado de su nervio
function frondPath(g, a, len, w, side) {
  const ca = Math.cos(a), sa = Math.sin(a), nx = -sa * side, ny = ca * side;
  g.moveTo(0, 0);
  g.quadraticCurveTo(ca * len * 0.45 + nx * w, sa * len * 0.45 + ny * w, ca * len, sa * len);
  g.lineTo(ca * len * 0.12, sa * len * 0.12);
  g.closePath();
}
// la palmera: la corona de hojas con sus pinnas y, encima, la misma corona más angosta y clara —
// corrida hacia el sol, asoma del lado de la luz de cada hoja sea cual sea el giro de la planta
function palm(R, sp, P, rnd) {
  const pal = sp.canopy, n = Math.round(between(rnd, P.fronds)), F = [];
  for (let i = 0; i < n; i++) F.push({ a: (i / n) * TAU + (rnd() - 0.5) * P.jitter, len: R * between(rnd, P.len), w: R * between(rnd, P.widthR) });
  const fronds = (g, wK, lenK) => { g.beginPath(); for (const f of F) { frondPath(g, f.a, f.len * lenK, f.w * wK, -1); frondPath(g, f.a, f.len * lenK, f.w * wK, 1); } g.fill(); };
  return {
    layers: [
      { f: H(P, 0, 0.6), shift: 0, paint: (g) => {
        g.fillStyle = tone(pal, 1); fronds(g, 1, 1);
        // las pinnas: rayitas oscuras a lo largo de la hoja
        g.strokeStyle = tone(pal, 0); g.lineWidth = Math.max(0.5, R * P.pinnaW); g.lineCap = "round";
        g.beginPath();
        for (const f of F) {
          const ca = Math.cos(f.a), sa = Math.sin(f.a);
          g.moveTo(0, 0); g.lineTo(ca * f.len * 0.96, sa * f.len * 0.96);
          for (let k = 1; k <= P.pinnae; k++) {
            const u = k / (P.pinnae + 1), bx = ca * f.len * u, by = sa * f.len * u, wv = f.w * (1 - u) * 0.9;
            for (const s of [-1, 1]) { g.moveTo(bx, by); g.lineTo(bx + (-sa * s) * wv + ca * wv * 0.5, by + (ca * s) * wv + sa * wv * 0.5); }
          }
        }
        g.stroke();
      } },
      { f: H(P, 1, 1), shift: P.litShift, paint: (g) => {
        g.fillStyle = tone(pal, 2); fronds(g, P.litWidth, P.litLen);
        g.fillStyle = tone(pal, 0); g.beginPath(); g.arc(0, 0, R * P.heartR, 0, TAU); g.fill();
        g.fillStyle = tone(pal, 3); g.beginPath(); g.arc(0, 0, R * P.heartR * 0.5, 0, TAU); g.fill();
      } },
    ],
    sil: (s) => { s.beginPath(); for (const f of F) { frondPath(s, f.a, f.len, f.w, -1); frondPath(s, f.a, f.len, f.w, 1); } s.arc(0, 0, R * P.heartR, 0, TAU); s.fill(); },
  };
}

// la palma de abanico: cada hoja es un abanico plisado en la punta de su peciolo
function fan(R, sp, P, rnd) {
  const pal = sp.canopy, n = Math.round(between(rnd, P.leaves)), leaves = [];
  for (let i = 0; i < n; i++) leaves.push({ a: (i / n) * TAU + (rnd() - 0.5) * P.jitter, d: R * between(rnd, P.dist), r: R * between(rnd, P.leafR) });
  const blade = (s, f, rK, spreadK) => {
    const cx = Math.cos(f.a) * f.d, cy = Math.sin(f.a) * f.d;
    s.moveTo(cx, cy); s.arc(cx, cy, f.r * rK, f.a - P.spread * spreadK / 2, f.a + P.spread * spreadK / 2); s.closePath();
  };
  return {
    layers: [
      { f: H(P, 0, 0.7), shift: 0, paint: (g) => {
        g.strokeStyle = sp.trunk; g.lineWidth = Math.max(0.6, R * P.petioleW); g.lineCap = "round";
        g.beginPath(); for (const f of leaves) { g.moveTo(0, 0); g.lineTo(Math.cos(f.a) * f.d, Math.sin(f.a) * f.d); } g.stroke();
        g.fillStyle = tone(pal, 1); g.beginPath(); for (const f of leaves) blade(g, f, 1, 1); g.fill();
        g.strokeStyle = tone(pal, 0); g.lineWidth = Math.max(0.4, R * P.pleatW); g.beginPath();
        for (const f of leaves) {
          const cx = Math.cos(f.a) * f.d, cy = Math.sin(f.a) * f.d;
          for (let k = 0; k <= P.pleats; k++) { const b = f.a - P.spread / 2 + P.spread * k / P.pleats; g.moveTo(cx, cy); g.lineTo(cx + Math.cos(b) * f.r, cy + Math.sin(b) * f.r); }
        }
        g.stroke();
      } },
      { f: H(P, 1, 1), shift: P.litShift, paint: (g) => {
        g.fillStyle = tone(pal, 2); g.beginPath(); for (const f of leaves) blade(g, f, P.litR, P.litSpread); g.fill();
        g.fillStyle = tone(pal, 0); g.beginPath(); g.arc(0, 0, R * P.heartR, 0, TAU); g.fill();
      } },
    ],
    sil: (s) => { s.beginPath(); for (const f of leaves) blade(s, f, 1, 1); s.arc(0, 0, R * P.heartR, 0, TAU); s.fill(); },
  };
}

// la conífera: estrellas de agujas apiladas, de la más ancha y oscura abajo a la más chica y clara
// arriba. Cada estrella es una capa a SU altura: el pinhole las abre en un cono.
function conifer(R, sp, P, rnd) {
  const pal = sp.canopy, rings = P.rings, rot0 = rnd() * TAU;
  const star = (s, r, k, rot) => {
    s.beginPath();
    for (let i = 0; i <= k * 2; i++) { const a = rot + (i / (k * 2)) * TAU, rr = i % 2 ? r * P.innerR : r; s[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr); }
    s.closePath(); s.fill();
  };
  const layers = [];
  for (let i = 0; i < rings; i++) {
    const u = i / rings;
    layers.push({ f: rings > 1 ? i / (rings - 1) : 1, shift: u * P.ringShift,
      paint: (g) => { g.fillStyle = tone(pal, Math.min(3, i)); star(g, R * (1 - u * P.shrink), P.points, rot0 + i * 0.4); } });
  }
  return { layers, sil: (s) => star(s, R, P.points, rot0) };
}

// el árbol de la estación seca, desde arriba: sus RAMAS abiertas desde el centro, con cuerpo —un canto
// oscuro, la corteza y una luz— y unos racimos de hoja seca en las puntas, que van más arriba.
// La especie trae sólo corteza (`paletteRoles: ["trunk"]`): las tintas de la hoja seca y del canto son
// de la receta (`kinds.bare`), no de este archivo.
function bare(R, sp, P, rnd) {
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
  const limb = (s2, widen, dx, dy) => {
    s2.lineCap = "round"; s2.lineJoin = "round";
    for (const [x0, y0, mx, my, x1, y1, w] of segs) {
      s2.lineWidth = Math.max(0.6, w + widen); s2.beginPath(); s2.moveTo(x0 + dx, y0 + dy); s2.quadraticCurveTo(mx + dx, my + dy, x1 + dx, y1 + dy); s2.stroke();
    }
  };
  const leaves = [];
  for (const [x, y, a] of tips) {
    if (rnd() > P.leafKeep) continue;
    const c = Math.round(between(rnd, P.leafPer));
    for (let i = 0; i < c; i++) { const aa = a + (rnd() - 0.5) * 1.6, d = R * rnd() * P.leafSpread; leaves.push([x + Math.cos(aa) * d, y + Math.sin(aa) * d, R * between(rnd, P.leafR), Math.floor(rnd() * P.leaves.length)]); }
  }
  return {
    layers: [
      { f: H(P, 0, 0.5), shift: 0, paint: (g) => {
        g.strokeStyle = P.edge; limb(g, R * P.edgeR, 0, 0);
        g.strokeStyle = sp.trunk; limb(g, 0, 0, 0);
        g.fillStyle = P.edge; g.beginPath(); g.arc(0, 0, R * P.widthR * 1.25, 0, TAU); g.fill();
        g.fillStyle = sp.trunk; g.beginPath(); g.arc(0, 0, R * P.widthR * 0.95, 0, TAU); g.fill();
      } },
      // la luz de la corteza, un poco más arriba y corrida hacia el sol: se lee de qué lado pega
      { f: H(P, 1, 0.6), shift: P.shineShift, paint: (g) => {
        g.strokeStyle = P.shine; g.globalAlpha = P.shineAlpha; limb(g, -R * P.widthR * 0.55, 0, 0); g.globalAlpha = 1;
      } },
      { f: H(P, 2, 1), shift: 0, paint: (g) => {
        for (const [x, y, r, i] of leaves) { g.fillStyle = P.leaves[i]; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); }
      } },
    ],
    sil: (s2) => {
      s2.strokeStyle = s2.fillStyle; limb(s2, R * P.edgeR, 0, 0);
      s2.beginPath(); for (const [x, y, r] of leaves) { s2.moveTo(x + r, y); s2.arc(x, y, r, 0, TAU); } s2.fill();
    },
  };
}

const PAINTERS = { bare: bare, broadleaf: broadleaf, palm: palm, fan: fan, conifer: conifer };
export const TOPDOWN_KINDS = Object.freeze(Object.keys(PAINTERS));

/** ¿Tiene esta forma su versión cenital? */
export function topdownKind(T, form) { return T.byGenerator[form.generator] || null; }

/** La receta de un tipo con lo que su forma le cambia (`kinds` + `byForm`), resuelta una vez por par. */
const recipes = new Map();
export function topdownRecipe(T, kind, formId) {
  const key = `${kind}|${formId}`;
  let P = recipes.get(key);
  if (!P) recipes.set(key, (P = { ...T.kinds[kind], ...(T.byForm?.[formId] || {}) }));
  return P;
}

// LOS SPRITES SE PINTAN A TAMAÑOS ESCALONADOS y se escalan al blitear. Con la clave al medio píxel de
// radio, cada árbol del monte (de 0,85 a 1,25 de tamaño) pedía su propio juego de lienzos, y ahora un
// árbol son cinco: escalones de 2^(1/4) (un 19 %) dejan cuatro o cinco tamaños por especie.
const STEP = 4;
function quantR(R) { return Math.pow(2, Math.ceil(Math.log2(Math.max(1, R)) * STEP) / STEP); }

function sprite(T, sp, kind, P, R, variant, q) {
  let bySp = cache.get(sp);
  if (!bySp) cache.set(sp, (bySp = new Map()));
  const key = `${kind}|${variant}|${R}|${q}`;
  let hit = bySp.get(key);
  if (hit) return hit;
  const pad = Math.ceil(R * (P.padR || 1.3)) + 2, size = Math.ceil(pad * 2 * q);
  const mk = () => { const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d"); g.setTransform(q, 0, 0, q, size / 2, size / 2); return { c, g }; };
  const out = PAINTERS[kind](R, sp, P, rng(variant * 31.7 + R));
  const layers = out.layers.map((L) => { const cv = mk(); L.paint(cv.g); return { ...crop(cv.c, q), f: L.f, shift: L.shift || 0 }; });
  const shadow = mk();
  shadow.g.fillStyle = T.shadowInk;
  out.sil(shadow.g);
  hit = { layers, shadow: crop(shadow.c, q), R };
  if (bySp.size > T.cacheMax) bySp.delete(bySp.keys().next().value);
  bySp.set(key, hit);
  return hit;
}

// CADA LIENZO SE RECORTA A LO QUE TIENE PINTADO. Las capas altas de una copa ocupan un cuarto del
// cuadro de la copa entera, y blitearlas a tamaño completo era pagar píxeles transparentes: un blit
// cuesta su área de destino. Se mide el alfa una vez, al crear el sprite, y se guarda dónde cae el
// recorte respecto del centro (`ox`, `oy`, en unidades de mundo del radio cuantizado).
function crop(c, q) {
  const W = c.width, Hh = c.height, d = c.getContext("2d").getImageData(0, 0, W, Hh).data;
  let x0 = W, y0 = Hh, x1 = -1, y1 = -1;
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] === 0) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return { c, ox: 0, oy: 0, w: 0, h: 0 };
  const w = x1 - x0 + 1, h = y1 - y0 + 1, out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d").drawImage(c, x0, y0, w, h, 0, 0, w, h);
  return { c: out, ox: (x0 - W / 2) / q, oy: (y0 - Hh / 2) / q, w: w / q, h: h / q };
}

/** El eje del tronco a la fracción `t` de su alto: el pie más la inclinación (que crece como t²) más
 *  el corrimiento de esa altura — el pinhole (`lift`) para dibujarlo, el sol (`sun`) para su sombra. */
function axisAt(x, y, lean, v, h, t) {
  const tl = t * t;
  return [x + lean.dx * tl + v.dx * h * t, y + lean.dy * tl + v.dy * h * t];
}

/** Un tronco que se angosta hacia arriba, a lo largo de los puntos `A` (del pie hacia arriba). `side`:
 *  0 el tronco entero, ±1 sólo esa mitad. Lo agrega al camino abierto de `g`. */
function trunkOutline(g, A, wb, wt, side) {
  const n = A.length, L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const p = A[Math.max(0, i - 1)], q = A[Math.min(n - 1, i + 1)];
    let tx = q[0] - p[0], ty = q[1] - p[1];
    const len = Math.hypot(tx, ty) || 1; tx /= len; ty /= len;
    const w = wb + (wt - wb) * (i / (n - 1));
    L.push([A[i][0] - ty * w * (side > 0 ? 0 : 1), A[i][1] + tx * w * (side > 0 ? 0 : 1)]);
    Rr.push([A[i][0] + ty * w * (side < 0 ? 0 : 1), A[i][1] - tx * w * (side < 0 ? 0 : 1)]);
  }
  g.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i < n; i++) g.lineTo(L[i][0], L[i][1]);
  for (let i = n - 1; i >= 0; i--) g.lineTo(Rr[i][0], Rr[i][1]);
}

/**
 * Pinta UNA planta en 3D, vista desde arriba.
 *   g        el lienzo (en coordenadas de mundo)
 *   T        `effects.json → flora25.topdown`
 *   sp/kind  la especie (`flora.json`) y su tipo de copa; `P` la receta ya resuelta (`topdownRecipe`)
 *   x, y     el PIE: lo único que toca el suelo
 *   s, seed  escala (alto y copa) y semilla de la variante
 *   q        escala de pantalla del sprite
 *   hTop     la cima, en metros; `hBase` el arranque de la copa
 *   lift     {dx, dy}: píxeles que el pinhole corre algo por METRO de alto (ya con su tope)
 *   sun      {dx, dy, alpha}: lo mismo con el sol (`sunShadow(1)`), y la fuerza de su sombra
 *   light    {x, y}: unitario, hacia el sol en planta — hacia dónde se corren las capas claras
 *   lean     {dx, dy}: cuánto se inclina la copa respecto del pie, en píxeles (las palmeras)
 *   inks     {trunk, trunkDark, roots}: tintas del tronco y de las raíces, ya resueltas
 *   spin     giro extra (el vaivén de una palma)
 *   only     "shadow" | "trunk" | "crown": sólo esa pasada (el lote de `flora.js` las separa: todas las
 *            sombras, después todos los troncos —que van abajo— y por último las copas)
 *   trunkPaths  un Map donde juntar troncos y raíces por tinta (el lote los pinta de una vez)
 *   base     la transformación del lienzo, si quien llama ya la tiene (el lote la lee una vez)
 *   trunkShadows  un Path2D donde dejar la sombra del tronco en vez de pintarla (el lote la rellena
 *                 una vez, así que dos troncos que se cruzan no se oscurecen dos veces)
 */
export function paintTopdown(g, T, sp, kind, P, o) {
  const { x, y, s = 1, seed = 0, q = 1, spin = 0, only = null, hTop, hBase, lift, sun, light, inks } = o;
  const lean = o.lean || { dx: 0, dy: 0 };
  const R = sp.r * s * (T.radiusMul[kind] ?? 1), variant = Math.floor(hash01(seed * 3.1) * T.variants);
  const sq = Math.max(1, Math.min(T.maxQ, Math.round(q * 2) / 2));
  const S = sprite(T, sp, kind, P, quantR(R), variant, sq), k = R / S.R;
  // las palmas y las coníferas son simétricas: se giran por instancia, y así ninguna se repite. Las copas
  // de hojas no tienen por qué: su luz ya no va pintada de un lado (se corre al blitear), pero su racimo
  // está compuesto para leerse derecho
  const rot = T.spin[kind] ? hash01(seed * 7.3) * TAU + spin : 0;
  const ppm = o.ppm || 1;
  // UN SPRITE GIRADO O ESTIRADO SE PONE CON SU MATRIZ ENTERA, NO CON save/translate/restore. Medido en
  // el bosque más denso con la CPU frenada 4×: el save/restore alrededor de cada sombra costaba ~50 ms
  // de cuadro, y un blit plano ~10. Se compone la transformación del lienzo (`base`, que el lote pasa
  // una vez) con la del sprite, y se repone `base` una sola vez al final.
  const base = o.base || (rot || !only || only === "shadow" ? g.getTransform() : null);
  let moved = false;
  // un sprite recortado (`crop`), con su centro en (px, py): plano, o con la matriz `m` del sprite
  const blit = (I, px, py) => { if (I.w) g.drawImage(I.c, px + I.ox * k, py + I.oy * k, I.w * k, I.h * k); };
  const blitM = (I, px, py, ma, mb, mc, md) => {
    if (!I.w) return;
    const A = base;
    g.setTransform(A.a * ma + A.c * mb, A.b * ma + A.d * mb, A.a * mc + A.c * md, A.b * mc + A.d * md,
      A.a * px + A.c * py + A.e, A.b * px + A.d * py + A.f);
    g.drawImage(I.c, I.ox * k, I.oy * k, I.w * k, I.h * k);
    moved = true;
  };
  const wb = Math.max(0.6, (P.trunkWM || 0.4) * s * ppm) / 2, wt = wb * (P.trunkTaper ?? 0.7);
  const span = Math.max(0, hTop - hBase), mid = hBase + span * 0.5;

  if (!only || only === "shadow") {
    if (sun && sun.alpha > 0.002) {
      // LA SILUETA DE LA COPA, a la sombra de su CENTRO, estirada a lo largo del sol por lo que la copa
      // mide de alto (la sombra de un domo es más larga que ancha cuando el sol baja)
      const cx = x + lean.dx + sun.dx * mid, cy = y + lean.dy + sun.dy * mid;
      const sLen = Math.hypot(sun.dx, sun.dy), along = sLen * span;
      // (por debajo de un 5 % no se ve, y el blit plano es más barato que uno con matriz)
      const stretch = Math.min(T.shadowStretchMax || 1.8, 1 + along / (2 * R));
      // el lote pone el alfa de la sombra UNA vez para todas (`o.shadowAlphaSet`); suelto, cada árbol
      const prev = g.globalAlpha;
      if (!o.shadowAlphaSet) g.globalAlpha = prev * sun.alpha * T.shadowAlpha;
      if (stretch > 1.05 && sLen > 1e-6) {
        const ux = sun.dx / sLen, uy = sun.dy / sLen, e = stretch - 1;
        // el estirón a lo largo del sol (I + e·u·uᵀ), compuesto con el giro de la planta
        const sa = 1 + e * ux * ux, sb = e * ux * uy, sd = 1 + e * uy * uy, c = Math.cos(rot), sn = Math.sin(rot);
        blitM(S.shadow, cx, cy, sa * c + sb * sn, sb * c + sd * sn, -sa * sn + sb * c, -sb * sn + sd * c);
      } else if (rot) blitM(S.shadow, cx, cy, Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot));
      else blit(S.shadow, cx, cy);
      if (!o.shadowAlphaSet) g.globalAlpha = prev;
      if (moved) { g.setTransform(base); moved = false; }   // la franja del tronco va en coordenadas de mundo
      // EL TRONCO tira una franja del pie hacia la sombra de la copa, y se corta donde ésta empieza: si
      // se metiera debajo, la junta saldría dos veces oscura
      const dx = cx - x, dy = cy - y, d = Math.hypot(dx, dy), end = d - R * (T.trunkShadowTuckR ?? 0.8);
      if (end > 0.5) {
        const ux = dx / d, uy = dy / d, ex = x + ux * end, ey = y + uy * end;
        const sp2 = o.trunkShadows || null, path = sp2 || (g.beginPath(), g);
        const wE = wb + (wt - wb) * Math.min(1, end / (d || 1));
        // siempre con el mismo giro, para que un relleno `nonzero` de muchos sea su unión
        path.moveTo(x - uy * wb, y + ux * wb); path.lineTo(ex - uy * wE, ey + ux * wE);
        path.lineTo(ex + uy * wE, ey - ux * wE); path.lineTo(x + uy * wb, y - ux * wb);
        if (!sp2) {
          g.globalAlpha = prev * sun.alpha * T.shadowAlpha; g.fillStyle = T.shadowInk; g.fill(); g.globalAlpha = prev;
        }
      }
    }
  }
  if (only === "shadow") return;

  if (only !== "crown") {
    // LOS TRONCOS Y LAS RAÍCES DEL LOTE VAN EN UN CAMINO POR TINTA (`o.trunkPaths`, que el lote rellena al
    // final): son decenas de rellenos chiquitos por cuadro, y cada llamada de dibujo tiene su costo fijo.
    // Sin lote, cada árbol los pinta enseguida.
    const TP = o.trunkPaths || null;
    const pathFor = (kindKey, ink, width) => {
      if (!TP) { g.beginPath(); return g; }
      const key = `${kindKey}|${ink}|${width ? width.toFixed(1) : ""}`;
      let e = TP.get(key);
      if (!e) TP.set(key, (e = { kind: kindKey, ink, width, path: new Path2D() }));
      return e.path;
    };
    // LAS RAÍCES (el mangle): arcos del tronco al agua, alrededor del pie
    if (P.roots && inks.roots) {
      const rr = rng(seed * 5.3 + 1.7), n = Math.round(between(rr, P.roots.count));
      const width = Math.max(0.6, (P.roots.widthM || 0.12) * s * ppm), path = pathFor("roots", inks.roots, width);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + (rr() - 0.5) * 0.7, d = R * between(rr, P.roots.spreadR), hr = hBase * between(rr, P.roots.topFrac);
        const top = axisAt(x, y, lean, lift, hr, 1), ex = x + Math.cos(a) * d, ey = y + Math.sin(a) * d;
        const cxr = x + Math.cos(a) * d * 0.7 + lift.dx * hr * 0.9, cyr = y + Math.sin(a) * d * 0.7 + lift.dy * hr * 0.9;
        path.moveTo(top[0], top[1]); path.quadraticCurveTo(cxr, cyr, ex, ey);
      }
      if (!TP) { g.strokeStyle = inks.roots; g.lineWidth = width; g.lineCap = "round"; g.stroke(); }
    }
    // EL TRONCO: del pie al arranque de la copa, con el pinhole. Bajo la cámara mide nada y la copa lo
    // tapa; hacia el borde asoma del lado del centro, como la pared de un edificio
    // …Y SÓLO SI ASOMA. El pie queda bajo la copa mientras su distancia al centro de la capa ancha sea
    // menor que la copa misma: cerca del centro de la pantalla (y en casi todo mangle, que es bajo y
    // ancho) el tronco entero está tapado, y pintarlo eran dos rellenos que nadie veía
    const top = axisAt(x, y, lean, lift, hBase, 1);
    const h0 = hBase + span * (S.layers[0]?.f ?? 0);
    const footOff = Math.hypot(lean.dx + lift.dx * h0, lean.dy + lift.dy * h0);
    if (Math.hypot(top[0] - x, top[1] - y) > 0.4 && footOff > R * (T.trunkHiddenR ?? 0.8)) {
      const steps = lean.dx || lean.dy ? 4 : 1, A = [];
      for (let i = 0; i <= steps; i++) A.push(axisAt(x, y, lean, lift, hBase, i / steps));
      let path = pathFor("dark", inks.trunkDark);
      trunkOutline(path, A, wb, wt, 0);
      if (!TP) { g.fillStyle = inks.trunkDark; g.fill(); }
      // la mitad que mira al sol, en la tinta del tronco
      const ax = A[A.length - 1][0] - A[0][0], ay = A[A.length - 1][1] - A[0][1];
      // la normal derecha del eje es (ay, -ax): si mira al sol, la mitad derecha es la clara
      const sideToSun = (ay * light.x - ax * light.y) >= 0 ? 1 : -1;
      path = pathFor("lit", inks.trunk);
      trunkOutline(path, A, wb, wt, sideToSun);
      if (!TP) { g.fillStyle = inks.trunk; g.fill(); }
    }
  }
  if (only === "trunk") return;
  // LA COPA, capa por capa: cada una a su altura con el pinhole, y corrida hacia el sol lo que su
  // receta diga — las claras arriba y del lado de la luz, la oscura abajo y asomando del otro
  //
  // UNA COPA ES UN DOMO, NO UNA PILA. En la esquina de la pantalla el pinhole corre la cima casi un radio
  // más que la base, y sumado a la luz las capas de arriba se salían de la silueta: brillos flotando
  // fuera del árbol. Cada capa se aleja de la primera a lo sumo `layerMaxR` radios — la copa entera
  // sigue corrida lo que le toca a su altura, sólo deja de estirarse como un tubo.
  const Lr = R * (T.lightR ?? 0.8), maxD = R * (P.layerMaxR ?? 0.5);
  let bx = 0, by = 0;
  for (let i = 0; i < S.layers.length; i++) {
    const L = S.layers[i], hh = hBase + span * L.f;
    let px = x + lean.dx + lift.dx * hh + light.x * Lr * L.shift;
    let py = y + lean.dy + lift.dy * hh + light.y * Lr * L.shift;
    if (i === 0) { bx = px; by = py; } else {
      const dx = px - bx, dy = py - by, d = Math.hypot(dx, dy);
      if (d > maxD) { px = bx + dx * maxD / d; py = by + dy * maxD / d; }
    }
    if (!rot) blit(L, px, py);
    else blitM(L, px, py, Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot));
  }
  if (moved) g.setTransform(base);
}
