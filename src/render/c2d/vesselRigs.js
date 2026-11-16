// LOS BARCOS EN 3D — el ferry del golfo como un cuerpo, y el costado de cualquier casco.
//
// EL FERRY es un roll-on/roll-off de doble proa, como los del golfo de Nicoya: casco magenta en la
// línea de flotación y obra muerta blanca, la cubierta de carros abierta con sus franjas amarillas,
// la superestructura a un costado con su fila de ventanas y sus paneles en el techo, el puente
// arriba con su franja magenta y el mástil, y un pórtico rosado con su rampa en CADA punta —
// cualquiera de las dos es proa. Medidas en metros (`materials.json → structure.ferry.model`);
// el largo y la manga son los del barco del mundo, así que la cubierta dibujada sigue siendo la
// caja que el colisionador conoce.
//
// EL CASCO DE UNA PANGA, UN YATE O EL BARCO DEL PUERTO no tiene receta de cajas: su arte se levanta
// a la altura de su borda y `paintHullSides` pinta su costado —la franja de flotación y la obra
// muerta— repitiendo su contorno del agua a la borda, como la silueta de un carro.
import { state } from "../../game/state.js";
import { mixColor } from "./gfx.js";
import { facingEdges, paintSweep, parallaxOffset } from "./depth.js";

/**
 * El ferry. `R` es el aparejo en el marco del barco (u a lo largo, v de banda a banda, metros);
 * `L`/`B` su semieslora y semimanga, `M` el modelo del registro.
 */
export function ferryForm(R, { L, B, M }) {
  const I = M.inks, d = M.deckM, fb = M.freeboardM;
  // el casco: la franja magenta y la obra muerta blanca, con la cubierta de carros arriba
  R.at(M.boottopM, () => R.box(0, 0, 0, M.boottopM, 2 * L, 2 * B, I.boottop));
  R.at(d, () => R.box(0, 0, M.boottopM, d, 2 * L, 2 * B, { top: I.deck, side: I.hull }));
  R.at(d + 0.01, () => {
    if (R.shadow) return;
    for (const s of [-1, 1]) R.line([[-L + 1.2, s * B * M.laneK, d + 0.01], [L - 1.2, s * B * M.laneK, d + 0.01]], M.laneM, I.lane);
  });
  // las bordas a lo largo: blancas por fuera y con su canto magenta, que es lo que se ve desde arriba
  for (const s of [-1, 1]) {
    R.at(fb, () => R.box(0, s * (B - M.bulwarkM / 2), d, fb, 2 * L - 2, M.bulwarkM, { top: I.boottop, side: I.hull }));
  }
  // la superestructura a un costado: paredes blancas, la fila de ventanas, la franja magenta y el techo de paneles
  const sv0 = B * M.superK[0], sv1 = B, sl = L * M.superK[1], sv = (sv0 + sv1) / 2, sw = sv1 - sv0, zt = M.superTopM;
  R.at(zt, () => R.box(0, sv, d, zt, 2 * sl, sw, { top: I.white, side: I.white }));
  R.at(zt + 0.01, () => {
    const [w0, w1] = M.windowsM;
    R.box(0, sv1 + 0.03, w0, w1, 2 * sl - 1, 0.06, I.window);
    R.box(0, sv0 - 0.03, w0, w1, 2 * sl - 1, 0.06, I.window);
    for (const e of [-1, 1]) R.box(e * (sl + 0.03), sv, w0, w1, 0.06, sw - 1, I.window);
    R.box(0, sv1 + 0.04, zt - 0.35, zt, 2 * sl, 0.08, I.stripe);
  });
  R.at(zt + 0.2, () => R.box(0, sv, zt, zt + 0.15, 2 * sl - 1.2, sw - 1, I.solar));
  for (const e of [-1, 1]) R.at(zt + 0.6, () => R.box(e * sl * 0.7, sv1 - 0.6, zt, zt + 0.55, 1.6, 0.9, I.raft));
  // el puente: su fila de ventanas, la franja magenta arriba y el mástil
  const [bl, bw, bh] = M.bridgeM, bv = sv0 + sw * M.bridgeAtK, zb = zt + bh;
  R.at(zb, () => R.box(0, bv, zt, zb, bl, bw, { top: I.white, side: I.white }));
  R.at(zb + 0.01, () => {
    const w0 = zt + bh * 0.42, w1 = zt + bh * 0.78;
    for (const s of [-1, 1]) R.box(0, bv + s * (bw / 2 + 0.03), w0, w1, bl - 0.4, 0.06, I.window);
    for (const e of [-1, 1]) R.box(e * (bl / 2 + 0.03), bv, w0, w1, 0.06, bw - 0.4, I.window);
    for (const s of [-1, 1]) R.box(0, bv + s * (bw / 2 + 0.05), zb - 0.35, zb, bl, 0.1, I.stripe);
    for (const e of [-1, 1]) R.box(e * (bl / 2 + 0.05), bv, zb - 0.35, zb, 0.1, bw, I.stripe);
  });
  R.at(zb + M.mastM, () => { R.line([[0, bv, zb], [0, bv, zb + M.mastM]], 0.18, I.mast); R.dot([0, bv, zb + M.mastM], 0.3, I.mast); });
  // las rampas: el pórtico rosado en cada punta y la plancha que baja al muelle
  for (const e of [-1, 1]) {
    R.at(d - 0.05, () => R.box(e * (L + M.rampM / 2), 0, d - 0.25, d - 0.05, M.rampM, 2 * B * M.rampK, { top: I.deck, side: I.ramp }));
    for (const s of [-1, 1]) R.at(M.gantryM * 0.5, () => R.box(e * (L - 0.6), s * (B - 0.4), d, M.gantryM, 0.5, 0.5, I.ramp));
    R.at(M.gantryM + 0.2, () => R.box(e * (L - 0.6), 0, M.gantryM - 0.5, M.gantryM, 0.6, 2 * B - 0.3, I.ramp));
  }
}

/**
 * El COSTADO de un casco: su contorno (`pts`, plano [x, y, …] en el marco del barco) repetido del
 * agua a la borda — la franja de flotación abajo, la obra muerta arriba—, en coordenadas de mundo.
 * Devuelve el corrimiento de la borda {dx, dy} (mundo) para que quien llama levante el arte.
 */
export function paintHullSides(g, x, y, ang, sx, pts, heightM, low, high, bandK, side, ppm) {
  const o = parallaxOffset(state.cam, x, y, heightM, ppm);
  if (!o.dx && !o.dy) return o;
  const c = Math.cos(ang), s = Math.sin(ang), world = [];
  for (let i = 0; i < pts.length; i += 2) {
    const px = pts[i] * sx, py = pts[i + 1];
    world.push(x + px * c - py * s, y + px * s + py * c);
  }
  const band = (from, to, ink) => {
    const base = world.map((v, i) => v + (i % 2 ? o.dy : o.dx) * from);
    const dx = o.dx * (to - from), dy = o.dy * (to - from);
    g.fillStyle = mixColor(ink, side.ink, side.k);
    paintSweep(g, base, dx, dy, facingEdges(base, dx, dy));
  };
  band(0, bandK, low);
  band(bandK, 1, high);
  return o;
}

/** El contorno de un casco de semieslora L y semimanga H (proa en +x), como lo dibuja `hull`. */
export function hullOutline(L, H) {
  return [L, 0, 0.55 * L, -0.82 * H, 0, -0.97 * H, -0.7 * L, -0.9 * H, -L, -0.45 * H,
    -L, 0.45 * H, -0.7 * L, 0.9 * H, 0, 0.97 * H, 0.55 * L, 0.82 * H];
}
