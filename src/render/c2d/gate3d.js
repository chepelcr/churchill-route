// LOS ARCOS DE ENTRADA EN 3D — el de la feria y el del Muelle de Cruceros, la misma pieza.
//
// Antes eran un dibujo en ALZADO (los postes de pie en la pantalla y el rótulo enderezado contra la
// cámara), que en un mundo con perspectiva se lee como un recorte pegado al piso. Acá son cuerpos sobre
// el aparejo (`rig3d.js`): dos postes y un tablero con su grosor, levantados con la misma cámara que los
// edificios y con su sombra al sol. El LETRERO va pintado sobre la cara del tablero que mira a la
// cámara: se le arma una transformación afín con tres esquinas de esa cara, así que el texto se
// inclina y se acorta con ella. Si quedara de cabeza o en espejo en la pantalla se gira, porque un
// rótulo es para leerse; y cuando la cara se ve de canto (justo debajo de la cámara) no se escribe.
//
// No tiene medidas ni tintas propias: llegan del registro de quien lo llama
// (`materials.json → punta.gate`, `feriaAssets.json → deck.sign`).
import { state } from "../../game/state.js";
import { PX_PER_M } from "../../domain/units.js";
import { makeRig, withShadowLayer } from "./rig3d.js";
import { sunShadow } from "./shadows.js";
import { queueBodyLike } from "./bodies.js";
import { ctx } from "./gfx.js";

/**
 * Un arco en (x, y) de mundo, con el tablero a lo largo de `ang` y `wPx` entre postes.
 * `S`: { postHeightM, boardM, overhangM, postM, boardDepthM, fontM, font, shade, shadowAlpha }.
 * `inks`: { post, board, trim, ink }.
 */
export function drawGate3d(x, y, ang, wPx, text, S, inks) {
  const ppm = PX_PER_M, H = S.postHeightM, B = S.boardM, hw = wPx / ppm / 2, ov = S.overhangM;
  const pw = S.postM, bd = S.boardDepthM, half = hw + ov;
  const form = (R, g) => {
    for (const s of [-1, 1]) R.at(H - B, () => R.box(s * hw, 0, 0, H - B, pw, pw, inks.post));
    R.at(H, () => {
      R.box(0, 0, H - B, H, 2 * half, bd, inks.board);
      if (R.shadow) return;
      // la cara que mira a la cámara: su marco y su letrero
      const vf = R.faces([0, bd / 2, H - B / 2], [0, 1, 0]) ? bd / 2 : -bd / 2;
      const fr = 0.18;
      R.line([[-half, vf, H - fr / 2], [half, vf, H - fr / 2]], fr, inks.trim);
      R.line([[-half, vf, H - B + fr / 2], [half, vf, H - B + fr / 2]], fr, inks.trim);
      lettering(g, R, text, vf, half, H - B, H, S, inks.ink);
    });
  };
  const sun = sunShadow(1), reach = (half + H) * ppm * 1.5;
  if (sun.alpha > 0) withShadowLayer(ctx, x, y, reach, sun.alpha * (S.shadowAlpha ?? 0.5), (g) => {
    const R = makeRig(g, x, y, ang, ppm, state.cam, "sun", S.shade, H); form(R, g); R.flush();
  });
  queueBodyLike({ x, y, paint: () => { const R = makeRig(ctx, x, y, ang, ppm, state.cam, "cam", S.shade, H); form(R, ctx); R.flush(); } });
}

// el texto sobre la cara v = vf del tablero, de u = -half a +half y de z0 a z1 (metros)
function lettering(g, R, text, vf, half, z0, z1, S, ink) {
  const O = R.P(-half, vf, z0), U = R.P(half, vf, z0), Z = R.P(-half, vf, z1);
  const Wm = 2 * half, Bm = z1 - z0;
  let ex = [(U[0] - O[0]) / Wm, (U[1] - O[1]) / Wm], ey = [(Z[0] - O[0]) / Bm, (Z[1] - O[1]) / Bm];
  const cx = (U[0] + Z[0]) / 2, cy = (U[1] + Z[1]) / 2;
  // de canto no se escribe: la cara mide menos que un renglón en la pantalla
  const m = g.getTransform(), scr = (v) => [m.a * v[0] + m.c * v[1], m.b * v[0] + m.d * v[1]];
  const up = scr(ey), across = scr(ex);
  if (Math.hypot(up[0], up[1]) * Bm < 5) return;
  // de cabeza en la pantalla → se gira media vuelta; en espejo → se lee del otro lado
  if (up[1] > 0) { ex = [-ex[0], -ex[1]]; ey = [-ey[0], -ey[1]]; }
  const a2 = scr(ex), u2 = scr(ey);
  if (a2[0] * -u2[1] - a2[1] * -u2[0] < 0) ex = [-ex[0], -ex[1]];
  void across;
  g.save();
  g.transform(ex[0], ex[1], -ey[0], -ey[1], cx, cy);
  let fm = S.fontM;
  g.font = `${fm}px '${S.font}', sans-serif`;
  const room = Wm - 1.2, tw = g.measureText(text).width;
  if (tw > room) { fm *= room / tw; g.font = `${fm.toFixed(3)}px '${S.font}', sans-serif`; }
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = ink;
  g.fillText(text, 0, 0.05);
  g.restore();
  g.textBaseline = "alphabetic";
}
