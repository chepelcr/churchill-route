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
  const P = mode === "sun"
    ? (u, v, h) => { const p = ground(u, v); return [p[0] + sun1.dx * h, p[1] + sun1.dy * h]; }
    : (u, v, h) => { const p = ground(u, v); if (!(h > 0)) return p; const o = parallaxOffset(cam, p[0], p[1], h, ppm, UNCAPPED); return [p[0] + o.dx * squash, p[1] + o.dy * squash]; };
  // la cámara y la luz, en el marco del juego (metros)
  const ex = (cam.x - x) / ppm, ey = (cam.y - y) / ppm;
  const C = [ex * c + ey * s, -ex * s + ey * c, CAM_H];
  const lx = -(sun1.dx * c + sun1.dy * s), ly = -(-sun1.dx * s + sun1.dy * c);   // hacia el sol, en planta
  const sh = mode === "sun";
  const items = [];

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
    P, ppm, C, shadow: sh, items,
    ink: (k) => (sh ? shade.shadow : k),
    /** encola un dibujo a la altura `h` (se pinta de lo bajo a lo alto) */
    at(h, fn) { items.push([h, items.length, fn]); },
    flush() { items.sort((a, b) => a[0] - b[0] || a[1] - b[1]); for (const it of items) it[2](); items.length = 0; },
    line(pts, wM, ink) {
      g.strokeStyle = R.ink(ink); g.lineWidth = Math.max(0.6, wM * ppm); g.lineCap = "round"; g.lineJoin = "round";
      path(pts); g.stroke();
    },
    poly(pts, ink, edge = null, edgeM = 0.08) {
      path(pts); g.closePath(); g.fillStyle = R.ink(ink); g.fill();
      if (edge && !sh) { g.strokeStyle = edge; g.lineWidth = Math.max(0.5, edgeM * ppm); g.stroke(); }
    },
    dot(p, rM, ink) {
      const q = P(p[0], p[1], p[2]);
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
    /** ¿la cara con normal `n` que pasa por `p` mira a la cámara? */
    faces(p, n) { return sh || (C[0] - p[0]) * n[0] + (C[1] - p[1]) * n[1] + (C[2] - p[2]) * n[2] > 0; },
  };
  return R;
}
