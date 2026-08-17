// LOS SPRITES: un lugar puede USAR UNA IMAGEN en vez de dibujarse.
//
// Todo el arte de este juego es vectorial, y para casi todo eso es lo correcto —
// escala a cualquier zoom, pesa nada, y se puede editar campo por campo. Pero hay
// un caso que el vector no cubre y es el que importa acá: **un lugar CONCRETO que
// uno quiere que se vea como es**. La Catedral de Puntarenas no es «una catedral
// genérica del tamaño de su lote»: es ese edificio. Para eso una imagen dibujada
// a mano gana, y hasta hoy no había forma de ponerla.
//
// LAS REGLAS, y cada una está acá por una razón:
//
//   * **UN SPRITE ES UNA FILA DEL REGISTRO, no una ruta suelta.** `sprites.json`
//     dice qué imagen es, cuánto mide EN METROS y de qué punto cuelga. Una ruta
//     escrita en el catálogo de arte sería un archivo que nadie valida y que se
//     rompe en silencio cuando alguien lo mueve.
//   * **SE MIDE EN METROS**, como todo largo que dos runtimes comparten. Un
//     tamaño en píxeles sólo es verdad a la escala a la que se afinó, y este mundo
//     ya se reescaló tres veces — la última se llevó el centro cívico entero.
//   * **CARGA ASÍNCRONA, DIBUJO SÍNCRONO.** El intérprete no puede esperar: dibuja
//     el cuadro que tiene. Mientras la imagen no está, se pinta el `placeholder`
//     del registro, que es un color plano del tamaño correcto — así un sprite que
//     nunca carga se VE (un bloque liso donde debería estar el edificio) en vez de
//     dejar un hueco que parece que no había nada.
//   * **NO IMPORTA NADA.** Igual que `primitives.js`: el editor carga esto para su
//     vista previa, así que no puede arrastrar el juego. Y `Image` se toca de
//     forma perezosa y guardada, porque bajo Node no existe y el validador del
//     editor importa este módulo para preguntar qué sprites hay.
import SPRITES from "../../assets/sprites.json" with { type: "json" };

/** El registro, tal cual. El editor lo lee para ofrecer la lista. */
export const SPRITE_REGISTRY = SPRITES.sprites;
export const SPRITE_NAMES = Object.freeze(
  Object.keys(SPRITES.sprites).filter((k) => !k.startsWith("_")));

//: id -> HTMLImageElement | "loading" | "failed". Un `Map`, no un objeto, porque
//: se consulta una vez por sprite por cuadro y se escribe una vez en la vida.
const cache = new Map();

/**
 * La imagen de un sprite si ya está, o `null`.
 *
 * Nunca lanza y nunca espera. La primera llamada arranca la carga y devuelve
 * `null`; a partir del cuadro en que llegó, devuelve la imagen. Un sprite que
 * falla queda marcado y no se vuelve a pedir — si no, un 404 se reintentaría
 * sesenta veces por segundo.
 */
export function spriteImage(id) {
  const had = cache.get(id);
  if (had && had !== "loading" && had !== "failed") return had;
  if (had) return null;                      // cargando, o ya falló
  const rec = SPRITES.sprites[id];
  if (!rec || !rec.src) { cache.set(id, "failed"); return null; }
  // Bajo Node no hay `Image`, y este módulo se importa igual para preguntarle la
  // lista de sprites. Marcar y salir, en vez de reventar el import del editor.
  if (typeof Image === "undefined") { cache.set(id, "failed"); return null; }
  cache.set(id, "loading");
  const img = new Image();
  img.decoding = "async";
  img.onload = () => cache.set(id, img);
  img.onerror = () => cache.set(id, "failed");
  img.src = rec.src;
  return null;
}

/** ¿Ya se sabe que este sprite no va a llegar? Para que el dibujante decida. */
export function spriteFailed(id) { return cache.get(id) === "failed"; }

/** El registro de un sprite: `{src, wM, hM, anchor, placeholder}`. */
export function spriteRecord(id) { return SPRITES.sprites[id] || null; }

/** Solo para pruebas y para la vista previa del editor: olvidar lo cargado. */
export function resetSpriteCache() { cache.clear(); }
