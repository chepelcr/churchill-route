// EL PUEBLO, DE VERDAD, EN TRES DIMENSIONES.
//
// Cada huella emitida deja de ser un rectángulo de color y pasa a ser un
// VOLUMEN: paredes extruidas hasta el alero y un techo a dos aguas encima,
// iluminado por el sol de verdad y proyectando su sombra sobre la calle y
// sobre el vecino.
//
// LA CÁMARA NO SE INCLINA, y eso es la mitad del diseño. Se mira desde arriba
// en ortográfica, así que el plano del suelo mapea EXACTAMENTE como el Canvas
// de abajo y manejar es idéntico por construcción: `applyTouch` compara un
// ángulo de pantalla contra un rumbo de mundo y a 0° coinciden. Lo que hace
// que esto se lea como 3-D no es el ángulo sino que la geometría sea real:
//
//   · el techo tiene DOS FALDONES con distinta luz y una cumbrera entre ellos,
//     que desde arriba es lo que distingue un edificio de una mancha;
//   · la sombra es la que proyecta ESE cuerpo, con su forma, y gira con la
//     hora — no un desplazamiento fijo de la silueta;
//   · un edificio le hace sombra al de al lado, porque hay un mapa de sombras
//     y no una lista de calcomanías.
//
// EL SUELO SE QUEDA EN CANVAS. El arte pictórico es el aspecto del juego; acá
// sólo se le agrega la luz encima. Por eso este lienzo compone en `normal` y
// no en `multiply` como el del terreno: el volumen REEMPLAZA lo que Canvas
// dibujaba, mientras que la sombra sobre la calle es negro con alfa, que bajo
// composición normal es exactamente un oscurecimiento.
import { WORLD2D as W } from "../../world2d/index.js";
import { sunDirection3 } from "../sun.js";
import { buildingHeightM } from "../c2d/shadows.js";
import { buildingStyle } from "../c2d/buildingStyle.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import { LAYER, owns } from "../migrated.js";
import { addTree, beginTreeFrame, endTreeFrame, setupTrees, teardownTrees } from "./trees.js";
import { addLamp, beginLampFrame, endLampFrame, setupLamps, teardownLamps } from "./lamps.js";
import { forEachWoodTree, roadsideTrees, tileTrees } from "../c2d/flora.js";
import { medianPairs } from "../c2d/streets.js";

const S = MATERIALS.structure;

// EL TECHO ES CASI PLANO, y esa es la decisión que hace que esto se vea desde
// arriba en vez de en escorzo.
//
// Un techo a dos aguas de pendiente normal, mirado A PLOMO, no se lee como un
// techo: se lee como una PIRÁMIDE. Sus cuatro faldones reciben luz distinta y
// las limatesas cruzan la planta de esquina a esquina, así que cada casa sale
// como un bulto puntiagudo y la manzana entera parece inclinada — que es
// exactamente lo contrario de lo que este ángulo de cámara promete. Se probó a
// 0.34 de la altura y el centro de Puntarenas salió como un campo de carpas.
//
// Con una pendiente mínima el techo vuelve a ser una superficie: desde arriba
// es la losa plana de siempre —o sea, el juego que ya existe— y lo que aporta
// el volumen es la SOMBRA REAL que proyecta sobre la calle. La pendiente sigue
// estando, así que en la cámara libre, cuando se incline, el pueblo tiene
// techos y no cajas.
const ROOF_FRACTION = 0.06;
const ROOF_MAX_M = 0.5;
const ROOF_MIN_M = 0.15;

// Cuánto más oscura es una pared que su propio techo. No es una paleta nueva:
// el pueblo ya tiene sus colores y una pared inventada los contradiría.
const WALL_TINT = 0.82;
// Cuánto se hunde el plano receptor bajo el suelo para no quedar coplanar con
// la base de los edificios. En metros, como todo lo que es una medida real.
const RECEIVER_BELOW_M = 0.04;

let THREE = null;
let renderer = null;
let scene = null;
let canvas = null;
let sun = null;
let ambient = null;
let catcher = null;
let sizeKey = "";
let shadowKey = "";
let ready = false;

const tiles = new Map();

const diagnostics = {
  ready: false, meshTiles: 0, buildings: 0, triangles: 0,
  shadowMapUpdates: 0, cpuLastMs: 0,
};
function publish() {
  if (typeof window !== "undefined") window.__threeMassing = diagnostics;
}

// El color del pueblo, LLEVADO AL ESPACIO DE TRABAJO DE THREE.
//
// Un `#d9c9a8` de `materials.json` es sRGB — es lo que Canvas pinta. Metido
// crudo como color de vértice, Three lo interpreta como LINEAL y lo devuelve
// lavado: el rosa de una casa sale beige y el pueblo entero pierde su paleta,
// que es justo lo que esta migración no puede costar. `THREE.Color` hace la
// conversión con la gestión de color encendida, así que se pasa por ahí en vez
// de dividir entre 255 a mano. Se cachea porque el pueblo repite sus colores
// miles de veces y esto corre por vértice.
const COLOR_CACHE = new Map();
function rgb(hex, scale = 1) {
  const key = `${hex}|${scale}`;
  let out = COLOR_CACHE.get(key);
  if (out) return out;
  const color = new THREE.Color(hex || S.building.fallback);
  out = [color.r * scale, color.g * scale, color.b * scale];
  COLOR_CACHE.set(key, out);
  return out;
}

/**
 * El eje mayor de una huella, por su segundo momento.
 *
 * En una planta cuadrada el ajuste es DEGENERADO y puede salir a 45° — que en
 * otras partes de este repo es un error real (una manzana se corta en diagonal)
 * y acá no importa: la cumbrera de un techo cuadrado puede ir en cualquier
 * dirección y sigue siendo un techo. Se documenta para que nadie "arregle"
 * esto copiando la advertencia de `place_parcels`.
 */
function principalAxis(pts, cx, cy) {
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - cx, dy = pts[i + 1] - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return [Math.cos(a), Math.sin(a)];
}

/**
 * Una huella -> triángulos de pared y de techo, en coordenadas de Three.
 *
 * El techo es a CUATRO AGUAS sobre la cumbrera del rectángulo orientado: cada
 * vértice del alero sube al punto MÁS CERCANO de la cumbrera. En una planta
 * rectangular eso da el techo de toda la vida —dos faldones largos y dos
 * limatesas en las puntas—; en una irregular da algo razonable sin tener que
 * calcular un esqueleto recto, que es el problema difícil de verdad y que este
 * pueblo de plantas casi todas rectangulares no necesita.
 */
function emitBuilding(b, out) {
  const pts = b.pts;
  const n = pts.length;
  if (n < 6) return 0;

  const heightPx = buildingHeightM(b) * W.PX_PER_M;
  const roofPx = Math.min(ROOF_MAX_M * W.PX_PER_M,
    Math.max(ROOF_MIN_M * W.PX_PER_M, heightPx * ROOF_FRACTION));
  const eave = Math.max(0.5, heightPx - roofPx);
  const apex = heightPx;

  // EL TECHO LLEVA EL COLOR DEL CUERPO, y es una decisión de aspecto tomada
  // mirando las dos. Desde arriba lo que se ve es el techo, así que lo
  // "correcto" sería pintarlo con `roof` — pero esa paleta se autoró como una
  // BANDA angosta de sombra sobre el borde superior de una huella plana, no
  // como un techo entero al sol. Estirada sobre toda la planta convierte el
  // puerto pastel en un pueblo de tejas oscuras: otro juego. Así que el techo
  // se pinta del color del edificio y el volumen lo pone la LUZ, que es lo que
  // se quería de todo esto. `roof` se queda para el alero, donde sí es una
  // banda.
  const style = buildingStyle(b);
  const bodyHex = (style && style.color) || b.color || S.building.fallback;
  const eaveHex = (style && style.roof) || b.roof || S.roof;
  const wall = rgb(bodyHex, WALL_TINT);
  const roof = rgb(bodyHex);
  const eaveBand = rgb(eaveHex, 0.92);

  let cx = 0, cy = 0;
  for (let i = 0; i < n; i += 2) { cx += pts[i]; cy += pts[i + 1]; }
  cx /= n / 2; cy /= n / 2;

  const [ux, uy] = principalAxis(pts, cx, cy);
  const vx = -uy, vy = ux;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < n; i += 2) {
    const dx = pts[i] - cx, dy = pts[i + 1] - cy;
    const u = dx * ux + dy * uy, v = dx * vx + dy * vy;
    if (u < u0) u0 = u; if (u > u1) u1 = u;
    if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  // La cumbrera corre por el eje mayor, retirada por media anchura en cada
  // punta: eso es lo que convierte los dos extremos en limatesas y no en
  // hastiales verticales flotando en el aire.
  const half = Math.min((v1 - v0) / 2, (u1 - u0) / 2);
  const rA = u0 + half, rB = Math.max(u0 + half, u1 - half);

  // Three mira (x, -y, z): la Y del mundo va hacia abajo y acá hacia arriba.
  const P = (x, y, z) => { out.pos.push(x, -y, z); };
  const C = (c) => { out.col.push(c[0], c[1], c[2]); };
  const tri = (ax, ay, az, bx, by, bz, cx2, cy2, cz, c) => {
    P(ax, ay, az); P(bx, by, bz); P(cx2, cy2, cz); C(c); C(c); C(c);
  };

  const ridgeOf = (px, py) => {
    const dx = px - cx, dy = py - cy;
    const u = Math.min(rB, Math.max(rA, dx * ux + dy * uy));
    return [cx + ux * u, cy + uy * u];
  };

  let triangles = 0;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const x0 = pts[i], y0 = pts[i + 1];
    const x1 = pts[j], y1 = pts[j + 1];
    // pared: del suelo al alero. La franja de arriba lleva el color autorado
    // de `roof`, que es exactamente donde esa banda vivía en el dibujo plano.
    const band = Math.max(0, eave - Math.min(eave * 0.34, 1.1 * W.PX_PER_M));
    tri(x0, y0, 0, x1, y1, 0, x1, y1, band, wall);
    tri(x0, y0, 0, x1, y1, band, x0, y0, band, wall);
    tri(x0, y0, band, x1, y1, band, x1, y1, eave, eaveBand);
    tri(x0, y0, band, x1, y1, eave, x0, y0, eave, eaveBand);
    // techo: del alero a la cumbrera
    const [r0x, r0y] = ridgeOf(x0, y0);
    const [r1x, r1y] = ridgeOf(x1, y1);
    tri(x0, y0, eave, x1, y1, eave, r1x, r1y, apex, roof);
    if (r0x !== r1x || r0y !== r1y) {
      tri(x0, y0, eave, r1x, r1y, apex, r0x, r0y, apex, roof);
      triangles++;
    }
    triangles += 5;
  }
  return triangles;
}

function buildTile(tile) {
  const out = { pos: [], col: [] };
  let triangles = 0, count = 0;
  for (const b of tile.buildings) { triangles += emitBuilding(b, out); count++; }
  if (!out.pos.length) return { mesh: null, triangles: 0, buildings: 0, tc: tile.tc, tr: tile.tr };

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(out.pos), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(out.col), 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, scene.userData.material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  scene.add(mesh);
  return { mesh, geometry, triangles, buildings: count, tc: tile.tc, tr: tile.tr };
}

export function setupMassing(three, mainCanvas, terrainCanvas) {
  THREE = three;
  canvas = document.createElement("canvas");
  canvas.id = "three-massing";
  canvas.dataset.ready = "false";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = [
    "position:fixed", "inset:0", "pointer-events:none",
    "mix-blend-mode:normal", "will-change:contents",
  ].join(";");
  // Encima del terreno (que multiplica) y debajo de Pixi y del HUD. El orden
  // del DOM es el orden de las capas y por eso se ancla explícitamente en vez
  // de depender de quién se insertó primero.
  const below = terrainCanvas || mainCanvas;
  below.parentNode.insertBefore(canvas, below.nextSibling);

  renderer = new THREE.WebGLRenderer({
    canvas, alpha: true, antialias: true,
    premultipliedAlpha: true, powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  // El lienzo se compone sobre el arte de Canvas, que ya está en sRGB: salir
  // en el mismo espacio es lo que hace que un techo pintado `#8a5f45` acá se
  // vea del mismo color que la misma huella pintada allá.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.userData.material = new THREE.MeshLambertMaterial({
    vertexColors: true,
    // Plano por cara: el pueblo está dibujado a colores planos y un degradado
    // suave sobre el faldón lo sacaría de su propio estilo.
    flatShading: true,
    side: THREE.DoubleSide,
  });

  sun = new THREE.DirectionalLight(0xfff4e2, 1.05);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  // El sesgo por normal se mide en unidades del MUNDO (píxeles acá). El mapa
  // cubre ~614 px en 2048 texels, o sea 0.3 px por texel: 0.6 px eran DOS
  // texels de corrimiento, bastante para saltarse por completo la sombra corta
  // de una casa de una planta. Un tercio de texel basta contra el acné.
  sun.shadow.normalBias = 0.1;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  scene.add(sun);
  scene.add(sun.target);

  // La luz del cielo. Sin ella una pared a contraluz sale NEGRA, y este mundo
  // no tiene negros: es un puerto al mediodía.
  ambient = new THREE.HemisphereLight(0xdfeaf2, 0x9a8b73, 1.15);
  scene.add(ambient);

  // LA CALLE RECIBE LA SOMBRA. Un plano transparente a ras del suelo que sólo
  // se oscurece donde algo lo tapa: negro con alfa, que compuesto en normal
  // sobre el arte de Canvas es exactamente multiplicar por (1 - alfa).
  catcher = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShadowMaterial({ opacity: 0.42, depthWrite: false }),
  );
  catcher.receiveShadow = true;
  catcher.renderOrder = -1;
  scene.add(catcher);

  // LO QUE SE PARA EN EL PAISAJE, en el MISMO escenario y bajo la MISMA luz.
  // Separarlos en escenas propias costaría una pasada de sombra por capa, y
  // entonces un árbol no podría tirar su sombra sobre una casa.
  setupTrees(THREE, scene);
  setupLamps(THREE, scene);

  canvas.dataset.ready = "true";
  ready = true;
  diagnostics.ready = true;
  publish();
  return true;
}

function syncTiles(view) {
  const visible = W.visibleTiles(view.x0, view.y0, view.x1, view.y1);
  const live = new Set();
  let triangles = 0, buildings = 0, meshes = 0;
  for (const tile of visible) {
    const key = `${tile.tc},${tile.tr}`;
    live.add(key);
    let entry = tiles.get(key);
    if (!entry) { entry = buildTile(tile); tiles.set(key, entry); }
    if (entry.mesh) { entry.mesh.visible = true; meshes++; }
    triangles += entry.triangles; buildings += entry.buildings;
  }
  for (const [key, entry] of tiles) {
    if (live.has(key)) continue;
    // WORLD2D es el dueño de la residencia: una malla se tira cuando su tile
    // deja esa caché, no cuando sale del cuadro — o una vuelta en U la
    // reconstruye entera cada vez.
    if (W.tileResident(entry.tc * W.TILE_PX + 1, entry.tr * W.TILE_PX + 1)) {
      if (entry.mesh) entry.mesh.visible = false;
      continue;
    }
    if (entry.mesh) scene.remove(entry.mesh);
    entry.geometry?.dispose();
    tiles.delete(key);
  }
  diagnostics.meshTiles = meshes;
  diagnostics.triangles = triangles;
  diagnostics.buildings = buildings;
  return visible;
}

/**
 * El arbolado y el alumbrado del cuadro, DESDE LOS MISMOS ENUMERADORES que usa
 * el pintor plano.
 *
 * El monte no se emite —se computa desde una retícula global— y la calle se
 * planta desde la geometría de la propia calzada, así que recorrerlos otra vez
 * acá con otra fórmula pondría el volumen de un árbol en un sitio y su sombra
 * en otro. Se llaman las funciones de `c2d/flora.js`, que es donde vive la
 * respuesta.
 */
function syncStanding(view, visible) {
  beginTreeFrame();
  beginLampFrame();
  const inView = (x, y, pad) => (
    x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad
  );

  forEachWoodTree(view, (x, y, k, s) => addTree(x, y, k, s));

  const roads = [];
  for (const tile of visible) for (const r of tile.roads) roads.push(r);
  for (const r of roads) {
    for (const tr of roadsideTrees(r)) {
      if (inView(tr.x, tr.y, 30)) addTree(tr.x, tr.y, tr.k, tr.s);
    }
  }
  for (const tile of visible) {
    for (const tr of tileTrees(tile, medianPairs(tile).pairs)) {
      if (inView(tr.x, tr.y, 30)) addTree(tr.x, tr.y, tr.k, tr.s);
    }
    for (const pa of tile.palms) {
      if (inView(pa.x, pa.y, 30)) addTree(pa.x, pa.y, pa.k, pa.s, true);
    }
  }
  for (const lamp of (W.lampsIn ? W.lampsIn(view, 24) : [])) {
    addLamp(lamp.x, lamp.y, lamp.type || "warm");
  }
  diagnostics.trees = endTreeFrame();
  diagnostics.lamps = endLampFrame();
}

function placeSun(frame) {
  const dir = sunDirection3();
  const cx = frame.x, cy = -frame.y;
  const span = Math.max(frame.worldWidth, frame.worldHeight);
  // El volumen de sombra cubre la vista más lo que pueda entrar desde fuera:
  // el edificio más alto del mundo por el alcance del arte al atardecer.
  const reach = 20 * W.PX_PER_M * 0.95;
  const half = span / 2 + reach + 60;
  const distance = 4000;
  sun.position.set(cx + dir.x * distance, cy + dir.y * distance, dir.z * distance);
  sun.target.position.set(cx, cy, 0);
  sun.target.updateMatrixWorld(true);
  sun.updateMatrixWorld(true);

  const cam = sun.shadow.camera;
  cam.left = -half; cam.right = half;
  cam.top = half; cam.bottom = -half;
  cam.near = 1; cam.far = distance * 2;
  cam.updateProjectionMatrix();

  // EL RECEPTOR VA BAJO EL SUELO, no en él. La base de cada edificio se apoya
  // exactamente en z = 0 y el plano que recibe la sombra estaba ahí también:
  // dos superficies coplanares, y la comparación de profundidad del mapa no
  // puede decidir cuál está delante. El resultado no es ruido — es que NO SALE
  // NINGUNA SOMBRA, que es lo que costó media tarde. Es la misma corrección que
  // `effects.terrainShadow.receiverBelowM` ya documenta para el terreno: cuatro
  // centímetros abajo, invisibles, suficientes para desempatar.
  catcher.position.set(cx, cy, -RECEIVER_BELOW_M * W.PX_PER_M);
  catcher.scale.set(half * 2, half * 2, 1);

  // El mapa se recalcula sólo cuando el sol o el encuadre se mueven de verdad.
  // A 60 fps un reloj de diez minutos apenas cambia; redibujarlo cada cuadro
  // sería el gasto entero de esto por nada.
  //
  // …PERO EL CONJUNTO DE CASTERS TAMBIÉN CUENTA, y olvidarlo es un fallo que
  // se ve exactamente como que las sombras no funcionan. Los tiles llegan por
  // streaming: el mapa se dibuja una vez con el pueblo a medio cargar, y si la
  // llave sólo mira al sol y a la cámara, las casas que entraron después NO
  // PROYECTAN NADA hasta que el jugador se mueva o pase una hora. Conducir
  // hacia una manzana nueva la deja sin sombra, que es justo donde uno mira.
  const key = `${Math.round(dir.x * 512)},${Math.round(dir.y * 512)},`
    + `${Math.round(cx / 32)},${Math.round(cy / 32)},${Math.round(half)},`
    + `${diagnostics.meshTiles}:${diagnostics.buildings}:`
    + `${diagnostics.trees || 0}:${diagnostics.lamps || 0}`;
  if (key !== shadowKey) {
    shadowKey = key;
    sun.shadow.needsUpdate = true;
    diagnostics.shadowMapUpdates++;
  }
  sun.intensity = 0.55 + 0.75 * Math.max(0, dir.z);
  diagnostics.sunDir = [+dir.x.toFixed(3), +dir.y.toFixed(3), +dir.z.toFixed(3)];
  diagnostics.sunElevationDeg = +(dir.elevationRad * 180 / Math.PI).toFixed(1);
  diagnostics.shadowEnabled = renderer.shadowMap.enabled;
  diagnostics.lightCasts = sun.castShadow;
  diagnostics.catcherVisible = catcher.visible;
  diagnostics.shadowCam = [Math.round(cam.left), Math.round(cam.right),
                           Math.round(cam.near), Math.round(cam.far)];
  diagnostics.shadowNeedsUpdate = sun.shadow.needsUpdate;
}

export function renderMassing(frame, camera3) {
  if (!ready || !renderer) return;
  const started = performance.now();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const nextSize = `${frame.viewportWidth}x${frame.viewportHeight}@${dpr}`;
  if (nextSize !== sizeKey) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(frame.viewportWidth, frame.viewportHeight, false);
    sizeKey = nextSize;
  }
  const visible = syncTiles(frame.view);
  if (owns(LAYER.THREE, "flora")) syncStanding(frame.view, visible);
  placeSun(frame);
  renderer.render(scene, camera3);
  diagnostics.cpuLastMs = performance.now() - started;
  publish();
}

export function teardownMassing() {
  for (const entry of tiles.values()) {
    if (entry.mesh) scene?.remove(entry.mesh);
    entry.geometry?.dispose();
  }
  tiles.clear();
  COLOR_CACHE.clear();
  teardownTrees();
  teardownLamps();
  renderer?.dispose();
  canvas?.remove();
  THREE = renderer = scene = canvas = sun = ambient = catcher = null;
  ready = false;
  diagnostics.ready = false;
}
