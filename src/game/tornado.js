// EL TORNADO — un remolino de tierra.
//
// Sólo sale en las tormentas de verdad (`stormHasTornado`), y eso es a
// propósito: si apareciera en cualquier chubasco dejaría de ser un evento y
// pasaría a ser el clima.
//
// **NO ES UN CHOQUE, ES UNA CORRIENTE**, y ése es el modelo que el estero ya
// tenía escrito para su remolino: «no es una colisión, es una corriente que
// sigue trabajando sobre uno todo el tiempo que esté adentro». Un tornado es esa
// misma idea en tierra, así que usa la misma física en vez de inventar una
// segunda — tira del carro y además le tuerce la trompa, que es lo que lo hace
// sentir como viento y no como un muro.
//
// **Y PASA, NO PERSIGUE.** Cruza el mapa en línea recta a su propia velocidad.
// Un tornado que persigue al jugador es un castigo; uno que cruza es algo que
// hay que leer y esquivar, que es el mismo trato que la travesía le da a todo lo
// que hay en el estero.
import { state } from "./state.js";
import { stormHasTornado, stormSeverity } from "./daynight.js";
import SIM from "../content/simulation.json" with { type: "json" };

const PULL = SIM.day.tornadoPull;
const R = SIM.day.tornadoRadius;
const SPEED = SIM.day.tornadoSpeed;

//: Uno a la vez. Dos tornados sobre una ciudad de este tamaño no es una tormenta
//: peor, es una escena distinta — y con uno ya no se sabe por dónde salir.
let live = null;

export function tornado() { return live; }

/** Suelta un tornado cerca del jugador, pero NO encima. */
function spawn() {
  // Lo bastante lejos para verlo llegar; lo bastante cerca para que importe.
  const a = Math.random() * Math.PI * 2;
  const d = 520 + Math.random() * 380;
  // Cruza en una dirección que lo trae hacia la zona del jugador sin apuntarle:
  // el rumbo se desvía hasta un cuarto de vuelta, así que a veces pasa de largo.
  const heading = a + Math.PI + (Math.random() - 0.5) * (Math.PI / 2);
  live = {
    x: state.p.x + Math.cos(a) * d,
    y: state.p.y + Math.sin(a) * d,
    vx: Math.cos(heading) * SPEED,
    vy: Math.sin(heading) * SPEED,
    ph: 0,
    // el radio y el tirón crecen con la fuerza de la tormenta que lo trajo
    r: R * (0.7 + stormSeverity() * 0.5),
    pull: PULL * (0.6 + stormSeverity() * 0.6),
    life: 26 + Math.random() * 22,
  };
}

export function updateTornado(dt) {
  if (!stormHasTornado()) { live = null; return; }
  if (!live) { spawn(); return; }
  live.ph += dt * 3.4;
  live.x += live.vx * dt;
  live.y += live.vy * dt;
  live.life -= dt;
  // Se va solo, y también si se alejó tanto que ya no es de esta escena.
  const gone = Math.hypot(live.x - state.p.x, live.y - state.p.y) > 2400;
  if (live.life <= 0 || gone) live = null;
}

/**
 * La corriente sobre el jugador. Devuelve el par (empuje, giro) para que la
 * física la aplique donde aplica todo lo demás, en vez de escribir en `p` desde
 * acá — la misma razón por la que el remolino del estero vive en `crossing.js` y
 * no en su dibujante.
 */
export function tornadoPull(p) {
  if (!live) return null;
  const dx = live.x - p.x, dy = live.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d > live.r || d < 1e-3) return null;
  // Más fuerte hacia el centro, como el remolino: `grip` es 1 en el ojo y 0 en
  // el borde, así que el efecto entra y sale en vez de encenderse de golpe.
  const grip = 1 - d / live.r;
  // Tangencial (el giro) más una componente hacia adentro (la succión): el
  // tangencial solo lo haría orbitar para siempre.
  const tx = -dy / d, ty = dx / d;
  const inx = dx / d, iny = dy / d;
  return {
    ax: (tx * 0.8 + inx * 0.45) * live.pull * grip,
    ay: (ty * 0.8 + iny * 0.45) * live.pull * grip,
    spin: grip * 1.4,
  };
}
