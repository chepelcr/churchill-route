// LOS EDIFICIOS, CON VOLUMEN DE VERDAD.
//
// Cada huella del mundo emitido se extruye hasta `buildingHeightM(b)` — la
// misma altura inferida con la que Canvas ya tira su sombra — y se tapa con un
// techo plano. Una malla por TILE residente: el streaming de WORLD2D es el
// "chunk manager", no hace falta otro. Un tile son cientos de edificios en UNA
// geometría y UN draw call.
//
// El color sale de donde sale en Canvas (`buildingStyle` → `districtBuildingStyle`
// → `b.color`), así que el pueblo se reconoce al primer vistazo. Las paredes
// no llevan paleta propia: son el mismo cuerpo y las oscurece la luz del sol,
// que es lo que las hace leerse como paredes y no como otra pintura.
//
// Un edificio que cruza el borde de un tile viene DUPLICADO en cada tile que
// toca (el emit lo hace así para `buildingsNear`); aquí lo construye sólo el
// tile que contiene el centro de su caja, o saldrían dos cuerpos coplanares
// peleándose el z-buffer.
import { WORLD2D as W } from "../../world2d/index.js";
import { buildingHeightM } from "../c2d/shadows.js";
import { buildingStyle } from "../c2d/buildingStyle.js";
import { districtBuildingStyle } from "../c2d/districts.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { hash01 } from "../c2d/primitives.js";
import { tintMaterial } from "./tint.js";

const S = MATERIALS.structure;
const STOREY_M = EFFECTS.buildingHeight.storeyM;
// LAS VENTANAS, en metros de fachada: una cada `WINDOW_PITCH_M`, de
// `WINDOW_W_M` × `WINDOW_H_M`, a `WINDOW_SILL_M` del piso de cada planta. De
// noche se prende una parte — un edificio con TODAS las ventanas prendidas es
// una oficina, no una casa de puerto.
const WINDOW_PITCH_M = 3.4, WINDOW_W_M = 1.1, WINDOW_H_M = 1.3, WINDOW_SILL_M = 0.9;
const WINDOWS_LIT = 0.55;
const CORNICE_M = 0.45;      // la banda del alero, en el color de techo del edificio
const WALL_SHADE = 0.86;     // la pared es el cuerpo un poco más apagado; el sol hace el resto
const ROOF_LIFT_M = 0.0;

let T = null;                // el módulo three, inyectado
let material = null, windowMaterial = null;
const night = { value: 0 };
const tiles = new Map();     // "tc:tr" → { mesh, used }
const color = { a: null, b: null };

export function setupBuildings(THREE, scene) {
  T = THREE;
  material = new T.MeshLambertMaterial({ vertexColors: true });
  tintMaterial(material);
  windowMaterial = makeWindowMaterial();
  color.a = new T.Color();
  color.b = new T.Color();
  return { scene };
}

function styleOf(b) {
  const st = buildingStyle(b) || districtBuildingStyle(b);
  return {
    body: (st && st.color) || b.color || S.building.fallback,
    roof: (st && st.roof) || b.roof || null,
  };
}

// Una ventana es de día un vidrio claro que se tiñe con el cielo, y de noche —si
// le toca— una luz cálida que ATRAVIESA el velo (`uTintK` baja con ella). Los
// dos colores son los de Canvas (`materials.json` → structure.building).
function makeWindowMaterial() {
  const day = new T.Color().setStyle(S.building.windowsDay.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, "rgb($1,$2,$3)"));
  const lit = new T.Color().setStyle(S.building.windowsNight.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, "rgb($1,$2,$3)"));
  const m = new T.MeshBasicMaterial({ color: 0xffffff });
  const uDay = { value: day.multiplyScalar(0.72) }, uLit = { value: lit };
  const inner = tintMaterial(m);
  const tintCompile = m.onBeforeCompile;
  m.onBeforeCompile = (shader) => {
    tintCompile(shader);
    shader.uniforms.uDay = uDay; shader.uniforms.uLit = uLit; shader.uniforms.uNight = night;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "attribute float lit;\nvarying float vLit;\nvoid main() {\n\tvLit = lit;");
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform vec3 uDay;\nuniform vec3 uLit;\nuniform float uNight;\nvarying float vLit;\nvoid main() {")
      .replace("vec4 diffuseColor = vec4( diffuse, opacity );",
        "float glow = vLit * uNight;\n\tvec4 diffuseColor = vec4( mix( uDay * (1.0 - 0.55 * uNight), uLit, glow ), opacity );")
      .replace("uTint.a * uTintK", "uTint.a * uTintK * (1.0 - glow)");
  };
  m.customProgramCacheKey = () => "windows";
  inner.value = 1;
  return m;
}

/** 0 de día, 1 de noche: cuánto se prenden las ventanas que tienen luz. */
export function setWindowNight(v) { night.value = v; }

function quad(arr, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  arr.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
}

/** Área con signo (px²): el sentido de giro decide hacia dónde mira cada pared. */
function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}

/**
 * Un triángulo con su normal, girado para que su frente mire hacia `n`.
 * Decidir el giro por la normal y no por convención deja una sola regla para
 * el techo y las paredes, sea cual sea el sentido en que venga la huella.
 */
function tri(pos, nor, col, c, ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz) {
  const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
  const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
  if (dot < 0) { const t0 = bx, t1 = by, t2 = bz; bx = cx; by = cy; bz = cz; cx = t0; cy = t1; cz = t2; }
  pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
}

// Las ventanas de una pared: una fila por planta, despegadas un pelo de la
// fachada para no pelearle el z-buffer. Qué ventana se prende lo decide el hash
// de su posición, así que es la misma todas las noches.
function addWindows(wpos, wlit, ax, ay, ux, uy, len, nx, ny, base, hM, pxm) {
  const pitch = WINDOW_PITCH_M * pxm;
  const nWin = Math.floor(len / pitch);
  if (nWin < 1) return;
  const storeys = Math.max(1, Math.round(hM / STOREY_M));
  const hw = (WINDOW_W_M * pxm) / 2, wh = WINDOW_H_M * pxm;
  const off = 0.15;
  const start = (len - nWin * pitch) / 2 + pitch / 2;
  for (let f = 0; f < storeys; f++) {
    const z0 = base + (f * STOREY_M + WINDOW_SILL_M) * pxm;
    const z1 = z0 + wh;
    for (let k = 0; k < nWin; k++) {
      const t = start + k * pitch;
      const cx = ax + ux * t + nx * off, cy = ay + uy * t + ny * off;
      const x0 = cx - ux * hw, y0 = cy - uy * hw, x1 = cx + ux * hw, y1 = cy + uy * hw;
      // el frente mira hacia (nx, ny): la normal de (u, arriba) es (uy, −ux)
      if (uy * nx - ux * ny > 0) quad(wpos, x0, y0, z0, x1, y1, z0, x1, y1, z1, x0, y0, z1);
      else quad(wpos, x1, y1, z0, x0, y0, z0, x0, y0, z1, x1, y1, z1);
      const lit = hash01(cx * 0.37 + cy * 0.91 + f * 7.1) < WINDOWS_LIT ? 1 : 0;
      for (let v = 0; v < 6; v++) wlit.push(lit);
    }
  }
}

function buildTile(tile) {
  const pos = [], nor = [], col = [];
  const wpos = [], wlit = [];
  const roofC = new T.Color();
  const x0 = tile.x, y0 = tile.y, x1 = x0 + W.TILE_PX, y1 = y0 + W.TILE_PX;
  const pxm = W.PX_PER_M;
  let count = 0;
  for (const b of tile.buildings) {
    const a = b.aabb;
    const mx = (a.x0 + a.x1) / 2, my = (a.y0 + a.y1) / 2;
    if (mx < x0 || mx >= x1 || my < y0 || my >= y1) continue;
    const pts = b.pts;
    const n = pts.length / 2;
    if (n < 3) continue;
    const hM = buildingHeightM(b);
    const h = (hM + ROOF_LIFT_M) * pxm;
    const base = W.groundZAt ? (W.groundZAt(mx, my) || 0) * pxm : 0;
    const top = base + h;
    const st = styleOf(b);
    color.a.setStyle(st.body);
    color.b.copy(color.a).multiplyScalar(WALL_SHADE);
    if (st.roof) roofC.setStyle(st.roof).multiplyScalar(WALL_SHADE); else roofC.copy(color.b);
    const eave = Math.max(base, top - CORNICE_M * pxm);
    // Techo: triangulación de la huella, mirando hacia arriba.
    const contour = [];
    for (let i = 0; i < n; i++) contour.push(new T.Vector2(pts[i * 2], pts[i * 2 + 1]));
    for (const [i, j, k] of T.ShapeUtils.triangulateShape(contour, [])) {
      tri(pos, nor, col, color.a,
        pts[i * 2], pts[i * 2 + 1], top, pts[j * 2], pts[j * 2 + 1], top,
        pts[k * 2], pts[k * 2 + 1], top, 0, 0, 1);
    }
    // Paredes: un quad por arista, con la normal hacia afuera de la huella.
    const outward = signedArea(pts) > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[j * 2], by = pts[j * 2 + 1];
      const ex = bx - ax, ey = by - ay;
      const len = Math.hypot(ex, ey);
      if (len < 1e-6) continue;
      const nx = (ey / len) * outward, ny = (-ex / len) * outward;
      tri(pos, nor, col, color.b, ax, ay, base, bx, by, base, bx, by, eave, nx, ny, 0);
      tri(pos, nor, col, color.b, ax, ay, base, bx, by, eave, ax, ay, eave, nx, ny, 0);
      tri(pos, nor, col, roofC, ax, ay, eave, bx, by, eave, bx, by, top, nx, ny, 0);
      tri(pos, nor, col, roofC, ax, ay, eave, bx, by, top, ax, ay, top, nx, ny, 0);
      if (b.wnd) addWindows(wpos, wlit, ax, ay, ex / len, ey / len, len, nx, ny, base, hM, pxm);
    }
    count++;
  }
  if (!count) return null;
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3));
  g.setAttribute("color", new T.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const mesh = new T.Mesh(g, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.buildings = count;
  if (wpos.length) {
    const wg = new T.BufferGeometry();
    wg.setAttribute("position", new T.Float32BufferAttribute(wpos, 3));
    wg.setAttribute("lit", new T.Float32BufferAttribute(wlit, 1));
    wg.computeBoundingSphere();
    const wm = new T.Mesh(wg, windowMaterial);
    mesh.add(wm);
  }
  return mesh;
}

/**
 * Sincroniza las mallas con los tiles residentes alrededor de la vista.
 * Construye como mucho `budget` tiles por cuadro (un tile nuevo cuesta unos
 * milisegundos de triangulación) y libera los que llevan un rato sin verse.
 * Devuelve cuántas mallas cambiaron, para invalidar el mapa de sombras.
 */
export function syncBuildings(scene, view, frameNo, budget = 1) {
  const pad = 400;
  const vts = W.visibleTiles(view.x0 - pad, view.y0 - pad, view.x1 + pad, view.y1 + pad);
  let changed = 0;
  for (const tile of vts) {
    const key = tile.tc + ":" + tile.tr;
    let e = tiles.get(key);
    if (!e) {
      if (budget <= 0) continue;
      budget--;
      e = { mesh: buildTile(tile), used: frameNo, tile };
      tiles.set(key, e);
      if (e.mesh) { scene.add(e.mesh); changed++; }
    }
    // el tile se re-decodificó (evicción + recarga): la malla vieja apunta a otro objeto
    if (e.tile !== tile) {
      if (e.mesh) { scene.remove(e.mesh); e.mesh.geometry.dispose(); }
      e.mesh = buildTile(tile); e.tile = tile;
      if (e.mesh) scene.add(e.mesh);
      changed++;
    }
    e.used = frameNo;
  }
  for (const [key, e] of tiles) {
    if (frameNo - e.used < 240) continue;
    if (e.mesh) { scene.remove(e.mesh); e.mesh.geometry.dispose(); changed++; }
    tiles.delete(key);
  }
  return changed;
}

export function buildingStats() {
  let meshes = 0, count = 0;
  for (const e of tiles.values()) if (e.mesh) { meshes++; count += e.mesh.userData.buildings; }
  return { tiles: tiles.size, meshes, buildings: count };
}
