// LA CÁMARA DE THREE, CONSTRUIDA DESDE EL MISMO MARCO QUE CANVAS.
//
// No hay una cámara nueva: `camera.js#beginCameraFrame` resuelve el encuadre
// (centro con sacudida, zoom, giro) UNA vez por cuadro y aquí se escribe la
// matriz que lleva el mismo suelo al mismo píxel. Espacio de Three:
//
//     (x, y, h)  —  x, y = píxeles de mundo (y hacia el SUR, como Canvas),
//                   h = altura en píxeles de mundo (metros · PX_PER_M).
//
// Para un punto a `d = (x − cx, y − cy)` del centro y altura `h`:
//
//     u = c·dx − s·dy                     (eje x de pantalla, en px de mundo)
//     v = s·dx + c·dy − tan(lean)·h       (eje y de pantalla: lo alto sube)
//     w = 1 − h / H                       (pinhole a H px sobre el suelo; H=∞ → 1)
//
//     pantalla = centro + zoom · (u, v) / w
//
// Con h = 0 queda `centro + zoom·R·d`, que es `cameraAffine` letra por letra:
// el suelo registra con Canvas y el volante no se entera. La profundidad es la
// distancia a lo largo del rayo de una ortográfica inclinada `lean` hacia el
// sur de la pantalla: más alto y más al sur = más cerca.
//
// ## Por qué la escena cuelga de un espejo
//
// (x, y-sur, h) es un espacio que, visto desde arriba con y hacia abajo en la
// pantalla, se ve ESPEJADO respecto de una cámara normal — y three decide qué
// cara es la de adelante por el giro en pantalla. `three/index.js` cuelga todo
// de una raíz con `scale.y = −1`: el contenido se autora en coordenadas de
// juego y el mundo de three queda (x, Y-norte, h), diestro y estándar; three ve
// el determinante negativo de cada malla y corrige el frente solo, así que una
// geometría de catálogo (un cilindro, un cono) sale bien sin pensar en esto.
// Esta matriz habla por lo tanto en (x, Y, h) con Y = −y.
const DEPTH_RANGE = 12000;

/**
 * Escribe la proyección en `cam` (un THREE.Camera con matrices manuales).
 * `frame` es el marco de `beginCameraFrame`; `leanRad` y `pinholePx` las
 * perillas de `view3d.js` ya en radianes y px.
 */
export function applyFrame(cam, frame, leanRad, pinholePx) {
  const c = Math.cos(frame.rotation), s = Math.sin(frame.rotation);
  const zx = (2 * frame.zoom) / frame.viewportWidth;
  const zy = (2 * frame.zoom) / frame.viewportHeight;
  const T = Math.tan(leanRad);
  const sinL = Math.sin(leanRad), cosL = Math.cos(leanRad);
  const invH = pinholePx > 0 ? 1 / pinholePx : 0;
  const cx = frame.x, cy = frame.y;
  // proyección de pantalla del centro: s·cx + c·cy (y) y c·cx − s·cy (x)
  const ox = c * cx - s * cy, oy = s * cx + c * cy;
  const R = DEPTH_RANGE;
  // clip = M · (x, y, h, 1); ndc = clip / clip.w
  // (columna de Y = −(columna de y): la raíz espejada, ver arriba)
  cam.projectionMatrix.set(
    zx * c, zx * s, 0, -zx * ox,
    -zy * s, zy * c, zy * T, zy * oy,
    -sinL * s / R, sinL * c / R, -cosL / R, sinL * oy / R,
    0, 0, -invH, 1,
  );
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  // Sin matriz de vista: la proyección ya habla en coordenadas de mundo.
  cam.matrixWorld.identity();
  cam.matrixWorldInverse.identity();
}

/**
 * Proyecta (x, y, h) de mundo a píxeles CSS con la misma cuenta que la matriz.
 * Para rótulos y marcadores HTML que tienen que pararse sobre algo alto.
 */
export function projectToScreen(frame, leanRad, pinholePx, x, y, h = 0) {
  const c = Math.cos(frame.rotation), s = Math.sin(frame.rotation);
  const dx = x - frame.x, dy = y - frame.y;
  const w = pinholePx > 0 ? 1 - h / pinholePx : 1;
  const u = c * dx - s * dy;
  const v = s * dx + c * dy - Math.tan(leanRad) * h;
  return [frame.viewportWidth / 2 + frame.zoom * u / w, frame.viewportHeight / 2 + frame.zoom * v / w];
}
