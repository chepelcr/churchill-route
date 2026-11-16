// EL MOBILIARIO DE LA CALLE EN 3D — la parada del bus, la banca, y las señales que van en su poste.
//
// Eran dibujos en ALZADO o en planta pegados al piso: la caseta un rectángulo azul, la banca dos
// tiras, el alto un octágono con su palito hacia abajo de la pantalla. Acá cada cosa tiene altura con
// la misma cámara que los edificios:
//   * la PARADA y la BANCA son cajas sobre el aparejo (`rig3d.js`), con su sombra al sol y pintadas
//     con los cuerpos (encima de quien pase detrás);
//   * una señal de POSTE (alto, ceda, semáforo) sube su poste a `stand3d.poleM` y lleva su placa —el
//     mismo dibujo del registro— arriba, en la punta.
// Las medidas y las tintas son del registro (`world-props.json → props.parada.view3d`,
// `signs.<tipo>.view3d` / `stand3d`); acá sólo la forma.
import { state } from "../../game/state.js";
import { PX_PER_M } from "../../domain/units.js";
import { makeRig, withShadowLayer } from "./rig3d.js";
import { parallaxOffset } from "./depth.js";
import { sunShadow } from "./shadows.js";
import { queueBodyLike } from "./bodies.js";
import { ctx } from "./gfx.js";
import { paintParts } from "./shapes.js";

function rigged(x, y, ang, topM, V, reach, form) {
  const ppm = PX_PER_M, sun = sunShadow(1);
  if (sun.alpha > 0) withShadowLayer(ctx, x, y, reach, sun.alpha * (V.shadowAlpha ?? 0.5), (g) => {
    const R = makeRig(g, x, y, ang, ppm, state.cam, "sun", V.shade, topM); form(R); R.flush();
  });
  queueBodyLike({ x, y, paint: () => { const R = makeRig(ctx, x, y, ang, ppm, state.cam, "cam", V.shade, topM); form(R); R.flush(); } });
}

/**
 * LA PARADA: techo de vidrio azul sobre dos postes al frente, la pared del fondo, la banca contra ella
 * y el poste naranja con su letrero a la orilla de la calle. `hwPx`/`hhPx` son los semiejes (el centro
 * cívico trae la suya más grande); +v es el fondo, -v la calle.
 */
export function drawParada3d(x, y, ang, hwPx, hhPx, V) {
  const ppm = PX_PER_M, hw = hwPx / ppm, hh = hhPx / ppm, I = V.inks, z = V.roofM, t = V.roofTM;
  rigged(x, y, ang, z + t, V, (Math.hypot(hwPx, hhPx) + z * ppm) * 1.6, (R) => {
    R.at(z, () => {
      R.box(0, hh - V.wallTM / 2, V.wallFromM, z, 2 * hw, V.wallTM, I.glass);
      for (const s of [-1, 1]) R.box(s * (hw - V.postM), -hh + V.postM, 0, z, V.postM, V.postM, I.post);
      R.box(0, hh - V.benchFromM, V.benchM[0], V.benchM[1], 2 * hw * V.benchK, V.benchDM, I.bench);
    });
    R.at(z + t, () => R.box(0, 0, z, z + t, 2 * hw, 2 * hh, { top: I.roof, side: I.roofSide }));
    const pu = hw - V.signAtM[0], pv = -hh - V.signAtM[1];
    R.at(V.signM, () => {
      R.box(pu, pv, 0, V.signM, V.signPoleM, V.signPoleM, I.sign);
      R.box(pu, pv, V.signM - V.plateM[1], V.signM, V.plateM[0], V.plateM[2], I.sign);
    });
  });
}

/** LA BANCA: asiento, respaldo detrás y dos patas, mirando hacia `ang` (+u). */
export function drawBench3d(x, y, ang, V) {
  const I = V.inks, [s0, s1] = V.seatZ, L = V.lenM;
  rigged(x, y, ang, V.backZ[1], V, L * PX_PER_M * 1.4, (R) => {
    R.at(s0, () => { for (const s of [-1, 1]) R.box(V.seatU[0] + V.seatU[1] / 2, s * (L / 2 - 0.2), 0, s0, 0.25, 0.25, I.leg); });
    R.at(s1, () => R.box(V.seatU[0] + V.seatU[1] / 2, 0, s0, s1, V.seatU[1], L, I.seat));
    R.at(V.backZ[1], () => R.box(V.backU, 0, s1, V.backZ[1], V.backTM, L, I.back));
  });
}

/**
 * UNA SEÑAL DE POSTE: el poste sube a `stand3d.poleM` y la placa del registro —sus partes después de
 * la primera, que era el palito del alzado— se pinta arriba, en la punta, mirando al cielo como la
 * cabeza de una farola. Su sombra: el poste tirado al sol.
 */
export function drawPoleSign3d(rec, x, y, vars) {
  const S = rec.stand3d, ppm = PX_PER_M, top = parallaxOffset(state.cam, x, y, S.poleM, ppm), sh = sunShadow(S.poleM);
  if (sh.alpha > 0) {
    ctx.save(); ctx.globalAlpha = sh.alpha; ctx.strokeStyle = S.shadow; ctx.lineWidth = S.poleWM * ppm; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + sh.dx, y + sh.dy); ctx.stroke(); ctx.restore();
  }
  queueBodyLike({ x, y, paint: () => {
    ctx.strokeStyle = S.pole; ctx.lineWidth = S.poleWM * ppm; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + top.dx, y + top.dy); ctx.stroke();
    ctx.save(); ctx.translate(x + top.dx, y + top.dy);
    paintParts(ctx, rec.parts.slice(1), { pxPerM: ppm, X: (v) => v || 0, Y: (v) => v || 0, vars });
    ctx.restore();
  } });
}
