// LA ORILLA CON CUERPO — el talud y la escollera donde la tierra toca el mar.
//
// El suelo lo sigue pintando Canvas en planta, así que el mar y la tierra
// están los dos a h = 0 y el borde entre ellos es una línea. Donde hay PLAYA
// eso es verdad (la arena baja sola hasta el agua); donde no —La Punta, el
// frente del puerto, las orillas del estero— el borde es un talud de concreto
// y roca, y eso es lo que esto levanta:
//
//   * el TALUD: una cara que baja `depthM` desde el borde de la tierra hacia el
//     agua, un poco inclinada hacia afuera;
//   * la ESCOLLERA: rocas instanciadas al pie, del gris de `materials.coast`;
//   * un PLATO DE PROFUNDIDAD sobre la tierra, invisible (no escribe color),
//     que tapa la parte de un talud que queda DETRÁS de la tierra — en una
//     orilla que mira al norte la cara baja hacia el sur de la pantalla, por
//     encima del suelo pintado, y sin el plato se vería a través de él.
//
// Qué borde es escollera y cuál es playa lo decide el SUELO: el talud va donde
// una celda dura (ni agua ni arena) toca una de agua. Donde hay arena de por
// medio la playa baja sola y no hay talud.
import { WORLD2D as W } from "../../world2d/index.js";
import { SURFACE } from "../../game/surfaces.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import { hash01 } from "../c2d/primitives.js";
import { tintMaterial } from "./tint.js";

const C = MATERIALS.coast;
const PROBE_PX = 3;         // a cuánto de cada lado se pregunta al suelo
const SLOPE_PX = 3;         // cuánto avanza el pie del talud hacia el agua
const ROCK_PITCH_PX = 5;
const PLATE_H = -0.2;       // bajo el receptor de sombra (−0.125), sobre el talud

let T = null, mat = null, rockGeo = null;
const tiles = new Map();

export function setupCoast(THREE) {
  T = THREE;
  mat = {
    wall: new T.MeshLambertMaterial({ color: new T.Color().setStyle(C.wall) }),
    rock: new T.MeshLambertMaterial({ flatShading: true }),
    plate: new T.MeshBasicMaterial({ colorWrite: false }),
  };
  tintMaterial(mat.wall);
  tintMaterial(mat.rock);
  rockGeo = new T.IcosahedronGeometry(1, 0);
}

// LOS BORDES SALEN DEL SUELO, NO DEL POLÍGONO. El frente de mar que se ve es
// el del ráster (el malecón, la plazoleta del faro y la arena ganada al mar se
// estampan por celda), así que un talud que siguiera `LAND_POLYS` quedaba
// debajo del paseo o a metros de la orilla pintada. Marching squares sobre los
// centros de celda: la frontera agua/orilla sale en tramos de 45° en vez de la
// escalera de la celda, y cae donde Canvas pinta el borde.
function coastSegments(tile) {
  const { grid, cols, rows } = tile;
  if (!grid) return [];
  const cell = W.CELL;
  const at = (c, r) => {
    if (c < cols && r < rows) return grid[r * cols + c];
    return W.surfaceAt(tile.x + (c + 0.5) * cell, tile.y + (r + 0.5) * cell);
  };
  // 1 = orilla dura; el agua, la arena y los muelles (un tablero sobre pilotes,
  // no un relleno) son 0
  const solid = (c, r) => { const v = at(c, r); return v !== SURFACE.WATER && v !== SURFACE.BEACH && v !== SURFACE.BRIDGE ? 1 : 0; };
  const out = [];
  let prev = new Uint8Array(cols + 1), cur = new Uint8Array(cols + 1);
  for (let c = 0; c <= cols; c++) prev[c] = solid(c, 0);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) cur[c] = solid(c, r + 1);
    for (let c = 0; c < cols; c++) {
      const tl = prev[c], tr = prev[c + 1], br = cur[c + 1], bl = cur[c];
      const k = tl | (tr << 1) | (br << 2) | (bl << 3);
      if (k === 0 || k === 15) continue;
      // centros de celda → puntos medios de las aristas del bloque
      const x0 = tile.x + (c + 0.5) * cell, y0 = tile.y + (r + 0.5) * cell;
      const T_ = [x0 + cell / 2, y0], R_ = [x0 + cell, y0 + cell / 2];
      const B_ = [x0 + cell / 2, y0 + cell], L_ = [x0, y0 + cell / 2];
      const add = (p, q) => out.push(p[0], p[1], q[0], q[1]);
      switch (k) {
        case 1: case 14: add(L_, T_); break;
        case 2: case 13: add(T_, R_); break;
        case 4: case 11: add(R_, B_); break;
        case 8: case 7: add(B_, L_); break;
        case 3: case 12: add(L_, R_); break;
        case 6: case 9: add(T_, B_); break;
        case 5: add(L_, T_); add(R_, B_); break;
        case 10: add(T_, R_); add(B_, L_); break;
      }
    }
    const t = prev; prev = cur; cur = t;
  }
  return out;
}

function isShore(c) { return c !== SURFACE.WATER && c !== SURFACE.BEACH && c !== SURFACE.BRIDGE; }

function buildTile(tile) {
  const segs = coastSegments(tile);
  if (!segs.length) return null;
  const pxm = W.PX_PER_M;
  const D = C.depthM * pxm;
  const pos = [], nor = [];
  const rocks = [];
  for (let i = 0; i < segs.length; i += 4) {
    const x0 = segs[i], y0 = segs[i + 1], x1 = segs[i + 2], y1 = segs[i + 3];
    const ex = x1 - x0, ey = y1 - y0, len = Math.hypot(ex, ey);
    let nx = ey / len, ny = -ex / len;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    const a = W.surfaceAt(mx + nx * PROBE_PX, my + ny * PROBE_PX);
    const b = W.surfaceAt(mx - nx * PROBE_PX, my - ny * PROBE_PX);
    if (a === SURFACE.WATER && isShore(b)) { /* n ya mira al agua */ }
    else if (b === SURFACE.WATER && isShore(a)) { nx = -nx; ny = -ny; }
    else continue;   // orilla dura contra arena: la playa baja sola
    // la cara: del borde (h≈0) al pie (h = −D), avanzando hacia el agua
    const fx = nx * SLOPE_PX, fy = ny * SLOPE_PX;
    const top0 = [x0, y0, -0.05], top1 = [x1, y1, -0.05];
    const bot0 = [x0 + fx, y0 + fy, -D], bot1 = [x1 + fx, y1 + fy, -D];
    // normal: hacia el agua y hacia arriba, por la pendiente del talud
    const nl = Math.hypot(D, SLOPE_PX);
    const nn = [nx * D / nl, ny * D / nl, SLOPE_PX / nl];
    pushTri(pos, nor, top0, bot0, bot1, nn);
    pushTri(pos, nor, top0, bot1, top1, nn);
    // la escollera al pie: rocas cada pocos px, tamaño y gris por hash
    for (let t = ROCK_PITCH_PX / 2; t < len; t += ROCK_PITCH_PX) {
      const px = x0 + (ex / len) * t, py = y0 + (ey / len) * t;
      const h = hash01(px * 0.73 + py * 1.37);
      const out = SLOPE_PX + 0.5 + h * 3.5;
      rocks.push({
        x: px + nx * out, y: py + ny * out, z: -D * (0.35 + h * 0.3),
        s: 1.6 + hash01(px * 2.1 + py * 0.3) * 2.2,
        c: C.rocks[(h * C.rocks.length) | 0], r: h * 6.28,
      });
    }
  }
  if (!pos.length) return null;
  const group = new T.Group();
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  const wall = new T.Mesh(g, mat.wall);
  wall.receiveShadow = true;
  group.add(wall);
  if (rocks.length) {
    const im = new T.InstancedMesh(rockGeo, mat.rock, rocks.length);
    const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), sc = new T.Vector3();
    const col = new T.Color();
    rocks.forEach((r, i) => {
      q.setFromEuler(e.set(r.r * 0.7, r.r * 1.3, r.r));
      m4.compose(v.set(r.x, r.y, r.z), q, sc.set(r.s, r.s * 0.85, r.s * 0.7));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, col.setStyle(r.c));
    });
    im.castShadow = true;
    im.computeBoundingSphere();
    group.add(im);
  }
  const plate = landPlate(tile);
  if (plate) group.add(plate);
  group.userData.segments = pos.length / 18;
  return group;
}

function pushTri(pos, nor, a, b, c, n) {
  // girado para que el frente mire hacia n (misma regla que buildings.js)
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const dot = (uy * vz - uz * vy) * n[0] + (uz * vx - ux * vz) * n[1] + (ux * vy - uy * vx) * n[2];
  const [p, q] = dot < 0 ? [c, b] : [b, c];
  pos.push(...a, ...p, ...q);
  nor.push(...n, ...n, ...n);
}

// El plato: las corridas de celdas que NO son agua, fila por fila, como quads
// a PLATE_H. Sólo escribe profundidad; lo que hace es que un talud que cae
// detrás de la tierra quede detrás de ella.
function landPlate(tile) {
  const { grid, cols, rows } = tile;
  if (!grid) return null;
  const cell = W.CELL;
  const pos = [];
  for (let r = 0; r < rows; r++) {
    let start = -1;
    const y0 = tile.y + r * cell, y1 = y0 + cell;
    for (let c = 0; c <= cols; c++) {
      const land = c < cols && grid[r * cols + c] !== SURFACE.WATER;
      if (land && start < 0) start = c;
      if (!land && start >= 0) {
        const x0 = tile.x + start * cell, x1 = tile.x + c * cell;
        pos.push(x0, y0, PLATE_H, x1, y0, PLATE_H, x1, y1, PLATE_H,
                 x0, y0, PLATE_H, x1, y1, PLATE_H, x0, y1, PLATE_H);
        start = -1;
      }
    }
  }
  if (!pos.length) return null;
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  const m = new T.Mesh(g, mat.plate);
  m.renderOrder = -2;
  // el plato no tiene frente ni espalda: se ve desde arriba siempre
  m.material.side = T.DoubleSide;
  return m;
}

export function syncCoast(root, view, frameNo, budget = 1) {
  const pad = 200;
  const vts = W.visibleTiles(view.x0 - pad, view.y0 - pad, view.x1 + pad, view.y1 + pad);
  let changed = 0;
  for (const tile of vts) {
    const key = tile.tc + ":" + tile.tr;
    let e = tiles.get(key);
    if (e && e.tile !== tile) { drop(root, e); tiles.delete(key); e = null; }
    if (!e) {
      if (budget <= 0) continue;
      budget--;
      e = { group: buildTile(tile), tile, used: frameNo };
      tiles.set(key, e);
      if (e.group) { root.add(e.group); changed++; }
    }
    e.used = frameNo;
  }
  for (const [key, e] of tiles) {
    if (frameNo - e.used < 240) continue;
    drop(root, e); tiles.delete(key); changed++;
  }
  return changed;
}

function drop(root, e) {
  if (!e.group) return;
  root.remove(e.group);
  e.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); else if (o.geometry) o.geometry.dispose(); });
}

export function coastStats() {
  let segments = 0;
  for (const e of tiles.values()) if (e.group) segments += e.group.userData.segments;
  return { tiles: tiles.size, segments };
}
