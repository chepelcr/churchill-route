// LA NOCHE, PERFORADA — el alumbrado público como luz de verdad.
//
// El problema no era el brillo. La noche se pintaba con `C.tint`, un lavado
// plano sobre el CUADRO ENTERO, así que una lámpara dibujada en la pasada del
// mundo quedaba debajo del mismo lavado que la hacía falta: subir su alfa la
// aclaraba a ella y no al suelo que debía alumbrar.
//
// Así que la oscuridad deja de ser una manta y pasa a ser una CAPA que las
// lámparas perforan:
//
//   1. el mundo se pinta normal;
//   2. en un canvas aparte se llena la oscuridad de la noche;
//   3. con `destination-out` se BORRA un disco suave por cada lámpara en vista
//      — ahí nace el pozo de luz;
//   4. la capa se dibuja sobre el cuadro, y encima una pasada cálida en
//      `lighter` con el color de la lámpara.
//
// TRES COSAS LO HACEN BARATO, y sin las tres esto no es viable con miles de
// postes:
//
//   * **media resolución.** Un pozo de luz es suave por definición, así que a
//     la mitad no se nota y cuesta un cuarto de los píxeles.
//   * **el disco es un SPRITE pre-renderizado**, uno por tipo, dibujado con
//     `drawImage`. Crear un `createRadialGradient` por lámpara y por cuadro es
//     lo que haría inviable la cobertura completa: con miles hay que blitear,
//     no generar.
//   * **sólo las de la vista**, que el streaming por tile ya da gratis.
import LIGHTS from "../../assets/lights.json" with { type: "json" };
import { WORLD2D as W } from "../../world2d/index.js";
import { moonlight } from "../../game/daynight.js";
import { LAMP_POOL_R } from "../../domain/units.js";
import { ctx, dpr } from "./gfx.js";

//: La capa de oscuridad, a media resolución. Se reusa entre cuadros: crear un
//: canvas de pantalla completa por cuadro es basura para el GC en el bucle más
//: caliente que tiene el juego.
let layer = null, lctx = null;

//: Un disco por TIPO de luz, pre-renderizado una vez. La clave incluye el radio
//: porque una torre de estadio y una farola no alumbran lo mismo.
const pools = new Map();

function poolSprite(type, radius) {
  const key = `${type}@${radius}`;
  const had = pools.get(key);
  if (had) return had;
  const size = Math.max(2, Math.ceil(radius * 2));
  const cv = document.createElement("canvas");
  cv.width = cv.height = size;
  const g = cv.getContext("2d");
  const grad = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  // Un pozo de luz no tiene borde. El centro borra del todo y el canto no borra
  // nada; las dos paradas de en medio son lo que evita que se lea como un
  // círculo recortado — que es exactamente como se ve un `globalAlpha` plano.
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.72)");
  grad.addColorStop(0.78, "rgba(0,0,0,0.22)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  pools.set(key, cv);
  return cv;
}

/** Every lamp whose pool can reach the view, from the streamed tiles. The pad
 *  is the pool's own reach: a lamp just off-screen still lights what is on it. */
function lampsInView(view) {
  return W.lampsIn ? W.lampsIn(view, LAMP_POOL_R) : [];
}

/**
 * Draw the night as a punched layer over the finished frame.
 *
 * `tint` is the weather's own night wash — kept, because it is what the game
 * has always looked like away from a lamp. What changes is that it is no longer
 * the last word.
 */
export function drawNightLights(vw, vh, view, tint, toScreen) {
  // LA LUNA DECIDE CUÁNTO SE VE. Luna llena y luna nueva son dos noches
  // distintas y el jugador lo nota antes de saber por qué: en llena el tinte se
  // aligera y se maneja por la calle, en nueva la ciudad son los pozos de luz y
  // nada más. Es la misma luna que abre y cierra la marea, así que una noche de
  // marea viva es además una noche clara — que es verdad y es una pista.
  const moon = moonlight();
  if (moon > 0) tint = lightenTint(tint, moon * 0.34);
  const lamps = lampsInView(view);
  if (!lamps.length) {
    // Sin postes la noche es lo que siempre fue. Este camino es el que mantiene
    // honesto el cambio: un mundo sin alumbrado se ve exactamente igual.
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, vw, vh);
    return 0;
  }
  const w = Math.max(1, Math.ceil(vw / 2)), h = Math.max(1, Math.ceil(vh / 2));
  if (!layer || layer.width !== w || layer.height !== h) {
    layer = document.createElement("canvas");
    layer.width = w; layer.height = h;
    lctx = layer.getContext("2d");
  }
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = "source-over";
  lctx.clearRect(0, 0, w, h);
  lctx.fillStyle = tint;
  lctx.fillRect(0, 0, w, h);

  // …y ahora los agujeros. `destination-out` borra de la capa, no del cuadro:
  // por eso la oscuridad tiene que vivir en su propio canvas — hacerlo sobre el
  // frame borraría el mundo.
  lctx.globalCompositeOperation = "destination-out";
  const s = 0.5;                       // world px -> layer px (half resolution)
  const r = Math.max(2, Math.round(LAMP_POOL_R * ZOOMED * s));
  for (const lamp of lamps) {
    const [sx, sy] = toScreen(lamp.x, lamp.y);
    const sprite = poolSprite(lamp.type || "warm", r);
    lctx.drawImage(sprite, sx * s - r, sy * s - r, r * 2, r * 2);
  }
  lctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(layer, 0, 0, vw * dpr, vh * dpr);
  // La pasada cálida: el color de la lámpara SUMADO encima, para que un pozo se
  // lea como luz de sodio y no como un hueco recortado en la noche.
  ctx.globalCompositeOperation = "lighter";
  const warmR = LAMP_POOL_R * ZOOMED;
  for (const lamp of lamps) {
    const spec = LIGHTS.types[lamp.type] || LIGHTS.types.warm;
    const [cr, cg, cb] = spec.halo;
    const [sx, sy] = toScreen(lamp.x, lamp.y);
    const grad = ctx.createRadialGradient(
      sx * dpr, sy * dpr, 0, sx * dpr, sy * dpr, warmR * dpr);
    grad.addColorStop(0, `rgba(${cr},${cg},${cb},0.16)`);
    grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect((sx - warmR) * dpr, (sy - warmR) * dpr, warmR * 2 * dpr, warmR * 2 * dpr);
  }
  ctx.restore();
  return lamps.length;
}

//: Aclara el velo de la noche por la luna. El tinte es un `rgba()`, así que lo
//: que se baja es su ALFA — aclarar su color lo volvería azul lechoso en vez de
//: dejar ver lo que hay debajo.
function lightenTint(tint, k) {
  const i = tint.lastIndexOf(",");
  if (!tint.startsWith("rgba") || i < 0) return tint;
  const alpha = parseFloat(tint.slice(i + 1));
  if (!Number.isFinite(alpha)) return tint;
  return `${tint.slice(0, i + 1)}${(alpha * (1 - k)).toFixed(3)})`;
}

//: El zoom vigente, puesto por el compositor antes de llamar — el pozo es una
//: distancia del MUNDO y tiene que encoger y crecer con la cámara.
let ZOOMED = 1;
export const setLightZoom = (z) => { ZOOMED = z; };
