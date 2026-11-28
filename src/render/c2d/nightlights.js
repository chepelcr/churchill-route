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
import { paintLightPoolMask, paintLightWarmPool } from "./systemShapes.js";

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
  paintLightPoolMask(g, LIGHTS, radius);
  pools.set(key, cv);
  return cv;
}

//: OTRAS FUENTES DE LUZ, registradas por quien las dibuja.
//:
//: El alumbrado público viaja por tile y lo contesta `W.lampsIn`, pero no es el
//: único que hay: las del muelle salen de la geometría de su propio deck y sólo
//: las conoce quien lo dibuja. Mientras el compositor no supiera de ellas, se
//: dibujaban y no alumbraban — la noche es un velo que las lámparas PERFORAN, y
//: una lámpara que el compositor no ve queda debajo del velo que la apaga. Es
//: un registro y no un `import` a propósito: este archivo no tiene por qué
//: saber qué es un muelle, ni el próximo que traiga luces propias.
const sources = [];
export function registerLampSource(fn) { sources.push(fn); }

//: LO QUE TAPA LA LUZ DE LA CALLE: polígonos de mundo (`[x, y, …]`) que el pozo de una lámpara no cruza
//: — las graderías y la cancha de un estadio, que tienen pared. El pozo de una lámpara `field` (las torres
//: del propio estadio) sí los alumbra. Mismo patrón de registro que las fuentes: este archivo no sabe qué
//: es un estadio.
const occluderSources = [];
export function registerOccluderSource(fn) { occluderSources.push(fn); }
function occludersNow() {
  if (!occluderSources.length) return [];
  const out = [];
  for (const fn of occluderSources) { const got = fn(); if (got?.length) out.push(...got); }
  return out;
}
// TODOS CON EL MISMO GIRO: se rellenan `nonzero`, y dos polígonos de giro contrario que se montan (la franja
// de una grada y su tapa, la cancha y la tribuna) abrirían un hueco justo donde se tocan
function traceOccluders(g, polys, toScreen, k) {
  for (const it of polys) {
    const pts = it.pts || it;
    const n = pts.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
    }
    for (let m = 0; m < n; m++) {
      const i = area >= 0 ? m : n - 1 - m;
      const [sx, sy] = toScreen(pts[i * 2], pts[i * 2 + 1]);
      if (m) g.lineTo(sx * k, sy * k); else g.moveTo(sx * k, sy * k);
    }
    g.closePath();
  }
}

//: El color de la calle sin cruzar la pared: los pozos cálidos de la calle se suman en su propio lienzo a
//: media resolución (son suaves), se les BORRA lo que tapa y recién entonces se suman al cuadro. Recortar
//: «todo menos los polígonos» con `evenodd` no sirve: donde dos polígonos se montan, se vuelve a dibujar.
let warmLayer = null, wctx = null;

/** Every lamp whose pool can reach the view, from the streamed tiles. The pad
 *  is the pool's own reach: a lamp just off-screen still lights what is on it. */
export function lampsInView(view) {
  const out = W.lampsIn ? W.lampsIn(view, LAMP_POOL_R) : [];
  if (!sources.length) return out;
  const extra = [];
  for (const fn of sources) {
    const got = fn(view, LAMP_POOL_R);
    if (got && got.length) extra.push(...got);
  }
  return extra.length ? out.concat(extra) : out;
}

/**
 * Draw the night as a punched layer over the finished frame.
 *
 * `tint` is the weather's own night wash — kept, because it is what the game
 * has always looked like away from a lamp. What changes is that it is no longer
 * the last word.
 */
export function drawNightLights(vw, vh, view, tint, toScreen, strength = 1) {
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
  const maskScale = LIGHTS.poolMask.resolutionScale;
  const w = Math.max(1, Math.ceil(vw * maskScale));
  const h = Math.max(1, Math.ceil(vh * maskScale));
  if (!layer || layer.width !== w || layer.height !== h) {
    layer = document.createElement("canvas");
    layer.width = w; layer.height = h;
    lctx = layer.getContext("2d");
  }
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = "source-over";
  lctx.globalAlpha = 1;
  lctx.clearRect(0, 0, w, h);
  lctx.fillStyle = tint;
  lctx.fillRect(0, 0, w, h);

  // …y ahora los agujeros. `destination-out` borra de la capa, no del cuadro:
  // por eso la oscuridad tiene que vivir en su propio canvas — hacerlo sobre el
  // frame borraría el mundo.
  lctx.globalCompositeOperation = "destination-out";
  const s = maskScale;                 // world px -> layer px
  const occ = occludersNow();
  // dos pasadas: primero la calle; lo que tapa vuelve a la oscuridad; y DESPUÉS las torres de los estadios,
  // que sí alumbran sus graderías y su cancha
  const punch = (field) => {
    for (const lamp of lamps) {
      if (!!lamp.field !== field) continue;
      const r = Math.max(2, Math.round((lamp.r || LAMP_POOL_R) * ZOOMED * s));
      const [sx, sy] = toScreen(lamp.x, lamp.y);
      const sprite = poolSprite(lamp.type || "warm", r);
      lctx.globalAlpha = Math.max(0, Math.min(1, (lamp.intensity ?? 1) * strength));
      lctx.drawImage(sprite, sx * s - r, sy * s - r, r * 2, r * 2);
    }
  };
  punch(false);
  if (occ.length) {
    lctx.globalCompositeOperation = "source-over"; lctx.globalAlpha = 1;
    lctx.beginPath(); traceOccluders(lctx, occ, toScreen, s);
    // la oscuridad de vuelta: borrar y rellenar con el tinte, o el tinte se sumaría al que quedaba
    lctx.save(); lctx.clip(); lctx.clearRect(0, 0, w, h); lctx.fillStyle = tint; lctx.fillRect(0, 0, w, h); lctx.restore();
    lctx.globalCompositeOperation = "destination-out";
  }
  punch(true);
  // LO QUE SU PROPIA LUZ ALUMBRA ENTERO (`lit`): las graderías bajo sus torres. Su sombra cae afuera, detrás
  // y debajo de ellas —en la calle, que queda oscura—, nunca encima
  for (const it of occ) {
    if (!(it.lit > 0)) continue;
    lctx.globalAlpha = Math.min(1, it.lit * strength);
    lctx.beginPath(); traceOccluders(lctx, [it], toScreen, s); lctx.fill();
  }
  lctx.globalCompositeOperation = "source-over";
  lctx.globalAlpha = 1;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(layer, 0, 0, vw * dpr, vh * dpr);
  // La pasada cálida: el color de la lámpara SUMADO encima, para que un pozo se
  // lea como luz de sodio y no como un hueco recortado en la noche.
  ctx.globalCompositeOperation = "lighter";
  const warm = (field) => {
    for (const lamp of lamps) {
      if (!!lamp.field !== field) continue;
      const spec = LIGHTS.types[lamp.type] || LIGHTS.types.warm;
      const [sx, sy] = toScreen(lamp.x, lamp.y);
      ctx.globalAlpha = Math.max(0, Math.min(1, (lamp.intensity ?? 1) * strength));
      paintLightWarmPool(ctx, LIGHTS, spec, sx * dpr, sy * dpr, (lamp.r || LAMP_POOL_R) * ZOOMED * dpr);
    }
  };
  if (occ.length) {
    if (!warmLayer || warmLayer.width !== w || warmLayer.height !== h) {
      warmLayer = document.createElement("canvas");
      warmLayer.width = w; warmLayer.height = h;
      wctx = warmLayer.getContext("2d");
    }
    wctx.setTransform(1, 0, 0, 1, 0, 0);
    wctx.globalAlpha = 1; wctx.globalCompositeOperation = "source-over";
    wctx.clearRect(0, 0, w, h);
    wctx.globalCompositeOperation = "lighter";
    for (const lamp of lamps) {
      if (lamp.field) continue;
      const spec = LIGHTS.types[lamp.type] || LIGHTS.types.warm;
      const [sx, sy] = toScreen(lamp.x, lamp.y);
      wctx.globalAlpha = Math.max(0, Math.min(1, (lamp.intensity ?? 1) * strength));
      paintLightWarmPool(wctx, LIGHTS, spec, sx * s, sy * s, (lamp.r || LAMP_POOL_R) * ZOOMED * s);
    }
    wctx.globalAlpha = 1; wctx.globalCompositeOperation = "destination-out";
    wctx.beginPath(); traceOccluders(wctx, occ, toScreen, s); wctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(warmLayer, 0, 0, vw * dpr, vh * dpr);
  } else warm(false);
  warm(true);
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
