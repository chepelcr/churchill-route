// LA VÍA: UNA CURVA MUESTREADA, NO UN PERFIL.
//
// Casi todo el recorrido es una función de la x — el tablero sube y baja sobre
// el corredor — y por eso daba la tentación de guardarlo como un perfil y
// preguntarle la altura a cada x. El rizo lo prohíbe: dentro del lazo hay
// CUATRO alturas para la misma x y el tren pasa por todas. Así que la vía es lo
// que de verdad es, una curva paramétrica por longitud de arco, y todo lo que
// el juego pregunta —dónde está el tren, con qué ángulo, qué pendiente siente—
// se pregunta en metros recorridos y nunca en x.
//
// Dos cosas que se aprendieron escribiéndolo:
//
//   * **EL ÁNGULO DEL RIZO ES ANALÍTICO Y DA VUELTA ENTERA.** Derivado de los
//     vecinos con `atan2` sale acotado a (-π/2, π/2) y el tren se endereza al
//     pasar la cima en vez de ponerse boca abajo. Guardamos el ángulo del
//     parámetro (0 → -2π en el lazo) e interpolamos por el arco más corto, que
//     es lo mismo que hace la cámara de la ciudad con `cam.rot`.
//   * **LA PENDIENTE QUE SIENTE LA FÍSICA SE MIDE SOBRE UN LARGO.** En el punto
//     exacto, cada vértice del perfil muestreado da un tirón y el tren vibra en
//     una recta. `gradeAt` mide sobre `physics.gradeSmoothM`, que es el largo de
//     un bogie.

const TAU = Math.PI * 2;

/** Dónde empieza y termina la vía dibujable, en metros del eje de juego. */
const EDGE_M = 26;

/**
 * Muestrea la vía completa de un nivel ya mapeado.
 *
 * @param {object} map        la salida de `buildLevelMap`
 * @param {object} [options]
 * @param {number} [options.sampleM]  paso del muestreo recto
 * @param {number} [options.loopSteps] muestras por rizo
 */
export function buildTrack(map, { sampleM = 2.5, loopSteps = 120 } = {}) {
  const points = [];
  const loops = [];
  let distance = 0;

  const push = (x, y, angle) => {
    const last = points.at(-1);
    if (last) distance += Math.hypot(x - last.x, y - last.y);
    points.push({ x, y, angle, s: distance });
    return points.at(-1);
  };

  const straight = (fromX, toX) => {
    const span = toX - fromX;
    if (span <= 0) return;
    const steps = Math.max(1, Math.round(span / sampleM));
    for (let i = 1; i <= steps; i++) {
      const x = fromX + (span * i) / steps;
      const y = map.deckY(x);
      const prev = points.at(-1);
      push(x, y, Math.atan2(y - prev.y, x - prev.x));
    }
  };

  const startX = -EDGE_M;
  push(startX, map.deckY(startX), 0);

  for (const loop of map.loops) {
    straight(points.at(-1).x, loop.entryX);
    const entry = points.at(-1);
    const r = loop.radiusM;
    // El centro queda R por encima del punto de entrada (-y es arriba) y el
    // parámetro corre 0 → 2π: derecha, arriba, cima, izquierda, vuelta al
    // punto de entrada. El ángulo del tren es -φ, que es la tangente.
    const first = points.length;
    for (let i = 1; i <= loopSteps; i++) {
      const phi = (TAU * i) / loopSteps;
      push(entry.x + r * Math.sin(phi), entry.y - r + r * Math.cos(phi), -phi);
    }
    loops.push({
      ...loop,
      centerX: entry.x,
      centerY: entry.y - r,
      sIn: entry.s,
      sOut: points.at(-1).s,
      sTop: points[first + Math.round(loopSteps / 2) - 1].s,
      firstIndex: first,
    });
    straight(points.at(-1).x, loop.playX1);
  }
  straight(points.at(-1).x, map.playTotalM + EDGE_M);

  const finishS = sAtX(points, map.playTotalM);
  return {
    points,
    loops,
    length: distance,
    startS: sAtX(points, 0),
    finishS,
    minY: points.reduce((n, p) => Math.min(n, p.y), Infinity),
    maxY: points.reduce((n, p) => Math.max(n, p.y), -Infinity),
  };
}

/** El primer punto cuya x pasa de `x` — sólo para los hitos del eje de juego,
 *  que están todos fuera de los rizos. */
function sAtX(points, x) {
  for (let i = 1; i < points.length; i++) {
    if (points[i].x >= x && points[i - 1].x <= x) {
      const span = points[i].x - points[i - 1].x || 1;
      const t = (x - points[i - 1].x) / span;
      return points[i - 1].s + (points[i].s - points[i - 1].s) * t;
    }
  }
  return points.at(-1).s;
}

/** Posición y ángulo del tren a `s` metros recorridos. */
export function atDistance(track, s) {
  const pts = track.points;
  const d = Math.max(0, Math.min(s, track.length));
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].s < d) lo = mid + 1; else hi = mid;
  }
  const b = pts[lo], a = pts[Math.max(0, lo - 1)];
  const span = b.s - a.s || 1;
  const t = (d - a.s) / span;
  // Arco más corto: dentro de un rizo `b.angle - a.angle` puede ser casi -2π.
  const delta = Math.atan2(Math.sin(b.angle - a.angle), Math.cos(b.angle - a.angle));
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    angle: a.angle + delta * t,
    index: lo,
  };
}

/**
 * La pendiente que siente la física: dy/ds medido sobre `window` metros.
 *
 * Positivo = bajando (y crece hacia abajo), que es el signo con el que la
 * gravedad entra directa en la aceleración a lo largo de la vía.
 */
export function gradeAt(track, s, window = 14) {
  const half = window / 2;
  const a = atDistance(track, s - half);
  const b = atDistance(track, s + half);
  const ds = Math.hypot(b.x - a.x, b.y - a.y);
  if (ds < 1e-6) return 0;
  return (b.y - a.y) / ds;
}

/** El rizo que contiene `s`, o null. Lo pregunta la física (sostén de pestaña)
 *  y lo pregunta la cámara (abrirse para que el lazo entre en cuadro). */
export function loopAt(track, s, easeM = 0) {
  for (const loop of track.loops) {
    if (s >= loop.sIn - easeM && s <= loop.sOut + easeM) return loop;
  }
  return null;
}
