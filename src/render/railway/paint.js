// EL MARCO DEL TREN — metros a píxeles, en un solo sitio.
//
// Todo el arte del modo está autorado en METROS (`railway-art.json`), lo que
// deja una sola conversión en todo el renderer: este archivo. No es higiene, es
// la razón por la que el mismo dibujo sirve para el juego, para la ficha del
// garaje —donde una locomotora se ve a 14 px/m— y para la hoja de arte, sin una
// segunda copia del arte en otra escala.
//
// Dos cosas que el intérprete de la casa NO escala y que por lo tanto se
// resuelven acá:
//
//   * **EL TAMAÑO DE UN TEXTO.** `shapes.js` lee `font.size` crudo. Cada
//     registro declara sus tamaños en metros en `fonts` y los pasamos por
//     `vars` ya convertidos, que es el canal que el intérprete ya tenía.
//   * **LA RUEDA.** No es una parte: rueda. Su ángulo sale de la distancia
//     recorrida, y la biela de la manivela, así que es geometría DERIVADA —
//     lo que esta casa deja en el motor. El registro dice dónde está cada eje y
//     de qué tamaño (`wheels`); esto las hace girar.
import { paintParts } from "../c2d/shapes.js";

const TAU = Math.PI * 2;

/** Resuelve `$nombre` contra la paleta del registro. Una tinta por defecto acá
 *  sería un color autorado dentro del pintor, que es lo que la casa prohíbe:
 *  un `$` sin entrada sale `undefined` y Canvas lo deja ver. */
function ink(palette, spec, pick = 0) {
  // UNA PALETA EN LISTA ES UNA VARIANTE, NO UN COLOR. `repeat` y `fit` ya eligen
  // por copia; una parte suelta —la casa de zinc sembrada por el paisaje— no
  // tiene copia de la que colgarse, así que la elige el LLAMADOR con su índice
  // de siembra. Sin esto Canvas recibía un Array como `fillStyle`, lo ignoraba
  // en silencio y las treinta casas del barrio salían todas del color de la
  // pared anterior.
  if (Array.isArray(spec)) return ink(palette, spec[((pick % spec.length) + spec.length) % spec.length]);
  if (typeof spec !== "string" || !spec.startsWith("$")) return spec;
  return palette?.[spec.slice(1)];
}

/**
 * Un marco en metros anclado en (ox, oy) píxeles.
 *
 * @param {object} record  el registro del arte (paleta, fonts)
 * @param {number} ox      origen en píxeles
 * @param {number} oy      origen en píxeles
 * @param {number} ppm     píxeles por metro
 * @param {object} [extra] `vars` extra, `t`, `shadow`, `shadowInk`
 */
export function metreFrame(record, ox, oy, ppm, extra = {}) {
  const fonts = {};
  for (const [name, metres] of Object.entries(record.fonts || {})) {
    fonts[name] = Math.max(1, metres * ppm);
  }
  return {
    X: (v) => ox + Number(v || 0) * ppm,
    Y: (v) => oy + Number(v || 0) * ppm,
    S: (v) => Number(v || 0) * ppm,
    color: (spec) => ink(record.palette, spec, extra.pick || 0),
    pxPerM: ppm,
    ...extra,
    vars: { ...fonts, ...(extra.vars || {}) },
  };
}

/** Pinta una lista de partes de un registro en su propio marco. */
export function paintRecord(g, record, list, ox, oy, ppm, extra = {}) {
  if (!list?.length) return;
  paintParts(g, list, metreFrame(record, ox, oy, ppm, extra));
}

/**
 * Un coche del convoy, puesto y girado sobre la vía.
 *
 * El canvas se gira al ángulo de la vía y el arte se dibuja en su marco local,
 * que es lo que deja que el mismo registro sirva para un tren plano, uno en una
 * cuesta del 19 % y uno boca abajo en la cima de un rizo sin una sola rama.
 */
export function paintCar(g, record, point, ppm, extra = {}) {
  g.save();
  g.translate(point.x, point.y);
  g.rotate(point.angle);
  paintRecord(g, record, record.parts, 0, 0, ppm, extra);
  paintWheels(g, record, ppm, extra.rollRad || 0);
  g.restore();
}

/**
 * Las ruedas y las bielas, giradas por la distancia recorrida.
 *
 * `rollRad` es el ángulo de rodadura del convoy: una sola vuelta para todo el
 * tren, porque todas las ruedas de un tren tienen el mismo diámetro en este
 * catálogo y verlas desfasadas entre sí es lo que delata que son un adorno.
 * (Si algún día un registro trae un diámetro distinto, el ángulo se corrige por
 * el radio ahí mismo.)
 */
export function paintWheels(g, record, ppm, rollRad) {
  const wheels = record.wheels || [];
  if (!wheels.length) return;
  // LA TINTA LA TRAE EL REGISTRO, SIEMPRE. Un respaldo escrito acá sería un
  // color autorado dentro del pintor, que es lo que la casa prohíbe en todo
  // `src/render`; `tests/test_railway_content.py` exige las cuatro llaves.
  const pal = record.palette || {};
  const { tyre, hub, wheel: spoke, rod: rodInk } = pal;
  const base = wheels[0].r;
  let rodPin = null;
  for (const w of wheels) {
    const cx = w.x * ppm, cy = -w.r * ppm, r = w.r * ppm;
    const turn = rollRad * (base / w.r);
    g.fillStyle = spoke;
    g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    g.strokeStyle = tyre; g.lineWidth = Math.max(1, r * 0.17);
    g.beginPath(); g.arc(cx, cy, r * 0.92, 0, TAU); g.stroke();
    // Los rayos: discos sobre una órbita. A este tamaño una barra radial se ve
    // como una mancha; los huecos de la rueda leen mejor y giran igual.
    g.fillStyle = tyre;
    const spokes = w.r > 0.7 ? 8 : 6;
    for (let i = 0; i < spokes; i++) {
      const a = turn + (i / spokes) * TAU;
      g.beginPath();
      g.arc(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.15, 0, TAU);
      g.fill();
    }
    g.fillStyle = hub;
    g.beginPath(); g.arc(cx, cy, r * 0.2, 0, TAU); g.fill();
    if (w.crank) {
      rodPin = { x: cx + Math.cos(turn) * r * 0.58, y: cy + Math.sin(turn) * r * 0.58 };
    }
  }
  // LA BIELA DE ACOPLAMIENTO une los ejes motores y sube y baja con la
  // manivela: es lo que hace que una locomotora de vapor parezca una máquina y
  // no un dibujo que se desliza.
  const rods = wheels.filter((w) => w.rod);
  if (rodPin && rods.length > 1) {
    const dy = rodPin.y - (-rods[0].r * ppm);
    g.strokeStyle = rodInk;
    g.lineWidth = Math.max(1.5, rods[0].r * ppm * 0.14);
    g.beginPath();
    g.moveTo(rods[0].x * ppm + Math.cos(0) * 0, -rods[0].r * ppm + dy);
    for (const w of rods) g.lineTo(w.x * ppm, -w.r * ppm + dy);
    g.stroke();
    for (const w of rods) {
      g.fillStyle = hub;
      g.beginPath(); g.arc(w.x * ppm, -w.r * ppm + dy, rods[0].r * ppm * 0.12, 0, TAU); g.fill();
    }
  }
}

/** Un accesorio del paisaje, plantado en el suelo. */
export function paintProp(g, record, x, y, ppm, scale = 1, extra = {}) {
  paintRecord(g, record, record.parts, x, y, ppm * scale, extra);
}
