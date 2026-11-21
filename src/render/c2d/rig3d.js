// EL APAREJO 3D DE LA FERIA — piezas en METROS, proyectadas con la misma cámara que los edificios.
//
// Los cuerpos (`bodies.js`) son prismas QUIETOS: una pared, una tapa, un techo. Un juego de feria se
// MUEVE — un brazo que da la vuelta, una góndola que cuelga, un barco que se mece —, y eso no se puede
// escribir como una receta de pisos. Este aparejo es lo mínimo para dibujarlo bien desde arriba:
//
//   * un punto es (u, v, h): u y v en el marco del juego, h de alto, todo en metros;
//   * `P` lo lleva a la pantalla con `parallaxOffset` (con su tope), o con `sunShadow` cuando se pinta
//     la sombra — el MISMO dibujo, otro mapeo, así que la sombra es la silueta real de lo que se mueve;
//   * una caja ORIENTADA (`obox`) muestra las caras que miran a la cámara —se pregunta a la posición
//     de la cámara en 3D, no a la pantalla— y las sombrea según el sol, como las paredes de un edificio;
//   * lo que se pide se ENCOLA con su altura y se pinta de lo bajo a lo alto, que desde arriba es de
//     lejos a cerca: la góndola de arriba tapa al rayo de abajo, y no al revés.
//
// No tiene colores propios: cada tinta llega del registro del juego (`feriaAssets.json`), y el
// oscurecido de una cara es una mezcla hacia la tinta de costado que también llega del registro.
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { parallaxOffset } from "./depth.js";
import { sunShadow } from "./shadows.js";
import { mixColor } from "./gfx.js";

const PARALLAX = EFFECTS.parallax || {};
const CAM_H = PARALLAX.cameraHeightM || 60;
const UNCAPPED = { ...PARALLAX, maxOffsetPx: 0 };
const TAU = Math.PI * 2;

/**
 * Un aparejo para un juego parado en (x, y) de mundo y girado `rot`.
 * `mode`: "cam" pinta lo que se ve; "sun" pinta su sombra (todo en `shade.shadow`).
 * `shade`: { side, litK, darkK, bottomK, shadow } — las mezclas de las caras, del registro.
 * `topM`: lo más alto del juego; el tope de perspectiva se reparte sobre esa altura.
 */
export function makeRig(g, x, y, rot, ppm, cam, mode, shade, topM = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  // EL TOPE DE LA PERSPECTIVA SE APLICA AL JUEGO ENTERO, NO A CADA PUNTO. Recortado punto por punto
  // (como un edificio, que es UNA altura), todo lo que pasa de cierta altura cae al mismo corrimiento
  // y la cima de la rueda salía PLANA. Se mide el corrimiento sin tope a la altura del juego (`topM`)
  // y, si pasa del tope, se encoge TODA la altura por el mismo factor: la forma se conserva.
  const raw = topM > 0 ? parallaxOffset(cam, x, y, topM, ppm, UNCAPPED) : { dx: 0, dy: 0 };
  const rawLen = Math.hypot(raw.dx, raw.dy), cap = PARALLAX.maxOffsetPx || 0;
  const squash = cap > 0 && rawLen > cap ? cap / rawLen : 1;
  const ground = (u, v) => [x + (u * c - v * s) * ppm, y + (u * s + v * c) * ppm];
  const sun1 = sunShadow(1);
  // "sil": la SOMBRA, pero juntada en un camino en vez de pintada pieza por pieza (ver `silhouette` abajo)
  const collect = mode === "sil";
  const P = mode === "sun" || collect
    ? (u, v, h) => { const p = ground(u, v); return [p[0] + sun1.dx * h, p[1] + sun1.dy * h]; }
    : (u, v, h) => { const p = ground(u, v); if (!(h > 0)) return p; const o = parallaxOffset(cam, p[0], p[1], h, ppm, UNCAPPED); return [p[0] + o.dx * squash, p[1] + o.dy * squash]; };
  // la cámara y la luz, en el marco del juego (metros)
  const ex = (cam.x - x) / ppm, ey = (cam.y - y) / ppm;
  const C = [ex * c + ey * s, -ex * s + ey * c, CAM_H];
  const lx = -(sun1.dx * c + sun1.dy * s), ly = -(-sun1.dx * s + sun1.dy * c);   // hacia el sol, en planta
  const sh = mode === "sun" || collect;
  const items = [];
  // LA SILUETA, para pintar la sombra SIN LIENZO APARTE. Cada pieza entra al MISMO camino con el MISMO
  // giro —el de `arc`, horario en pantalla—, y un relleno `nonzero` de piezas que giran igual es su UNIÓN:
  // donde dos se montan no se oscurece dos veces, que es todo lo que `withShadowLayer` compraba con su
  // lienzo y su `drawImage` por cuerpo. Una caja entra como la envolvente de sus 8 esquinas al sol (eso
  // ES la sombra de un prisma), un polígono con su giro corregido, un punto como disco y un trazo como
  // cápsulas.
  const sil = collect ? new Path2D() : null;
  const addPoly = (Q) => {
    let a2 = 0;
    for (let i = 0; i < Q.length; i++) { const p = Q[i], q = Q[(i + 1) % Q.length]; a2 += p[0] * q[1] - q[0] * p[1]; }
    const n = Q.length;
    for (let k = 0; k < n; k++) { const q = Q[a2 >= 0 ? k : n - 1 - k]; k ? sil.lineTo(q[0], q[1]) : sil.moveTo(q[0], q[1]); }
  };
  const addDisc = (x, y, r) => { sil.moveTo(x + r, y); sil.arc(x, y, r, 0, TAU); };
  const hull = (Q) => {
    Q.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const H = [];
    for (const pass of [Q, Q.slice().reverse()]) {
      const start = H.length;
      for (const p of pass) { while (H.length >= start + 2 && cross(H[H.length - 2], H[H.length - 1], p) <= 0) H.pop(); H.push(p); }
      H.pop();
    }
    return H;
  };

  const face = (base, n) => {
    if (sh) return shade.shadow;
    if (n[2] > 0.7) return base;
    if (n[2] < -0.7) return mixColor(base, shade.side, shade.bottomK);
    return mixColor(base, shade.side, n[0] * lx + n[1] * ly > 0 ? shade.litK : shade.darkK);
  };
  const path = (pts) => {
    g.beginPath();
    pts.forEach((p, i) => { const q = P(p[0], p[1], p[2]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); });
  };

  const R = {
    P, ppm, C, shadow: sh, items, silhouette: sil,
    ink: (k) => (sh ? shade.shadow : k),
    /** encola un dibujo a la altura `h` (se pinta de lo bajo a lo alto) */
    at(h, fn) { items.push([h, items.length, fn]); },
    /** pinta lo encolado de lo bajo a lo alto; `keep(h)` elige qué alturas pinta esta vez */
    flush(keep = null) { items.sort((a, b) => a[0] - b[0] || a[1] - b[1]); for (const it of items) if (!keep || keep(it[0])) it[2](); items.length = 0; },
    line(pts, wM, ink) {
      if (collect) {
        const r = Math.max(0.6, wM * ppm) / 2, Q = pts.map((p) => P(p[0], p[1], p[2]));
        for (let i = 0; i < Q.length; i++) {
          addDisc(Q[i][0], Q[i][1], r);
          if (i + 1 < Q.length) {
            const a = Q[i], b = Q[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
            if (L > 0.01) { const nx = -(b[1] - a[1]) / L * r, ny = (b[0] - a[0]) / L * r; addPoly([[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]]); }
          }
        }
        return;
      }
      g.strokeStyle = R.ink(ink); g.lineWidth = Math.max(0.6, wM * ppm); g.lineCap = "round"; g.lineJoin = "round";
      path(pts); g.stroke();
    },
    poly(pts, ink, edge = null, edgeM = 0.08) {
      if (collect) { addPoly(pts.map((p) => P(p[0], p[1], p[2]))); return; }
      path(pts); g.closePath(); g.fillStyle = R.ink(ink); g.fill();
      if (edge && !sh) { g.strokeStyle = edge; g.lineWidth = Math.max(0.5, edgeM * ppm); g.stroke(); }
    },
    dot(p, rM, ink) {
      const q = P(p[0], p[1], p[2]);
      if (collect) { addDisc(q[0], q[1], Math.max(0.7, rM * ppm)); return; }
      g.fillStyle = R.ink(ink); g.beginPath(); g.arc(q[0], q[1], Math.max(0.7, rM * ppm), 0, TAU); g.fill();
    },
    /** puntos de un círculo de radio `r` alrededor de `o`, en el plano de los ejes unitarios e1, e2 */
    circle(o, e1, e2, r, n = 20, a0 = 0) {
      const out = [];
      for (let k = 0; k < n; k++) {
        const a = a0 + k / n * TAU, ca = Math.cos(a) * r, sa = Math.sin(a) * r;
        out.push([o[0] + e1[0] * ca + e2[0] * sa, o[1] + e1[1] * ca + e2[1] * sa, o[2] + e1[2] * ca + e2[2] * sa]);
      }
      return out;
    },
    /**
     * Una caja orientada: centro `o` y tres semiejes (vectores 3D). `ink` es un color o
     * {top, side, bottom}: la cara de arriba en `top`, las demás en `side` sombreadas por el sol.
     * Se pintan sólo las caras que miran a la cámara (en sombra, todas).
     */
    obox(o, a, b, d, ink) {
      if (collect) {
        const Q = [];
        for (const i of [-1, 1]) for (const j of [-1, 1]) for (const k of [-1, 1])
          Q.push(P(o[0] + a[0] * i + b[0] * j + d[0] * k, o[1] + a[1] * i + b[1] * j + d[1] * k, o[2] + a[2] * i + b[2] * j + d[2] * k));
        addPoly(hull(Q));
        return;
      }
      const inks = typeof ink === "string" ? { top: ink, side: ink, bottom: ink } : ink;
      const ax = [a, b, d], faces = [];
      for (let i = 0; i < 3; i++) for (const sg of [-1, 1]) {
        const n0 = ax[i], len = Math.hypot(n0[0], n0[1], n0[2]) || 1, n = [n0[0] / len * sg, n0[1] / len * sg, n0[2] / len * sg];
        const fc = [o[0] + n0[0] * sg, o[1] + n0[1] * sg, o[2] + n0[2] * sg];
        if (!sh && (C[0] - fc[0]) * n[0] + (C[1] - fc[1]) * n[1] + (C[2] - fc[2]) * n[2] <= 0) continue;
        const p = ax[(i + 1) % 3], q = ax[(i + 2) % 3];
        const pts = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([j, k]) =>
          [fc[0] + p[0] * j + q[0] * k, fc[1] + p[1] * j + q[1] * k, fc[2] + p[2] * j + q[2] * k]);
        const base = n[2] > 0.7 ? inks.top : n[2] < -0.7 ? (inks.bottom || inks.side) : inks.side;
        faces.push([fc[2], pts, face(base, n)]);
      }
      faces.sort((m, k) => m[0] - k[0]);
      for (const [, pts, col] of faces) { path(pts); g.closePath(); g.fillStyle = col; g.fill(); }
    },
    /** la caja de siempre: centro (u, v), de z0 a z1, `w` a lo largo de u, `d` a lo largo de v, girada `ang` */
    box(u, v, z0, z1, w, d, ink, ang = 0) {
      const ca = Math.cos(ang), sa = Math.sin(ang);
      R.obox([u, v, (z0 + z1) / 2], [ca * w / 2, sa * w / 2, 0], [-sa * d / 2, ca * d / 2, 0], [0, 0, (z1 - z0) / 2], ink);
    },
    /**
     * UN RÓTULO PINTADO SOBRE UNA CARA HORIZONTAL: centrado en `o`, a lo largo del eje `e` (un vector en
     * metros del marco del juego), de `hM` metros de alto y nunca más ancho que `maxM`. Se proyecta con
     * la cámara como todo lo demás y se ENDEREZA: si el eje queda de cabeza en pantalla se lee al revés.
     * `font` es `{ weight, family }` del registro. En sombra no se pinta: una letra no tira sombra.
     */
    text(o, e, str, hM, maxM, ink, font) {
      if (sh || !str) return;
      const a = P(o[0], o[1], o[2]), b = P(o[0] + e[0], o[1] + e[1], o[2]);
      const m = g.getTransform();
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const sx = m.a * Math.cos(ang) + m.c * Math.sin(ang), sy = m.b * Math.cos(ang) + m.d * Math.sin(ang);
      if (Math.abs(Math.atan2(sy, sx)) > Math.PI / 2) ang += Math.PI;
      const unit = Math.hypot(b[0] - a[0], b[1] - a[1]) / (Math.hypot(e[0], e[1]) || 1);   // px por metro, a esa altura
      g.save(); g.translate(a[0], a[1]); g.rotate(ang);
      let px = hM * unit;
      g.font = `${font.weight} ${px}px ${font.family}`;
      const w = g.measureText(str).width, max = maxM * unit;
      if (w > max) { px *= max / w; g.font = `${font.weight} ${px}px ${font.family}`; }
      g.fillStyle = ink; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(str, 0, 0);
      g.restore();
    },
    /** ¿la cara con normal `n` que pasa por `p` mira a la cámara? */
    faces(p, n) { return sh || (C[0] - p[0]) * n[0] + (C[1] - p[1]) * n[1] + (C[2] - p[2]) * n[2] > 0; },
  };
  return R;
}

// LA SOMBRA DE UN CUERPO EN MOVIMIENTO se pinta OPACA en su propio lienzo (del tamaño del cuerpo en
// pantalla) y se compone con alfa UNA vez: así no se oscurece donde dos piezas se cruzan.
// `g` es el lienzo destino (con su transformación de mundo); `draw(sg)` pinta la silueta en `sg`,
// que ya trae esa misma transformación.
//
// …Y CON UN LOTE ABIERTO, SE COMPONE UNA VEZ POR LOTE, NO POR CUERPO. Componer un lienzo sobre otro
// con `drawImage` obliga al navegador a terminar de pintar el primero antes de leerlo: medido, cada
// capa costaba de 0,3 a 1 ms FIJOS, del tamaño que fuera, y el Paseo llegó a pedir noventa por cuadro
// (en un teléfono, con la GPU, esa sincronización es todavía más cara). Entre `beginShadowBatch` y
// `flushShadowBatch` cada silueta se pinta opaca en un lienzo compartido del tamaño de la vista —uno
// por cada alfa, que son tres o cuatro: el sol por la constante de cada clase de cosa— y se compone
// al cerrar. Lo único que cambia es que dos sombras VECINAS que se montan ya no se oscurecen dos
// veces, que es la misma regla que dentro de un cuerpo y la de `bodies.js → paintShadow`.
//
// Sólo vale para quien ENCOLA su cuerpo (lo pinta `flushBodies`, después): quien pinta el cuerpo
// enseguida de su sombra —el ferri, su casco bajo— pide `immediate`, o la sombra le caería encima.
let shadowCanvas = null;
const batch = { open: false, layers: new Map() };   // alfa → { canvas, g, alpha, rects }

/** Abre un lote: las sombras que siguen se juntan hasta `flushShadowBatch`. `__perfFlags.noShadowBatch`
 *  lo deja cerrado, para medir el lote contra la capa por cuerpo en la MISMA escena. */
export function beginShadowBatch() { batch.open = !(typeof window !== "undefined" && window.__perfFlags?.noShadowBatch); }

/** Compone lo juntado sobre `g` (una vez por alfa y por caja) y cierra el lote. */
export function flushShadowBatch(g) {
  batch.open = false;
  for (const L of batch.layers.values()) {
    if (!L.rects.length) continue;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = L.alpha;
    L.g.setTransform(1, 0, 0, 1, 0, 0);
    for (const [x0, y0, x1, y1] of L.rects) {
      g.drawImage(L.canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
      L.g.clearRect(x0, y0, x1 - x0, y1 - y0);
    }
    g.restore();
    L.rects.length = 0;
  }
}

// UNA CAJA POR SOMBRA, Y SÓLO SE FUNDEN LAS QUE SE TOCAN. Con una sola caja que abarcara todo el lote,
// dos carros en esquinas opuestas componían —y limpiaban— la pantalla entera. Separadas, cada región se
// compone UNA vez (si dos se montaran, su cruce se oscurecería dos veces: por eso se funden).
function addRect(rects, r) {
  for (let i = 0; i < rects.length; i++) {
    const q = rects[i];
    if (r[0] < q[2] && q[0] < r[2] && r[1] < q[3] && q[1] < r[3]) {
      rects.splice(i, 1);
      return addRect(rects, [Math.min(r[0], q[0]), Math.min(r[1], q[1]), Math.max(r[2], q[2]), Math.max(r[3], q[3])]);
    }
  }
  rects.push(r);
}

function batchLayer(g, alpha) {
  const key = Math.round(alpha * 1000);
  let L = batch.layers.get(key);
  if (!L) {
    const canvas = document.createElement("canvas");
    L = { canvas, g: canvas.getContext("2d"), alpha, rects: [] };
    batch.layers.set(key, L);
  }
  L.alpha = alpha;
  const W = g.canvas.width, H = g.canvas.height;
  if (L.canvas.width !== W || L.canvas.height !== H) {
    L.canvas.width = W; L.canvas.height = H;   // redimensionar ya lo deja en blanco
    L.rects.length = 0;
  }
  return L;
}

export function withShadowLayer(g, x, y, radiusPx, alpha, draw, immediate = false) {
  if (typeof document === "undefined") return;
  const m = g.getTransform(), sc = Math.hypot(m.a, m.b), c = m.transformPoint({ x, y });
  const R = radiusPx * sc, bx = Math.floor(c.x - R), by = Math.floor(c.y - R), w = Math.ceil(2 * R), h = w;
  if (w <= 0) return;
  if (batch.open && !immediate && g.canvas) {
    const L = batchLayer(g, alpha), cw = L.canvas.width, ch = L.canvas.height;
    const x0 = Math.max(0, bx), y0 = Math.max(0, by), x1 = Math.min(cw, bx + w), y1 = Math.min(ch, by + h);
    if (x1 <= x0 || y1 <= y0) return;   // fuera de la vista: nada que juntar
    addRect(L.rects, [x0, y0, x1, y1]);
    // el mismo recorte que el lienzo propio: lo que la silueta pinte fuera de su caja no existía antes
    L.g.save(); L.g.setTransform(1, 0, 0, 1, 0, 0);
    L.g.beginPath(); L.g.rect(x0, y0, x1 - x0, y1 - y0); L.g.clip();
    L.g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    draw(L.g);
    L.g.restore();
    return;
  }
  if (!shadowCanvas) shadowCanvas = document.createElement("canvas");
  if (shadowCanvas.width < w) shadowCanvas.width = w;
  if (shadowCanvas.height < h) shadowCanvas.height = h;
  const sg = shadowCanvas.getContext("2d");
  sg.setTransform(1, 0, 0, 1, 0, 0); sg.clearRect(0, 0, w, h);
  sg.setTransform(m.a, m.b, m.c, m.d, m.e - bx, m.f - by);
  draw(sg);
  g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = alpha;
  g.drawImage(shadowCanvas, 0, 0, w, h, bx, by, w, h); g.restore();
}

/**
 * PINTA LA SOMBRA DE UN APAREJO EN UN SOLO RELLENO, sin lienzo aparte. `build(mode)` arma el aparejo en
 * el modo que se le pide y lo vacía (`flush`); aquí se le pide `"sil"` y se rellena su silueta con el
 * alfa sobre `g`. Mismo dibujo que `withShadowLayer` (la unión de las piezas al sol, oscura una sola
 * vez) sin su `drawImage`, que en el Paseo eran decenas por cuadro.
 */
export function fillRigShadow(g, alpha, ink, build) {
  if (!(alpha > 0.001)) return;
  const R = build("sil");
  if (!R || !R.silhouette) return;
  g.save(); g.globalAlpha = alpha; g.fillStyle = ink; g.fill(R.silhouette); g.restore();
}
