// EL ALUMBRADO PÚBLICO, de pie.
//
// Los postes están donde el mundo los emite (`tile.lamps`, uno cada 32 m de
// calzada alternando de acera) y son como `lights.json` dice que son: el mástil
// del color de su trazo, la cabeza del `core` de su tipo. Un InstancedMesh para
// los mástiles y otro para las cabezas, por tile.
//
// La LUZ no se dibuja acá: el pozo sobre el suelo lo sigue abriendo
// `c2d/nightlights.js` contra el tinte del lienzo de abajo. Lo que sí hace esto
// es que la cabeza, de noche, ATRAVIESE el velo (`uTintK` → 0): es lo que se ve
// brillar desde arriba, y lo que explica el pozo.
import { WORLD2D as W } from "../../world2d/index.js";
import { groundBase } from "./ground.js";
import LIGHTS from "../../assets/lights.json" with { type: "json" };
import { tintMaterial } from "./tint.js";

const POLE_M = 6.5;          // alto del mástil
const HEAD_M = [1.8, 0.8, 0.45];   // largo, ancho y alto de la luminaria
const TYPES = LIGHTS.types;

let T = null, geo = null, mat = null;
const headTint = { value: 1 };
const tiles = new Map();

function poleColor(spec) {
  const stroke = (spec.parts || []).find((p) => p.shape === "stroke");
  return (stroke && stroke.stroke) || TYPES.warm.parts[0].stroke;
}

export function setupLamps(THREE) {
  T = THREE;
  const pole = new T.CylinderGeometry(0.5, 0.65, 1, 5, 1, true);
  pole.rotateX(Math.PI / 2); pole.translate(0, 0, 0.5);
  const head = new T.BoxGeometry(1, 1, 1);
  geo = { pole, head };
  mat = { pole: new T.MeshLambertMaterial(), head: new T.MeshBasicMaterial() };
  tintMaterial(mat.pole);
  tintMaterial(mat.head, headTint);
}

/** 0 de día, 1 de noche: la cabeza deja de teñirse y brilla. */
export function setLampNight(v) { headTint.value = 1 - v; }

function buildTile(tile) {
  const lamps = tile.lamps || [];
  const x0 = tile.x, y0 = tile.y, x1 = x0 + W.TILE_PX, y1 = y0 + W.TILE_PX;
  const list = lamps.filter((l) => l.x >= x0 && l.x < x1 && l.y >= y0 && l.y < y1);
  if (!list.length) return null;
  const pxm = W.PX_PER_M;
  const poles = new T.InstancedMesh(geo.pole, mat.pole, list.length);
  const heads = new T.InstancedMesh(geo.head, mat.head, list.length);
  const m4 = new T.Matrix4(), q = new T.Quaternion(), v = new T.Vector3(), sc = new T.Vector3();
  const c = new T.Color(), up = new T.Vector3(0, 0, 1);
  list.forEach((l, i) => {
    const spec = TYPES[l.type] || TYPES.warm;
    const z0 = groundBase();
    // la luminaria cruza la calle: perpendicular al rumbo de la vía (`ang`)
    const ang = (Number.isFinite(l.ang) ? l.ang : 0) + Math.PI / 2;
    q.setFromAxisAngle(up, ang);
    m4.compose(v.set(l.x, l.y, z0), q, sc.set(1.1, 1.1, POLE_M * pxm));
    poles.setMatrixAt(i, m4);
    poles.setColorAt(i, c.setStyle(poleColor(spec)));
    m4.compose(v.set(l.x, l.y, z0 + POLE_M * pxm), q, sc.set(HEAD_M[0] * pxm, HEAD_M[1] * pxm, HEAD_M[2] * pxm));
    heads.setMatrixAt(i, m4);
    heads.setColorAt(i, c.setStyle(spec.core));
  });
  poles.castShadow = true;
  const group = new T.Group();
  group.add(poles, heads);
  for (const im of group.children) im.computeBoundingSphere();
  group.userData.lamps = list.length;
  return group;
}

export function syncLamps(root, view, frameNo, budget = 1) {
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
  for (const im of e.group.children) im.dispose();
}

export function lampStats() {
  let n = 0;
  for (const e of tiles.values()) if (e.group) n += e.group.userData.lamps;
  return { tiles: tiles.size, lamps: n };
}
