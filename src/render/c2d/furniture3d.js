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
import { WORLD2D as W } from "../../world2d/index.js";
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

/**
 * UN BLOQUE PARA SENTARSE —la banca de concreto de las medialunas y de los abanicos—: una caja de
 * `lenM` x `depM` y `hM` de alto, con su tapa en `top` y sus caras en `side`. `V` da la sombra.
 */
export function drawBlock3d(x, y, ang, lenM, depM, hM, inks, V) {
  rigged(x, y, ang, hM, V, (lenM + hM) * PX_PER_M * 1.3, (R) => {
    R.at(hM, () => R.box(0, 0, 0, hM, lenM, depM, { top: inks.top, side: inks.side }));
  });
}

/**
 * UN TRAZO CON ALTURA —la banca corrida y la pérgola del Parque Marino, que el mundo trae como una
 * polilínea con ancho—: la banca es el trazo a ras en la tinta del costado y otra vez arriba, a `hM`,
 * en la de la tapa; la pérgola lleva además sus postes cada `everyM` y la viga arriba.
 */
export function drawRaisedStroke3d(pts, wPx, hM, inks, posts = null) {
  const cam = state.cam, ppm = PX_PER_M;
  const up = (x, y, z) => { const o = parallaxOffset(cam, x, y, z, ppm); return [x + o.dx, y + o.dy]; };
  const sh = sunShadow(hM);
  const line = (P, w, ink) => {
    ctx.strokeStyle = ink; ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); P.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  };
  const base = []; for (let i = 0; i + 1 < pts.length; i += 2) base.push([pts[i], pts[i + 1]]);
  if (sh.alpha > 0 && inks.shadow) {
    ctx.save(); ctx.globalAlpha = sh.alpha * 0.6; line(base.map(([x, y]) => [x + sh.dx, y + sh.dy]), wPx, inks.shadow); ctx.restore();
  }
  queueBodyLike({ x: base[0][0], y: base[0][1], paint: () => {
    if (posts) {
      // los postes, del piso a la viga
      ctx.strokeStyle = inks.side; ctx.lineWidth = posts.wM * ppm; ctx.lineCap = "butt"; ctx.beginPath();
      let run = 0;
      for (let k = 0; k + 1 < base.length; k++) {
        const [ax, ay] = base[k], [bx, by] = base[k + 1], L = Math.hypot(bx - ax, by - ay) || 1;
        for (; run <= L; run += posts.everyM * ppm) {
          const x = ax + (bx - ax) * run / L, y = ay + (by - ay) * run / L, t = up(x, y, hM);
          ctx.moveTo(x, y); ctx.lineTo(t[0], t[1]);
        }
        run -= L;
      }
      ctx.stroke();
    } else {
      // la banca: su cuerpo, del piso a la tapa, en capas
      for (const f of [0, 0.34, 0.67]) line(base.map(([x, y]) => up(x, y, hM * f)), wPx, inks.side);
    }
    line(base.map(([x, y]) => up(x, y, hM)), wPx, inks.top);
  } });
}

/** UNA TUMBONA: el bastidor bajo y el respaldo levantado en la cabecera (+u), con su cojín de color. */
export function drawLounger3d(x, y, ang, lenM, wM, inks, V) {
  rigged(x, y, ang, V.backM, V, lenM * PX_PER_M * 1.3, (R) => {
    R.at(V.seatM, () => R.box(-lenM * 0.15, 0, 0, V.seatM, lenM * 0.7, wM, { top: inks.frame, side: inks.side }));
    R.at(V.backM, () => {
      const u0 = lenM * 0.2, u1 = lenM / 2, h = wM / 2;
      R.poly([[u0, -h, V.seatM], [u1, -h, V.backM], [u1, h, V.backM], [u0, h, V.seatM]], inks.pad);
    });
  });
}

/**
 * EL SEMÁFORO COLGADO: el poste en la acera, el brazo sobre la calzada y las cabezas colgando de él,
 * con sus tres luces en las caras que miran a la calle. `V` es `signs.<tipo>.gantry3d`.
 *
 * Con `s.hw` (los del mundo, que `seat_bus_stops` sentó en la acera) el brazo cruza hacia el eje de la
 * calle: `side` dice de qué lado de la normal (−sin, cos) quedó el poste, así que el eje está en
 * −side · normal, y una cabeza en `k` cuelga a `k` medias calzadas del bordillo. Sin `hw` (uno del
 * editor) `ang` ya es el rumbo del brazo y (x, y) su medio, como en el dibujo plano.
 */
export function drawGantrySignal3d(V, s) {
  const ppm = PX_PER_M;
  let x = s.x, y = s.y, dir, at;
  if (s.hw) {
    const a = s.ang || 0, side = s.side || 1;
    dir = Math.atan2(-side * Math.cos(a), side * Math.sin(a));
    const kerbM = (V.kerbFromPoleK * W.CUAD) / ppm, hwM = s.hw / ppm;
    at = (hwM > V.wideHwM ? V.wideHeadsK : V.headsK).map((k) => kerbM + k * hwM);
  } else {
    dir = s.ang || 0;
    x -= Math.cos(dir) * V.armLenM * ppm / 2; y -= Math.sin(dir) * V.armLenM * ppm / 2;
    at = V.headsK.map((k) => k * (V.armLenM - V.overhangM));
  }
  const I = V.inks, [hw, hd, hh] = V.headM, z = V.armM, L = Math.max(...at) + V.overhangM;
  rigged(x, y, dir, V.poleM, V, (L + V.poleM) * ppm * 1.4, (R) => {
    R.at(V.poleM, () => R.box(0, 0, 0, V.poleM, V.poleWM, V.poleWM, I.pole));
    for (const u of at) {
      const top = z - V.armWM / 2, bot = top - hh;
      R.at(top - 0.01, () => {
        R.box(u, 0, bot, top, hw, hd, I.head);
        if (R.shadow) return;
        // las tres luces, en las dos caras que miran a lo largo de la calle (±v)
        for (const sg of [-1, 1]) {
          if (!R.faces([u, sg * hd / 2, (top + bot) / 2], [0, sg, 0])) continue;
          V.lensZK.forEach((k, i) => R.dot([u, sg * (hd / 2 + 0.02), bot + k * hh], V.lensRM, I.lenses[i]));
        }
      });
    }
    R.at(z + V.armWM / 2, () => R.box(L / 2, 0, z - V.armWM / 2, z + V.armWM / 2, L, V.armWM, I.arm));
  });
}

