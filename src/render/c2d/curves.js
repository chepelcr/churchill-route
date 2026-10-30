// LAS CURVAS — cómo un polígono del mundo deja de tener esquinas de 90 grados.
//
// Puro: entran y salen arreglos planos `[x,y,x,y,…]`, o un `Path2D`. No importa
// el juego ni el `ctx` compartido, así que lo puede usar una hoja de arte o el
// editor igual que el pintor.
//
// ## Por qué NO es Chaikin
//
// El camino obvio —y el que sugiere la investigación— es Chaikin: cortar cada
// esquina por sus dos tercios y repetir. El problema es que **Chaikin encoge la
// figura entera**: cada iteración mete TODO el contorno hacia adentro, aristas
// incluidas. Sobre un mapa donde las parcelas están pegadas a la calle y la
// calle está pegada a la acera, eso abre una costura por cada borde — que es
// exactamente el bug de «espacios vacíos» que la investigación describe y trata
// de tapar después con uniones booleanas o solapamiento intencional.
//
// La respuesta más barata es no crear el hueco: **se redondea la ESQUINA y las
// ARISTAS NO SE MUEVEN**. Se camina hacia atrás y hacia adelante sobre las dos
// aristas que llegan al vértice, se entra por un punto, se sale por el otro y
// se pasa el vértice como control de una cuadrática. El resto de cada arista
// queda EXACTAMENTE donde estaba, así que una parcela redondeada sigue tocando
// su calle en todo el largo del frente y sólo se despega en la esquina — donde
// asoma la acera que ya estaba pintada debajo, que es lo correcto y además lo
// que se ve bien.
//
// El radio se recorta a la mitad de la arista más corta que toca el vértice, de
// modo que dos esquinas seguidas nunca se comen la arista de en medio ni se
// cruzan entre sí.

/** Largo de la arista i..j de un arreglo plano. */
function edgeLen(pts, i, j) {
  return Math.hypot(pts[j] - pts[i], pts[j + 1] - pts[i + 1]);
}

/**
 * El contorno redondeado como LISTA DE ÓRDENES — `["M",x,y]`, `["L",x,y]`,
 * `["Q",cx,cy,x,y]`, `["Z"]`.
 *
 * Va separado de `roundedPath` por dos razones, y ninguna es estética. `Path2D`
 * NO EXISTE fuera del navegador, así que una geometría que sólo sabe fabricar
 * un `Path2D` no se puede comprobar en node — y la propiedad que hay que
 * comprobar aquí (que las aristas no se mueven) es precisamente la que decide
 * si aparecen costuras. Y una lista de órdenes es lo que un backend WebGL
 * futuro puede teselar, mientras que un `Path2D` es un callejón sin salida.
 *
 * @param {number[]} pts    plano `[x,y,…]`
 * @param {number}   radius radio máximo, en px de mundo
 * @param {boolean}  close  cerrar el contorno
 */
export function roundedOutline(pts, radius, close = true) {
  const n = pts.length / 2;
  const out = [];
  // Menos de un triángulo no tiene esquinas que redondear, y un radio de cero
  // es la petición explícita de no tocarlo.
  if (n < 3 || !(radius > 0)) {
    out.push(["M", pts[0], pts[1]]);
    for (let i = 2; i < pts.length; i += 2) out.push(["L", pts[i], pts[i + 1]]);
    if (close) out.push(["Z"]);
    return out;
  }
  const first = close ? 0 : 1;
  const last = close ? n : n - 1;
  let started = false;
  if (!close) { out.push(["M", pts[0], pts[1]]); started = true; }
  for (let k = first; k < last; k++) {
    const i = (k % n) * 2;
    const p = ((k - 1 + n) % n) * 2;
    const q = ((k + 1) % n) * 2;
    const inLen = edgeLen(pts, p, i) || 1;
    const outLen = edgeLen(pts, i, q) || 1;
    // EL RADIO SE RECORTA A MEDIA ARISTA por cada lado: sin esto, dos vértices
    // seguidos sobre una arista corta se comen el segmento entero y el contorno
    // se cruza consigo mismo — que en un relleno even-odd sale como un agujero.
    const r = Math.min(radius, inLen / 2, outLen / 2);
    const ax = pts[i] + (pts[p] - pts[i]) * (r / inLen);
    const ay = pts[i + 1] + (pts[p + 1] - pts[i + 1]) * (r / inLen);
    const bx = pts[i] + (pts[q] - pts[i]) * (r / outLen);
    const by = pts[i + 1] + (pts[q + 1] - pts[i + 1]) * (r / outLen);
    out.push(started ? ["L", ax, ay] : ["M", ax, ay]);
    started = true;
    out.push(["Q", pts[i], pts[i + 1], bx, by]);
  }
  if (close) out.push(["Z"]);
  else out.push(["L", pts[pts.length - 2], pts[pts.length - 1]]);
  return out;
}

/** Las mismas órdenes, en un `Path2D`. Lo que el pintor usa. */
export function roundedPath(pts, radius, close = true) {
  const path = new Path2D();
  for (const c of roundedOutline(pts, radius, close)) {
    if (c[0] === "M") path.moveTo(c[1], c[2]);
    else if (c[0] === "L") path.lineTo(c[1], c[2]);
    else if (c[0] === "Q") path.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    else path.closePath();
  }
  return path;
}

/**
 * Partir toda arista más larga que `maxLen`.
 *
 * El ruido desplaza VÉRTICES, así que una costa de cuatro puntos no tiene dónde
 * agarrarse por mucho ruido que se le pida: sale una línea recta ligeramente
 * torcida. Esto le da al desplazamiento la resolución que necesita, y se hace
 * UNA vez al construir la caché, no por cuadro.
 */
export function subdivide(pts, maxLen) {
  const out = [];
  const n = pts.length / 2;
  for (let k = 0; k < n; k++) {
    const i = k * 2, j = ((k + 1) % n) * 2;
    out.push(pts[i], pts[i + 1]);
    const len = edgeLen(pts, i, j);
    const steps = Math.floor(len / maxLen);
    for (let s = 1; s <= steps; s++) {
      const t = s / (steps + 1);
      out.push(pts[i] + (pts[j] - pts[i]) * t,
               pts[i + 1] + (pts[j + 1] - pts[i + 1]) * t);
    }
  }
  return out;
}

/**
 * Empujar cada vértice sobre su normal, por ruido. Devuelve un arreglo nuevo.
 *
 * **LA AMPLITUD LA MANDA EL RÁSTER, y quien llama tiene que respetarla.** La
 * casa ya decidió que *la arena dibujada ES la arena*: `sand_outlines` traza el
 * ráster terminado justamente para que el dibujo no mienta sobre dónde se puede
 * andar, después de que 8,5 % de las celdas de playa se pintaran con el tan de
 * la tierra y la costura se leyera como una raya recta bajando por la playa.
 *
 * Una costa ondulada 20 px diría que hay agua donde el colisionador dice tierra,
 * y el jugador chocaría con una pared invisible o navegaría sobre arena. Con
 * menos de una celda de ráster no puede mentir: el error queda por debajo de la
 * resolución con la que el mundo decide qué es qué. Ver `SHORE_JITTER_PX` en
 * quien lo llame.
 */
export function jitterAlongNormals(pts, amp, freq, noise) {
  const n = pts.length / 2;
  const out = new Array(pts.length);
  for (let k = 0; k < n; k++) {
    const i = k * 2;
    const p = ((k - 1 + n) % n) * 2, q = ((k + 1) % n) * 2;
    // La normal sale de la CUERDA entre los dos vecinos y no de una sola
    // arista: sobre una esquina, la normal de una arista apunta a un lado y la
    // de la otra al contrario, y el vértice saldría disparado en diagonal.
    const tx = pts[q] - pts[p], ty = pts[q + 1] - pts[p + 1];
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len, ny = tx / len;
    const d = noise(pts[i], pts[i + 1], freq) * amp;
    out[i] = pts[i] + nx * d;
    out[i + 1] = pts[i + 1] + ny * d;
  }
  return out;
}

/**
 * Varios anillos en un solo `Path2D`, cada uno redondeado.
 *
 * EL RELLENO ES EVEN-ODD y por eso los anillos van juntos: el residual del
 * Parque Marino tiene agujeros alrededor de los lotes de sus vecinos, y el
 * malecón son bandas con pellizcos. Rellenar anillo por anillo con non-zero
 * pinta cada agujero SÓLIDO — la playa ya perdió así 805 000 px² de agua
 * interior vestida de arena. Un camino, even-odd, y los agujeros siguen
 * siendo agujeros.
 */
export function roundedMultiPath(rings, radius) {
  const path = new Path2D();
  for (const ring of rings) {
    if (!ring || ring.length < 6) continue;
    for (const c of roundedOutline(ring, radius, true)) {
      if (c[0] === "M") path.moveTo(c[1], c[2]);
      else if (c[0] === "L") path.lineTo(c[1], c[2]);
      else if (c[0] === "Q") path.quadraticCurveTo(c[1], c[2], c[3], c[4]);
      else path.closePath();
    }
  }
  return path;
}
