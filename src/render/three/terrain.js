// EL SUELO CON RELIEVE — una malla por trozo, con el cuadro de Canvas encima.
//
// Cada trozo de `CHUNK` px es una retícula a la resolución del ráster (4 px;
// 8 en calidad baja) cuya altura en cada vértice es el NIVEL de la superficie
// más la COTA real (`ground.js`). El color no es de acá: es el píxel de Canvas
// proyectado en planta (`canvasTexture.js`), así que la calle, la acera, el mar
// y todo lo que camina encima son el arte de siempre, sólo que ahora a su
// altura.
//
// LA ESQUINA ES EL PROMEDIO DE SUS CUATRO CELDAS. Eso vuelve cada cambio de
// nivel un bisel de una celda: el bordillo se lee como un escalón con su cara
// iluminada o en sombra, sin la escalera de 4 px que daría un salto por celda
// en una calle diagonal — y el borde pintado de la acera cae DENTRO del bisel,
// no al lado. La orilla sale igual: del nivel de la manzana al del agua hay un
// talud, y ése es el borde de la costa.
//
// Un trozo se construye sólo cuando todos los tiles bajo él están residentes
// (`surfaceAt` contesta AGUA por un tile que no llegó, y un trozo hecho a
// destiempo sería un hoyo al nivel del mar), y se rehace si uno de ellos se
// re-decodificó.
import { WORLD2D as W } from "../../world2d/index.js";
import { SURFACE } from "../../game/surfaces.js";
import { ELEVATED_M, levelOfClass, reliefM } from "./ground.js";
import { projectedMaterial } from "./canvasTexture.js";

const CHUNK = 256;
const ROADISH = new Set([SURFACE.ROAD, SURFACE.PASEO, SURFACE.BARRO, SURFACE.GRAVEL, SURFACE.BRIDGE]);

let T = null, material = null, stride = 4;
const chunks = new Map();   // "cx:cy" → { mesh, tiles, used }

export function setupTerrain(THREE, { low = false } = {}) {
  T = THREE;
  stride = low ? 8 : 4;
  material = projectedMaterial();
}

function chunkTiles(x0, y0) {
  return W.visibleTiles(x0 - stride, y0 - stride, x0 + CHUNK + stride, y0 + CHUNK + stride);
}

function resident(x0, y0) {
  for (const [x, y] of [[x0 - stride, y0 - stride], [x0 + CHUNK + stride, y0 - stride],
    [x0 - stride, y0 + CHUNK + stride], [x0 + CHUNK + stride, y0 + CHUNK + stride]]) {
    if (x < 0 || y < 0 || x >= W.W || y >= W.H) continue;
    if (!W.tileResident(x, y)) return false;
  }
  return true;
}

// Los tramos de las calles en terraplén que tocan el trozo: la avenida del
// Ferrocarril sube `ELEVATED_M` sobre la calzada. Se juntan una vez por trozo,
// no se preguntan por celda (`W.onElevated` recorre todas las calles del tile).
function elevatedSegs(tiles, x0, y0) {
  const out = [];
  if (!ELEVATED_M) return out;
  for (const t of tiles) {
    for (const r of t.roads) {
      if (!r.elev) continue;
      const a = r.aabb;
      if (a && (a.x1 < x0 - r.w || a.x0 > x0 + CHUNK + r.w || a.y1 < y0 - r.w || a.y0 > y0 + CHUNK + r.w)) continue;
      const p = r.pts, hw2 = (r.w / 2 + 4) ** 2;
      for (let i = 0; i + 3 < p.length; i += 2) out.push(p[i], p[i + 1], p[i + 2], p[i + 3], hw2);
    }
  }
  return out;
}

function onSegs(segs, x, y) {
  for (let i = 0; i < segs.length; i += 5) {
    const x0 = segs[i], y0 = segs[i + 1], dx = segs[i + 2] - x0, dy = segs[i + 3] - y0;
    const l2 = dx * dx + dy * dy;
    let s = l2 > 0 ? ((x - x0) * dx + (y - y0) * dy) / l2 : 0;
    s = s < 0 ? 0 : s > 1 ? 1 : s;
    const qx = x0 + dx * s - x, qy = y0 + dy * s - y;
    if (qx * qx + qy * qy <= segs[i + 4]) return true;
  }
  return false;
}

function buildChunk(x0, y0, tiles) {
  const n = CHUNK / stride;
  const pxm = W.PX_PER_M;
  const segs = elevatedSegs(tiles, x0, y0);
  // nivel por CELDA de muestra (centros), con una celda de margen alrededor
  const m = n + 2;
  const lv = new Float32Array(m * m);
  for (let j = 0; j < m; j++) {
    for (let i = 0; i < m; i++) {
      const x = x0 + (i - 0.5) * stride, y = y0 + (j - 0.5) * stride;
      const c = W.surfaceAt(x, y);
      let l = levelOfClass(c);
      if (segs.length && ROADISH.has(c) && onSegs(segs, x, y)) l += ELEVATED_M;
      lv[j * m + i] = l;
    }
  }
  const pos = new Float32Array((n + 1) * (n + 1) * 3);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = x0 + i * stride, y = y0 + j * stride;
      // la esquina (i, j) toca las celdas (i, j), (i+1, j), (i, j+1), (i+1, j+1)
      const l = (lv[j * m + i] + lv[j * m + i + 1] + lv[(j + 1) * m + i] + lv[(j + 1) * m + i + 1]) / 4;
      const k = (j * (n + 1) + i) * 3;
      pos[k] = x; pos[k + 1] = y; pos[k + 2] = (l + reliefM(x, y)) * pxm;
    }
  }
  const idx = new Uint32Array(n * n * 6);
  let q = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      // frente hacia +h en (x, y-sur, h): ver `tri` en buildings.js
      idx[q++] = a; idx[q++] = b; idx[q++] = c;
      idx[q++] = b; idx[q++] = d; idx[q++] = c;
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(pos, 3));
  g.setIndex(new T.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mesh = new T.Mesh(g, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/** Trozos alrededor de la vista: construye `budget`, suelta los que se alejaron. */
export function syncTerrain(root, view, frameNo, budget = 1) {
  const pad = 96;
  const cx0 = Math.floor((view.x0 - pad) / CHUNK), cx1 = Math.floor((view.x1 + pad) / CHUNK);
  const cy0 = Math.floor((view.y0 - pad) / CHUNK), cy1 = Math.floor((view.y1 + pad) / CHUNK);
  let changed = 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const x0 = cx * CHUNK, y0 = cy * CHUNK;
      if (x0 + CHUNK < 0 || y0 + CHUNK < 0 || x0 > W.W || y0 > W.H) continue;
      const key = cx + ":" + cy;
      let e = chunks.get(key);
      if (e) {
        e.used = frameNo;
        // un tile re-decodificado es otro objeto: el trozo se rehace
        const now = chunkTiles(x0, y0);
        if (now.length === e.tiles.length && now.every((t, i) => t === e.tiles[i])) continue;
        if (budget <= 0 || !resident(x0, y0)) continue;
        budget--;
        drop(root, e);
        e.tiles = now;
        e.mesh = buildChunk(x0, y0, now);
        root.add(e.mesh);
        changed++;
        continue;
      }
      if (budget <= 0 || !resident(x0, y0)) continue;
      budget--;
      const tiles = chunkTiles(x0, y0);
      e = { mesh: buildChunk(x0, y0, tiles), tiles, used: frameNo };
      chunks.set(key, e);
      root.add(e.mesh);
      changed++;
    }
  }
  for (const [key, e] of chunks) {
    if (frameNo - e.used < 120) continue;
    drop(root, e);
    chunks.delete(key);
  }
  return changed;
}

function drop(root, e) {
  if (!e.mesh) return;
  root.remove(e.mesh);
  e.mesh.geometry.dispose();
}

export function terrainStats() { return { chunks: chunks.size, stride }; }
