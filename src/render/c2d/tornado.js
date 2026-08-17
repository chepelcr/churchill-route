// EL TORNADO, dibujado.
//
// Desde esta cámara un embudo NO es un cono: nunca se le ve el alto. Lo que se
// ve es un anillo de polvo girando, un ojo oscuro en el medio y escombro dando
// vueltas — así que eso es lo que se dibuja. Sobre agua el polvo se cambia por
// rocío, que es la diferencia visible entre un tornado y una tromba marina.
//
// La geometría se queda acá y no en una lista de partes: gira con el reloj Y con
// su propia fase, y los generadores del vocabulario colocan copias pero no
// animan un anillo continuo. La PALETA sí es data (`materials.json` -> `tornado`).
import { SURFACE } from "../../game/surfaces.js";
import { WORLD2D as W } from "../../world2d/index.js";
import { tornado } from "../../game/tornado.js";
import { ctx, hash01 } from "./gfx.js";
import MATERIALS from "../../assets/materials.json" with { type: "json" };

const T = MATERIALS.tornado;

export function drawTornado(view) {
  const tor = tornado();
  if (!tor) return;
  if (tor.x < view.x0 - tor.r || tor.x > view.x1 + tor.r) return;
  if (tor.y < view.y0 - tor.r || tor.y > view.y1 + tor.r) return;
  // Sobre agua levanta rocío; sobre tierra, polvo.
  const overWater = W.surfaceAt(tor.x, tor.y) === SURFACE.WATER;
  const dust = overWater ? T.spray : T.dust;
  ctx.save();
  ctx.translate(tor.x, tor.y);
  // EL ANILLO DE POLVO: varias vueltas a distinta velocidad, que es lo que le da
  // la sensación de estar hecho de aire y no de una textura girando.
  for (let ring = 0; ring < 4; ring++) {
    const rr = tor.r * (0.34 + ring * 0.22);
    const spin = tor.ph * (1.6 - ring * 0.28);
    ctx.strokeStyle = ring === 3 ? T.dustEdge : dust;
    ctx.lineWidth = tor.r * (0.16 - ring * 0.02);
    ctx.beginPath();
    // Arcos rotos en vez de un círculo: un anillo cerrado se lee como una
    // dona, y lo que se quiere es aire moviéndose.
    for (let i = 0; i < 5; i++) {
      const a0 = spin + (i / 5) * Math.PI * 2;
      ctx.arc(0, 0, rr, a0, a0 + 0.82);
    }
    ctx.stroke();
  }
  // EL OJO, más oscuro: es por donde uno ve el suelo levantado.
  ctx.fillStyle = T.eye;
  ctx.beginPath(); ctx.arc(0, 0, tor.r * 0.2, 0, Math.PI * 2); ctx.fill();
  // …y el escombro, en órbitas propias con el mismo hash de siempre, para que
  // no hierva de un cuadro al otro.
  ctx.fillStyle = T.debris;
  for (let i = 0; i < 14; i++) {
    const h = hash01(i * 7.13);
    const rr = tor.r * (0.24 + h * 0.66);
    const a = tor.ph * (1.1 + h) + h * Math.PI * 2;
    const s = 1.2 + h * 2.4;
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * rr, Math.sin(a) * rr * 0.72, s, s * 0.55, a, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
