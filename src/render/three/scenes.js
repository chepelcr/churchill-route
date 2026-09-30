// LAS ESCENAS CON VOLUMEN — la catedral, la casa de la cultura, la escuela…
//
// Una escena del registro (`world-props.json` → scenes) ya dice qué masa tiene
// qué altura: `heightM` y `castsShadow`, heredados hacia adentro, que Canvas usa
// para su sombra. Acá esas mismas alturas levantan volumen, SIN una segunda
// descripción de la catedral:
//
//   1. se pinta la escena en un lienzo propio, en coordenadas de mundo, con
//      `paintParcelHeights` — la primera pasada de siempre, pero cada masa del
//      color de su altura (decímetros en el rojo) y con `lighten`, así que
//      donde el cimborrio pisa la nave queda el cimborrio;
//   2. por cada altura distinta, de abajo hacia arriba, marching squares sobre
//      «todo lo que es al menos así de alto» (`contour.js`) da los lazos;
//   3. cada banda es una pared desde la banda anterior y una tapa a su altura.
//
// El COLOR no es de acá: tapas y paredes llevan el cuadro vivo de Canvas
// proyectado en planta (`canvasTexture.js`), así que el techo de la catedral es
// el techo que Canvas pinta — sus tejas, su cruz, sus torres — sólo que arriba.
import { WORLD2D as W } from "../../world2d/index.js";
import { withSurface } from "../c2d/gfx.js";
import { paintParcelHeights, parcelSceneNames, sceneHasHeight } from "../c2d/landmarks.js";
import { maskLoops } from "./contour.js";
import { groundBase } from "./ground.js";
import { projectedMaterial } from "./canvasTexture.js";

const S = 2;             // texels por px de mundo en la captura de alturas
const PAD = 12;          // px de margen alrededor de la parcela
const DM = 10;           // decímetros por metro: la altura va en el rojo, 0..25,5 m
const WALL_READ_IN = 4;   // px hacia adentro de la huella donde una pared lee su color:
                          // más que la copa de un árbol pintado que pisa el borde

let T = null, material = null;
const built = new Map();   // parcel id → { mesh, used }

export function setupScenes(THREE) {
  T = THREE;
  material = projectedMaterial();
}

const inkFor = (h) => `rgb(${Math.max(1, Math.min(255, Math.round(h * DM)))},0,0)`;

function captureHeights(P, names) {
  const x0 = Math.floor(P.x0 - PAD), y0 = Math.floor(P.y0 - PAD);
  const w = Math.ceil((P.x1 + PAD - x0) * S), h = Math.ceil((P.y1 + PAD - y0) * S);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.setTransform(S, 0, 0, S, -x0 * S, -y0 * S);
  g.globalCompositeOperation = "lighten";
  withSurface(g, () => { for (const n of names) paintParcelHeights(P, n, inkFor); });
  const px = g.getImageData(0, 0, w, h).data;
  const hdm = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) hdm[i] = px[i * 4 + 3] >= 128 ? px[i * 4] : 0;
  return { hdm, w, h, x0, y0 };
}

function pushTri(pos, shift, a, b, c, n, sx = 0, sy = 0) {
  // girado para que el frente mire hacia n (la regla de buildings.js)
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  if (dot < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c);
  shift.push(sx, sy, sx, sy, sx, sy);
}

function buildVolume(P, names) {
  const cap = captureHeights(P, names);
  const { hdm, w, h, x0, y0 } = cap;
  const bands = [...new Set(hdm)].filter((v) => v > 0).sort((a, b) => a - b);
  if (!bands.length) return null;
  const pxm = W.PX_PER_M;
  const base = groundBase((P.x0 + P.x1) / 2, (P.y0 + P.y1) / 2);
  const toWorld = ([px, py]) => [x0 + (px + 0.5) / S, y0 + (py + 0.5) / S];
  const pos = [], shift = [];
  let prevZ = base;
  for (const band of bands) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = hdm[i] >= band ? 1 : 0;
    const z = base + (band / DM) * pxm;
    const solid = (wx, wy) => {
      const px = Math.floor((wx - x0) * S), py = Math.floor((wy - y0) * S);
      return px >= 0 && py >= 0 && px < w && py < h && mask[py * w + px] === 1;
    };
    for (const { outer, holes } of maskLoops(mask, w, h)) {
      // paredes: cada arista, con la normal hacia AFUERA de lo sólido
      for (const loop of [outer, ...holes]) {
        const pts = loop.map(toWorld);
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
          const ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey);
          if (len < 1e-6) continue;
          let nx = ey / len, ny = -ex / len;
          const mx = (ax + bx) / 2, my = (ay + by) / 2;
          if (solid(mx + nx * 0.75, my + ny * 0.75)) { nx = -nx; ny = -ny; }
          const n = [nx, ny, 0];
          const sx = -nx * WALL_READ_IN, sy = -ny * WALL_READ_IN;
          pushTri(pos, shift, [ax, ay, prevZ], [bx, by, prevZ], [bx, by, z], n, sx, sy);
          pushTri(pos, shift, [ax, ay, prevZ], [bx, by, z], [ax, ay, z], n, sx, sy);
        }
      }
      // la tapa, con sus agujeros
      const contour = outer.map((p) => new T.Vector2(...toWorld(p)));
      const hl = holes.map((hole) => hole.map((p) => new T.Vector2(...toWorld(p))));
      const all = contour.concat(...hl);
      for (const [i, j, k] of T.ShapeUtils.triangulateShape(contour, hl)) {
        pushTri(pos, shift, [all[i].x, all[i].y, z], [all[j].x, all[j].y, z], [all[k].x, all[k].y, z], [0, 0, 1]);
      }
    }
    prevZ = z;
  }
  if (!pos.length) return null;
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("canvasShift", new T.Float32BufferAttribute(shift, 2));
  g.computeVertexNormals();          // no indexada: normales de cara, planas
  g.computeBoundingSphere();
  const mesh = new T.Mesh(g, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.bands = bands.length;
  return mesh;
}

/** Levanta (una vez) las escenas con altura de las parcelas cerca de la vista. */
export function syncScenes(root, view, frameNo, budget = 1) {
  const pad = 200;
  let changed = 0;
  for (const P of W.PARCELS || []) {
    if (P.x1 < view.x0 - pad || P.x0 > view.x1 + pad || P.y1 < view.y0 - pad || P.y0 > view.y1 + pad) continue;
    let e = built.get(P.id);
    if (!e) {
      if (budget <= 0) continue;
      const names = parcelSceneNames(P).filter(sceneHasHeight);
      if (names.length && !W.tileResident((P.x0 + P.x1) / 2, (P.y0 + P.y1) / 2)) continue;
      budget -= names.length ? 1 : 0;
      e = { mesh: names.length ? buildVolume(P, names) : null, used: frameNo };
      built.set(P.id, e);
      if (e.mesh) { root.add(e.mesh); changed++; }
    }
    e.used = frameNo;
  }
  for (const [id, e] of built) {
    if (frameNo - e.used < 600) continue;
    if (e.mesh) { root.remove(e.mesh); e.mesh.geometry.dispose(); changed++; }
    built.delete(id);
  }
  return changed;
}

export function sceneStats() {
  let volumes = 0;
  for (const e of built.values()) if (e.mesh) volumes++;
  return { volumes };
}
