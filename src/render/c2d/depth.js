// EL VOLUMEN — cómo un relleno plano se convierte en un cuerpo, sin salir de 2-D.
//
// Puro salvo por el registro: entra un contorno y un marco de cámara, sale
// geometría. Recibe `g` por parámetro como los demás intérpretes, así que un
// backend WebGL podría adoptarlo sin reescribir el dibujo.
//
// ## El paralaje, y por qué la rotación sale gratis
//
// Una cámara a plomo sobre el centro de la pantalla ve la tapa de un cuerpo
// desplazada HACIA AFUERA en proporción a lo excéntrico que esté: es el mismo
// pinhole de siempre, `desplazamiento = excentricidad · altura / alturaDeCámara`.
// Un edificio justo bajo la cámara se ve a plomo y no muestra pared; uno en la
// esquina de la pantalla enseña medio piso.
//
// Se calcula en píxeles de MUNDO y no de pantalla, y eso es lo que lo hace
// correcto bajo rotación: la cámara rota ALREDEDOR DE SU PROPIA POSICIÓN, así
// que la dirección radial en mundo es la misma dirección radial ya rotada en
// pantalla. No hay que tocar la afín de `camera.js` ni añadir un caso especial.
// (El Cocal es la única etapa rotada del juego, y es justo donde una fórmula
// escrita en espacio de pantalla se habría roto.)
//
// ## Las aristas de silueta sirven DOS VECES
//
// Qué paredes se ven y qué sombra tira un cuerpo son la misma pregunta con otro
// vector. Un cuerpo sólido proyecta el BARRIDO de su huella a lo largo del sol
// —base, copia corrida, y los costados que unen las dos—, y hasta hoy la sombra
// de un edificio era una COPIA de la huella corrida por `sunShadow`, que en un
// edificio alto se despega del cuerpo y deja un hueco entre los dos. La misma
// rutina que decide qué paredes mira la cámara decide qué costados tira la
// sombra; sólo cambia el vector que se le pasa.
import EFFECTS from "../../assets/effects.json" with { type: "json" };

const P = EFFECTS.parallax || {};

/** El área con signo dice el sentido de giro, y de ahí sale «hacia afuera». */
function signedArea(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += pts[i] * pts[j + 1] - pts[j] * pts[i + 1];
  }
  return a / 2;
}

/**
 * El desplazamiento de la tapa de un cuerpo de `heightM` metros en (x, y).
 *
 * Devuelve `{dx, dy}` en píxeles de mundo. Cero cuando el paralaje está apagado
 * o cuando el cuerpo cae justo bajo la cámara — que es correcto: se está viendo
 * a plomo. Quien llame tiene que aguantar el cero sin parpadear.
 */
export function parallaxOffset(cam, x, y, heightM, pxPerM) {
  const camH = P.cameraHeightM;
  if (!camH || !(heightM > 0)) return { dx: 0, dy: 0 };
  const ex = x - cam.x, ey = y - cam.y;
  const k = (heightM * pxPerM) / (camH * pxPerM);
  let dx = ex * k, dy = ey * k;
  // EL TOPE NO ES COSMÉTICO. Sin él, un edificio alto en la esquina de una
  // pantalla ancha se estira hasta despegarse de su propia huella y la pared
  // deja de leerse como pared. Se recorta el LARGO y no cada eje, o el tope
  // torcería la dirección.
  const cap = P.maxOffsetPx || 0;
  if (cap > 0) {
    const len = Math.hypot(dx, dy);
    if (len > cap) { dx = dx * cap / len; dy = dy * cap / len; }
  }
  return { dx, dy };
}

/**
 * Las aristas cuya normal exterior mira EN CONTRA de `(vx, vy)`.
 *
 * Para las paredes se pasa la dirección radial: un edificio a la derecha de la
 * pantalla se mira desde su izquierda, así que la pared que se ve es la del
 * lado del centro. Para la sombra se pasa el vector del sol INVERTIDO, que
 * selecciona los costados por donde el cuerpo se barre.
 *
 * Devuelve índices de vértice `i` (la arista es `i -> i+2`).
 */
export function facingEdges(pts, vx, vy) {
  const n = pts.length;
  // El signo del área dice el sentido de giro; sin esto, «afuera» sería
  // «adentro» en la mitad de los contornos y las paredes saldrían del lado
  // equivocado. Los anillos de agujero giran al revés a propósito.
  const s = signedArea(pts) >= 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    const ex = pts[j] - pts[i], ey = pts[j + 1] - pts[i + 1];
    // normal exterior de la arista, con el giro ya tenido en cuenta
    const nx = ey * s, ny = -ex * s;
    if (nx * vx + ny * vy < 0) out.push(i);
  }
  return out;
}

/**
 * Pintar el barrido de un contorno a lo largo de `(ox, oy)`: los costados que
 * unen la huella con su copia desplazada.
 *
 * Sirve para las dos cosas — las paredes de un cuerpo y la sombra de un sólido
 * — porque son la misma geometría con otro vector. Quien llama pone el color y
 * el orden; esto sólo pone los cuadriláteros.
 */
export function paintSweep(g, pts, ox, oy, edges) {
  if (!edges.length || (ox === 0 && oy === 0)) return;
  g.beginPath();
  const n = pts.length;
  for (const i of edges) {
    const j = (i + 2) % n;
    g.moveTo(pts[i], pts[i + 1]);
    g.lineTo(pts[j], pts[j + 1]);
    g.lineTo(pts[j] + ox, pts[j + 1] + oy);
    g.lineTo(pts[i] + ox, pts[i + 1] + oy);
    g.closePath();
  }
  g.fill();
}

/** El contorno corrido, como camino cerrado — la tapa del cuerpo. */
export function offsetPath(pts, ox, oy) {
  const path = new Path2D();
  path.moveTo(pts[0] + ox, pts[1] + oy);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i] + ox, pts[i + 1] + oy);
  path.closePath();
  return path;
}

/**
 * La clave de orden para pintar cuerpos con pared bajo el algoritmo del pintor.
 *
 * **No hay z-buffer y los edificios se pintan en orden de TILE**, así que una
 * pared que se extiende hacia el viewer taparía mal a su vecino. Con la cámara
 * a plomo sobre el centro, lo más excéntrico está más lejos en 3-D: se pinta
 * primero lo lejano y encima lo cercano, o sea **distancia radial DESCENDENTE**.
 * A lo largo de una línea radial el orden queda bien definido, que es donde el
 * solape ocurre; entre direcciones distintas los cuerpos casi no se pisan.
 *
 * Ordenar unas decenas de referencias por cuadro es ruido — el viewport encuadra
 * 160 m y los edificios enteros cuestan 0,21 ms.
 *
 * Devuelve la distancia al cuadrado NEGADA, para que un `sort` ascendente de
 * toda la vida dé el orden lejos->cerca sin que quien llama tenga que acordarse
 * de invertirlo.
 */
export function depthKey(cam, x, y) {
  const ex = x - cam.x, ey = y - cam.y;
  return -(ex * ex + ey * ey);
}
