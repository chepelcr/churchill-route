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
//
// ## Los pozos de luz, también arriba
//
// De noche Canvas no pone un velo parejo: lo PERFORA con un pozo por poste
// (`nightlights.js`, `destination-out` con la máscara de `lights.json`). Una
// fachada junto a un poste tiene que salir de la noche igual que la acera que
// tiene enfrente, así que el sombreador recibe los postes más cercanos a la
// cámara y descuenta el velo con la MISMA máscara radial — el alfa que queda
// es el producto de lo que cada pozo deja, como en el `destination-out`.
import LIGHTS from "../../assets/lights.json" with { type: "json" };
import { weatherColors } from "../c2d/gfx.js";
import { lampsInView, nightTint } from "../c2d/nightlights.js";
import { lightsOn } from "../../game/daynight.js";
import { LAMP_POOL_R } from "../../domain/units.js";

export const MAX_POOLS = 16;
export const tint = { value: null };     // THREE.Vector4 (r, g, b, a) en sRGB 0..1
const pools = { value: [] };             // vec3(x, Y, fuerza) en coordenadas de three (Y = −y)
const poolR = { value: LAMP_POOL_R };
const STOPS = LIGHTS.poolMask.stops;     // [[offset, alfa], …] — el degradé de la máscara
let lastKey = "";

export function setupTint(THREE) {
  tint.value = new THREE.Vector4(0, 0, 0, 0);
  for (let i = 0; i < MAX_POOLS; i++) pools.value.push(new THREE.Vector3(0, 0, 0));
}

function parseRgba(str) {
  const m = /rgba?\(([^)]+)\)/.exec(str || "");
  if (!m) return [0, 0, 0, 0];
  const [r, g, b, a = 1] = m[1].split(",").map(Number);
  return [r / 255, g / 255, b / 255, Number.isFinite(a) ? a : 1];
}

/** Una vez por cuadro: el tinte de la hora y, de noche, los pozos cercanos. */
export function updateTint(view, cx, cy) {
  const C = weatherColors();
  const lit = lightsOn();
  const str = lit ? nightTint(C.tint) : C.tint;
  if (str !== lastKey) { lastKey = str; tint.value.set(...parseRgba(str)); }
  const slots = pools.value;
  let n = 0;
  if (lit && view) {
    const lamps = lampsInView(view)
      .map((l) => ({ l, d: (l.x - cx) ** 2 + (l.y - cy) ** 2 }))
      .sort((a, b) => a.d - b.d);
    for (; n < Math.min(MAX_POOLS, lamps.length); n++) slots[n].set(lamps[n].l.x, -lamps[n].l.y, 1);
  }
  for (let i = n; i < MAX_POOLS; i++) slots[i].z = 0;
}

// El degradé de `poolMask.stops` escrito en GLSL: lineal entre paradas, como
// lo interpola `createRadialGradient`.
const MASK_GLSL = (() => {
  let code = "float poolMask(float t) {\n";
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [o0, a0] = STOPS[i], [o1, a1] = STOPS[i + 1];
    code += `\tif (t <= ${o1.toFixed(4)}) return mix(${a0.toFixed(4)}, ${a1.toFixed(4)}, clamp((t - ${o0.toFixed(4)}) / ${Math.max(1e-4, o1 - o0).toFixed(4)}, 0.0, 1.0));\n`;
  }
  return code + "\treturn 0.0;\n}\n";
})();

/**
 * Enseña a un material a teñirse. `strength` es un uniform propio (0..1) para
 * lo que emite: 1 = se tiñe entero, 0 = atraviesa el velo. `extra` deja que
 * otro inyector (las ventanas) toque el sombreador después.
 */
export function tintMaterial(material, strength = null, extra = null) {
  const k = strength || { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTint = tint;
    shader.uniforms.uTintK = k;
    shader.uniforms.uPools = pools;
    shader.uniforms.uPoolR = poolR;
    shader.vertexShader = shader.vertexShader
      .replace("void main() {", "varying vec3 vTintPos;\nvoid main() {")
      .replace("#include <project_vertex>", `#include <project_vertex>
\tvec4 tintWp = vec4( transformed, 1.0 );
\t#ifdef USE_INSTANCING
\t\ttintWp = instanceMatrix * tintWp;
\t#endif
\tvTintPos = ( modelMatrix * tintWp ).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", `uniform vec4 uTint;
uniform float uTintK;
uniform vec3 uPools[${MAX_POOLS}];
uniform float uPoolR;
varying vec3 vTintPos;
${MASK_GLSL}
float veil() {
\tfloat keep = 1.0;
\tfor (int i = 0; i < ${MAX_POOLS}; i++) {
\t\tif (uPools[i].z <= 0.0) continue;
\t\tfloat t = length(vTintPos.xy - uPools[i].xy) / uPoolR;
\t\tkeep *= 1.0 - poolMask(t) * uPools[i].z;
\t}
\treturn uTint.a * keep;
}
void main() {`)
      .replace("#include <colorspace_fragment>",
        "#include <colorspace_fragment>\n\tgl_FragColor.rgb = mix(gl_FragColor.rgb, uTint.rgb, veil() * uTintK);");
    if (extra) extra(shader);
  };
  material.customProgramCacheKey = () => (extra ? "tint+extra" : "tint");
  return k;
}
