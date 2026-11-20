// LAS GRADERÍAS EN 3D — un estadio se levanta como los edificios nuevos (`bodies.js`).
//
// Parte de las MISMAS gradas que el mundo ya estampó como pared (`lm.stands.quads`: cada una con su
// baranda contra la cancha, `p0 p1`, y su espalda, `p3 p2`), así que el arte y la colisión no pueden
// separarse. Lo que cada lado ES lo dice el registro (`world-props.json → stadiums3d.<id>.sides`):
//
// * `terrace` — las graderías abiertas de concreto: escalones que suben de la baranda hacia la calle,
//   con sus pasillos amarillos y la baranda de atrás. `overM` es cuánto VUELAN sobre la calle más allá
//   de la franja estampada (media calle en el Lito Pérez): ahí el carro pasa POR DEBAJO, entre los
//   pilotes que la sostienen. Por eso se pintan encima del carro (`queueBody(…, over)`).
// * `building` — el edificio techado de la tribuna principal: planta baja con su zócalo y sus bloques
//   calados hacia la calle, la tribuna cubierta arriba con sus columnas, el frontón del centro y el techo
//   a un agua. No pasa sobre la calle; se mete `innerM` en la cuadra.
//
// La geometría sale en PÍXELES DE MUNDO (el cuerpo se arma con un marco identidad) y las alturas en
// metros, como cualquier cuerpo. Se arma una vez por estadio.
import { buildBody } from "./bodyGeometry.js";
import { queueBody } from "./bodies.js";
import { PX_PER_M } from "../../domain/units.js";

const built = new Map();
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const add = (a, v, k) => [a[0] + v[0] * k, a[1] + v[1] * k];
const r1 = (v) => Math.round(v * 10) / 10;

/** El marco de una grada: baranda A→B, espalda D (junto a A) → C (junto a B), y su normal hacia afuera. */
function standFrame(q) {
  const A = [q[0], q[1]], B = [q[2], q[3]], C = [q[4], q[5]], D = [q[6], q[7]];
  const ex = B[0] - A[0], ey = B[1] - A[1], L = Math.hypot(ex, ey) || 1;
  let n = [-ey / L, ex / L];
  const mx = (C[0] + D[0]) / 2 - (A[0] + B[0]) / 2, my = (C[1] + D[1]) / 2 - (A[1] + B[1]) / 2;
  if (n[0] * mx + n[1] * my < 0) n = [-n[0], -n[1]];
  return { A, B, C, D, n, L, depth: Math.abs(n[0] * mx + n[1] * my) };
}

// una cara: sin sombra propia ni costura —la grada tira UNA sombra con su bloque `shadowOnly`, y cientos de
// caras con su barrido y su trazo cada una costaban más de diez milisegundos por cuadro—
const facet = (pts, ink, ink2 = null, wall = false) => ({ facet: pts.map(([x, y, z]) => [r1(x), r1(y), z]), ink, noShadow: true, seam: false,
  ...(wall ? { wallFacet: true } : { ink2: ink2 || ink }) });

/** UNA GRADERÍA ABIERTA: escalones de la baranda a la espalda, que se alarga `overM` sobre la calle. */
function terrace(q, S, I, ppm) {
  const F = standFrame(q), over = (S.overM || 0) * ppm;
  const A = F.A, B = F.B, Ab = add(F.D, F.n, over), Bb = add(F.C, F.n, over);
  const N = S.steps, zf = S.frontM, zb = S.backM, zu = S.underBackM ?? 0;
  const at = (u, v) => lerp(lerp(A, B, v), lerp(Ab, Bb, v), u);
  const zStep = (k) => zf + (zb - zf) * k / Math.max(1, N - 1);
  const out = [];
  // los costados: el perfil de la grada, de la baranda a la espalda (su cara de abajo, inclinada)
  for (const v of [0, 1]) out.push(facet([[...at(0, v), 0], [...at(1, v), zu], [...at(1, v), zb], [...at(0, v), zf]], I.side, null, true));
  // los pilotes de atrás, y una fila a la mitad de lo que vuela: se pintan primero (`sortM: 0`)
  if (over > 0 && S.pillarEveryM) {
    const cnt = Math.max(2, Math.round(F.L / ppm / S.pillarEveryM) + 1), w = S.pillarM * ppm / 2;
    const rows = [[1, zu], ...(S.midPillars ? [[1 - (over / 2) / (F.depth + over), zu * (1 - (over / 2) / (F.depth + over))]] : [])];
    for (const [u, z] of rows) for (let k = 0; k < cnt; k++) {
      const [x, y] = at(u, (k + 0.5) / cnt);
      out.push({ poly: [[x - w, y - w], [x + w, y - w], [x + w, y + w], [x - w, y + w]], z: [0, +z.toFixed(2)], sortM: 0,
        wall: I.pillar, cap: I.pillar, bands: [[0, S.pillarFootK, I.pillarFoot]] });
    }
  }
  // los escalones: la huella de cada uno y, delante, su contrahuella
  for (let k = 0; k < N; k++) {
    const u0 = k / N, u1 = (k + 1) / N, z = zStep(k), zPrev = k ? zStep(k - 1) : 0;
    out.push(facet([[...at(u0, 0), zPrev], [...at(u0, 1), zPrev], [...at(u0, 1), z], [...at(u0, 0), z]], I.riser, null, true));
    // dos tonos por PROFUNDIDAD, como la grada plana de antes: adelante `tread`, atrás desde `roofFrom` `treadBack`
    const ti = u0 >= (S.roofFrom ?? 1) && I.treadBack ? I.treadBack : I.tread;
    out.push(facet([[...at(u0, 0), z], [...at(u0, 1), z], [...at(u1, 1), z], [...at(u1, 0), z]], ti, ti));
  }
  // los pasillos: UNA franja amarilla por pasillo, de la baranda a la espalda sobre las narices de los
  // escalones, pintada después de ellos (`sortM`)
  if (S.aisleEveryM) {
    const cnt = Math.max(1, Math.round(F.L / ppm / S.aisleEveryM)), hw = S.aisleM / 2 * ppm / F.L;
    for (let a = 1; a < cnt; a++) {
      const v = a / cnt;
      // CON LA FORMA DE LA ESCALERA: el borde de la franja sube peldaño por peldaño (huella y contrahuella)
      // de un lado y baja del otro. Una sola cara —el pintor proyecta cada vértice a su altura, no le pide
      // que sea plana—, así que un pasillo sigue costando un relleno
      const side = (vv) => { const pts = []; for (let k = 0; k < N; k++) { const z = zStep(k) + 0.04, zp = k ? zStep(k - 1) + 0.04 : 0;
        pts.push([...at(k / N, vv), zp], [...at(k / N, vv), z], [...at((k + 1) / N, vv), z]); } return pts; };
      out.push({ ...facet([...side(v - hw), ...side(v + hw).reverse()], I.aisle), sortM: zb + 0.1 });
    }
  }
  // LA SOMBRA DE LA GRADA, de una vez: un bloque que sólo existe para tirarla
  out.push({ poly: [at(0, 0), at(0, 1), at(1, 1), at(1, 0)].map(([x, y]) => [r1(x), r1(y)]), z: [0, +(zb * 0.75).toFixed(2)], shadowOnly: true, wall: I.back, cap: I.back });
  // la espalda (lo que se ve desde la calle) y la baranda encima
  out.push(facet([[...at(1, 0), zu], [...at(1, 1), zu], [...at(1, 1), zb], [...at(1, 0), zb]], I.back, null, true));
  if (S.railM) out.push(facet([[...at(1, 0), zb], [...at(1, 1), zb], [...at(1, 1), zb + S.railM], [...at(1, 0), zb + S.railM]], I.rail, null, true));
  return out;
}

/** LA TRIBUNA TECHADA: el edificio de la grada principal, sobre su franja y `innerM` dentro de la cuadra. */
function building(q, S, I, ppm) {
  const F = standFrame(q), inner = (S.innerM || 0) * ppm;
  const Ai = add(F.A, F.n, -inner), Bi = add(F.B, F.n, -inner), Ao = F.D, Bo = F.C;
  const poly = [Ai, Bi, Bo, Ao].map(([x, y]) => [r1(x), r1(y)]);        // aristas: 0 cancha, 1 fin B, 2 calle, 3 fin A
  const out = [];
  const Lm = F.L / ppm, holes = [], doors = [];
  for (let k = 0; k < Math.floor(Lm / S.bayM); k++) {
    const f0 = (k + 0.12) / Math.floor(Lm / S.bayM), f1 = (k + 0.88) / Math.floor(Lm / S.bayM);
    if (k % S.doorEvery === S.doorEvery - 1) doors.push({ edge: 2, f: [1 - f1 + 0.02, 1 - f0 - 0.02], z: [0, 2.9], ink: I.door });
    else holes.push({ edge: 2, f: [1 - f1, 1 - f0], z: [S.groundM * 0.58, S.groundM * 0.92], ink: I.lattice });
  }
  out.push({ poly, z: [0, S.groundM], wall: I.wall, cap: I.slab, bands: [[0, 0.55, I.base]], openings: [...holes, ...doors] });
  // la tribuna de arriba: su piso, las columnas de la baranda de la calle y el frontón del centro
  out.push({ poly, z: [S.groundM, S.groundM + 0.25], wall: I.slab, cap: I.slab });
  const cols = Math.max(2, Math.round(Lm / S.columnEveryM));
  for (let k = 0; k <= cols; k++) {
    const [x, y] = add(lerp(Ao, Bo, k / cols), F.n, -0.4 * ppm), w = 0.35 * ppm;
    out.push({ poly: [[x - w, y - w], [x + w, y - w], [x + w, y + w], [x - w, y + w]], z: [S.groundM + 0.25, S.groundM + S.columnM], wall: I.column, cap: I.column });
  }
  const mid = lerp(Ao, Bo, 0.5), u = [(Bo[0] - Ao[0]) / F.L, (Bo[1] - Ao[1]) / F.L], hw = S.pedimentWM / 2 * ppm, d = S.pedimentDM * ppm;
  const P = [add(add(mid, u, -hw), F.n, -d), add(add(mid, u, hw), F.n, -d), add(mid, u, hw), add(mid, u, -hw)].map(([x, y]) => [r1(x), r1(y)]);
  const ped = { poly: P, z: [S.groundM, S.pedimentM], wall: I.pediment, cap: I.pedimentTop, bands: [[0.9, 1, I.pedimentTop]], openings: [] };
  for (let k = 0; k < 3; k++) ped.openings.push({ edge: 2, f: [0.08 + k * 0.3, 0.3 + k * 0.3], z: [S.groundM + 0.7, S.groundM + 1.6], ink: I.lattice });
  out.push(ped);
  // el techo a un agua: alto del lado de la cancha, bajo hacia la calle, volando sobre la cancha
  const ov = (S.roofOverM || 0) * ppm;
  // …y metido `roofSetbackM` de la fachada: desde la calle se ve la tribuna de arriba, con sus columnas
  const sb = (S.roofSetbackM || 0) * ppm;
  const R = [add(Ai, F.n, -ov), add(Bi, F.n, -ov), add(Bo, F.n, -sb), add(Ao, F.n, -sb)];
  out.push(facet([[...R[0], S.roofHighM], [...R[1], S.roofHighM], [...R[2], S.roofLowM], [...R[3], S.roofLowM]], I.roof, I.roofShade));
  return out;
}

/** Arma (una vez) el estadio entero: un cuerpo por clase de grada. */
function buildStadium(lm, quads, cfg) {
  const ppm = PX_PER_M, sides = lm.stands?.sides || quads.map(() => lm.stands?.side);
  const groups = {};
  quads.forEach((q, i) => {
    const S = { roofFrom: cfg.roofFrom, ...(cfg.sides.all || {}), ...(cfg.sides[sides[i]] || {}) };
    if (!S.kind) return;
    const I = { ...(cfg.inks || {}), ...(S.inks || {}) };
    (groups[S.kind] ||= []).push(...(S.kind === "building" ? building(q, S, I, ppm) : terrace(q, S, I, ppm)));
  });
  const F = { ppm, ang: 0, at: ([x, y]) => [x, y] };
  // el centro del cuerpo es el de su caja: con el marco identidad `buildBody` lo pone en (0, 0), el origen
  // del mapa, y la perspectiva —que mide el tope desde el centro— aplastaba todas las alturas a casi nada
  return Object.values(groups).map((tiers) => {
    const S = buildBody({ tiers, perspective: true, noFade: true }, [0, 0], 0, F);
    S.x = (S.x0 + S.x1) / 2; S.y = (S.y0 + S.y1) / 2;
    return S;
  });
}

/** Encola las graderías 3D de un estadio, si el registro las tiene. Devuelve si lo hizo. */
export function queueStadium3d(lm, quads, cfg) {
  if (!cfg || !quads?.length) return false;
  let bodies = built.get(lm.id);
  if (!bodies) built.set(lm.id, (bodies = buildStadium(lm, quads, cfg)));
  // la paleta del estadio que el mundo emite (`$tierA`, `$tierB`, `$structure`)
  for (const S of bodies) queueBody(S, lm.stands?.palette || null, null, true);
  return true;
}

/** Las torres de luz donde las pone el registro: sobre la baranda de un lado, a una fracción de su largo,
 *  metidas `inM` hacia la cancha. `[[x, y], …]` en píxeles de mundo. */
export function stadiumTowerSpots(lm, quads, cfg) {
  const ppm = PX_PER_M, sides = lm.stands?.sides || quads.map(() => lm.stands?.side), out = [];
  for (const T of cfg?.towers || []) {
    const i = sides.indexOf(T.side);
    if (i < 0) continue;
    const F = standFrame(quads[i]);
    for (const f of T.at) out.push(add(lerp(F.A, F.B, f), F.n, -(T.inM || 0) * ppm));
  }
  return out;
}
