// LA CAPA 2.5D — three.js entre el suelo de Canvas y la interfaz.
//
//   #game-canvas          Canvas2D: el suelo, las calles, los actores, todo lo
//                         que todavía no migró (plano, a nivel del suelo)
//   #three-canvas         ESTO: lo que tiene altura — edificios hoy — con luz
//                         de sol y sombra proyectada sobre lo de abajo
//   #game-overlay-canvas  Canvas2D en pantalla: el tinte del cielo, la noche,
//                         la lluvia, el minimapa y la brújula
//
// Por qué el sándwich funciona sin z-buffer entre capas: la cámara (ver
// `camera.js`) deja el suelo exactamente donde Canvas lo pinta y lo alto sólo
// se levanta hacia ARRIBA/AFUERA en la pantalla. Una cosa plana pintada por
// Canvas que queda detrás de un edificio queda debajo de él en pantalla, y el
// edificio la tapa — que es lo correcto. La sombra cae en un receptor
// transparente 4 cm bajo el suelo, así que oscurece la calle Y al carro que
// pasa por ella.
//
// El tinte del cielo va EN LA CAPA DE ARRIBA: la noche oscurece los edificios
// con el mismo color que oscurece la calle, sin una segunda autoridad del día.
import { WORLD2D as W } from "../../world2d/index.js";
import { sunDirection3 } from "../sun.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import { claimForThree, releaseAll } from "../owners.js";
import { leanDeg, pinholeM, quality } from "../view3d.js";
import { applyFrame, projectToScreen } from "./camera.js";
import { buildingStats, setupBuildings, syncBuildings } from "./buildings.js";
import { floraStats, setupFlora, syncFlora } from "./flora.js";
import { lampStats, setLampNight, setupLamps, syncLamps } from "./lamps.js";
import { setupTint, updateTint } from "./tint.js";
import { setWindowNight } from "./buildings.js";
import { lightsOn } from "../../game/daynight.js";

const RECEIVER_BELOW_M = 0.04; // coplanar con la base = NINGUNA sombra (ROADMAP §6)
const SUN_SHARE = 0.5;
// La tinta de la sombra de un edificio es la de Canvas (`materials.json`),
// multiplicada por la fuerza del sol de la hora — igual que `sunShadow2`.
const SHADOW_INK = (() => {
  const m = /rgba\([^)]*,\s*([\d.]+)\)/.exec(MATERIALS.structure.building.shadow || "");
  return m ? Number(m[1]) : 0.22;
})();

let THREE = null;
let renderer = null, scene = null, root = null, camera = null;
let sun = null, sunTarget = null, hemi = null, receiver = null, receiverMat = null;
let canvas = null, ready = false, failed = false;
let frameNo = 0, sizeKey = "";
const HIGH = quality() === "high";
let lastFrame = null;
let nightRamp = 0, lastT = null;
function frameDt(t) {
  const dt = lastT === null ? 0 : Math.max(0, Math.min(0.1, t - lastT));
  lastT = t;
  return dt;
}

const stats = { ready: false, frames: 0, calls: 0, triangles: 0, ms: 0, buildings: null, lean: 0, pinhole: 0 };
function publish() { if (typeof window !== "undefined") window.__three = stats; }

/** Monta la capa. Devuelve una promesa; si WebGL falla, Canvas sigue siendo dueño de todo. */
export async function setupThree(mainCanvas) {
  canvas = document.createElement("canvas");
  canvas.id = "three-canvas";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;";
  mainCanvas.parentNode.insertBefore(canvas, mainCanvas.nextSibling);
  try {
    THREE = await import("three");
    renderer = new THREE.WebGLRenderer({
      canvas, alpha: true, antialias: HIGH, premultipliedAlpha: true,
      powerPreference: "high-performance",
    });
  } catch (e) {
    console.warn("[three] no WebGL — el mundo sigue en Canvas", e);
    canvas.remove();
    failed = true;
    releaseAll();
    throw e;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = HIGH ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;

  scene = new THREE.Scene();
  // La raíz espejada: se autora en coordenadas de juego (y hacia el sur). Ver
  // el comentario de `camera.js`.
  root = new THREE.Group();
  root.scale.set(1, -1, 1);
  scene.add(root);

  camera = new THREE.Camera();
  camera.matrixAutoUpdate = false;
  camera.matrixWorldAutoUpdate = false;

  // LA LUZ NO REPINTA EL ARTE. El techo tiene que salir del color que el
  // registro le da (y que Canvas pinta), así que ambiente + sol·cos(cenit) = 1
  // se sostiene cuadro a cuadro: el sol sólo decide qué PARED se ilumina y
  // cuál queda en sombra. El color del día lo pone el tinte de la capa de
  // arriba, que es la misma autoridad para la calle y para el edificio.
  hemi = new THREE.AmbientLight(0xffffff, 0.55);
  root.add(hemi);
  sun = new THREE.DirectionalLight(0xffffff, SUN_SHARE);
  sunTarget = new THREE.Object3D();
  root.add(sunTarget);
  sun.target = sunTarget;
  sun.castShadow = true;
  sun.shadow.mapSize.set(HIGH ? 2048 : 1024, HIGH ? 2048 : 1024);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.autoUpdate = false;
  root.add(sun);

  receiverMat = new THREE.ShadowMaterial({ opacity: 0.3, depthWrite: false });
  receiver = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), receiverMat);
  receiver.receiveShadow = true;
  receiver.position.z = -RECEIVER_BELOW_M * W.PX_PER_M;
  receiver.renderOrder = -1;
  root.add(receiver);

  setupTint(THREE);
  setupBuildings(THREE, root);
  setupFlora(THREE);
  setupLamps(THREE);
  claimForThree(["buildings", "flora", "lamps"]);
  ready = true;
  stats.ready = true;
  stats.revision = THREE.REVISION;
  canvas.dataset.ready = "true";
  // para la consola y las herramientas de tools/: la escena viva, sin copiarla
  if (typeof window !== "undefined") window.__threeScene = { THREE, renderer, scene, root, sun };
  publish();
  return api;
}

function resize(frame) {
  const dpr = HIGH ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const key = `${frame.viewportWidth}x${frame.viewportHeight}@${dpr}`;
  if (key === sizeKey) return;
  sizeKey = key;
  renderer.setPixelRatio(dpr);
  renderer.setSize(frame.viewportWidth, frame.viewportHeight, false);
}

// EL MAPA DE SOMBRAS SE RENDERIZA CUANDO CAMBIA ALGO QUE LO CAMBIA — no en
// cada cuadro. Tres cosas lo mueven, y la tercera es la que ROADMAP §6 anotó
// después de pagarla: el sol, la cámara, y EL CONJUNTO DE CASTERS (los tiles
// llegan por streaming; una manzana que entra después de dibujado el mapa se
// quedaba sin sombra hasta que el jugador se movía). La cámara se cuantiza a
// una retícula de `SHADOW_SNAP` px y el volumen de sombra cubre la vista más
// ese margen, así que manejando el mapa se rehace cada tanto y no cada cuadro.
const SHADOW_SNAP = 160;
let shadowKey = "";

function placeSun(frame, castersChanged) {
  const d = sunDirection3();
  // sun.js habla en (x, −y, z); aquí autoramos en (x, y-sur, h)
  const lx = d.x, ly = -d.y, lz = Math.max(0.15, d.z);
  const reach = 1600;
  const cx = Math.round(frame.x / SHADOW_SNAP) * SHADOW_SNAP;
  const cy = Math.round(frame.y / SHADOW_SNAP) * SHADOW_SNAP;
  // el volumen cubre la vista, el margen del cuantizado y lo que entra por el borde
  const half = Math.ceil((Math.max(frame.worldWidth, frame.worldHeight) * 0.6 + SHADOW_SNAP + 80) / 32) * 32;
  const key = `${cx},${cy},${half},${lx.toFixed(3)},${ly.toFixed(3)},${lz.toFixed(3)}`;
  if (key !== shadowKey || castersChanged) {
    shadowKey = key;
    sunTarget.position.set(cx, cy, 0);
    sun.position.set(cx + lx * reach, cy + ly * reach, lz * reach);
    const sc = sun.shadow.camera;
    if (sc.right !== half) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.near = 1; sc.far = reach * 2 + 800;
      sc.updateProjectionMatrix();
    }
    sun.shadow.needsUpdate = true;
    stats.shadowUpdates = (stats.shadowUpdates || 0) + 1;
  }
  hemi.intensity = Math.max(0.2, 1 - SUN_SHARE * lz);
  receiverMat.opacity = SHADOW_INK * d.shadowAlpha;
  stats.sun = { x: +lx.toFixed(3), y: +ly.toFixed(3), z: +lz.toFixed(3), alpha: +d.shadowAlpha.toFixed(3) };
  receiver.scale.set(half * 2.4, half * 2.4, 1);
  receiver.position.x = frame.x; receiver.position.y = frame.y;
}

/** Un cuadro, con el MISMO marco que acaba de usar Canvas. */
export function renderThree(tSeconds, frame) {
  if (!ready || failed) return;
  const started = performance.now();
  frameNo++;
  lastFrame = frame;
  resize(frame);
  const lean = (leanDeg() * Math.PI) / 180;
  const pinhole = pinholeM() * W.PX_PER_M;
  applyFrame(camera, frame, lean, pinhole);
  const warm = frameNo < 30 ? 4 : 1;
  const casters = syncBuildings(root, frame.view, frameNo, warm)
    + syncFlora(root, frame.view, frameNo, warm)
    + syncLamps(root, frame.view, frameNo, warm);
  // LA NOCHE ENTRA DE A POCO: ventanas y faroles se prenden con una rampa, no
  // en el cuadro en que `lightsOn()` cambia de opinión.
  nightRamp += ((lightsOn() ? 1 : 0) - nightRamp) * Math.min(1, frameDt(tSeconds) * 1.5);
  setWindowNight(nightRamp);
  setLampNight(nightRamp);
  updateTint();
  placeSun(frame, casters > 0);
  renderer.render(scene, camera);
  stats.frames = frameNo;
  stats.calls = renderer.info.render.calls;
  stats.triangles = renderer.info.render.triangles;
  stats.ms = +(performance.now() - started).toFixed(2);
  stats.lean = leanDeg(); stats.pinhole = pinholeM();
  if (frameNo % 30 === 0) { stats.buildings = buildingStats(); stats.flora = floraStats(); stats.lamps = lampStats(); }
  stats.night = +nightRamp.toFixed(2);
  publish();
}

/** Para rótulos HTML que tienen que pararse sobre algo alto. */
export function screenOf(x, y, h = 0) {
  if (!lastFrame) return null;
  return projectToScreen(lastFrame, (leanDeg() * Math.PI) / 180, pinholeM() * W.PX_PER_M, x, y, h);
}

const api = { render: renderThree, screenOf };
