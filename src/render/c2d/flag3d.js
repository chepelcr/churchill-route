// UNA BANDERA EN 2.5D: el asta sube con el pinhole como un poste de luz y el paño es una tira VERTICAL
// que vuela con el viento (`windDeg`) y flamea de lado (`flapM`). Desde arriba se ve su canto ondeando y,
// al alejarse de la cámara, la cara. Su sombra y la del asta van al suelo ya; lo que se levanta se pinta
// con los cuerpos, encima de la gente. La usan las banderas del Muelle de Cruceros (`punta.js`) y los
// rótulos de los kioscos (`landmarks.js`): la geometría es una, lo que cambia es qué se pinta en el paño.
//
// `FL` es un registro de `materials.json` (`flag`, `kioskFlag`): `poleM`, `sizeM`, `windDeg`, `flapM`,
// `flapHz`, `droopM`, `segments`, `polePx`, `finialM`, y las tintas `pole`, `shadow`, `edge`, `finial`.
// `tiltM` (opcional) corre el canto de abajo del paño de lado, como cuando el viento lo levanta: es lo que
// le da cara vista desde arriba a un paño que tiene que leerse.
import { ctx } from "./gfx.js";
import { sunShadow } from "./shadows.js";
import { parallaxOffset } from "./depth.js";
import { queueBodyLike } from "./bodies.js";
import { traceFlagShape } from "./cruiseFlags.js";
import { state } from "../../game/state.js";
import { WORLD2D as W } from "../../world2d/index.js";

const RAD = Math.PI / 180;

/**
 * Encola una bandera parada en (`fl.x`, `fl.y`). `paintCloth(cloth, segments)` pinta el paño:
 * `cloth(u, v)` es el punto en pantalla del paño, `u` a lo largo (0 el asta, 1 la punta libre) y `v`
 * hacia abajo (0 el borde de arriba, 1 el de abajo). `t` en SEGUNDOS.
 */
export function queueFlag(fl, FL, t, paintCloth, windDeg = FL.windDeg) {
  const fp = W.PX_PER_M, [fwM, fhM] = FL.sizeM, wind = (windDeg || 0) * RAD, wx = Math.cos(wind), wy = Math.sin(wind);
  // EL CANTO DE ABAJO CAE HACIA DONDE LE ABRE LA CARA. El pinhole ya corre el borde de abajo del paño
  // (más bajo) hacia el asta respecto del de arriba; si `tiltM` lo corre para el otro lado, los dos se
  // anulan y el paño se ve de filo. Así que se corre para el MISMO lado que el pinhole, con una rampa
  // de dos píxeles para que, cuando la cámara pasa por encima, cambie de lado sin saltar.
  const N = FL.segments || 8;
  let tilt = 0;
  if (FL.tiltM) {
    const P = parallaxOffset(state.cam, fl.x, fl.y, fhM, fp), lat = -(P.dx * -wy + P.dy * wx);
    tilt = FL.tiltM * fp * Math.max(-1, Math.min(1, lat / 2));
  }
  const ph = t * (FL.flapHz || 1.4) * Math.PI * 2 + fl.y * 0.01 + fl.x * 0.007;
  // `lift` dice si el punto se levanta con la cámara (el paño) o se tumba con el sol (su sombra)
  const at = (u, v, lift) => {
    const flap = Math.sin(ph - u * 3.2) * FL.flapM * fp * u + tilt * v, droop = u * u * (FL.droopM || 0);
    const px = fl.x + wx * fwM * fp * u - wy * flap, py = fl.y + wy * fwM * fp * u + wx * flap, h = FL.poleM - fhM * v - droop;
    const o = lift(px, py, h);
    return [px + o.dx, py + o.dy];
  };
  const sun = (px, py, h) => sunShadow(h), cam = (px, py, h) => parallaxOffset(state.cam, px, py, h, fp);
  const polePx = FL.polePx || 1.6;
  const fsh = sunShadow(FL.poleM);
  if (fsh.alpha > 0) {
    ctx.save(); ctx.globalAlpha = fsh.alpha; ctx.strokeStyle = FL.shadow; ctx.fillStyle = FL.shadow; ctx.lineCap = "round"; ctx.lineWidth = polePx;
    ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fl.x + fsh.dx, fl.y + fsh.dy); ctx.stroke();
    traceFlagShape(ctx, (u, v) => at(u, v, sun), N); ctx.fill();
    ctx.restore();
  }
  queueBodyLike({ x: fl.x, y: fl.y, paint: () => {
    const top = cam(fl.x, fl.y, FL.poleM + (FL.finialM || 0.3));
    ctx.lineCap = "round"; ctx.lineWidth = polePx; ctx.strokeStyle = FL.pole;
    ctx.beginPath(); ctx.moveTo(fl.x, fl.y); ctx.lineTo(fl.x + top.dx, fl.y + top.dy); ctx.stroke();
    const cloth = (u, v) => at(u, v, cam);
    paintCloth(cloth, N);
    // el canto del paño, para que se lea aunque la cámara lo vea de filo
    ctx.strokeStyle = FL.edge; ctx.lineWidth = 0.8; traceFlagShape(ctx, cloth, N); ctx.stroke();
    ctx.fillStyle = FL.finial; ctx.beginPath(); ctx.arc(fl.x + top.dx, fl.y + top.dy, polePx * 0.9, 0, Math.PI * 2); ctx.fill();
  } });
}

/**
 * Pinta `sprite` (un lienzo) sobre el paño, franja por franja: una afín por tira, así las letras flamean
 * con la tela. Según cómo la cámara vea el paño, la imagen se recorre al revés a lo largo, a lo alto o en
 * los dos sentidos, para que el nombre nunca salga espejado ni de cabeza en la pantalla.
 */
export function paintClothSprite(cloth, N, sprite) {
  const sw = sprite.width, sh = sprite.height;
  const a0 = cloth(0, 0), a1 = cloth(1, 0), b0 = cloth(0, 1);
  const ax0 = a1[0] - a0[0], ay0 = a1[1] - a0[1], bx0 = b0[0] - a0[0], by0 = b0[1] - a0[1];
  const det = ax0 * by0 - ay0 * bx0, up = by0 < 0;   // espejado / el canto de abajo arriba en pantalla
  const flipU = det < 0 ? !up : up, flipV = up;
  for (let k = 0; k < N; k++) {
    const u0 = k / N, u1 = (k + 1) / N;
    const p00 = cloth(u0, flipV ? 1 : 0), p10 = cloth(u1, flipV ? 1 : 0), p01 = cloth(u0, flipV ? 0 : 1);
    const s0 = (flipU ? 1 - u0 : u0) * sw, s1 = (flipU ? 1 - u1 : u1) * sw, ds = s1 - s0;
    const ax = (p10[0] - p00[0]) / ds, ay = (p10[1] - p00[1]) / ds;
    const cx = (p01[0] - p00[0]) / sh, cy = (p01[1] - p00[1]) / sh;
    ctx.save();
    ctx.transform(ax, ay, cx, cy, p00[0] - ax * s0, p00[1] - ay * s0);
    // medio píxel de solape entre tiras, o la costura se ve como una raya
    const lo = Math.max(0, Math.min(s0, s1) - 0.5), hi = Math.min(sw, Math.max(s0, s1) + 0.5);
    ctx.drawImage(sprite, lo, 0, hi - lo, sh, lo, 0, hi - lo, sh);
    ctx.restore();
  }
}
