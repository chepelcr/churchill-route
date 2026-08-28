// CADA BARRIO SE VE COMO ÉL MISMO.
//
// Los doce distritos viajan en el manifest desde siempre —`id`, `name`, `tone`
// y su polígono— y el renderer los usaba para exactamente dos cosas: un
// contorno de depuración y la píldora con el nombre de la calle. El puerto
// entero se pintaba con una sola paleta, así que El Cocal (arenoso, de palmera
// y casa de madera), el Paseo (pasteles de balneario), el Centro (denso, zinc)
// y Esparza (pueblo moderno de bloque) salían del mismo bombo.
//
// ## Dos cosas que este archivo NO hace, y por qué
//
// **No resuelve qué distrito manda en un punto.** `W.districtAt(x, y)` ya lo
// hace, y hace más de lo que uno escribiría: primero prueba los polígonos
// AUTORADOS en el editor y sólo después cae al centroide más cercano. Escribir
// un segundo resolvedor aquí es la deriva que este repo ya pagó cuando el
// editor pintaba un `park` de un verde y el juego de otro.
//
// **No pinta.** Devuelve la anulación de paleta y se acabó; quien dibuja sigue
// siendo el pintor de siempre. Un módulo que además pintara tendría que saber
// de edificios, de suelo y de flora a la vez.
//
// ## La caché no es una optimización tardía
//
// `districtAt` recorre doce centroides y N polígonos autorados. Preguntarlo por
// edificio y por cuadro son cientos de pruebas para una respuesta que **no
// puede cambiar**: un edificio no se muda. Así que se guarda en el objeto, con
// la misma convención con la que `structures.js` guarda `b._path` y `cache.js`
// guarda los suyos.
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { hash01 } from "./primitives.js";

const BY_DISTRICT = MATERIALS.districts || {};

//: Un color de la lista ELEGIDO POR EL ID, nunca al azar — la misma regla, y
//: por la misma razón, que `buildingStyle.pick`.
function pick(list, seed) {
  if (!list || !list.length) return null;
  return list[Math.floor(hash01(seed) * list.length) % list.length];
}

/** El id del distrito que contiene (x, y), cacheado en `obj`. */
export function districtOf(obj, x, y) {
  if (obj && obj._district !== undefined) return obj._district;
  const d = W.districtAt(x, y);
  const id = d ? d.id : null;
  if (obj) obj._district = id;
  return id;
}

/**
 * La anulación de este distrito, o `null`.
 *
 * **SIN ANULACIÓN, TODO SE VE COMO HOY.** Es lo que hace la migración
 * demostrable barrio por barrio: se autora El Cocal, se mira El Cocal, y el
 * resto del puerto queda intacto para comparar. Un registro que obligara a
 * describir los doce antes de ver el primero se habría quedado a medias.
 */
export function districtStyle(id) {
  return (id && BY_DISTRICT[id]) || null;
}

/**
 * El estilo de edificio del distrito donde cae esta huella, en la MISMA forma
 * que devuelve `buildingStyle` — `{color, roof, wnd}` —, o `null`.
 *
 * Devolver la forma del registro (`{walls, roofs}`) en vez de la del pintor
 * sería dejarle a quien llama la tarea de elegir un color de una lista, y esa
 * elección no es libre: tiene que ser **por el id de la huella**, o dos casas
 * vecinas salen del mismo color y ninguna se queda quieta entre cuadros. Es la
 * misma regla que `buildingStyle` ya escribió, así que se cumple aquí y no se
 * reparte.
 */
export function districtBuildingStyle(b) {
  const cx = b.aabb ? (b.aabb.x0 + b.aabb.x1) / 2 : b.pts[0];
  const cy = b.aabb ? (b.aabb.y0 + b.aabb.y1) / 2 : b.pts[1];
  const st = districtStyle(districtOf(b, cx, cy));
  const spec = st && st.building;
  if (!spec) return null;
  const seed = b.osmId != null ? Number(b.osmId) : (b.pts[0] * 13.7 + b.pts[1] * 7.3);
  return {
    color: pick(spec.walls, seed),
    roof: pick(spec.roofs, seed * 1.61 + 11),
    wnd: spec.wnd,
  };
}
