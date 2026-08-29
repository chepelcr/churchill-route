// EL RELIEVE — el terreno deja de ser una lámina y empieza a tener laderas.
//
// La malla de altura del mundo lleva tiempo emitida y **no la consumía nadie**:
// `residentElevationTiles` existía para un compositor 3-D que se borró entero el
// 2026-08-26, y la ranura `effects.json -> terrainShadow` estaba documentada en
// CLAUDE.md sin haberse escrito nunca. Esto es esa ranura.
//
// ## DECILO ANTES DE QUE PAREZCA QUE NO FUNCIONA: EL ARENAL ES PLANO
//
// La cota es del IGN, no de un DEM, y por una razón medida: SRTM y Mapzen
// levantan el Centro 6-8 m sobre el faro porque son modelos de SUPERFICIE y eso
// que miden son TECHOS. El nodo de OSM dice 2,49 m. Así que la península es
// plana **de verdad**, y en el Paseo, el Centro o El Cocal este archivo no va a
// dibujar casi nada. Donde se ve es tierra adentro — el este del mapa, donde
// `smoke:grade` encuentra pendientes del 51 %. Si alguien lo prueba en el faro y
// concluye que está roto, es que nadie escribió esta línea.
//
// ## POR QUÉ ES UN `drawImage` DE UNA IMAGEN DIMINUTA
//
// El sombreado de una ladera es un valor por MUESTRA de la malla, y la malla es
// gruesa: un tile de 2500 px de mundo trae 32x32 alturas, o sea una muestra cada
// ~81 px. A la distancia a la que se juega eso son siete muestras de ancho.
//
// Dibujar 32x32 rectángulos por tile daría escalones. Lo que se hace es escribir
// esas 1 024 muestras en un canvas de **32x32 píxeles** y estirarlo sobre los
// 2 500 px del tile con `imageSmoothingEnabled`: la interpolación bilineal la
// pone el navegador, gratis y en hardware. Es UN `drawImage` por tile visible, y
// a esta cámara hay entre uno y cuatro.
//
// Y es la misma lección que dejó escrita el grano del suelo: **un relleno con
// patrón del tamaño del viewport cuesta ~10 ns por píxel**, así que una capa que
// cubre la pantalla se blitea, nunca se rellena.
//
// ## EL MEDIO TEXEL NO ES UN DETALLE
//
// La muestra `i` está en `x + i·paso` — en el BORDE del tile cuando `i` es 0 —
// mientras que el píxel `i` de una imagen estirada cae en su CENTRO. Sin
// corregir ese medio texel el relieve queda corrido media muestra y, peor, los
// tiles vecinos dejan de coincidir en su frontera: aparece una costura recta
// cada 2 500 px, que es justo el defecto que la malla evita computando su halo.
import EFFECTS from "../../assets/effects.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { PX_PER_M } from "../../domain/units.js";
import { sunVector } from "../../game/daynight.js";

const R = EFFECTS.terrainShadow || {};

//: El sombreado ya rasterizado, por `tile@ángulo del sol`. El sol se mueve en
//: continuo, así que se redondea a unos cuantos pasos del día: sin eso habría
//: que rehacer 1 024 muestras por tile y por cuadro, que es exactamente el
//: "generar en vez de blitear" que `nightlights.js` prohíbe.
const cache = new Map();
const CACHE_MAX = 24;

function shadeCanvas(mesh, sun) {
  const side = mesh.side;
  const step = mesh.size / mesh.segments;      // px de mundo entre muestras
  const cv = document.createElement("canvas");
  cv.width = cv.height = side;
  const g = cv.getContext("2d");
  const img = g.createImageData(side, side);
  const px = img.data;
  const h = mesh.heightsM;
  const lit = String(R.lit || "255,255,255").split(",").map(Number);
  const shade = String(R.shade || "0,0,0").split(",").map(Number);
  const gain = R.strength || 0;
  const cap = R.maxAlpha || 0;
  const floor = R.minSlope || 0;
  let any = false;
  // **UN TILE LLANO SE DESCARTA ENTERO, ANTES DE MIRAR UNA MUESTRA.** Y hay que
  // hacerlo por el RANGO del tile y no muestra a muestra, porque muestra a
  // muestra la península NO sale llana: las curvas del IGN vienen cada 2 m y las
  // muestras cada 26, así que cruzar una curva da una pendiente local del 7,7 %
  // sobre un terreno que sube 2,15 m en 800. Eso es la interpolación entre dos
  // curvas, no una ladera — y le costaba 2,3 ms de cuadro a todo el puerto por
  // dibujar algo que nadie puede ver.
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < h.length; i++) { if (h[i] < lo) lo = h[i]; if (h[i] > hi) hi = h[i]; }
  if (hi - lo < (R.minTileReliefM || 0)) return null;
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const l = Math.max(col - 1, 0), r = Math.min(col + 1, side - 1);
      const u = Math.max(row - 1, 0), d = Math.min(row + 1, side - 1);
      // LA PENDIENTE ES ADIMENSIONAL y las alturas están en METROS mientras el
      // paso está en píxeles de mundo. Sin el `PX_PER_M` esto sería metros por
      // píxel, que cambia de significado cada vez que el mundo se reescala — y
      // este mundo se ha reescalado cuatro veces.
      const dzdx = ((h[row * side + r] - h[row * side + l]) / ((r - l) * step)) * PX_PER_M;
      const dzdy = ((h[d * side + col] - h[u * side + col]) / ((d - u) * step)) * PX_PER_M;
      // La ladera que MIRA al sol se aclara; la contraria se oscurece. `sun` ya
      // viene normalizado por el dueño del cielo, así que acá no se reinventa
      // ninguna dirección — que es el error que este repo ya pagó con los 19
      // desplazamientos fijos de las sombras.
      const k = -(dzdx * sun.x + dzdy * sun.y);
      // EL UMBRAL NO ES UNA OPTIMIZACIÓN, ES EL LÍMITE DEL DATO. Las curvas del
      // IGN vienen cada 2 m (y cada 50 en el juego nacional), así que una
      // pendiente por debajo de un pequeño porcentaje no es terreno: es la
      // interpolación entre dos curvas. Sombrear eso pinta una ladera donde el
      // levantamiento no dice que la haya — y, de paso, hacía que la península
      // ENTERA, que es plana de verdad, pagara 1,9 ms por dibujar nada visible.
      // Se resta en vez de recortarse, para que no aparezca un escalón justo en
      // el umbral.
      const a = Math.min(cap, Math.max(0, Math.abs(k) - floor) * gain);
      const ink = k >= 0 ? lit : shade;
      const o = (row * side + col) * 4;
      px[o] = ink[0]; px[o + 1] = ink[1]; px[o + 2] = ink[2];
      const alpha = Math.round(a * 255);
      px[o + 3] = alpha;
      if (alpha) any = true;
    }
  }
  // UN TILE PLANO NO SE DIBUJA, y esto no es una optimización tardía: es la
  // misma frase que encabeza este archivo. El arenal es plano de verdad, así que
  // en la península ENTERA el sombreado sale transparente de punta a punta — y
  // un blit de una imagen vacía del tamaño del viewport costaba 1,85 ms medidos,
  // que es todo el precio de esta capa cobrado justo donde no dibuja nada.
  if (!any) return null;
  g.putImageData(img, 0, 0);
  return cv;
}

/**
 * Sombrear el suelo visible según sus laderas.
 *
 * No hace nada sin `effects.json -> terrainShadow`, y no hace nada donde el
 * mundo no emitió cota — que es la mayor parte de la península, a propósito.
 * Las dos son la misma clase de respuesta honesta que da `textureFor`: sin
 * datos, el cuadro sale como salía ayer.
 */
export function paintRelief(g, view) {
  if (!(R.strength > 0)) return;
  const meshes = W.residentElevationTiles ? W.residentElevationTiles(view) : [];
  if (!meshes.length) return;
  const sun = sunVector();
  // El sol se cuantiza para que la caché sirva: un día son `sunSteps` mallas
  // distintas por tile, no una por cuadro.
  const steps = R.sunSteps || 16;
  const bucket = Math.round(sun.x * steps);
  const key0 = `@${bucket}`;
  const prev = g.imageSmoothingEnabled;
  g.imageSmoothingEnabled = true;
  for (const mesh of meshes) {
    const key = mesh.key + key0;
    let cv = cache.get(key);
    if (cv === undefined) {
      if (cache.size >= CACHE_MAX) cache.clear();
      cv = shadeCanvas(mesh, sun);
      cache.set(key, cv);     // `null` TAMBIÉN se guarda: un tile plano se
    }                          // resuelve una vez, no 1 024 muestras por cuadro
    if (!cv) continue;
    // EL MEDIO TEXEL: la muestra 0 está en el borde del tile y el píxel 0 de la
    // imagen estirada cae en su centro. Se dibuja media muestra más afuera y
    // media más ancho por lado, y así los tiles vecinos casan en su frontera.
    const step = mesh.size / mesh.segments;
    g.drawImage(cv, mesh.x - step / 2, mesh.y - step / 2,
                mesh.size + step, mesh.size + step);
  }
  g.imageSmoothingEnabled = prev;
}
