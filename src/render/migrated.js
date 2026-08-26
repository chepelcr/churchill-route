// QUIÉN DIBUJA QUÉ. Un solo dueño por clase de cosa.
//
// El mundo lo pinta más de un backend: Canvas2D para todo el aspecto
// publicado, una capa Pixi transparente para un par de estructuras, y la capa
// Three para el terreno y —desde el mundo 3-D— el volumen del pueblo. El modo
// de fallar de eso no es sutil y este repo ya lo vio una vez: DOS capas
// dibujando lo mismo, y entonces un edificio tiene un doble medio píxel
// corrido; o NINGUNA, y una clase entera de objeto deja de existir en silencio.
//
// Éste es el registro que lo decide, y es un REGISTRO y no un `if` en cada
// pintor porque la migración tiene que ser REVERSIBLE de a una clase: cambiar
// una llave acá mueve los edificios de backend, y la captura compara las dos
// corridas. Un pintor nunca pregunta «¿está el 3-D encendido?»; pregunta «¿esto
// es mío?».
//
// Las llaves son CLASES DE COSA, nunca archivos: `buildings` es toda huella
// emitida, la dibuje quien la dibuje.

/** Las capas que pueden ser dueñas de una clase de cosa. */
export const LAYER = Object.freeze({ CANVAS: "canvas", THREE: "three" });

// El juego 2-D es dueño de todo. Ésta es la configuración publicada hasta hoy
// y la línea base contra la que se diffea cualquier migración.
const CANVAS_ONLY = Object.freeze({
  buildings: LAYER.CANVAS,
  flora: LAYER.CANVAS,
  ground: LAYER.CANVAS,
});

// Qué toma cada modo Three. `empty`/`terrain`/`shadows` son las etapas de
// prueba D1-D3 y deliberadamente NO toman nada que Canvas ya pinte — por eso
// pudieron prometer cero píxeles cambiados sobre la península plana.
const BY_MODE = Object.freeze({
  empty: CANVAS_ONLY,
  terrain: CANVAS_ONLY,
  shadows: CANVAS_ONLY,
  // El mundo 3-D. El VOLUMEN pasa a Three —huellas extruidas con techo, sol
  // real, sombra proyectada— y Canvas deja de pintarlas en el mismo gesto. El
  // SUELO se queda en Canvas a propósito: es el arte pictórico que da el
  // aspecto del juego, y Three sólo le agrega la luz encima.
  world: { buildings: LAYER.THREE, flora: LAYER.THREE, ground: LAYER.CANVAS },
});

let owners = { ...CANVAS_ONLY };

/**
 * Resuelve la propiedad para un modo Three, con anulaciones por URL.
 *
 * `?own=buildings:canvas` devuelve UNA clase a Canvas sin tocar el resto de la
 * capa, que es como se bisecciona una regresión hasta una cosa migrada en vez
 * de hasta «la capa 3-D».
 */
export function resolveOwners(mode, search = "") {
  owners = { ...(BY_MODE[mode] || CANVAS_ONLY) };
  let params = null;
  try { params = new URLSearchParams(search); } catch { /* SSR/private mode */ }
  for (const pair of (params?.get("own") || "").split(",")) {
    const [key, layer] = pair.split(":");
    if (!key || !(key in owners)) continue;
    if (layer === LAYER.CANVAS || layer === LAYER.THREE) owners[key] = layer;
  }
  return { ...owners };
}

/** ¿Pinta `layer` la clase `key` en este cuadro? */
export function owns(layer, key) {
  return (owners[key] || LAYER.CANVAS) === layer;
}

/** La tabla entera, para diagnóstico y para la captura de prueba. */
export function currentOwners() {
  return { ...owners };
}
