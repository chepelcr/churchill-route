// LOS MATERIALES — una superficie deja de ser UN SOLO HEX.
//
// Hasta hoy el mundo entero se pintaba con relleno sólido: `materials.json` y
// `surfaces.json` juntan ~266 colores planos y en todo el repositorio no había
// **ni una sola llamada a `createPattern`**. Con eso el asfalto, la arena, el
// césped y la acera se distinguen por su tono y por nada más, y a la escala a
// la que se juega una manzana entera es una mancha lisa del tamaño de la
// pantalla. Lo que le falta a un tapete de ciudad para leerse como suelo no es
// otro color: es GRANO.
//
// ## El grano va aparte del color, y eso es la mitad del diseño
//
// Un patrón podría traer su propio fondo, y sería un error. El color de este
// mundo NO ES FIJO: `weatherColors()` lo mezcla entre dos fases del cielo cada
// cuadro, y `surfaces.json` da un tono de día y otro de noche. Un patrón con
// fondo tendría que regenerarse con cada paso de esa mezcla —64 por transición,
// por superficie— y la caché no serviría de nada.
//
// Así que **la textura es SÓLO la tinta, sobre transparente**, y se dibuja
// ENCIMA del relleno de siempre. Tres consecuencias, y las tres importan:
//
//   * la clave de caché es `nombre@escala` y nada más — el color es libre;
//   * la textura hereda el clima y la hora sin saber que existen;
//   * **sin textura, el cuadro sale EXACTAMENTE como antes.** Es lo que hace la
//     migración demostrable superficie por superficie: se autora la arena, se
//     mira la arena, y el resto del puerto queda intacto para comparar.
//
// ## Por qué se pre-renderiza a un canvas, y por qué la clave lleva la escala
//
// Es la lección que `nightlights.js` ya dejó escrita: con miles de elementos
// **hay que blitear, no generar**. Un `createRadialGradient` por lámpara y por
// cuadro es lo que hacía inviable el alumbrado completo; unos cientos de motas
// por cuadro y por superficie serían lo mismo. Se dibuja el mosaico UNA vez a
// un canvas fuera de pantalla y de ahí en adelante es un `CanvasPattern`.
//
// La escala entra en la clave porque el mosaico se mide en píxeles de MUNDO
// —una mota de arena tiene un tamaño real y tiene que quedarse pegada al
// suelo— pero se rasteriza en píxeles de PANTALLA. Renderizarlo a 1x y
// estirarlo lo deja borroso justo cuando el jugador se acerca. Se rasteriza a
// la escala del cuadro y se compensa con `setTransform`, así que el grano
// mantiene su tamaño en metros y su nitidez en pantalla a la vez. La escala se
// cuantiza en cuartos para que la caché no tenga una entrada por zoom posible.
//
// ## Y el ruido se siembra en `hash01`
//
// La misma razón que ya está escrita en `noise.js`: un mosaico sembrado con
// `Math.random` sale distinto cada vez que se reconstruye —al cambiar de zoom,
// al volver de una pausa— y el suelo PARPADEA. Un hash da el mismo mosaico
// siempre.
import MATERIALS from "../../assets/materials.json" with { type: "json" };
import { alphaColor, hash01 } from "./primitives.js";

const TEXTURES = MATERIALS.textures || {};

//: El mosaico ya rasterizado, por `nombre@escala`.
const cache = new Map();
//: Un tope, porque la escala cambia con el zoom y con el tamaño de la ventana.
//: Sin él, redimensionar la ventana despacio deja una entrada por paso.
const CACHE_MAX = 32;

//: Una secuencia determinista a partir de una semilla — el equivalente de un
//: `Math.random()` que se puede repetir. Cada mosaico siembra la suya con el
//: nombre, así que dos texturas nunca salen con las motas en el mismo sitio.
function seq(seed) {
  let n = seed;
  return () => hash01(n++ * 0.7325 + seed * 0.011);
}

function seedOf(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 100003;
  return h + 1;
}

function lerp(a, b, k) { return a + (b - a) * k; }

//: Un rango del registro — `[min, max]` o un número suelto.
function span(v, rnd) {
  if (Array.isArray(v)) return lerp(v[0], v[1], rnd());
  return v || 0;
}

/**
 * Dibujar `draw` en (x, y) y también en sus copias envueltas.
 *
 * **UN MOSAICO QUE NO SE ENVUELVE TIENE COSTURAS**, y a este zoom son rayas
 * rectas cada 60 px cruzando toda la playa — exactamente el defecto que la casa
 * ya persiguió cuando el 8,5 % de la arena se pintaba con el tan de la tierra.
 * Un elemento a menos de su propio radio del borde asoma por el lado contrario,
 * así que se dibuja otra vez corrido un mosaico entero. Se prueban las ocho
 * vecindades sólo cuando hace falta; en el caso común es un solo dibujo.
 */
function wrapDraw(g, x, y, r, tile, draw) {
  draw(x, y);
  const left = x < r, right = x > tile - r;
  const top = y < r, bottom = y > tile - r;
  if (left) draw(x + tile, y);
  if (right) draw(x - tile, y);
  if (top) draw(x, y + tile);
  if (bottom) draw(x, y - tile);
  if (left && top) draw(x + tile, y + tile);
  if (right && top) draw(x - tile, y + tile);
  if (left && bottom) draw(x + tile, y - tile);
  if (right && bottom) draw(x - tile, y - tile);
}

//: EL GRANO: motas pequeñas. La arena, el árido del asfalto, el poro del
//: concreto. Es el verbo más barato y el que más suelo cubre.
function paintSpeckle(g, spec, tile, rnd) {
  const inks = spec.inks || [];
  if (!inks.length) return;
  const count = spec.count || 0;
  for (let i = 0; i < count; i++) {
    const x = rnd() * tile, y = rnd() * tile;
    const r = span(spec.r, rnd);
    const ink = inks[Math.floor(rnd() * inks.length) % inks.length];
    g.fillStyle = alphaColor(ink.rgb, ink.a);
    wrapDraw(g, x, y, r, tile, (px, py) => {
      g.beginPath();
      g.arc(px, py, r, 0, Math.PI * 2);
      g.fill();
    });
  }
}

//: LA BRIZNA: trazos cortos, casi todos en la misma dirección. Es lo que hace
//: que un verde plano se lea como césped y no como fieltro — y por eso lleva
//: `jitter`: un pasto con TODAS las briznas paralelas se lee como pana.
function paintHatch(g, spec, tile, rnd) {
  const inks = spec.inks || [];
  if (!inks.length) return;
  const count = spec.count || 0;
  const base = spec.ang || 0;
  g.lineCap = "round";
  g.lineWidth = spec.width || 1;
  for (let i = 0; i < count; i++) {
    const x = rnd() * tile, y = rnd() * tile;
    const len = span(spec.len, rnd);
    const ang = base + (rnd() - 0.5) * 2 * (spec.jitter || 0);
    const dx = Math.cos(ang) * len, dy = Math.sin(ang) * len;
    const ink = inks[Math.floor(rnd() * inks.length) % inks.length];
    g.strokeStyle = alphaColor(ink.rgb, ink.a);
    wrapDraw(g, x, y, len, tile, (px, py) => {
      g.beginPath();
      g.moveTo(px - dx / 2, py - dy / 2);
      g.lineTo(px + dx / 2, py + dy / 2);
      g.stroke();
    });
  }
}

const VERBS = { speckle: paintSpeckle, hatch: paintHatch };

/** Los verbos que este intérprete implementa — para el validador del editor y
 *  para la prueba, que preguntan en vez de guardarse una copia de la lista. */
export const TEXTURE_KINDS = Object.keys(VERBS);

/** Los nombres que el registro trae, sin las llaves de nota. */
export function textureNames() {
  return Object.keys(TEXTURES).filter((k) => !k.startsWith("_"));
}

function build(name, spec, q) {
  const tile = spec.tile || 64;
  const size = Math.max(2, Math.round(tile * q));
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  // Se dibuja en coordenadas de MUNDO y el canvas lleva la escala, así que el
  // registro se autora una sola vez y sirve a cualquier zoom.
  g.scale(size / tile, size / tile);
  const verb = VERBS[spec.kind];
  if (verb) verb(g, spec, tile, seq(seedOf(name)));
  return cv;
}

/**
 * El `CanvasPattern` de una textura, o `null`.
 *
 * `worldToDevice` es cuántos píxeles de dispositivo mide hoy un píxel de mundo
 * — o sea `zoom · dpr`. Quien llama lo sabe; este archivo no importa ni la
 * cámara ni el estado, que es lo que lo deja utilizable por una hoja de arte y
 * por el editor.
 *
 * **`null` es una respuesta legítima** y quien llama tiene que aguantarla sin
 * ramificar el dibujo: una superficie sin textura autorada, un registro con un
 * verbo que este intérprete no implementa, o un navegador sin `DOMMatrix` se
 * pintan con su hex de siempre. Eso no es degradación: es el mundo de ayer.
 */
export function textureFor(g, name, worldToDevice) {
  const spec = TEXTURES[name];
  if (!spec || spec.off || !VERBS[spec.kind]) return null;
  if (typeof DOMMatrix === "undefined") return null;
  const q = Math.max(0.25, Math.min(6, Math.round((worldToDevice || 1) * 4) / 4));
  const key = `${name}@${q}`;
  let entry = cache.get(key);
  if (!entry) {
    if (cache.size >= CACHE_MAX) cache.clear();
    const canvas = build(name, spec, q);
    entry = { canvas, tile: spec.tile || 64, pattern: null, ctx: null };
    cache.set(key, entry);
  }
  // EL `CanvasPattern` TAMBIÉN SE CACHEA, no sólo el mosaico. Un techo se pinta
  // por edificio, así que fabricar el patrón dentro de `overlayTexture` son
  // sesenta `createPattern` + sesenta `setTransform` por cuadro para sesenta
  // dibujos — MEDIDO: 2,2 ms de los 16,7 que dura el cuadro, y todo en montaje.
  // Se guarda con el contexto que lo emitió porque un patrón pertenece al suyo:
  // la hoja de arte y el editor pintan en otro canvas y tienen que rehacerlo.
  if (!entry.pattern || entry.ctx !== g) {
    const pattern = g.createPattern(entry.canvas, "repeat");
    if (!pattern) return null;
    // De vuelta a píxeles de mundo: el mosaico se rasterizó a `q` píxeles por
    // cada uno. Sin esto el grano crecería con el zoom en vez de quedarse
    // pegado al suelo, que es la diferencia entre una textura y un papel tapiz.
    const s = entry.tile / entry.canvas.width;
    pattern.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0]));
    entry.pattern = pattern;
    entry.ctx = g;
  }
  return entry.pattern;
}

/**
 * Rellenar con color y, si la hay, pasarle la textura por encima.
 *
 * `fill()` lo pone quien llama porque sólo él sabe la regla de relleno y la
 * forma — un `Path2D` even-odd, un `fillRect`, un trazo. Aquí sólo se decide
 * el estilo y se ejecuta dos veces.
 */
export function overlayTexture(g, name, worldToDevice, fill) {
  const tex = textureFor(g, name, worldToDevice);
  if (!tex) return;
  const prev = g.fillStyle;
  g.fillStyle = tex;
  fill();
  g.fillStyle = prev;
}


// ============================================================================
// EL SEGUNDO CAMINO: LA MANCHA, QUE NO PUEDE SER UN PATRÓN
//
// **UN RELLENO CON PATRÓN CUESTA ~10 ns POR PÍXEL, Y ESO ESTÁ MEDIDO.** Con el
// perfilador del juego, en el Centro a 1280x720 y con todo lo demás apagado:
//
//     sin texturas          17.32 ms de cuadro
//     sólo la arena         17.08   (una franja de playa: gratis)
//     sólo el asfalto       18.51
//     sólo el césped        18.66
//     sólo el techo         19.48
//     sólo la acera         19.90
//     sólo LA TIERRA        32.95   <-- casi el doble del cuadro entero
//
// La tierra no es más cara por su tinta: es que **cubre la pantalla entera**.
// Bajarle el mosaico de 180 a 48 px, o rasterizarlo a escala 1, la deja en
// 26,5 — sigue costando 9 ms. No hay perilla que arregle un relleno con patrón
// del tamaño del viewport; lo que hay que cambiar es el método.
//
// Así que la mancha se dibuja como LO QUE ES: unos cuantos discos suaves sobre
// el suelo, sembrados en una retícula GLOBAL recorrida sólo sobre el rectángulo
// VISIBLE. Es exactamente el patrón que `paintWoods` ya usa para plantar un
// bosque de 270 M px² al mismo precio que uno pequeño, y trae sus dos aciertos
// consigo:
//
//   * **la retícula es global**, así que una mancha no se mueve cuando se mueve
//     la cámara — es la misma razón por la que la variación se siembra en
//     `hash01` y no en `Math.random`;
//   * **el suelo decide, no el polígono.** Contener con `surfaceAt` es una
//     consulta al tile y además es MÁS correcta que un punto-en-polígono de la
//     silueta: excluye de una vez las calles, la arena y las aceras.
//
// Y el disco es un SPRITE pre-renderizado que se blitea, no un
// `createRadialGradient` por mancha y por cuadro — la lección que
// `nightlights.js` ya dejó escrita con los charcos de luz.

const sprites = new Map();

function blobSprite(name, ink, radius, q) {
  const key = `${name}#${ink.rgb}@${radius}@${q}`;
  const had = sprites.get(key);
  if (had) return had;
  const size = Math.max(2, Math.ceil(radius * 2 * q));
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const c = size / 2;
  const grad = g.createRadialGradient(c, c, 0, c, c, c);
  // El borde es LA MISMA TINTA a alfa cero, no un negro transparente: un color
  // escrito aquí sería una tinta autorada dentro del intérprete, que es lo que
  // `tests/test_materials.py` prohíbe — y dejaría muerta la opacidad del
  // registro. Y tiene que llegar a cero, o el disco se nota como disco.
  grad.addColorStop(0, alphaColor(ink.rgb, ink.a));
  grad.addColorStop(1, alphaColor(ink.rgb, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  sprites.set(key, cv);
  return cv;
}

/**
 * Sembrar las manchas de `name` sobre el rectángulo visible.
 *
 * `contains(x, y)` lo pone quien llama, porque sólo él sabe sobre qué suelo
 * tiene sentido esta mancha — y porque preguntárselo al mundo desde aquí ataría
 * este archivo al accesor, que es justo lo que lo deja utilizable fuera del
 * juego. Una textura que no es `scatter` no hace nada: `null` sigue siendo una
 * respuesta.
 */
export function paintScatter(g, name, view, contains, worldToDevice) {
  const spec = TEXTURES[name];
  if (!spec || spec.off || spec.kind !== "scatter") return;
  const inks = spec.inks || [];
  if (!inks.length) return;
  const step = spec.tile || 120;
  const q = Math.max(0.25, Math.min(4, Math.round((worldToDevice || 1) * 2) / 2));
  const rMax = Array.isArray(spec.r) ? spec.r[1] : spec.r;
  // El padding es el radio máximo: una mancha cuyo CENTRO cae fuera de la vista
  // todavía asoma dentro de ella, y sin esto aparecerían y desaparecerían en el
  // borde de la pantalla.
  const gx0 = Math.floor((view.x0 - rMax) / step), gx1 = Math.ceil((view.x1 + rMax) / step);
  const gy0 = Math.floor((view.y0 - rMax) / step), gy1 = Math.ceil((view.y1 + rMax) / step);
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      const h = hash01(gx * 1.87 + gy * 4.53);
      if (h > (spec.density ?? 1)) continue;
      const x = (gx + 0.5 + (hash01(gx * 9.31 + gy * 2.77) - 0.5) * 0.9) * step;
      const y = (gy + 0.5 + (hash01(gx * 3.19 + gy * 12.7) - 0.5) * 0.9) * step;
      if (!contains(x, y)) continue;
      const r = lerp(spec.r[0], spec.r[1], hash01(gx * 5.51 + gy * 7.93));
      const ink = inks[Math.floor(hash01(gx * 2.11 + gy * 6.37) * inks.length) % inks.length];
      g.drawImage(blobSprite(name, ink, rMax, q), x - r, y - r, r * 2, r * 2);
    }
  }
}
