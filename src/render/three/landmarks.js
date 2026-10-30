// LOS HITOS CON CUERPO — hoy, el Faro de La Punta.
//
// La torre se levanta con los MISMOS números con que Canvas la dibuja de
// costado (`world-props.json` → scenes.faro, verbo `lighthouse-tower`): el
// alto, el radio al pie y arriba, las tres franjas rojas en su sitio, la
// galería oscura, la linterna y el remate. Sólo cambia que ahora es un tronco
// de cono que tira su sombra con el sol, y que de noche la linterna atraviesa
// el velo del cielo como las ventanas.
//
// El resto de la escena (la escollera del borde, las comas rojas, el rótulo)
// sigue en Canvas: es suelo, y el suelo todavía es de Canvas.
import { WORLD2D as W } from "../../world2d/index.js";
import PROPS from "../../assets/world-props.json" with { type: "json" };
import { groundBase } from "./ground.js";
import { tintMaterial } from "./tint.js";

const SCENE = PROPS.scenes.faro;
const TOWER = SCENE.parts.find((p) => p.verb === "lighthouse-tower");

let T = null;
const lanternTint = { value: 1 };
const built = new Map();     // id → group

export function setupLandmarks(THREE) { T = THREE; }

/** 0 de día, 1 de noche: la linterna deja de teñirse. */
export function setLandmarkNight(v) { lanternTint.value = 1 - v; }

function ink(spec) {
  return typeof spec === "string" && spec.startsWith("$") ? SCENE.palette[spec.slice(1)] : spec;
}

function lambert(color) {
  const m = new T.MeshLambertMaterial({ color: new T.Color().setStyle(ink(color)) });
  tintMaterial(m);
  return m;
}

// Un tramo de tronco de cono entre dos alturas (en px de dibujo, medidos desde
// el pie como en Canvas), con el radio interpolado entre el pie y la cima.
function frustum(z0, z1, mat) {
  const p = TOWER, H = Number(p.height);
  const r = (z) => Number(p.baseHalf) + (Number(p.topHalf) - Number(p.baseHalf)) * Math.min(1, z / H);
  const g = new T.CylinderGeometry(r(z1), r(z0), z1 - z0, 16, 1);
  g.rotateX(Math.PI / 2);
  g.translate(0, 0, (z0 + z1) / 2);
  const m = new T.Mesh(g, mat);
  m.castShadow = true;
  return m;
}

function buildLighthouse(lm) {
  const p = TOWER;
  const group = new T.Group();
  const body = lambert(p.body), band = lambert(p.band), dark = lambert(p.gallery);
  const H = Number(p.height);
  // las franjas: `bandTop` es la altura del borde superior de la primera
  // franja, y cada una baja `bandGap` con alto `bandH` — igual que el fillRect
  const cuts = [];
  for (let i = 0; i < Number(p.bands); i++) {
    const top = Number(p.bandTop) - i * Number(p.bandGap);
    cuts.push([top - Number(p.bandH), top]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  let z = 0;
  for (const [b0, b1] of cuts) {
    if (b0 > z) group.add(frustum(z, b0, body));
    group.add(frustum(Math.max(z, b0), b1, band));
    z = b1;
  }
  if (z < H) group.add(frustum(z, H, body));
  // la galería: un disco oscuro un poco más ancho que la cima
  const gal = new T.CylinderGeometry(Number(p.galleryW) / 2, Number(p.galleryW) / 2, Number(p.galleryH), 16);
  gal.rotateX(Math.PI / 2); gal.translate(0, 0, H + Number(p.galleryH) / 2);
  const galM = new T.Mesh(gal, dark); galM.castShadow = true; group.add(galM);
  // la linterna, que brilla de noche
  const lanH = Math.max(2, Number(p.lanternY) - H);
  const lan = new T.CylinderGeometry(Number(p.lanternR), Number(p.lanternR), lanH, 12);
  lan.rotateX(Math.PI / 2); lan.translate(0, 0, H + Number(p.galleryH) + lanH / 2);
  const lanMat = new T.MeshBasicMaterial({ color: new T.Color().setStyle(ink(p.lantern)) });
  tintMaterial(lanMat, lanternTint);
  group.add(new T.Mesh(lan, lanMat));
  // el remate
  const capH = Math.max(2, Number(p.finialY) - Number(p.lanternY));
  const cap = new T.ConeGeometry(Number(p.finialW) / 2 + 1, capH, 12);
  cap.rotateX(Math.PI / 2); cap.translate(0, 0, H + Number(p.galleryH) + lanH + capH / 2);
  const capM = new T.Mesh(cap, dark); capM.castShadow = true; group.add(capM);
  group.position.set(lm.x, lm.y, groundBase(lm.x, lm.y));
  return group;
}

/** Construye los hitos que entran a la vista (una vez cada uno). */
export function syncLandmarks(root, view) {
  const pad = 300;
  let changed = 0;
  for (const lm of W.LANDMARKS || []) {
    if (lm.type !== "lighthouse" || !TOWER) continue;
    const near = lm.x > view.x0 - pad && lm.x < view.x1 + pad && lm.y > view.y0 - pad && lm.y < view.y1 + pad;
    const g = built.get(lm.id);
    if (near && !g) { const ng = buildLighthouse(lm); built.set(lm.id, ng); root.add(ng); changed++; }
    else if (g) g.visible = near;
  }
  return changed;
}
