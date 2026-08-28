// EL RUIDO — la variación que le quita la línea recta al mundo.
//
// No importa nada. Es aritmética pura sobre la retícula, así que la puede usar
// el pintor, una hoja de arte o el editor sin arrastrar el juego detrás.
//
// SE SIEMBRA EN `hash01`, QUE YA EXISTE, y eso no es ahorro de código: es la
// misma razón por la que `hash01` es un hash y no un `Math.random`. Un mundo
// que se dibuja distinto en cada cuadro parpadea, y dos fuentes de variación
// distintas darían dos estabilidades distintas — la costa temblando mientras
// los árboles se están quietos. `primitives.js` dice que es compartida y nunca
// copiada; esto la extiende, no la duplica.
import { hash01 } from "./primitives.js";

//: la retícula del ruido. `hash01(n)` toma UN número, así que los dos ejes se
//: mezclan en uno solo con dos primos grandes — el truco de siempre, y el que
//: hay que revisar si alguna vez aparecen bandas diagonales.
const KX = 374761393;
const KY = 668265263;

/** El valor del hash en un nodo entero de la retícula. */
function lattice(ix, iy) {
  return hash01(ix * KX + iy * KY);
}

//: la curva de suavizado de Perlin (6t^5 - 15t^4 + 10t^3). Interpolar LINEAL
//: entre nodos deja la derivada rota justo en cada nodo, y eso se ve: sale una
//: cuadrícula de rombos donde debería haber una mancha. Esta tiene primera y
//: segunda derivada nulas en 0 y 1, que es lo que borra la retícula.
function smooth(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) { return a + (b - a) * t; }

/**
 * Ruido de valor en 2-D, en `0..1`. Determinista y continuo.
 *
 * `freq` es en unidades de MUNDO por celda de ruido: `noise2(x, y, 40)` da una
 * mancha cada 40 px. Se pide así y no en "escala" porque quien llama piensa en
 * metros de costa, no en octavas.
 */
export function noise2(x, y, freq = 1) {
  const fx = x / freq, fy = y / freq;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = smooth(fx - ix), ty = smooth(fy - iy);
  const a = lerp(lattice(ix, iy), lattice(ix + 1, iy), tx);
  const b = lerp(lattice(ix, iy + 1), lattice(ix + 1, iy + 1), tx);
  return lerp(a, b, ty);
}

/** El mismo ruido centrado en cero, `-1..1` — que es lo que quiere un
 *  desplazamiento, porque una costa tiene que poder entrar y salir. */
export function snoise2(x, y, freq = 1) {
  return noise2(x, y, freq) * 2 - 1;
}

/**
 * Suma de octavas: cada una el doble de fina y la mitad de fuerte.
 *
 * Una sola octava da lomas parejas y se lee como una tela; la naturaleza tiene
 * detalle a todas las escalas. Tres bastan para una costa — la cuarta ya cuesta
 * lo mismo que las tres primeras juntas y no se distingue a este zoom.
 */
export function fbm(x, y, freq = 1, octaves = 3) {
  let sum = 0, amp = 1, norm = 0, f = freq;
  for (let i = 0; i < octaves; i++) {
    sum += snoise2(x, y, f) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 0.5;
  }
  return norm ? sum / norm : 0;
}
