// EL COLOR DE UN EDIFICIO SALE DE LO QUE EL EDIFICIO ES.
//
// El motor de `src/assets/building-styles.json`. Una huella con nombre recibía
// del build `BLDG_PALETTE[rng()]` — estable por su id, pero sin relación con el
// lugar: un hotel, una iglesia, una soda y una bodega salían del mismo bombo.
//
// La llave ya viajaba en el mundo emitido y no la usaba nadie: `cat`. Y NO es
// la etiqueta `building`, que es la que uno buscaría primero — de las 635
// huellas con nombre de esta ventana, 571 dicen `building=yes`. La categoría
// real vive en `amenity`/`shop`/`tourism`/`office`, que es lo que `poi_category`
// ya resuelve del lado del build.
//
// Se resuelve ACÁ y no en el build a propósito: `cat` ya está emitido, así que
// reteñir el puerto entero es editar el registro y recargar, no reconstruir el
// mundo. Y el `color` emitido sigue siendo el respaldo, de modo que un edificio
// sin categoría se ve exactamente como antes — que es lo que hace esta
// migración demostrable.
import STYLES from "../../assets/building-styles.json" with { type: "json" };
import { hash01 } from "./gfx.js";

const BY_CAT = STYLES.byCat || {};
const BY_ID = STYLES.byId || {};

//: Un color de la lista, ELEGIDO POR EL ID y no por azar de cuadro. Dos sodas
//: vecinas no pueden salir del mismo color y ninguna puede cambiar de color al
//: volver a mirarla, que es lo que pasaría con `Math.random()`.
function pick(list, seed) {
  if (!list || !list.length) return null;
  return list[Math.floor(hash01(seed) * list.length) % list.length];
}

/**
 * El estilo de este edificio, o `null` si no tiene ninguno.
 *
 * `byId` gana sobre `byCat`: es para el edificio que la gente reconoce POR su
 * color. Corregir una categoría equivocada no es trabajo de acá — eso se
 * arregla en OSM.
 */
export function buildingStyle(b) {
  const st = (b.osmId != null && BY_ID[String(b.osmId)]) || BY_CAT[b.cat];
  if (!st) return null;
  // La semilla es el id de OSM cuando lo hay; si no, la primera esquina, que es
  // lo único estable que tiene una huella sintética.
  const seed = b.osmId != null ? Number(b.osmId) : (b.pts[0] * 13.7 + b.pts[1] * 7.3);
  return {
    color: st.walls ? pick(st.walls, seed) : null,
    roof: st.roofs ? pick(st.roofs, seed * 1.61 + 11) : null,
    wnd: st.wnd,
  };
}
