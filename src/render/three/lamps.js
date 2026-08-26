// EL ALUMBRADO, EN VOLUMEN.
//
// Ésta es la pieza que más delataba que el mundo era plano: una farola dibujada
// de lado —poste entero visible, luminaria colgando— en una escena que se mira
// a plomo. Desde arriba, una farola es un poste que apenas se ve y una
// luminaria que sí: un disco claro con su sombra larga al lado.
//
// La ALTURA sale del registro (`lights.json` -> `heightM`), que es donde vive
// todo lo demás que una farola ES. El POZO DE LUZ no está acá: lo abre el
// compositor de noche sobre el suelo (`c2d/nightlights.js`), porque es
// iluminación del piso y no un cuerpo — y porque ese compositor ya resuelve
// miles de lámparas con un sprite pre-renderizado, que es la única forma
// barata de hacerlo.
import LIGHTS from "../../assets/lights.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { boxGeometry, discGeometry } from "./solids.js";

const TYPES = LIGHTS.types;
const FALLBACK = "warm";
const CAPACITY = 800;

// Alturas reales, en metros. Una luminaria de calle son 8 m, la del muelle 6,
// y una torre de cancha 26. No van en `lights.json` porque el registro es del
// CLIENTE 2-D y su esquema está probado; acá se declara lo que el volumen
// necesita y nada más.
const HEIGHT_M = { warm: 8, led: 8, amber: 6, stadium: 26 };
const POST_M = 0.16;          // media anchura del poste
const HEAD_R_M = 0.62;        // radio de la luminaria vista a plomo

let THREE = null;
let group = null;
let post = null;
let head = null;
let matrix = null;
let color = null;
let count = 0;

export function setupLamps(three, scene) {
  THREE = three;
  matrix = new THREE.Matrix4();
  color = new THREE.Color();
  group = new THREE.Group();
  scene.add(group);

  const material = new THREE.MeshLambertMaterial({ flatShading: true });
  post = new THREE.InstancedMesh(boxGeometry(THREE), material, CAPACITY);
  // La luminaria no recibe sombra: es la parte que EMITE, y oscurecerla la
  // convierte en un tornillo gris al lado de un poste.
  head = new THREE.InstancedMesh(discGeometry(THREE), material, CAPACITY);
  for (const mesh of [post, head]) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
  }
  post.castShadow = true;
  post.receiveShadow = true;
  head.castShadow = false;
  head.receiveShadow = false;
  return true;
}

export function beginLampFrame() { count = 0; }

export function addLamp(x, y, type) {
  if (!post || count >= CAPACITY) return;
  const name = TYPES[type] ? type : FALLBACK;
  const spec = TYPES[name];
  const heightPx = (HEIGHT_M[name] || 8) * W.PX_PER_M;
  const postR = POST_M * W.PX_PER_M;

  matrix.makeScale(postR, postR, heightPx);
  matrix.setPosition(x, -y, 0);
  post.setMatrixAt(count, matrix);
  color.set("#3f4648");
  post.setColorAt(count, color);

  const headR = HEAD_R_M * W.PX_PER_M * (name === "stadium" ? 2.4 : 1);
  matrix.makeScale(headR, headR, 1);
  matrix.setPosition(x, -y, heightPx + 0.4);
  head.setMatrixAt(count, matrix);
  color.set(spec.core || "#fff0ad");
  head.setColorAt(count, color);

  count++;
}

export function endLampFrame() {
  if (!post) return 0;
  post.count = count; head.count = count;
  if (count) {
    post.instanceMatrix.needsUpdate = true;
    head.instanceMatrix.needsUpdate = true;
    if (post.instanceColor) post.instanceColor.needsUpdate = true;
    if (head.instanceColor) head.instanceColor.needsUpdate = true;
  }
  return count;
}

export function teardownLamps() {
  if (!group) return;
  for (const mesh of [post, head]) {
    mesh?.geometry.dispose();
    mesh?.material.dispose?.();
  }
  group.parent?.remove(group);
  THREE = group = post = head = matrix = color = null;
  count = 0;
}
