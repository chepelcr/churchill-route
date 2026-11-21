// LAS FORMAS DE LA FERIA EN 3D — la geometría de cada juego que se levanta y se mueve.
//
// Mismo corte que la flora: la ESPECIE es data y la FORMA es código. `feriaAssets.json → <juego>.view3d`
// dice qué forma lo dibuja, sus medidas (en metros, o en fracciones de su radio con sufijo K) y todas
// sus tintas; acá queda cómo se arma una rueda de Chicago, un martillo, un barco pirata, una tómbola,
// una casa del terror, el escenario del DJ y un carrito chocón con el aparejo de `rig3d.js`.
//
// Cada forma ENCOLA sus piezas con su altura (`R.at`) y quien llama hace `R.flush()`. La misma forma
// se corre dos veces por cuadro: una con el mapeo del sol (su sombra, de un solo color) y otra con el
// de la cámara. El movimiento sale del reloj `t` y de la fase del juego, igual que el arte plano.
const TAU = Math.PI * 2;
const pick = (list, i) => list[((i % list.length) + list.length) % list.length];

/** LA RUEDA DE CHICAGO: dos aros paralelos, rayos, travesaños, góndolas que cuelgan derechas, y dos
 *  caballetes en A que la sostienen del eje. Desde arriba se lee como una escalera que se abre al
 *  alejarse de la cámara. */
function wheel(R, { rM, t, ph, V }) {
  const I = V.inks, Rw = V.wheelK * rM, Hh = Rw + V.clearM, D = V.depthM, sp = V.legSpreadK * rM;
  const spin = t * V.spin * TAU + ph, n = V.cabins, [cu, cv, ch] = V.cabinM;
  const [bw, bd, bh] = V.baseM;
  R.at(bh, () => R.box(0, 0, 0, bh, bw, bd, { top: I.baseTop, side: I.base }));
  for (const s of [-1, 1]) {
    const vy = s * (D / 2 + V.legOutM);
    for (const e of [-1, 1]) R.at(Hh * 0.45, () => R.line([[e * sp, vy, bh], [0, s * (D / 2 + 0.2), Hh]], V.legM, I.leg));
  }
  R.at(Hh, () => R.line([[0, -(D / 2 + 0.3), Hh], [0, D / 2 + 0.3, Hh]], V.axleM, I.hub));
  const rimPt = (a, v, k = 1) => [Math.cos(a) * Rw * k, v, Hh + Math.sin(a) * Rw * k];
  const seg = 36;
  for (const s of [-1, 1]) {
    const v = s * D / 2;
    for (let k = 0; k < seg; k++) {
      const a0 = spin + k / seg * TAU, a1 = spin + (k + 1) / seg * TAU;
      const p0 = rimPt(a0, v), p1 = rimPt(a1, v), q0 = rimPt(a0, v, V.innerK), q1 = rimPt(a1, v, V.innerK);
      R.at((p0[2] + p1[2]) / 2, () => R.line([p0, p1], V.rimM, I.rim));
      R.at((q0[2] + q1[2]) / 2, () => R.line([q0, q1], V.rimM * 0.7, I.rim2));
    }
    for (let k = 0; k < V.spokes; k++) {
      const a = spin + k / V.spokes * TAU, p = rimPt(a, v);
      R.at((Hh + p[2]) / 2, () => R.line([[0, v, Hh], p], V.spokeM, I.spoke));
    }
  }
  R.at(Hh + 0.01, () => { for (const s of [-1, 1]) R.dot([0, s * (D / 2 + 0.3), Hh], V.hubM, I.hub); });
  for (let i = 0; i < n; i++) {
    const a = spin + i / n * TAU, p = rimPt(a, 0), top = p[2] - V.hangM;
    R.at(p[2], () => R.line([[p[0], -D / 2, p[2]], [p[0], D / 2, p[2]]], V.spokeM, I.rim2));
    R.at(top, () => {
      R.box(p[0], 0, top - ch, top, cu, cv, { top: pick(I.cabinRoof, i), side: pick(I.cabins, i) });
    });
    R.at(p[2] + 0.02, () => { if (!R.shadow) R.dot(p, V.bulbM, pick(I.bulbs, i)); });
  }
}

/** EL MARTILLO (un «kamikaze»): una torre, y a cada lado un brazo que da la vuelta entera con su
 *  góndola en una punta y el contrapeso en la otra. Los dos brazos van en espejo. */
function hammer(R, { rM, t, ph, V }) {
  const I = V.inks, L = V.armK * rM, Lc = V.counterK * L, Ht = L + V.clearM;
  const [bw, bd, bh] = V.baseM, [tw, td] = V.towerM, [gl, gw, gt] = V.gondolaM;
  R.at(bh, () => R.box(0, 0, 0, bh, bw, bd, { top: I.baseTop, side: I.base }));
  R.at(Ht * 0.5, () => R.box(0, 0, bh, Ht + 0.4, tw, td, { top: I.towerTop, side: I.tower }));
  V.arms.forEach((arm, k) => {
    const sw = Math.sin(t * V.swing.speed * TAU + (arm.phase || 0) + ph) * V.swing.amp - Math.PI / 2;
    const dir = [Math.cos(sw), 0, -Math.sin(sw)], perp = [Math.sin(sw), 0, Math.cos(sw)];
    const v = arm.side * (td / 2 + V.armGapM), hub = [0, v, Ht];
    const at = (d) => [hub[0] + dir[0] * d, v, hub[2] + dir[2] * d];
    const mid = at((L - Lc) / 2), end = at(L), cw = at(-Lc);
    const half = (L + Lc) / 2, w = V.armWM / 2;
    R.at(mid[2], () => R.obox(mid, [dir[0] * half, 0, dir[2] * half], [0, w, 0], [perp[0] * w * 0.7, 0, perp[2] * w * 0.7], I.arm));
    R.at(cw[2], () => R.obox(cw, [dir[0] * V.counterM, 0, dir[2] * V.counterM], [0, V.counterM, 0], [perp[0] * V.counterM, 0, perp[2] * V.counterM], I.counter));
    R.at(end[2] + gt, () => R.obox(end, [dir[0] * gl / 2, 0, dir[2] * gl / 2], [0, gw / 2, 0], [perp[0] * gt / 2, 0, perp[2] * gt / 2],
      { top: pick(I.gondolaTop, k), side: pick(I.gondola, k) }));
    R.at(Ht + 0.5, () => R.dot(hub, V.hubM, I.hub));
  });
  R.at(Ht + 0.6, () => { if (!R.shadow) for (let i = 0; i < V.bulbs; i++) R.dot([(i / (V.bulbs - 1) - 0.5) * bw, bd / 2, bh + 0.05], V.bulbM, pick(I.bulbs, i)); });
}

/** EL BARCO PIRATA: dos caballetes en A con su eje arriba, y el casco que se mece colgado de él —
 *  proa y popa levantadas, cubierta con sus bancas, y el costado que mira a la cámara. */
function swingboat(R, { rM, t, ph, V }) {
  const I = V.inks, Rp = V.pivotK * rM, Hp = Rp + V.clearM, L = V.lengthK * rM, Wb = V.beamM, sp = V.legSpreadK * rM;
  const a = Math.sin(t * V.swing.speed * TAU + ph) * V.swing.amp;
  const cu = Rp * Math.sin(a), ch = Hp - Rp * Math.cos(a), ca = Math.cos(a), sa = Math.sin(a);
  const B = (s, v, z) => [cu + s * ca - z * sa, v, ch + s * sa + z * ca];
  const fv = Wb / 2 + V.frameOutM;
  for (const s of [-1, 1]) for (const e of [-1, 1]) R.at(Hp * 0.4, () => R.line([[e * sp, s * fv, 0], [0, s * fv, Hp]], V.legM, I.frame));
  R.at(Hp + 0.1, () => R.line([[0, -fv, Hp], [0, fv, Hp]], V.axleM, I.frame));
  const N = 14, deck = [], keel = [], half = (k) => (k / N * 2 - 1);
  for (let k = 0; k <= N; k++) {
    const q = half(k), s = q * L / 2, w = Wb / 2 * Math.pow(Math.max(0, 1 - Math.abs(q) ** 2.4), 0.55);
    const zd = V.sheerM * q * q;
    deck.push([s, w, zd]); keel.push([s, 0, zd - V.depthM * (1 - q * q * 0.85)]);
  }
  for (const side of [-1, 1]) {
    const edge = deck.map(([s, w, z]) => B(s, side * w, z));
    const bottom = keel.map(([s, , z]) => B(s, 0, z)).reverse();
    R.at(ch - 0.2, () => { if (R.faces(B(0, side * Wb / 2, 0), [0, side, 0])) R.poly([...edge, ...bottom], I.hull); });
  }
  const top = [...deck.map(([s, w, z]) => B(s, w, z)), ...deck.slice().reverse().map(([s, w, z]) => B(s, -w, z))];
  R.at(ch + 0.2, () => {
    R.poly(top, I.deck, R.shadow ? null : I.trim, V.trimM);
    if (R.shadow) return;
    for (let k = 1; k < V.benches + 1; k++) {
      const q = k / (V.benches + 1) * 2 - 1, s = q * L / 2 * 0.86, w = Wb / 2 * Math.pow(Math.max(0, 1 - Math.abs(q) ** 2.4), 0.55) * 0.82, z = V.sheerM * q * q + 0.05;
      R.line([B(s, -w, z), B(s, w, z)], V.benchM, I.bench);
    }
  });
  for (const e of [-1, 1]) {
    const z0 = V.sheerM, tip = B(e * L / 2 * 1.04, 0, z0 + V.prowM);
    R.at(ch + 0.4, () => R.line([B(e * L / 2, 0, z0), tip], V.legM * 1.2, I.trim));
    for (const side of [-1, 1]) R.at(ch + 0.3, () => R.line([[0, side * (Wb / 2 + 0.25), Hp], B(e * L * V.hangK, side * Wb / 2, V.sheerM * (2 * V.hangK) ** 2)], V.armM, I.frame));
  }
}

/** LA TÓMBOLA: el mostrador, su tablero de premios atrás, y la rueda de la fortuna sobre el tablero,
 *  recostada hacia atrás y girando de frente a quien juega. */
function wheelstall(R, { rM, t, ph, V }) {
  const I = V.inks, [cwK, cdK] = V.counterK, chh = V.counterHM, [bwK, bdK] = V.boardK, bh = V.boardHM;
  const cw = cwK * rM, cd = cdK * rM, bw = bwK * rM, bd = bdK * rM, bv = -cd / 2 - bd / 2;
  R.at(chh, () => R.box(0, 0, 0, chh, cw, cd, { top: I.counterTop, side: I.counter }));
  R.at(chh + 0.01, () => { if (!R.shadow) R.box(0, cd / 2 - 0.1, chh * 0.55, chh * 0.85, cw * 1.001, 0.2, I.counterBand); });
  R.at(bh, () => R.box(0, bv, 0, bh, bw, bd, { top: I.boardTop, side: I.board }));
  // la rueda de la fortuna se RECUESTA hacia atrás (`tiltDeg` desde la vertical): parada derecha, desde
  // arriba sería una raya; recostada se ve su cara con los gajos girando, como la ve quien juega
  const r = V.drumK * rM, th = V.tiltDeg * Math.PI / 180, spin = t * V.spin * TAU + ph;
  const e1 = [1, 0, 0], e2 = [0, -Math.sin(th), Math.cos(th)], nr = [0, Math.cos(th), Math.sin(th)];
  const c = [0, bv + bd / 2 + V.drumOutM, bh + V.drumTopM];
  const at = (a, rr, off) => [c[0] + e1[0] * Math.cos(a) * rr + nr[0] * off, c[1] + e2[1] * Math.sin(a) * rr + nr[1] * off, c[2] + e2[2] * Math.sin(a) * rr + nr[2] * off];
  R.at(bh + 0.3, () => R.line([[0, bv, bh], at(0, 0, -V.drumDepthM)], V.rimM * 3, I.board));
  R.at(bh + r, () => {
    const ring = (off, k = 1) => Array.from({ length: 28 }, (_, i) => at(i / 28 * TAU, r * k, off));
    R.poly(ring(-V.drumDepthM), I.drumBack);
    R.poly(ring(0), I.drum, R.shadow ? null : I.drumRim, V.rimM);
    if (R.shadow) return;
    for (let k = 0; k < V.spokes; k++) {
      const a0 = spin + k / V.spokes * TAU, a1 = spin + (k + 0.5) / V.spokes * TAU;
      R.poly([at(0, 0, 0.02), ...[0, 1, 2, 3, 4].map((j) => at(a0 + (a1 - a0) * j / 4, r * 0.94, 0.02))], pick(I.wedges, k));
    }
    R.dot(at(0, 0, 0.04), V.pointerM, I.drumRim);
    R.poly([at(Math.PI / 2 - 0.12, r * 1.12, 0.05), at(Math.PI / 2 + 0.12, r * 1.12, 0.05), at(Math.PI / 2, r * 0.86, 0.05)], I.pointer);
  });
  R.at(chh + 0.05, () => { if (!R.shadow) for (let i = 0; i < V.bulbs; i++) R.dot([(i / (V.bulbs - 1) - 0.5) * cw * 0.94, cd / 2, chh + 0.02], V.bulbM, pick(I.bulbs, i)); });
}

/** LA CASA DEL TERROR: un galpón pintado con su pretil morado; la PUERTA va en la pared —entrada de
 *  un lado, salida del otro—, con sus ojos que brillan arriba y el letrero sobre la entrada. */
function funhouse(R, { rM, t, V }) {
  const I = V.inks, W = V.widthK * rM, D = V.depthK * rM, H = V.heightM, p = V.parapetM;
  R.at(H, () => R.box(0, 0, 0, H, W, D, { top: I.roof, side: I.wall }));
  R.at(H + p, () => {
    R.box(0, -D / 2 + p / 2, H, H + p, W, p, I.trim); R.box(0, D / 2 - p / 2, H, H + p, W, p, I.trim);
    R.box(-W / 2 + p / 2, 0, H, H + p, p, D, I.trim); R.box(W / 2 - p / 2, 0, H, H + p, p, D, I.trim);
  });
  const blink = 0.5 + 0.5 * Math.sin(t * V.blinkHz * TAU);
  for (const side of [-1, 1]) {
    const v = side * (D / 2 + 0.03);
    // la puerta, su marco, el letrero y los ojos van SOBRE la pared: se encolan después del galpón
    R.at(H + 0.01, () => {
      if (!R.faces([0, v, 1], [0, side, 0])) return;
      R.box(V.doorAtK * W * side, v, 0, V.doorM[1] + 0.3, V.doorM[0] + 0.6, 0.05, I.doorFrame);
      R.box(V.doorAtK * W * side, v + side * 0.02, 0, V.doorM[1], V.doorM[0], 0.06, I.door);
      R.box(V.doorAtK * W * side, v, V.doorM[1], V.doorM[1] + V.signM[1], V.signM[0], 0.08, side > 0 ? I.sign : I.sign2);
      for (const ex of [-1, 1]) R.box(ex * W * V.eyeK, v, V.eyeHM, V.eyeHM + V.eyeM, V.eyeM * 1.6, 0.05, blink > 0.5 ? I.eye : I.eyeDim);
    });
  }
  R.at(H + p + 0.05, () => {
    if (R.shadow) return;
    for (let i = 0; i < V.bulbs; i++) {
      const q = i / V.bulbs, per = 2 * (W + D) * q;
      const [u, v] = per < W ? [-W / 2 + per, -D / 2] : per < W + D ? [W / 2, -D / 2 + per - W] : per < 2 * W + D ? [W / 2 - (per - W - D), D / 2] : [-W / 2, D / 2 - (per - 2 * W - D)];
      R.dot([u, v, H + p], V.bulbM, pick(I.bulbs, i));
    }
  });
}

/** La pantalla del DJ: las cuatro esquinas del muro de LED recostado sobre el telón, en metros del
 *  marco del escenario — [abajo-izq, abajo-der, arriba-der, arriba-izq]. La usa la forma (de día,
 *  apagada) y el pase nocturno de `attractions.js` (prendida), así que las dos caen en el mismo lugar. */
export function djScreenCorners(V, rM) {
  const S = V.screen, K = (k) => k * rM, [x0, , x1, y1] = V.curtainK.map(K);
  const ins = (x1 - x0) * S.insetK, th = S.tiltDeg * Math.PI / 180, Ls = V.curtainM * S.heightK;
  const v0 = y1 + 0.05, h0 = V.deckM + 0.3, v1 = v0 - Ls * Math.sin(th), h1 = h0 + Ls * Math.cos(th);
  return [[x0 + ins, v0, h0], [x1 - ins, v0, h0], [x1 - ins, v1, h1], [x0 + ins, v1, h1]];
}

/** EL ESCENARIO DEL DJ: la tarima, el telón al fondo, el truss en el aire con su dosel, las dos torres
 *  de bocinas que laten, la consola con su franja de luz, y el DJ detrás de ella. Mira a +v (al público). */
function stage(R, { rM, t, V }) {
  const I = V.inks, K = (k) => k * rM, H = V.deckM, T = V.trussM;
  const [x0, y0, x1, y1] = V.deckK.map(K);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, w = x1 - x0, d = y1 - y0;
  R.at(H, () => {
    R.box(cx, cy, 0, H, w, d, { top: I.deck, side: I.deckSide });
    if (R.shadow) return;
    for (let k = 1; k < V.planks; k++) { const v = y0 + d * k / V.planks; R.line([[x0 + 0.3, v, H + 0.01], [x1 - 0.3, v, H + 0.01]], 0.08, I.plank); }
  });
  const [bx0, by0, bx1, by1] = V.curtainK.map(K);
  R.at(H + V.curtainM, () => R.box((bx0 + bx1) / 2, (by0 + by1) / 2, H, H + V.curtainM, bx1 - bx0, by1 - by0, { top: I.curtainTop, side: I.curtain }));
  if (V.screen) R.at(H + V.curtainM + 0.05, () => {
    const c = djScreenCorners(V, rM);
    R.poly(c, R.shadow ? I.curtain : V.screen.off, R.shadow ? null : V.screen.frame, 0.25);
  });
  const posts = [[x0 + 0.4, y0 + 0.4], [x1 - 0.4, y0 + 0.4], [x0 + 0.4, y1 - 0.4], [x1 - 0.4, y1 - 0.4]];
  for (const [u, v] of posts) R.at(T * 0.5, () => R.box(u, v, H, T, V.postM, V.postM, I.truss));
  R.at(T + 0.2, () => {
    const b = V.beamM;
    R.box(cx, y0 + 0.4, T, T + b, w - 0.4, b, I.truss); R.box(cx, y1 - 0.4, T, T + b, w - 0.4, b, I.truss);
    R.box(x0 + 0.4, cy, T, T + b, b, d - 0.4, I.truss); R.box(x1 - 0.4, cy, T, T + b, b, d - 0.4, I.truss);
  });
  const [dx0, dy0, dx1, dy1] = V.doselK.map(K);
  R.at(T + 0.5, () => {
    R.box((dx0 + dx1) / 2, (dy0 + dy1) / 2, T + 0.1, T + V.doselM, dx1 - dx0, dy1 - dy0, { top: I.dosel, side: I.doselSide });
    // el nombre, pintado sobre el dosel: sin píldora, las letras sobre la lona
    const N = V.doselName;
    if (N) R.text([(dx0 + dx1) / 2, (dy0 + dy1) / 2, T + V.doselM + 0.02], [1, 0, 0], N.text,
      (dy1 - dy0) * N.heightK, (dx1 - dx0) * N.widthK, N.ink, N.font);
  });
  const pump = 1 + Math.sin(t * V.pump.speed * TAU) * V.pump.amp, [sw, sd, shh] = V.speakerM;
  for (const e of [-1, 1]) {
    const u = e * K(V.speakerAtK[0]), v = K(V.speakerAtK[1]);
    R.at(H + shh, () => {
      R.box(u, v, H, H + shh, sw, sd, I.speaker);
      if (R.shadow || !R.faces([u, v + sd / 2, H + 1], [0, 1, 0])) return;
      for (const [hh, rr] of V.cones) R.poly(R.circle([u, v + sd / 2 + 0.03, H + shh * hh], [1, 0, 0], [0, 0, 1], rr * pump, 16), I.cone);
    });
  }
  const [kx0, ky0, kx1, ky1] = V.consoleK.map(K);
  R.at(H + V.consoleM, () => {
    R.box((kx0 + kx1) / 2, (ky0 + ky1) / 2, H, H + V.consoleM, kx1 - kx0, ky1 - ky0, { top: I.console, side: I.consoleSide });
    if (!R.shadow) R.box((kx0 + kx1) / 2, (ky0 + ky1) / 2, H + V.consoleM, H + V.consoleM + 0.05, (kx1 - kx0) * 0.84, (ky1 - ky0) * 0.34, I.consoleLight);
  });
  const [px, py] = V.djAtK.map(K), bob = Math.sin(t * V.pump.speed * TAU) * V.djBobM, [tw, td, th] = V.djM;
  R.at(H + th + V.headM, () => {
    R.box(px, py, H, H + th + bob, tw, td, { top: I.shirt, side: I.shirtSide });
    R.poly(R.circle([px, py, H + th + bob + V.headM * 0.5], [1, 0, 0], [0, 1, 0], V.headM, 14), I.skin);
    if (!R.shadow) R.poly(R.circle([px, py - V.headM * 0.25, H + th + bob + V.headM * 0.55], [1, 0, 0], [0, 1, 0], V.headM * 0.62, 12), I.hair);
  });
  R.at(H + 0.02, () => {
    if (R.shadow) return;
    const n = V.bulbs;
    for (let i = 0; i < n; i++) {
      const per = 2 * (w + d) * i / n;
      const [u, v] = per < w ? [x0 + per, y0] : per < w + d ? [x1, y0 + per - w] : per < 2 * w + d ? [x1 - (per - w - d), y1] : [x0, y1 - (per - 2 * w - d)];
      const tw2 = 0.55 + 0.45 * Math.sin(t * 3 + i * 1.7);
      if (tw2 > 0.35) R.dot([u, v, H], V.bulbM, pick(I.bulbs, i));
    }
  });
}

/** UN CARRITO CHOCÓN: la llanta de hule alrededor, la carrocería con su trompa, el asiento, el
 *  chofer, y la vara que sube a la red del techo con su chispa. (u, v) en metros dentro del juego. */
export function bumperCar(R, u, v, ang, z, color, V, i, t) {
  const I = V.inks, ca = Math.cos(ang), sa = Math.sin(ang);
  const L = (a, b) => [u + a * ca - b * sa, v + a * sa + b * ca];
  const [bl, bw] = V.bumperM, [cl, cw] = V.bodyM;
  R.at(z + 0.4, () => R.box(u, v, z, z + V.bumperHM, bl, bw, I.bumper, ang));
  R.at(z + 0.9, () => {
    R.box(u, v, z + V.bumperHM, z + V.bodyHM, cl, cw, { top: color, side: color }, ang);
    const [nu, nv] = L(cl / 2 - V.noseM[0] / 2 + 0.1, 0);
    R.box(nu, nv, z + V.bumperHM, z + V.noseHM, V.noseM[0], V.noseM[1], { top: color, side: color }, ang);
    const [su, sv] = L(-cl * 0.22, 0);
    R.box(su, sv, z + V.bodyHM, z + V.seatHM, V.seatM[0], V.seatM[1], I.seat, ang);
  });
  const [du, dv] = L(-cl * 0.05, 0);
  R.at(z + V.headHM, () => {
    R.box(du, dv, z + V.bodyHM, z + V.headHM - V.headM, 0.5, 0.7, pick(I.shirts, i), ang);
    R.poly(R.circle([du, dv, z + V.headHM], [1, 0, 0], [0, 1, 0], V.headM, 10), I.skin);
  });
  const [pu, pv] = L(-cl / 2 + 0.15, 0);
  R.at(z + V.poleM, () => {
    R.line([[pu, pv, z + V.bodyHM], [pu, pv, z + V.poleM]], V.poleWM, I.pole);
    if (!R.shadow && Math.sin(t * 9 + i * 2.3) > 0.6) R.dot([pu, pv, z + V.poleM], V.sparkM, I.spark);
  });
}

export const FERIA_FORMS = Object.freeze({ wheel, hammer, swingboat, wheelstall, funhouse, stage });
export const FERIA_FORM_NAMES = Object.freeze(Object.keys(FERIA_FORMS));
