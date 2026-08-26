// LA SOMBRA SIGUE AL SOL — una respuesta, no diecinueve.
//
// Antes había **19 desplazamientos fijos** repartidos en cuatro archivos: cada
// peatón (`ellipse(pe.x + 1, pe.y + 5, …)`), los barcos, la boya, el banco del
// estero, la caseta del muelle, el ferry, la placa de un hito, y todo edificio
// del mundo con `ctx.translate(4, 4)`. Abajo y a la derecha, a las tres de la
// tarde y a las seis de la tarde igual. Los árboles ya seguían al sol desde que
// el cielo se volvió un continuo, y eso dejaba la escena partida en dos: los
// árboles con la hora correcta y todo lo demás con una hora inventada.
//
// **Y ES LO QUE HACE EL 2.5D.** Lo que vende la profundidad no es el ángulo sino
// el LARGO, y el largo es proporcional a la ALTURA: si un peatón y una bodega
// tiran la misma sombra la escena se aplana. De ahí que esto reciba una altura en
// METROS y no un desplazamiento en píxeles.
//
// Los números viven en `effects.json` -> `sunShadow`, y son los que `plantShadow`
// ya usaba con los árboles: la única parte de todo esto que llevaba meses
// viéndose bien, así que se generalizó en vez de inventar otra.
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { PX_PER_M } from "../../domain/units.js";
import { sunShadow2 } from "../sun.js";

const SUN = EFFECTS.sunShadow;
const BH = EFFECTS.buildingHeight;

/**
 * Dónde cae la sombra de algo de `heightM` metros, y con qué fuerza.
 *
 * Devuelve `{dx, dy, alpha}` en PÍXELES del mundo. El llamador decide la forma —
 * una elipse bajo una copa, la silueta de un casco, la huella de un edificio —
 * porque la forma es lo único que de verdad es distinto entre ellos.
 */
export function sunShadow(heightM) {
  // El adaptador vive junto a `sunDirection3`: consume su reach/alpha, y sólo
  // conserva acá el orden IEEE-754 del arte histórico para que el cambio de
  // autoridad siga siendo un diff de CERO píxeles.
  return sunShadow2(heightM, PX_PER_M);
}

/**
 * CUÁN ALTO ES UN EDIFICIO, en metros — inferido, porque nada lo sabe.
 *
 * Un edificio emitido lleva `pts`, `color`, `roof` y `wnd`. Medido sobre el mundo
 * publicado, **10 de 45 218 traen la etiqueta `building` de OSM y 9 de ésas dicen
 * `yes`**: no es que no se haya querido usarla, es que no está. Lo que sí hay es
 * la HUELLA, y en un puerto de una y dos plantas el área es la mejor señal
 * disponible — una casa son ~90 m² y la plaza del mercado 11 000.
 *
 * `wnd` termina de decidir: sin ventanas emitidas es un galpón o una bodega, y
 * ésos son anchos y bajos.
 */
export function buildingHeightM(b) {
  const a = b.aabb;
  if (!a) return BH.storeyM;
  const areaM2 = ((a.x1 - a.x0) * (a.y1 - a.y0)) / (PX_PER_M * PX_PER_M);
  let storeys = BH.bands[BH.bands.length - 1].storeys;
  for (const band of BH.bands) {
    if (band.maxAreaM2 == null || areaM2 <= band.maxAreaM2) { storeys = band.storeys; break; }
  }
  const h = storeys * BH.storeyM;
  return b.wnd ? h : h * BH.windowlessScale;
}

/** El color de la sombra, con su alpha ya resuelto. */
export function shadowInk(alpha, scale = 1) {
  return `rgba(${SUN.color},${(alpha * scale).toFixed(3)})`;
}

/**
 * LA SOMBRA DE UNA FIGURA DE PIE — un peatón, un vendedor, un perro.
 *
 * **`fx`/`fy` NO son la dirección del sol, son los PIES**, y confundirlos era la
 * trampa de esta migración. `ellipse(pe.x + 1, pe.y + 5, …)` no ponía la sombra
 * «abajo y a la derecha» por el sol: el `+5` la pone A LOS PIES, porque la figura
 * se dibuja desde su centro. Cambiar ese desplazamiento por uno solar le habría
 * sacado la sombra de los pies a todos los peatones del mundo.
 *
 * Así que la sombra es el ancla de los pies MÁS el corrimiento del sol, y sólo el
 * segundo se mueve con la hora. Para alguien de 1,70 m ese corrimiento va de
 * medio píxel al mediodía a cuatro al atardecer: poco, y es lo correcto — una
 * persona no tira la sombra de una bodega.
 */
export function figureShadow(g, x, y, rx, ry, ink, heightM = SUN.figureHeightM) {
  const sh = sunShadow(heightM);
  const prev = g.globalAlpha;
  g.globalAlpha = prev * sh.alpha;
  g.fillStyle = ink;
  g.beginPath();
  g.ellipse(x + sh.dx, y + sh.dy, rx, ry, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = prev;
}
