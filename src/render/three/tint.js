// EL CIELO SOBRE LO QUE TIENE ALTURA — el mismo tinte que Canvas, en el sombreador.
//
// Canvas cierra el cuadro con un velo `rgba` sobre el mundo (el día, el
// atardecer, la tormenta, la noche con la luna descontada). Ese velo se queda en
// el lienzo del SUELO, así que lo que dibuja three tiene que teñirse solo, con
// el mismo color y la misma mezcla, o de noche los edificios brillarían sobre
// una calle a oscuras.
//
// La mezcla va DESPUÉS de la conversión a sRGB: es `mix(color, tinte, alfa)` en
// el espacio en que Canvas compone, así que un techo sale del mismo tono que
// la acera de al lado. Lo que emite luz —una ventana prendida, la cabeza de un
// farol— baja `uTintK` y atraviesa la noche en vez de apagarse con ella.
import { weatherColors } from "../c2d/gfx.js";
import { nightTint } from "../c2d/nightlights.js";
import { lightsOn } from "../../game/daynight.js";

export const tint = { value: null };     // THREE.Vector4 (r, g, b, a) en sRGB 0..1
let lastKey = "";

export function setupTint(THREE) {
  tint.value = new THREE.Vector4(0, 0, 0, 0);
}

function parseRgba(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || "");
  if (!m) return [0, 0, 0, 0];
  const [r, g, b, a = 1] = m[1].split(",").map(Number);
  return [r / 255, g / 255, b / 255, Number.isFinite(a) ? a : 1];
}

/** Una vez por cuadro: el tinte de la hora, con la luna si es de noche. */
export function updateTint() {
  const C = weatherColors();
  const str = lightsOn() ? nightTint(C.tint) : C.tint;
  if (str === lastKey) return;
  lastKey = str;
  tint.value.set(...parseRgba(str));
}

/**
 * Enseña a un material a teñirse. `strength` es un uniform propio (0..1) para
 * lo que emite: 1 = se tiñe entero, 0 = atraviesa el velo.
 */
export function tintMaterial(material, strength = null) {
  const k = strength || { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTint = tint;
    shader.uniforms.uTintK = k;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform vec4 uTint;\nuniform float uTintK;\nvoid main() {")
      .replace("#include <colorspace_fragment>",
        "#include <colorspace_fragment>\n\tgl_FragColor.rgb = mix(gl_FragColor.rgb, uTint.rgb, uTint.a * uTintK);");
  };
  material.customProgramCacheKey = () => "tint";
  return k;
}
