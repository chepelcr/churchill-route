// EL AGUACERO SOBRE EL SUELO — lo que hace que la calle se vea mojada.
//
// La tormenta era un TINTE y unas rayas: el cielo se ponía plomizo, caían
// líneas por la pantalla y el asfalto seguía exactamente igual de seco que a
// mediodía. Aquí va la otra mitad, la que ocurre en el MUNDO y no en el vidrio:
// las gotas reventando en la calzada y, cuando de verdad arrecia, el agua
// juntándose donde el terreno es bajo.
//
// Dos reglas que lo mantienen honesto:
//
//   * SÓLO SOBRE CALZADA. Una gota reventando sobre el golfo o sobre el techo
//     de una casa no se ve desde arriba, y una lámina de agua uniforme sobre
//     todo el encuadre no es una calle inundada: es un filtro de color.
//   * EL AGUA SE JUNTA EN LO BAJO. La cota del terreno ya viaja en el mundo
//     (`groundZAt`, el canal `zM` del IGN), así que el charco puede preguntar
//     dónde está el punto bajo en vez de repartirse por igual. Es lo que
//     distingue «llovió» de «pusieron un azul encima».
//
// Todo lo autorado vive en `hud.json -> weather.roadSplash` y `weather.flood`.
import HUD from "../../assets/hud.json" with { type: "json" };
import { SURFACE } from "../../game/surfaces.js";
import { WORLD2D as W } from "../../world2d/index.js";
import { state } from "../../game/state.js";
import { ctx, hash01 } from "./gfx.js";

const TAU = Math.PI * 2;
const SPLASH = HUD.weather.roadSplash;
const FLOOD = HUD.weather.flood;

const rgba = (rgb, a) => `rgba(${rgb},${a})`;

//: Dónde puede reventar una gota y dónde puede juntarse el agua: la calzada, y
//: lo que se le parece. El malecón entra porque es piedra y se moja igual; la
//: arena y el agua no, y la acera tampoco — desde arriba no se leería.
const WET_CLASSES = new Set([
  SURFACE.ROAD, SURFACE.PASEO, SURFACE.BRIDGE, SURFACE.BOULEVARD,
  SURFACE.MALECON, SURFACE.GRAVEL,
]);

const wet = (x, y) => WET_CLASSES.has(W.surfaceAt(x, y));

/**
 * LAS GOTAS REVENTANDO EN LA CALLE, alrededor del carro.
 *
 * Deterministas por índice y por instante —`hash01`, nunca `Math.random`—, así
 * que el suelo no hierve entre cuadros: cada salpicadura nace, se abre y se
 * apaga en su sitio.
 */
export function drawRoadSplashes(view, t, force) {
  if (force <= 0) return;
  const p = state.p;
  const n = Math.round(SPLASH.count + SPLASH.countPerIntensity * Math.min(1.5, force));
  const reach = SPLASH.reach;
  ctx.save();
  ctx.lineWidth = SPLASH.width;
  for (let i = 0; i < n; i += 1) {
    const seed = i * 3.117;
    // el ciclo de vida de ESTA gota, desfasado del resto
    const phase = (t / SPLASH.life + hash01(seed)) % 1;
    // …y un sitio nuevo cada vez que renace, no una gota que camina
    const born = Math.floor(t / SPLASH.life + hash01(seed));
    const jitter = hash01(seed + born * 7.31);
    const ang = hash01(seed + born * 2.11) * TAU;
    const rad = Math.sqrt(jitter) * reach;          // uniforme en ÁREA, no en radio
    const x = p.x + Math.cos(ang) * rad;
    const y = p.y + Math.sin(ang) * rad;
    if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;
    if (!wet(x, y)) continue;
    const r = SPLASH.rMin + (SPLASH.rMax - SPLASH.rMin) * phase;
    const fade = (1 - phase) * (1 - phase);
    ctx.strokeStyle = rgba(SPLASH.rgb, SPLASH.alpha * fade * Math.min(1, force));
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.55, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * LA CALLE ENCHARCADA, por encima de `flood.startsAt`.
 *
 * El agua se junta donde el terreno es BAJO respecto de lo que lo rodea, que es
 * lo que la hace parecer agua y no un filtro: se muestrea la cota en una
 * retícula gruesa y se compara cada punto con la media de sus vecinos.
 *
 * `wetGrip()` es el que la retira, no el cielo — el charco dura más que la nube,
 * igual que el agarre.
 */
export function drawFloodedStreets(view, force, wetness) {
  const over = force - FLOOD.startsAt;
  if (over <= 0 || wetness <= 0) return;
  const strength = Math.min(1, over / (1 - FLOOD.startsAt)) * wetness;
  const cell = FLOOD.cell;
  const zAt = W.groundZAt;
  ctx.save();
  for (let y = Math.floor(view.y0 / cell) * cell; y < view.y1; y += cell) {
    for (let x = Math.floor(view.x0 / cell) * cell; x < view.x1; x += cell) {
      if (!wet(x, y)) continue;
      let pool = 1;
      if (zAt) {
        // ¿está BAJO respecto de lo que lo rodea? La cota viene en metros.
        const z = zAt(x, y);
        const around = (zAt(x - cell * 2, y) + zAt(x + cell * 2, y)
                        + zAt(x, y - cell * 2) + zAt(x, y + cell * 2)) / 4;
        pool = Math.min(1, Math.max(0.15, (around - z) / FLOOD.lowByM + 0.35));
      }
      const a = FLOOD.alphaMax * strength * pool;
      if (a <= 0.012) continue;
      ctx.fillStyle = rgba(FLOOD.rgb, a);
      ctx.fillRect(x, y, cell, cell);
      // …y el brillo del agua quieta encima, que es lo que la delata
      const shimmer = 0.5 + 0.5 * Math.sin((x + y) * 0.01);
      ctx.fillStyle = rgba(FLOOD.sheenRgb, FLOOD.sheenAlpha * strength * pool * shimmer);
      ctx.fillRect(x, y, cell, cell * 0.4);
    }
  }
  ctx.restore();
}
