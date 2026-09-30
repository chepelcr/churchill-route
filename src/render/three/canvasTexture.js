// EL CUADRO DE CANVAS COMO TEXTURA — el suelo 2-D, drapeado sobre el 3-D.
//
// Canvas ya pinta el mundo plano entero cada cuadro: el suelo, las calles, el
// agua, la gente, los puestos, el arte de las escenas, el tinte del cielo y los
// pozos de luz. No se repinta nada en three: ese lienzo se sube como textura y
// se proyecta EN PLANTA sobre el terreno y sobre los techos de las escenas, con
// la MISMA afín de `camera.js` con que Canvas lo pintó. Un punto de mundo (x, y)
// cae exactamente en el píxel de Canvas que lo dibujó, esté a la altura que esté.
//
// Dos consecuencias que son el diseño y no efectos colaterales:
//   * lo plano que Canvas sigue dibujando (peatones, estelas, rótulos) se
//     drapea solo sobre el suelo con relieve — no hay que migrarlo;
//   * el lienzo plano sigue DEBAJO: donde el terreno no llega o la proyección
//     cae fuera del cuadro, se descarta el fragmento y se ve el mismo píxel.
//
// La textura trae el cielo ya aplicado, así que estos materiales NO se tiñen.
import { cameraAffine } from "../camera.js";

let T = null, tex = null, mainCanvas = null;
const uAffine = { value: null };
const uSize = { value: null };

export function setupCanvasTexture(THREE, canvasEl) {
  T = THREE;
  mainCanvas = canvasEl;
  tex = new T.CanvasTexture(canvasEl);
  tex.colorSpace = T.SRGBColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.minFilter = T.LinearFilter;
  tex.magFilter = T.LinearFilter;
  uAffine.value = new T.Matrix3();
  uSize.value = new T.Vector2(1, 1);
}

/** Una vez por cuadro, DESPUÉS de que Canvas pintó: la afín y la subida. */
export function updateCanvasTexture(frame) {
  if (!tex) return;
  const dpr = mainCanvas.width / Math.max(1, frame.viewportWidth);
  const [a, b, c, d, e, f] = cameraAffine(frame, dpr);
  // px = a·x + c·y + e ; py = b·x + d·y + f   (y de juego, hacia el sur)
  uAffine.value.set(a, c, e, b, d, f, 0, 0, 1);
  uSize.value.set(mainCanvas.width, mainCanvas.height);
  tex.needsUpdate = true;
}

/**
 * Un Lambert cuyo color es el píxel de Canvas bajo el punto, en planta. La luz
 * hace el resto: ambiente + sol·cos(cenit) = 1 deja lo plano idéntico a Canvas
 * y sólo una cara inclinada (un bordillo, un talud, una pared) cambia de tono.
 */
export function projectedMaterial(opts = {}) {
  const m = new T.MeshLambertMaterial({ map: tex, ...opts });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAffine = uAffine;
    shader.uniforms.uSize = uSize;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "uniform mat3 uAffine;\nuniform vec2 uSize;\nattribute vec2 canvasShift;\nvarying vec2 vCanvasUv;\nvoid main() {")
      .replace("#include <project_vertex>", `#include <project_vertex>
\tvec4 cwp = modelMatrix * vec4( transformed, 1.0 );
\t// la raíz está espejada: y de juego = −Y de three. \`canvasShift\` (px de
\t// mundo, 0 si la malla no lo trae) corre DÓNDE se lee el cuadro: una pared
\t// lee un poco hacia adentro de su huella, el color del borde del techo, y no
\t// lo que Canvas pintó delante de ella (un jardín, una acera).
\tvec3 cpx = uAffine * vec3( cwp.x + canvasShift.x, -cwp.y + canvasShift.y, 1.0 );
\tvCanvasUv = cpx.xy / uSize;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "varying vec2 vCanvasUv;\nvoid main() {")
      .replace("#include <map_fragment>", `if ( vCanvasUv.x < 0.0 || vCanvasUv.y < 0.0 || vCanvasUv.x > 1.0 || vCanvasUv.y > 1.0 ) discard;
\tdiffuseColor *= texture2D( map, vCanvasUv );`);
  };
  m.customProgramCacheKey = () => "canvas-projected";
  return m;
}
