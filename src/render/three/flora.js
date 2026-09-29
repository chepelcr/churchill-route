// LA ARBOLEDA EN TRES DIMENSIONES — instanciada por tile.
//
// Los árboles se paran EXACTAMENTE donde Canvas los pinta: se reusan las mismas
// funciones de colocación (`tileTrees` con las medianas fusionadas, las palmas
// del tile, `roadsideTrees` de cada calle) y la misma especie del registro
// (`flora.json`): su `heightM`, su radio de copa `r`, su verde y su tronco. Lo
// único que es de acá es la GEOMETRÍA, y es poca: los siete generadores del
// registro caen en cuatro cuerpos low-poly —
//
//   copa    (crown-stack, branch-crown, tidal-root-crown)  tronco + icosaedro
//   cono    (tier-stack, column-stack)                     tronco + cono
//   palma   (frond-ring, fan-ring)                         tronco alto + penacho
//
// Un InstancedMesh por cuerpo y por tile: miles de árboles, cuatro draw calls.
// La variación sale de `hash01` sobre la posición, igual que en Canvas: un árbol
// que cambia de forma entre cuadros es un árbol que titila.
//
// EL MONTE (`paintWoods`) y los manglares se quedan en Canvas por ahora: son
// cientos de miles de árboles de campo y se migran con su propio presupuesto.
import { WORLD2D as W } from "../../world2d/index.js";
import { groundBase } from "./ground.js";
import FLORA from "../../assets/flora.json" with { type: "json" };
import { hash01 } from "../c2d/primitives.js";
import { roadsideTrees, tileTrees } from "../c2d/flora.js";
import { medianPairs } from "../c2d/streets.js";
import { tintMaterial } from "./tint.js";

const SPECIES = FLORA.species;
const FORMS = FLORA.forms;
const DEF_TREE = FLORA.defaults.treeSpecies;
const DEF_PALM = FLORA.defaults.palmSpecies;

const BODY = Object.freeze({
  "crown-stack": "crown", "branch-crown": "bare", "tidal-root-crown": "bush",
  "tier-stack": "cone", "column-stack": "column",
  "frond-ring": "palm", "fan-ring": "palm",
});

let T = null;
let geo = null, mat = null;
const tiles = new Map();

export function setupFlora(THREE) {
  T = THREE;
  const trunk = new T.CylinderGeometry(0.5, 0.7, 1, 5, 1, true);
  trunk.rotateX(Math.PI / 2); trunk.translate(0, 0, 0.5);      // base en z=0, alto 1
  const blob = new T.IcosahedronGeometry(1, 1);
  const cone = new T.ConeGeometry(1, 1, 7, 1);
  cone.rotateX(Math.PI / 2); cone.translate(0, 0, 0.5);
  geo = { trunk, blob, cone, fronds: frondGeometry() };
  mat = {
    trunk: new T.MeshLambertMaterial({ vertexColors: false }),
    // El follaje se ilumina en facetas y la mitad de ellas mira lejos del sol:
    // el realce devuelve la copa al tono que Canvas pinta de un solo color.
    leaf: new T.MeshLambertMaterial({ flatShading: true, color: new T.Color(1.3, 1.3, 1.3) }),
    frond: new T.MeshLambertMaterial({ side: T.DoubleSide, flatShading: true, color: new T.Color(1.2, 1.2, 1.2) }),
  };
  for (const m of Object.values(mat)) tintMaterial(m);
}

// Un penacho: ocho hojas que salen del centro y caen hacia la punta. Radio 1,
// base del penacho en z=0.
function frondGeometry() {
  const pos = [];
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (i % 2) * 0.2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = -sa, py = ca;                 // perpendicular en el plano
    const L = i % 2 ? 0.92 : 1.0, wdt = 0.2;
    const mid = [ca * L * 0.5, sa * L * 0.5, 0.12];
    const tip = [ca * L, sa * L, -0.42];
    const l = [mid[0] + px * wdt, mid[1] + py * wdt, mid[2]];
    const r = [mid[0] - px * wdt, mid[1] - py * wdt, mid[2]];
    pos.push(0, 0, 0.05, ...l, ...r);        // base → ensanche
    pos.push(...l, ...tip, ...r);            // ensanche → punta
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

function speciesOf(k, fallback) {
  return SPECIES[k] || SPECIES[fallback];
}

/** Todas las plantas del tile, en coordenadas de mundo y con su especie. */
function tilePlants(tile) {
  const out = [];
  const x0 = tile.x, y0 = tile.y, x1 = x0 + W.TILE_PX, y1 = y0 + W.TILE_PX;
  for (const tr of tileTrees(tile, medianPairs(tile).pairs)) out.push({ x: tr.x, y: tr.y, s: tr.s || 1, sp: speciesOf(tr.k, DEF_TREE) });
  for (const pa of tile.palms) out.push({ x: pa.x, y: pa.y, s: pa.s || 1, sp: speciesOf(pa.k || DEF_PALM, DEF_PALM) });
  for (const r of tile.roads) {
    for (const tr of roadsideTrees(r)) {
      // una calle cruza bordes: su arboleda la planta el tile que la contiene
      if (tr.x < x0 || tr.x >= x1 || tr.y < y0 || tr.y >= y1) continue;
      out.push({ x: tr.x, y: tr.y, s: tr.s || 1, sp: SPECIES[DEF_TREE] });
    }
  }
  return out;
}

function buildTile(tile) {
  const plants = tilePlants(tile);
  if (!plants.length) return null;
  const pxm = W.PX_PER_M;
  const lists = { trunk: [], blob: [], cone: [], fronds: [] };
  for (const p of plants) {
    const form = FORMS[p.sp.form] || {};
    const body = BODY[form.generator] || "crown";
    const seed = hash01(p.x * 0.731 + p.y * 1.917);
    const s = p.s * (0.9 + seed * 0.2);
    const H = Math.max(2, (p.sp.heightM || 8)) * pxm * s * 0.62;
    const R = (p.sp.r || 10) * s;
    const z0 = groundBase();
    // sin copa (el indio desnudo, el seco) es rama pelada; sin tronco (los
    // mangles) es copa sola — los dos colores vienen siempre del registro
    const canopy = p.sp.canopy || [p.sp.trunk];
    const leaf = canopy[Math.min(canopy.length - 1, 2)];
    const bark = p.sp.trunk || canopy[0];
    const rot = seed * Math.PI * 2;
    if (body === "palm") {
      const lean = (hash01(p.x * 3.1 + p.y) - 0.5) * 0.3;
      lists.trunk.push({ x: p.x, y: p.y, z: z0, sx: 1.4 * s, sz: H, c: bark, lean, rot });
      const tx = p.x + Math.cos(rot) * lean * H, ty = p.y + Math.sin(rot) * lean * H;
      lists.fronds.push({ x: tx, y: ty, z: z0 + H, sx: R * 1.1, sz: R * 0.8, c: leaf, rot });
    } else if (body === "cone" || body === "column") {
      const w = body === "column" ? R * 0.55 : R * 0.9;
      lists.trunk.push({ x: p.x, y: p.y, z: z0, sx: 1.6 * s, sz: H * 0.3, c: bark, rot });
      lists.cone.push({ x: p.x, y: p.y, z: z0 + H * 0.18, sx: w, sz: H * 0.9, c: leaf, rot });
    } else if (body === "bush") {
      lists.blob.push({ x: p.x, y: p.y, z: z0 + R * 0.25, sx: R * 0.85, sz: R * 0.45, c: leaf, rot });
    } else {
      const flat = body === "bare" ? 0.5 : (form.crown && form.crown.scaleY) || 0.75;
      const crownH = R * Math.max(0.45, flat) * 0.8;
      lists.trunk.push({ x: p.x, y: p.y, z: z0, sx: 2 * s, sz: Math.max(3, H - crownH), c: bark, rot });
      const sx = R * ((form.crown && form.crown.scaleX) || 1);
      const cz = z0 + H - crownH * 0.3;
      lists.blob.push({ x: p.x, y: p.y, z: cz, sx, sz: crownH, c: body === "bare" ? bark : leaf, rot });
      // …y el tono claro de arriba, como la capa alta de la copa pintada: sin
      // él una copa low-poly se lee como una bola oscura, no como un árbol.
      if (body !== "bare" && canopy.length > 2) {
        lists.blob.push({
          x: p.x - sx * 0.12, y: p.y - sx * 0.14, z: cz + crownH * 0.45,
          sx: sx * 0.62, sz: crownH * 0.62, c: canopy[canopy.length - 1], rot: rot + 1.3,
        });
      }
    }
  }
  const group = new T.Group();
  const m4 = new T.Matrix4(), q = new T.Quaternion(), e = new T.Euler(), v = new T.Vector3(), sc = new T.Vector3();
  const col = new T.Color();
  const add = (list, geometry, material, cast) => {
    if (!list.length) return;
    const im = new T.InstancedMesh(geometry, material, list.length);
    list.forEach((it, i) => {
      e.set(it.lean ? it.lean * Math.sin(it.rot) : 0, it.lean ? -it.lean * Math.cos(it.rot) : 0, it.rot);
      q.setFromEuler(e);
      v.set(it.x, it.y, it.z);
      sc.set(it.sx, it.sx, it.sz);
      m4.compose(v, q, sc);
      im.setMatrixAt(i, m4);
      im.setColorAt(i, col.setStyle(it.c));
    });
    im.castShadow = cast;
    im.receiveShadow = false;
    im.computeBoundingSphere();
    group.add(im);
  };
  add(lists.trunk, geo.trunk, mat.trunk, true);
  add(lists.blob, geo.blob, mat.leaf, true);
  add(lists.cone, geo.cone, mat.leaf, true);
  add(lists.fronds, geo.fronds, mat.frond, true);
  group.userData.plants = plants.length;
  return group;
}

/** Igual que `syncBuildings`: sigue a los tiles residentes alrededor de la vista. */
export function syncFlora(root, view, frameNo, budget = 1) {
  const pad = 300;
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
  for (const im of e.group.children) im.dispose();
}

export function floraStats() {
  let plants = 0;
  for (const e of tiles.values()) if (e.group) plants += e.group.userData.plants;
  return { tiles: tiles.size, plants };
}
