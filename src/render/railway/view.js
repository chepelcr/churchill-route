// LA CÁMARA Y EL CUADRO.
//
// Una sola dueña de la cámara, como en la ciudad (`render/camera.js`), y por la
// misma razón: aquí hay DOS cosas que quieren moverla —seguir al tren y abrirse
// para que un rizo entre entero— y escritas en dos sitios se pelean por ella
// cada cuadro.
//
// Lo que la cámara hace, en orden de importancia:
//
//   * **ANCLA LA LOCOMOTORA, NO EL CONVOY.** A 0,34 del ancho queda el tren
//     entero por detrás y vía por delante. Centrada en la locomotora, los
//     vagones se salen de cuadro justo cuando empieza la cuesta que uno quería
//     ver venir.
//   * **SE ABRE PARA EL RIZO.** El lazo grande mide 54 m de alto: a 8 px/m no
//     cabe en 720 px. El zoom objetivo sale de `view.loopFitFraction` y se busca
//     con una exponencial, así que la apertura empieza `loops.cameraEaseM`
//     metros antes y no de golpe al cruzar la entrada.
//   * **SE ABRE CON LA VELOCIDAD.** Un poco, y es la sensación de velocidad: vale
//     más que cualquier estela dibujada.
import { atDistance, loopAt } from "../../game/railway/track.js";
import { paintBackdrop, sceneBlend } from "./backdrop.js";
import { paintWorld, updateSmoke } from "./world.js";
import { eraOf, paintEra } from "./era.js";

/** Un estado de cámara en reposo, listo para el primer cuadro. */
export function createCamera(game, w, h) {
  const cam = { x: 0, y: 0, zoom: 1, ready: false };
  frameCamera(cam, game, w, h, 1e9);
  return cam;
}

/** La cámara de este cuadro. `dt` grande = colocarse sin suavizado (el primer
 *  cuadro, y después de un cambio de tamaño). */
export function frameCamera(cam, game, w, h, dt) {
  const { run, track, sim } = { ...game, sim: game.run.sim };
  const V = sim.view;
  const ppm = V.pxPerM;
  const point = atDistance(track, run.distance);

  const loop = loopAt(track, run.distance, sim.loops.cameraEaseM);
  let zoom = 1 - V.speedPullBack * Math.max(0, Math.min(1, run.speed / run.stats.topSpeed));
  if (loop) {
    const need = (loop.radiusM * 2 + 12) * ppm;
    zoom = Math.min(zoom, (h * V.loopFitFraction) / need);
  }
  zoom = Math.max(V.minZoom, Math.min(V.maxZoom, zoom));

  const lead = V.aheadM * Math.max(0, Math.min(1, run.speed / run.stats.topSpeed));
  const targetX = (point.x + lead) * ppm;
  const targetY = point.y * ppm;
  const easeZoom = 1 - Math.exp(-dt * V.zoomEasePerS);
  const ease = 1 - Math.exp(-dt * V.easePerS);
  cam.zoom += (zoom - cam.zoom) * easeZoom;
  // La ancla se aplica DESPUÉS del suavizado del zoom, o el tren se desliza por
  // el cuadro mientras la cámara se abre: el mismo punto del mundo cae en otro
  // píxel a cada paso del zoom.
  const wantX = targetX + (0.5 - V.anchorX) * w / cam.zoom;
  const wantY = targetY - (V.anchorY - 0.5) * h / cam.zoom;
  cam.x += (wantX - cam.x) * ease;
  cam.y += (wantY - cam.y) * ease;
  cam.point = point;
  cam.ppm = ppm;
  return cam;
}

/**
 * Un cuadro completo: fondo, mundo, convoy y humo. El HUD lo pone React.
 *
 * NO TOCA LA TRANSFORMACIÓN NI BORRA EL LIENZO: el dueño de la superficie es
 * quien llama. Reponiendo `setTransform` acá —que es lo que hacía— el pintor
 * ignoraba el `translate` y el `clip` de la hoja de arte y pintaba los ocho
 * tramos encima del mismo rincón, que en la hoja se lee como ocho recuadros en
 * blanco. Es la misma lección que ya tiene escrita `paintAt`: una superficie por
 * defecto es un error con forma de "no pasó nada".
 */
export function drawRailway(g, game, cam, w, h, t, extra = {}) {
  const { run, map, track, consist } = game;
  const sim = run.sim;
  const art = game.art;
  const blend = sceneBlend(map, cam.point.x, sim.scenes.crossfadeM);
  // La altura del tren respecto al MEDIO del nivel, no su `y` del mundo: ver
  // `_yParallax` en railway-art.json.
  const midY = (track.minY + track.maxY) / 2;
  paintBackdrop(g, art, w, h, {
    a: blend.a, b: blend.b, blend: blend.blend,
    camX: cam.x * cam.zoom, camY: (cam.point.y - midY) * cam.ppm * cam.zoom, t,
  });
  paintWorld(g, {
    art, map, track, run, consist, blend, t,
    camX: cam.x, camY: cam.y, zoom: cam.zoom, w, h, ppm: cam.ppm,
    smoke: extra.smoke,
    stationName: extra.stationName,
  });
  // LA ÉPOCA VA AL FINAL, sobre el cuadro ya pintado — incluido el convoy. Es
  // una foto de 1910 o no lo es; bañar el paisaje y dejar el tren a todo color
  // sería lo peor de los dos.
  paintEra(g, eraOf(art, map.level), w, h);
  return blend;
}

/** Avanza el penacho. Vive fuera de `drawRailway` porque el humo es ESTADO y un
 *  cuadro que se repinta (una pausa, una captura) no debe producir más humo. */
export function stepSmoke(state, game, dt) {
  const { run, track, consist } = game;
  const stack = consist[0].record.stackM;
  if (!stack) return state;
  const point = atDistance(track, run.distance);
  updateSmoke(state, run, dt, point, stack, run.sim.view.pxPerM);
  return state;
}
